// S17 design and access audit: the S16 judge's paths (every screen of the trial flow on a fake phone, Pixel 7 with the
// S15 canvas camera, a fake clock, every YouCam call answered here, so 0 units) on the S17 design, plus two keyboard-only
// paths. Paths come from R/s17_paths.R; bars are in R/s17_score.R.
//   node scripts/s17-audit.mjs <paths.json> <outDir> [base=http://localhost:3123]      (S17_ONLY=d01,d13 runs some)
// Writes <outDir>/screens.csv (one row per screen check), stops.csv (one row per keyboard Tab stop), paths.json (each
// path's outcome, focus after each change, spoken lines, announcements) and one picture of each screen in shots/ (light)
// and shots_dark/ (dark).
// Each screen check, on top of S16's: what is animating as the screen appears; then, once that has finished, axe-core
// with the WCAG 2.0, 2.1 and 2.2 A and AA rules in the light and in the dark colour scheme, one rendered main, heading
// levels in order, sideways scroll at 320 px as well as 360 px, and buttons or disclosures under 44 px.
// Each keyboard Tab stop: the focus indicator's width, its contrast with what is painted behind it, and whether the
// focused control can be seen (in view and not covered).
import AxeBuilder from "@axe-core/playwright";
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import { findClaims } from "../tools/claim-lint/policy.ts";
import path from "node:path";
import { PNG } from "pngjs";

const [, , pathsFile, outDir, baseArg] = process.argv;
const base = (baseArg ?? "http://localhost:3123").replace(/\/$/, "");
const paths = JSON.parse(fs.readFileSync(pathsFile, "utf8"));
const NOISE = new Map(JSON.parse(fs.readFileSync(new URL("../src/data/noise.json", import.meta.url), "utf8")).map((n) => [n.concern, n]));
fs.mkdirSync(path.join(outDir, "shots"), { recursive: true });
fs.mkdirSync(path.join(outDir, "shots_dark"), { recursive: true });
const SHOTS = { light: new Set(), dark: new Set() };

// Claim words: the claim policy (tools/claim-lint/policy.ts; the S13 list until S20), searched in every text node,
// title, label and alternative text.
const GOAL_WORDS = {
  wrinkle: "fine lines and wrinkles",
  texture: "skin texture",
  age_spot: "dark spots",
  oiliness: "oiliness",
  redness: "redness",
  moisture: "dryness",
};
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const MASK_W = 270,
  MASK_H = 360,
  GAP_MS = 60_000,
  STEP_MS = 30_000,
  KB_MAX = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- calendar (the runner's own, from the trial design: 4 run-in days, then visits W weeks after the start) ----------
const addDays = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
function visitsFor(firstLook, verdict) {
  const v = [{ week: 2, days: 1, purpose: "safety" }];
  if (firstLook > 2 && firstLook < verdict) v.push({ week: firstLook, days: 2, purpose: "first_look" });
  v.push({ week: Math.max(verdict, 2), days: 3, purpose: "verdict" });
  return v;
}
/** UTC time at which the clock in `zone` reads `day` hh:mm. */
function localTime(day, hh, zone, mm = 0) {
  const [y, m, d] = day.split("-").map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let t = want;
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  for (let i = 0; i < 4; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    t += want - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  }
  return t;
}

// ---------- seeded numbers for the planted measurements ----------
function rng(seedText) {
  let a = [...seedText].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0) || 1, 7);
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
  return { next, normal };
}

/** A mask whose left image half (the person's right) and right image half (the person's left) have the given densities
 * (1000 x mean alpha / 255, the app's half-face measure), dithered so the mean is exact to about 0.01. */
function maskPng(left, right, r) {
  const png = new PNG({ width: MASK_W, height: MASK_H });
  const alphaFor = (density) => Math.min(255, Math.max(0, (density * 255) / 1000));
  const aR = alphaFor(right),
    aL = alphaFor(left);
  for (let y = 0; y < MASK_H; y++)
    for (let x = 0; x < MASK_W; x++) {
      const m = x < MASK_W / 2 ? aR : aL;
      const a = Math.floor(m) + (r.next() < m - Math.floor(m) ? 1 : 0);
      const i = 4 * (y * MASK_W + x);
      png.data[i] = 255;
      png.data[i + 1] = 255;
      png.data[i + 2] = 255;
      png.data[i + 3] = Math.min(255, a);
    }
  return PNG.sync.write(png);
}

// ---------- the fake phone camera (S15's canvas camera), speech and print stubs ----------
function fakePhone() {
  const W = 1080,
    H = 1440;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const frame = document.createElement("canvas");
  frame.width = W;
  frame.height = H;
  const fctx = frame.getContext("2d", { willReadFrequently: true });
  const images = new Map();
  const load = async (u) => {
    if (!u || images.has(u)) return;
    const im = new Image();
    im.src = u;
    await im.decode();
    images.set(u, im);
  };
  const render = (sc) => {
    fctx.fillStyle = "rgb(200,200,200)";
    fctx.fillRect(0, 0, W, H);
    if (sc.kind !== "face") return;
    const im = images.get(sc.url);
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight);
    fctx.drawImage(im, W / 2 - (im.naturalWidth * s) / 2, H / 2 - (im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
  };
  render({ kind: "blank" });
  setInterval(() => ctx.drawImage(frame, 0, 0), 33);
  const stream = c.captureStream(30);
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => stream.clone();
  window.__cam = {
    set: async (s) => {
      await load(s.url);
      render(s);
      ctx.drawImage(frame, 0, 0);
    },
  };
  window.__spoken = [];
  try {
    window.speechSynthesis.speak = (u) => window.__spoken.push(u.text);
    window.speechSynthesis.cancel = () => {};
  } catch {
    /* no speech object */
  }
  window.__printed = 0;
  window.print = () => {
    window.__printed += 1;
  };
}

// ---------- reading what the app kept on the phone (never opens a database that isn't there) ----------
const stored = (page) =>
  page.evaluate(async () => {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    } catch {
      /* storage blocked */
    }
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    if (!dbs.includes("fairtrial")) return { db: false, keys, trial: null, photos: [] };
    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open("fairtrial");
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    const all = (store) =>
      new Promise((res, rej) => {
        if (!db.objectStoreNames.contains(store)) return res([]);
        const g = db.transaction(store).objectStore(store).getAll();
        g.onsuccess = () => res(g.result);
        g.onerror = () => rej(g.error);
      });
    const trials = await all("trials");
    const photos = (await all("photos")).map((p) => ({ id: p.id, day: p.day, takenAt: p.takenAt, status: p.status, errorKind: p.errorKind ?? null }));
    db.close();
    const trial = trials.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
    return {
      db: true,
      keys,
      trial: trial && { id: trial.id, side: trial.side, goal: trial.goal, concerns: trial.concerns, stopped: trial.stopped, verdicts: trial.verdicts.map((v) => ({ week: v.week, purpose: v.purpose, verdict: v.result.verdict })), plan: { verdictWeek: trial.plan.verdictWeek, firstLookWeek: trial.plan.firstLookWeek, visits: trial.plan.visits } },
      photos: photos.sort((a, b) => a.takenAt - b.takenAt),
    };
  });

/** Wait until every finite animation and transition on the page has finished (at most 1.5 s). */
const settle = (page) =>
  Promise.race([
    page
      .evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
            .map((a) => a.finished.catch(() => null)),
        ).then(() => true),
      )
      .catch(() => false),
    sleep(1500),
  ]);

/** The rendered main's text (Next keeps pages visited earlier in the document, hidden, for the back button). */
const mainText = (page) => page.evaluate(() => [...document.querySelectorAll("main")].find((m) => m.getClientRects().length > 0)?.textContent ?? "");

// ---------- one screen check ----------
async function check(page, R, key, ready, { camera = false } = {}) {
  if (ready) await page.waitForSelector(ready, { timeout: STEP_MS });
  // what moves as the screen appears (on the reduced-motion paths nothing may run longer than 10 ms)
  const moving = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running" || a.playState === "pending")
      .map((a) => {
        const t = a.effect.getComputedTiming();
        return { name: a.animationName || a.transitionProperty || "animation", dur: Number(t.duration) || 0, endless: t.iterations === Infinity };
      }),
  );
  const long = moving.filter((m) => m.endless || m.dur > 10).map((m) => `${m.name}:${m.endless ? "endless" : Math.round(m.dur)}`);
  await settle(page);
  await page.waitForTimeout(100);
  const info = await page.evaluate(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const texts = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("script,style,template,noscript") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push(n.nodeValue);
    for (const el of document.querySelectorAll("[aria-label],[alt],[title],[placeholder]"))
      for (const a of ["aria-label", "alt", "title", "placeholder"]) if (el.hasAttribute(a)) texts.push(el.getAttribute(a));
    texts.push(document.title, document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "");
    const text = texts.join(" \n ");
    const small = [...document.querySelectorAll("button, summary")]
      .filter((b) => vis(b) && b.offsetParent !== null)
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ b }) => b.id || b.textContent.trim().slice(0, 24));
    const levels = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(vis).map((h) => Number(h.tagName[1]));
    let skip = "";
    levels.forEach((l, i) => {
      if (!skip && l > (i ? levels[i - 1] : 0) + 1) skip = levels.join("");
    });
    const a = document.activeElement;
    const focus = !a || a === document.body ? "BODY" : `${a.tagName}${a.id ? "#" + a.id : ""}`;
    return {
      h1: [...document.querySelectorAll("h1")].filter(vis).length,
      mains: [...document.querySelectorAll("main")].filter(vis).length,
      headings: levels.join(""),
      skip,
      focus,
      text,
      small,
      hscroll: document.documentElement.scrollWidth > window.innerWidth,
      title: document.title,
    };
  });
  info.claims = [...new Set(findClaims(info.text).map((c) => c.match))];
  const scan = async (scheme) => {
    const ax = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    if (!SHOTS[scheme].has(key)) {
      SHOTS[scheme].add(key);
      await page
        .screenshot({ path: path.join(outDir, scheme === "dark" ? "shots_dark" : "shots", `${key.replace(/:/g, "_")}.png`), fullPage: !camera })
        .catch(() => {});
    }
    return ax.violations;
  };
  const own = await scan(R.scheme);
  const other = R.scheme === "dark" ? "light" : "dark";
  await page.emulateMedia({ colorScheme: other });
  await page.waitForTimeout(60);
  await settle(page);
  const theirs = await scan(other);
  await page.emulateMedia({ colorScheme: R.scheme });
  await settle(page);
  const light = R.scheme === "light" ? own : theirs,
    dark = R.scheme === "light" ? theirs : own;
  const serious = (v) =>
    v
      .filter((x) => x.impact === "serious" || x.impact === "critical")
      .map((x) => x.id)
      .join("|");
  let hscroll360 = null,
    hscroll320 = null;
  if (!camera) {
    const vp = page.viewportSize();
    for (const w of [360, 320]) {
      await page.setViewportSize({ width: w, height: 640 });
      await page.waitForTimeout(150);
      const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (w === 360) hscroll360 = over;
      else hscroll320 = over;
    }
    await page.setViewportSize(vp);
  }
  const row = {
    path: R.id,
    kind: R.kind,
    type: R.type,
    scheme: R.scheme,
    motion: R.motion,
    screen: key,
    url: page.url().replace(base, ""),
    title: info.title,
    h1: info.h1,
    mains: info.mains,
    headings: info.headings,
    heading_skip: info.skip,
    focus: info.focus,
    claims: info.claims.join("|"),
    axe_light: serious(light),
    axe_dark: serious(dark),
    axe_all: [...light.map((v) => `light:${v.id}:${v.impact}`), ...dark.map((v) => `dark:${v.id}:${v.impact}`)].join("|"),
    anims_long: long.join("|"),
    hscroll: info.hscroll,
    hscroll360,
    hscroll320,
    small: info.small.join("|"),
    errors: R.errors.splice(0).join(" || "),
  };
  R.rows.push(row);
  return row;
}

/** Where focus is after a change on the screen, against where the design puts it (polled for up to 1 s). */
async function focusAfter(page, R, screen, want) {
  let got = null;
  for (let i = 0; i < 10; i++) {
    got = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a === document.documentElement) return "BODY";
      return `${a.tagName}${a.id ? "#" + a.id : ""}${a.getClientRects().length > 0 ? "" : "(hidden)"}`;
    });
    if (got === want) break;
    await page.waitForTimeout(100);
  }
  R.focus.push({ screen, want, got });
}

// ---------- the keyboard: Tab stops and actions ----------
/** The focused control: its focus indicator, the indicator's contrast with what is painted behind it, and whether the
 *  control can be seen. Runs in the page. */
function probeFocus() {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return { el: "BODY", text: "", indicator: false, width: 0, contrast: null, visible: false };
  const name = `${el.tagName}${el.id ? "#" + el.id : ""}${el.getAttribute("name") ? `[${el.getAttribute("name")}]` : ""}`;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  const rgba = (c) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "rgba(0,0,0,0)";
    cx.fillStyle = c;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / (a || 1)).concat(a);
  };
  // the colour painted at an element: its background over its ancestors', down to the page (null over photos or video)
  const paint = (e) => {
    const layers = [];
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      if (["VIDEO", "IMG", "CANVAS"].includes(n.tagName)) return null;
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 0.999) break;
    }
    let out = [255, 255, 255, 1];
    for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const x = lum(a),
      y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const cs = getComputedStyle(el);
  const width = cs.outlineStyle === "none" ? 0 : parseFloat(cs.outlineWidth) || 0;
  const indicator = width >= 2;
  const r = el.getBoundingClientRect();
  const W = innerWidth,
    H = innerHeight;
  let contrast = null,
    behind = "",
    ringRgb = "";
  if (indicator) {
    const ring = rgba(cs.outlineColor);
    ringRgb = ring.slice(0, 3).map(Math.round).join(" ");
    const off = (parseFloat(cs.outlineOffset) || 0) + width / 2;
    const pts = [
      [r.left - off, r.top + r.height / 2],
      [r.right + off, r.top + r.height / 2],
      [r.left + r.width / 2, r.top - off],
      [r.left + r.width / 2, r.bottom + off],
    ];
    for (const [x, y] of pts) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const under = document.elementsFromPoint(x, y).find((e) => e !== el && !el.contains(e));
      if (!under) continue;
      const bg = paint(under);
      if (!bg) continue;
      const c = ratio(ring, bg);
      if (contrast == null || c < contrast) behind = `${under.tagName}${under.id ? "#" + under.id : ""}.${String(under.className?.baseVal ?? under.className ?? "").split(/s+/).slice(0, 3).join(".")} ${bg.slice(0, 3).map(Math.round).join(" ")}`;
      contrast = contrast == null ? c : Math.min(contrast, c);
    }
  }
  const visible =
    r.width > 0 &&
    r.height > 0 &&
    [
      [0.5, 0.5],
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ].some(([fx, fy]) => {
      const x = r.left + fx * r.width,
        y = r.top + fy * r.height;
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    });
  return {
    el: name,
    text: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30),
    indicator,
    width,
    contrast: contrast == null ? null : Math.round(contrast * 100) / 100,
    ring: ringRgb,
    behind,
    visible,
  };
}

async function kbStop(page, R, why) {
  await page.waitForTimeout(30); // what the eye sees once the key press has been painted
  const s = await page.evaluate(probeFocus);
  R.stops.push({ path: R.id, n: R.stops.length + 1, why, ...s });
}

/** Tab (or Shift+Tab) until the control has focus, checking every stop on the way. */
async function kbFocus(page, R, target) {
  const radio = typeof target === "string" ? null : target.radio;
  const sel = radio ? `input[type="radio"][name="${radio}"]` : target;
  await page.waitForSelector(sel, { timeout: STEP_MS });
  for (let presses = 0; presses <= KB_MAX; presses++) {
    const where = await page.evaluate(
      ([s, rn]) => {
        const all = [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length > 0);
        if (!all.length) return "missing";
        const a = document.activeElement;
        if (rn ? a?.type === "radio" && a.name === rn : all.includes(a)) return "here";
        if (!a || a === document.body || a === document.documentElement) return "after";
        return a.compareDocumentPosition(all[0]) & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before";
      },
      [sel, radio],
    );
    if (where === "here") {
      R.kb.actions.push({ target: sel, tabs: presses });
      return;
    }
    if (where === "missing") {
      await page.waitForTimeout(100);
      continue;
    }
    await page.keyboard.press(where === "after" ? "Tab" : "Shift+Tab");
    await kbStop(page, R, sel);
  }
  R.kb.actions.push({ target: sel, tabs: null });
  throw new Error(`keyboard: ${sel} not reached in ${KB_MAX} presses`);
}
async function kbPress(page, R, sel) {
  await kbFocus(page, R, sel);
  await page.keyboard.press("Enter");
}
async function kbType(page, R, sel, text) {
  await kbFocus(page, R, sel);
  await page.keyboard.press("Control+A");
  await page.keyboard.type(String(text));
}
async function kbPick(page, R, name, value) {
  await kbFocus(page, R, { radio: name });
  for (let i = 0; i < 12; i++) {
    if ((await page.evaluate(() => document.activeElement?.value)) === value) {
      await page.keyboard.press("Space");
      return;
    }
    await page.keyboard.press("ArrowDown");
    await kbStop(page, R, `radio ${name}`);
  }
  throw new Error(`keyboard: ${name}=${value} not reached`);
}

/** A judge's hands: the mouse on most paths, the keyboard alone on K1 and K2. */
const act = (page, R) =>
  R.keyboard
    ? { click: (sel) => kbPress(page, R, sel), fill: (sel, v) => kbType(page, R, sel, v), pick: (name, value) => kbPick(page, R, name, value) }
    : { click: (sel) => page.click(sel), fill: (sel, v) => page.fill(sel, String(v)), pick: (name, value) => page.check(`input[name="${name}"][value="${value}"]`) };

// ---------- the YouCam stand-in ----------
function youcam(R) {
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/api/analysis" && req.method() === "POST") {
      R.mock.posts++;
      if (R.mock.mode === "paused") {
        R.mock.refused++;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "live analysis is paused to keep units for the judges; the demo trial still works" }) });
      }
      const form = (req.postDataBuffer() ?? Buffer.alloc(0)).toString("latin1");
      const concerns = (form.match(/name="concerns"\r\n\r\n([^\r]*)/)?.[1] ?? "").split(",").filter(Boolean);
      const taskId = `s17mock${R.id}${String(R.mock.posts).padStart(4, "0")}`;
      const r = R.rng;
      const shared = r.normal();
      const values = {};
      for (const c of concerns) {
        const n = NOISE.get(c) ?? { mean_half: 30, sem_D: 2 };
        const b = n.mean_half * (1 + 0.05 * shared);
        let L = b + 0.25 * n.sem_D * r.normal(),
          Rt = b + 0.25 * n.sem_D * r.normal();
        let raw = Math.round(55 + 10 * r.next());
        const effect = R.plantFor(c);
        if (effect === "headroom") {
          L = 0;
          Rt = 0;
          raw = 100;
        } else if (effect) {
          if (R.side === "subject_left") L += effect * n.mean_half;
          else Rt += effect * n.mean_half;
        }
        values[c] = { raw, subject_left: Math.max(0, L), subject_right: Math.max(0, Rt) };
      }
      R.mock.tasks.set(taskId, { day: R.day, values });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ taskId, units: 9, concerns }) });
    }
    if (url.pathname.startsWith("/api/analysis/") && req.method() === "GET") {
      R.mock.polls++;
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const t = R.mock.tasks.get(id);
      if (!t) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "error", error: "unknown task" }) });
      const concerns = Object.fromEntries(Object.entries(t.values).map(([c, v]) => [c, { raw: v.raw, mask: `https://yce-us.s3-accelerate.amazonaws.com/s17mock/${id}/${c}.png` }]));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "success", concerns, image: null }) });
    }
    if (url.pathname === "/api/mask") {
      R.mock.masks++;
      const m = new URL(url.searchParams.get("u") ?? "https://invalid/").pathname.match(/^\/s17mock\/([^/]+)\/([a-z_0-9]+)\.png$/);
      const t = m && R.mock.tasks.get(m[1]);
      const v = t?.values[m[2]];
      if (!v) return route.fulfill({ status: 404, body: "" });
      return route.fulfill({ status: 200, contentType: "image/png", body: maskPng(v.subject_left, v.subject_right, rng(`${m[1]}/${m[2]}`)) });
    }
    R.mock.other++;
    return route.fulfill({ status: 599, body: "" });
  };
}

// ---------- steps a judge takes ----------
async function at(page, R, day, hh = 9) {
  const t = localTime(day, hh, R.zone);
  if (t <= R.now) throw new Error(`clock would go back: ${day} ${hh}:00`);
  await R.context.clock.setSystemTime(t);
  R.now = t;
  R.day = day;
}
async function face(page, R) {
  await page.evaluate((u) => window.__cam.set({ kind: "face", url: u }), R.faceUrl);
}
const kindNow = (page) => page.$eval("#today", (e) => e.dataset.kind).catch(() => null);
const visibleH1 = (page) => page.evaluate(() => [...document.querySelectorAll("h1")].find((h) => h.getClientRects().length > 0)?.textContent.trim() ?? "");
const missingMarks = (page) =>
  page.evaluate(() => ({
    marks: [...document.querySelectorAll("main p")].filter((p) => p.getClientRects().length > 0 && p.textContent.trim() === "Please answer this.").length,
    invalid: [...document.querySelectorAll('[aria-invalid="true"]')].filter((e) => e.getClientRects().length > 0).map((e) => e.id),
    focus: document.activeElement?.id ?? null,
  }));

/** The skip link: the first Tab stop on the home page, shown when focused, and it moves focus to the content. */
async function skipLink(page, R) {
  await page.keyboard.press("Tab");
  await kbStop(page, R, "skip link");
  const first = await page.evaluate(() => {
    const a = document.activeElement;
    const r = a.getBoundingClientRect();
    return { skip: a.hasAttribute("data-skip-link"), shown: r.width > 20 && r.height > 20 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight };
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  R.outcome.skip = { ...first, after: await page.evaluate(() => document.activeElement?.id ?? null) };
}

/** On the full-screen camera, Tab to its two buttons (without pressing them) to check their focus on black. */
async function cameraTabs(page, R) {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("Tab");
    await kbStop(page, R, "camera");
  }
}

/** The camera check from the home page, every step: first photo, check-in photo, done. */
async function cameraCheck(page, R) {
  const A = act(page, R);
  await A.click("#camera-check");
  await check(page, R, "camera:intro", "#start-camera");
  await A.click("#start-camera");
  await page.waitForSelector("#capture-guidance", { timeout: STEP_MS });
  await page.waitForFunction(() => {
    const r = document.getElementById("capture-guidance")?.dataset.reason;
    return r && r !== "starting";
  }, null, { timeout: STEP_MS });
  if (R.keyboard) await cameraTabs(page, R);
  await check(page, R, "camera:capture", "#capture-guidance", { camera: true });
  await face(page, R);
  await page.waitForSelector('#capture-photo[data-mode="baseline"]', { timeout: STEP_MS });
  await focusAfter(page, R, "camera:review_baseline", "H1");
  await check(page, R, "camera:review_baseline", "#capture-photo");
  await A.click("#use-photo");
  await page.waitForSelector("#start-checkin", { timeout: STEP_MS });
  await focusAfter(page, R, "camera:checkin_intro", "H1");
  await check(page, R, "camera:checkin_intro", "#start-checkin");
  await A.click("#start-checkin");
  await page.waitForSelector('#capture-photo[data-mode="checkin"]', { timeout: STEP_MS });
  await focusAfter(page, R, "camera:review_checkin", "H1");
  await check(page, R, "camera:review_checkin", "#capture-photo");
  await A.click("#use-photo");
  await page.waitForSelector("#camera-home", { timeout: STEP_MS });
  await focusAfter(page, R, "camera:done", "H1");
  await check(page, R, "camera:done", "#camera-home");
  await A.click("#camera-home");
  await page.waitForSelector("#start-trial", { timeout: STEP_MS });
}

async function startTrial(page, R, P) {
  const A = act(page, R);
  await page.goto(`${base}/`);
  await check(page, R, "home:new", "#start-trial");
  if (R.keyboard) await skipLink(page, R);
  if (P.path === "P1") await cameraCheck(page, R);
  await A.click("#start-trial");
  await check(page, R, "new:you", "#age");
  R.outcome.missing = {};
  if (R.keyboard) {
    await A.click("#next");
    await page.waitForSelector("#age-missing", { timeout: STEP_MS });
    await focusAfter(page, R, "new:you:missing", "INPUT#age");
    R.outcome.missing.you = await missingMarks(page);
    await check(page, R, "new:you:missing", "#age-missing");
  }
  const pr = P.person;
  await A.fill("#age", pr.age);
  await A.pick("pregnancy", pr.pregnancy);
  await A.pick("redflags", pr.redFlags ? "yes" : "no");
  await A.pick("undercare", pr.underCare ? "yes" : "no");
  await A.pick("prescription", pr.prescription ? "yes" : "no");
  await A.click("#next");
  const firstStop = await page.waitForSelector("#product-name, [data-rule]", { timeout: STEP_MS });
  if ((await firstStop.getAttribute("data-rule")) != null) return checkScreen(page, R, P);
  await focusAfter(page, R, "new:product", "H1");
  if (R.keyboard) {
    await A.click("#next");
    await page.waitForSelector("#product-name-missing", { timeout: STEP_MS });
    await focusAfter(page, R, "new:product:missing", "INPUT#product-name");
    R.outcome.missing.product = await missingMarks(page);
    await check(page, R, "new:product:missing", "#product-name-missing");
  }
  await A.fill("#product-name", P.product.name);
  await A.pick("type", P.product.type);
  await A.fill("#ingredients", P.product.ingredients);
  await A.pick("medicine", pr.medicine ? "yes" : "no");
  await check(page, R, "new:product", "#ingredients");
  await A.click("#next");
  const after = await page.waitForSelector("[data-rule], [data-reason], #goal", { timeout: STEP_MS });
  if ((await after.getAttribute("data-rule")) != null) {
    const go = await checkScreen(page, R, P);
    if (go !== "warn") return go;
    await A.click("#next");
    await page.waitForSelector("[data-reason], #goal", { timeout: STEP_MS });
  }
  const reason = await page.$eval("[data-reason]", (e) => e.dataset.reason).catch(() => null);
  if (reason) {
    await focusAfter(page, R, "new:plan:no_trial", "H1");
    await check(page, R, "new:plan:no_trial", "[data-reason]");
    R.outcome.noTrial = reason;
    return "no_trial";
  }
  await focusAfter(page, R, "new:plan", "H1");
  await check(page, R, "new:plan", "#goal");
  R.outcome.planGoal = await page.$eval("#goal", (e) => e.textContent.trim());
  await A.click("#next");
  await page.waitForSelector("#draw-side", { timeout: STEP_MS });
  await focusAfter(page, R, "new:side:before", "H1");
  await check(page, R, "new:side:before", "#draw-side");
  await A.click("#draw-side");
  await page.waitForSelector("#side", { timeout: STEP_MS });
  await focusAfter(page, R, "new:side:drawn", "P#side");
  await check(page, R, "new:side:drawn", "#side");
  R.outcome.shownSide = await page.$eval("#side", (e) => e.dataset.side);
  await A.click("#start-run-in");
  await page.waitForURL(/\/trial$/, { timeout: STEP_MS });
  await page.waitForSelector("#today", { timeout: STEP_MS });
  const s = await stored(page);
  R.side = s.trial.side;
  R.goal = s.trial.goal;
  R.outcome.storedSide = s.trial.side;
  R.outcome.goal = s.trial.goal;
  R.outcome.plan = s.trial.plan;
  R.outcome.dashboardSide = (await mainText(page)).match(/your (left|right) side only/i)?.[1]?.toLowerCase() ?? null;
  return "started";
}

async function checkScreen(page, R, P) {
  await focusAfter(page, R, "new:check", "H1");
  const rules = await page.$$eval("[data-rule]", (els) => els.map((e) => e.dataset.rule));
  const title = await visibleH1(page);
  const action = /professional/.test(title) ? "refer" : /can't test/.test(title) ? "refuse" : "warn";
  R.focus.at(-1).screen = `new:check:${action}`;
  await check(page, R, `new:check:${action}`, "[data-rule]");
  R.outcome.check = { action, rules, forward: (await page.$("#next")) != null };
  return action;
}

/** Today's photos, as a judge takes them: the dashboard, the photo page, two photos a minute apart, back. */
async function photoDay(page, R, label) {
  const A = act(page, R);
  await page.goto(`${base}/trial`);
  await page.waitForSelector("#today", { timeout: STEP_MS });
  const kind = await kindNow(page);
  R.kinds.push({ day: R.day, before: kind });
  if (!R.seen.has(`trial:${kind}`)) await check(page, R, `trial:${kind}`, "#take-photos");
  R.seen.add(`trial:${kind}`);
  await A.click("#take-photos");
  await page.waitForSelector("#start-camera", { timeout: STEP_MS });
  if (!R.seen.has("photos:ready")) await check(page, R, "photos:ready", "#start-camera");
  R.seen.add("photos:ready");
  // the first camera of a path is checked while it looks for a face (a steady screen), then the face appears
  const firstCamera = !R.seen.has("photos:camera");
  if (!firstCamera) await face(page, R);
  await A.click("#start-camera");
  await page.waitForSelector("#capture-guidance", { timeout: STEP_MS });
  let off = false;
  if (firstCamera) {
    await page.waitForFunction(() => {
      const r = document.getElementById("capture-guidance")?.dataset.reason;
      return r && r !== "starting";
    }, null, { timeout: STEP_MS });
    if (label === "voice-off") {
      await page.click('button[aria-pressed="true"]');
      R.outcome.voiceKey = await page.evaluate(() => localStorage.getItem("fairtrial.voice"));
      await page.evaluate(() => {
        window.__spoken.length = 0;
      });
      off = true;
    }
    if (R.keyboard) await cameraTabs(page, R);
    await check(page, R, "photos:camera", "#capture-guidance", { camera: true });
    await face(page, R);
  }
  R.seen.add("photos:camera");
  await page.waitForSelector("#countdown", { timeout: STEP_MS });
  await focusAfter(page, R, "photos:wait", "H1");
  const gap = { day: R.day, disabledAtFirst: await page.$eval("#next-photo", (b) => b.disabled) };
  if (!R.seen.has("photos:wait")) await check(page, R, "photos:wait", "#countdown");
  R.seen.add("photos:wait");
  await R.context.clock.fastForward(GAP_MS + 1000);
  R.now += GAP_MS + 1000;
  await page.waitForSelector("#next-photo:not([disabled])", { timeout: STEP_MS });
  gap.enabledAfter = true;
  R.gaps.push(gap);
  if (!R.seen.has("photos:wait_ready")) await check(page, R, "photos:wait_ready", "#next-photo:not([disabled])");
  R.seen.add("photos:wait_ready");
  await face(page, R);
  await A.click("#next-photo");
  await page.waitForSelector("#session-status", { timeout: STEP_MS });
  await focusAfter(page, R, "photos:done", "H1");
  await page.waitForFunction(() => [...document.querySelectorAll("[data-photo-status]")].every((e) => e.dataset.photoStatus !== "pending"), null, { timeout: STEP_MS });
  const statuses = await page.$$eval("[data-photo-status]", (els) => els.map((e) => e.dataset.photoStatus));
  R.voice.push({ day: R.day, off, spoken: await page.evaluate(() => window.__spoken.slice()) });
  const doneKey = statuses.includes("error") ? "photos:done_error" : "photos:done";
  if (!R.seen.has(doneKey)) await check(page, R, doneKey, "#back-to-trial");
  R.seen.add(doneKey);
  await A.click("#back-to-trial");
  await page.waitForSelector("#today", { timeout: STEP_MS });
  const after = await kindNow(page);
  R.kinds.at(-1).after = after;
  return { statuses, after };
}

async function dashboardAt(page, R, day, key, hh = 9) {
  await at(page, R, day, hh);
  await page.goto(`${base}/trial`);
  await page.waitForSelector("#today", { timeout: STEP_MS });
  const kind = await kindNow(page);
  R.kinds.push({ day, before: kind });
  if (key && !R.seen.has(key)) await check(page, R, key, "#today");
  if (key) R.seen.add(key);
  return kind;
}

async function verdictsShown(page) {
  return page.$$eval("[data-verdict][data-week]", (els) => els.filter((e) => e.getClientRects().length > 0).map((e) => ({ week: Number(e.dataset.week), verdict: e.dataset.verdict })));
}

async function runIn(page, R, days = 4) {
  for (let i = 0; i < days; i++) {
    if (i > 0) await at(page, R, addDays(R.start, i));
    const r = await photoDay(page, R, i === 0 && R.type === "P8" ? "voice-off" : "");
    const key = r.after === "run_in" ? "trial:run_in_day_done" : `trial:${r.after}`;
    if (!R.seen.has(key)) await check(page, R, key, "#today");
    R.seen.add(key);
    if (R.type === "P5" || R.type === "P7" || R.type === "P8") return r;
  }
}

async function visits(page, R, upTo) {
  const startDay = addDays(R.start, 4);
  const plan = visitsFor(R.outcome.plan.firstLookWeek, R.outcome.plan.verdictWeek);
  R.outcome.expectedVisits = plan;
  await dashboardAt(page, R, startDay, "trial:start_today");
  if (R.type === "P1") {
    await page.goto(`${base}/trial/photos`);
    await check(page, R, "photos:none", "#back-to-trial");
    await dashboardAt(page, R, addDays(startDay, 3), "trial:waiting");
  }
  for (const v of plan) {
    if (upTo != null && v.week > upTo) break;
    const due = addDays(startDay, 7 * v.week);
    for (let k = 0; k < v.days; k++) {
      await at(page, R, addDays(due, k));
      const r = await photoDay(page, R, "");
      const key = r.after === "visit_day_done" ? "trial:visit_day_done" : `trial:${r.after}`;
      if (!R.seen.has(key)) await check(page, R, key, "#today");
      R.seen.add(key);
    }
    const shown = await verdictsShown(page);
    const latest = shown.find((x) => x.week === v.week);
    R.outcome.verdicts.push({ week: v.week, purpose: v.purpose, shown: latest?.verdict ?? null });
    if (latest) {
      // the trial page's status region says the new verdict out loud
      const said = await page
        .waitForFunction(
          (w) => {
            const m = [...document.querySelectorAll("main")].find((x) => x.getClientRects().length > 0);
            const t = m?.querySelector('[role="status"]')?.textContent ?? "";
            return t.includes(`Week ${w} `) ? t : null;
          },
          v.week,
          { timeout: 5000 },
        )
        .then((h) => h.jsonValue())
        .catch(() => null);
      R.announce.push({ week: v.week, text: said });
      if (!R.seen.has(`trial:verdict:${latest.verdict}`)) await check(page, R, `trial:verdict:${latest.verdict}`, `[data-verdict="${latest.verdict}"]`);
      R.seen.add(`trial:verdict:${latest.verdict}`);
    }
    if (latest?.verdict === "stop") break;
  }
}

async function certificate(page, R) {
  const A = act(page, R);
  await page.goto(`${base}/trial`);
  await page.waitForSelector("#certificate", { timeout: STEP_MS });
  await A.click("#certificate");
  await check(page, R, "certificate", "#certificate-verdict");
  R.outcome.certificate = await page.evaluate(() => ({
    verdict: document.getElementById("certificate-verdict")?.dataset.verdict ?? null,
    improvement: document.getElementById("certificate-improvement")?.textContent ?? null,
    improvementValue: Number(document.getElementById("certificate-improvement")?.dataset.value),
    pubmed: [...document.querySelectorAll('a[href^="https://pubmed.ncbi.nlm.nih.gov/"]')].filter((a) => a.getClientRects().length > 0).length,
    trialId: /Trial [0-9a-f-]{36}/.test(document.body.textContent),
    limits: !!document.querySelector('[aria-label="Limits"]'),
  }));
  await A.click("#print");
  R.outcome.certificate.printed = await page.evaluate(() => window.__printed);
}

async function deleteAll(page, R, where) {
  const A = act(page, R);
  await A.click("#delete-everything");
  await page.waitForSelector("#confirm-delete", { timeout: STEP_MS });
  await focusAfter(page, R, `${where}:delete_confirm`, "P#delete-question");
  await check(page, R, `${where}:delete_confirm`, "#confirm-delete");
  await A.click("#confirm-delete");
  await page.waitForSelector("#start-trial", { timeout: STEP_MS });
  await focusAfter(page, R, where === "trial" ? "trial:none" : "home:deleted", where === "trial" ? "H1" : "A#start-trial");
  if (where === "trial") await check(page, R, "trial:none", "#start-trial");
  const s = await stored(page);
  await page.goto(`${base}/`);
  await page.waitForSelector("#start-trial", { timeout: STEP_MS });
  const s2 = await stored(page);
  R.outcome.deleted = { dbAfter: s.db, keysAfter: s.keys.filter((k) => k.startsWith("fairtrial.")), dbAfterHome: s2.db, homeStart: true };
}

// ---------- one path ----------
async function runPath(browser, P) {
  const R = {
    id: P.id,
    type: P.path,
    kind: P.kind,
    keyboard: !!P.keyboard,
    scheme: P.scheme,
    motion: P.motion,
    zone: P.zone,
    start: P.start,
    rows: [],
    errors: [],
    seen: new Set(),
    kinds: [],
    gaps: [],
    focus: [],
    voice: [],
    announce: [],
    stops: [],
    kb: { actions: [] },
    outcome: { verdicts: [] },
    mock: { mode: "ok", posts: 0, polls: 0, masks: 0, refused: 0, other: 0, tasks: new Map() },
    rng: rng(`s17:${P.id}`),
    side: null,
    goal: null,
    day: P.start,
    faceUrl: `data:image/jpeg;base64,${fs.readFileSync(P.face).toString("base64")}`,
  };
  R.plantFor = (c) => {
    if (P.path === "P5" && c === R.headroomGoal && R.day < addDays(P.start, 4)) return "headroom";
    if (c !== R.goal || R.day < addDays(P.start, 4)) return 0;
    if (P.path === "P1") return -P.effect;
    if (P.path === "P6" || P.path === "P9") return +P.effect;
    return 0;
  };
  const t0 = Date.now();
  R.context = await browser.newContext({ ...devices["Pixel 7"], timezoneId: P.zone, colorScheme: P.scheme, reducedMotion: P.motion });
  await R.context.addInitScript(fakePhone);
  R.now = localTime(P.start, 8, P.zone);
  await R.context.clock.install({ time: R.now });
  await R.context.route(/\/api\/(analysis|mask)(\/|\?|$)/, youcam(R));
  const page = await R.context.newPage();
  page.on("pageerror", (e) => R.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && R.errors.push(m.text()));
  // S20 diagnostics, read by no bar: the requests still in flight when a path crashes, and the camera's state
  const inflight = new Map();
  page.on("request", (rq) => inflight.set(rq, Date.now()));
  page.on("requestfinished", (rq) => inflight.delete(rq));
  page.on("requestfailed", (rq) => inflight.delete(rq));
  try {
    const go = await startTrial(page, R, P);
    R.outcome.start = go;
    if (go === "started") {
      R.headroomGoal = R.goal;
      if (P.path === "P7") R.mock.mode = "paused";
      const first = await runIn(page, R);
      if (P.path === "P5") {
        await page.waitForSelector("#headroom", { timeout: STEP_MS });
        await check(page, R, "trial:headroom", "#headroom");
        const to = await page.$eval("[data-goal]", (b) => b.dataset.goal).catch(() => null);
        R.outcome.headroom = { shown: true, switchTo: to };
        if (to) {
          await page.click(`[data-goal="${to}"]`);
          await page.waitForFunction((w) => document.getElementById("trial-goal")?.textContent === w, GOAL_WORDS[to], { timeout: STEP_MS });
          await focusAfter(page, R, "trial:goal_switched", "P#trial-summary");
          const s = await stored(page);
          R.outcome.headroom.after = { goal: s.trial.goal, first: s.trial.concerns[0], card: (await page.$("#headroom")) != null };
          R.goal = s.trial.goal;
        }
      }
      if (P.path === "P7") {
        R.outcome.paused = { statuses: first.statuses, errorKind: await page.$eval("#analysis-error", (e) => e.dataset.kind).catch(() => null) };
        await check(page, R, "trial:analysis_error", "#retry");
        R.mock.mode = "ok";
        await page.click("#retry");
        await page.waitForFunction(() => document.getElementById("photo-count")?.dataset.waiting === "0", null, { timeout: STEP_MS * 2 });
        await focusAfter(page, R, "trial:retried", "H2#photos-title");
        R.outcome.paused.after = await stored(page).then((s) => s.photos.map((p) => p.status));
        await page.click("#stop-trial");
        await page.waitForSelector("#confirm-stop", { timeout: STEP_MS });
        await focusAfter(page, R, "trial:stop_confirm", "P#stop-question");
        await check(page, R, "trial:stop_confirm", "#confirm-stop");
        await page.click("#confirm-stop");
        await page.waitForSelector('#today[data-kind="stopped"]', { timeout: STEP_MS });
        await focusAfter(page, R, "trial:stopped", "H2#today-title");
        await check(page, R, "trial:stopped", "#today");
        R.outcome.stopped = (await stored(page)).trial.stopped;
      }
      if (P.path === "P8") {
        R.outcome.photos = (await stored(page)).photos;
        await deleteAll(page, R, "trial");
      }
      if (P.path === "P1") {
        await visits(page, R);
        const lastVisit = R.outcome.expectedVisits.at(-1);
        await dashboardAt(page, R, addDays(addDays(R.start, 4), 7 * lastVisit.week + lastVisit.days), "trial:finished");
        R.outcome.photos = (await stored(page)).photos;
        await certificate(page, R);
        await page.goto(`${base}/`);
        await check(page, R, "home:returning", "#continue-trial");
        await deleteAll(page, R, "home");
      }
      if (P.path === "P6" || P.path === "P9") {
        await visits(page, R, 2);
        if (P.path === "P6") {
          R.outcome.stopped = (await stored(page)).trial.stopped;
          await certificate(page, R);
        }
      }
      const s = await stored(page);
      R.outcome.photos ??= s.photos;
      R.outcome.finalStopped = s.trial?.stopped ?? null;
      R.outcome.storedVerdicts = s.trial?.verdicts ?? [];
    }
  } catch (e) {
    R.outcome.crash = String(e?.stack ?? e).slice(0, 2000);
    R.outcome.inflight = [...inflight].map(([rq, t]) => `${rq.method()} ${rq.url().slice(0, 200)} for ${Math.round((Date.now() - t) / 1000)} s`);
    R.outcome.camera = await page.evaluate(() => document.getElementById("capture-guidance")?.dataset.reason ?? null).catch(() => null);
    await page.screenshot({ path: path.join(outDir, `${P.id}_crash.png`) }).catch(() => {});
    R.errors.length && R.rows.push({ path: R.id, kind: R.kind, type: R.type, scheme: R.scheme, motion: R.motion, screen: "crash", errors: R.errors.splice(0).join(" || ") });
  }
  await R.context.close();
  return {
    id: P.id,
    path: P.path,
    kind: P.kind,
    variant: P.variant,
    keyboard: R.keyboard,
    scheme: P.scheme,
    motion: P.motion,
    zone: P.zone,
    start: P.start,
    product: P.product.class,
    expect: P.expect,
    outcome: R.outcome,
    gaps: R.gaps,
    kinds: R.kinds,
    focus: R.focus,
    voice: R.voice,
    announce: R.announce,
    kb: R.kb,
    mock: { posts: R.mock.posts, polls: R.mock.polls, masks: R.mock.masks, refused: R.mock.refused, other: R.mock.other },
    seconds: Math.round((Date.now() - t0) / 1000),
    rows: R.rows,
    stops: R.stops,
  };
}

const toCsv = (rows, cols) => {
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n") + "\n";
};
const SCREEN_COLS = ["path", "kind", "type", "scheme", "motion", "screen", "url", "title", "h1", "mains", "headings", "heading_skip", "focus", "claims", "axe_light", "axe_dark", "axe_all", "anims_long", "hscroll", "hscroll360", "hscroll320", "small", "errors"];
const STOP_COLS = ["path", "n", "why", "el", "text", "indicator", "width", "contrast", "ring", "behind", "visible"];

const only = process.env.S17_ONLY ? new Set(process.env.S17_ONLY.split(",")) : null;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
for (const P of paths) {
  if (only && !only.has(P.id)) continue;
  const r = await runPath(browser, P);
  results.push(r);
  const bad = r.rows.filter(
    (x) => x.h1 !== 1 || x.mains !== 1 || x.heading_skip || x.claims || x.axe_light || x.axe_dark || x.hscroll === true || x.hscroll360 === true || x.hscroll320 === true || x.small || x.errors,
  );
  const badStops = r.stops.filter((s) => !(s.indicator && s.width >= 2 && s.contrast != null && s.contrast >= 3 && s.visible));
  const badFocus = r.focus.filter((f) => f.got !== f.want);
  console.log(
    `${r.id} ${r.kind}${r.variant} ${r.zone} ${r.scheme}/${r.motion} ${r.seconds}s screens=${r.rows.length} flagged=${bad.length} focus=${r.focus.length - badFocus.length}/${r.focus.length} stops=${r.stops.length - badStops.length}/${r.stops.length} posts=${r.mock.posts}${r.outcome.crash ? " CRASH " + r.outcome.crash.split("\n")[0] : ""}`,
  );
}
await browser.close();
fs.writeFileSync(path.join(outDir, "screens.csv"), toCsv(results.flatMap((r) => r.rows), SCREEN_COLS));
fs.writeFileSync(path.join(outDir, "stops.csv"), toCsv(results.flatMap((r) => r.stops), STOP_COLS));
fs.writeFileSync(path.join(outDir, "paths.json"), JSON.stringify(results.map(({ rows, stops, ...r }) => r), null, 1));
console.log(`wrote ${results.length} paths, ${results.reduce((s, r) => s + r.rows.length, 0)} screen checks, ${results.reduce((s, r) => s + r.stops.length, 0)} Tab stops to ${outDir}`);
