// S18 demo trial audit (prereg and bars in R/s18_score.R; paths from R/s18_paths.R). Every view of the demo (its start,
// every stop of the trial, the certificate) on a fake phone (Pixel 7), with the S17 screen check copied unchanged from
// scripts/s17-audit.mjs (axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules in both colour schemes, one rendered h1
// and main, heading order, claim words, sideways scroll at 360 and 320 px, buttons under 44 px, page and console errors)
// and, on keyboard paths, S17's measure of every Tab stop's focus ring. The page runs on Playwright's clock: Play is
// timed on it with the clock paused, so nothing moves while a view is read.
// The runner records what the app shows; it never reads the R twin's expected verdicts.
//   node scripts/s18-audit.mjs <paths.json> <outDir> [base=http://localhost:3123]      (S18_ONLY=d1,d3 runs some)
// Writes <outDir>/screens.csv (one row per screen check), stops.csv (keyboard Tab stops), views.json (what every view
// showed), paths.json (each path's timing, storage before and after, requests, focus moves) and pictures in shots/,
// shots_dark/ and print/.
import AxeBuilder from "@axe-core/playwright";
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import { findClaims } from "../tools/claim-lint/policy.ts";
import path from "node:path";

const [, , pathsFile, outDir, baseArg] = process.argv;
const base = (baseArg ?? "http://localhost:3123").replace(/\/$/, "");
const paths = JSON.parse(fs.readFileSync(pathsFile, "utf8"));
for (const d of ["shots", "shots_dark", "print"]) fs.mkdirSync(path.join(outDir, d), { recursive: true });
const SHOTS = { light: new Set(), dark: new Set() };

// Claim words: the claim policy (tools/claim-lint/policy.ts; the S13 list until S20), searched in every text node,
// title, label and alternative text.
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const STEP_MS = 30_000,
  KB_MAX = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const addDays = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
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

// ---------- speech and print stubs (S17's, without the camera: the demo takes no photo) ----------
function stubs() {
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

// ---------- the person's own data: everything Fair Trial keeps on the phone, in full ----------
/** Every Fair Trial record and setting on the phone (a photo's image by its size, type and SHA-256). Never opens a
 * database that isn't there. */
const dump = (page) =>
  page.evaluate(async () => {
    const local = {};
    try {
      for (let i = 0; i < localStorage.length; i++) local[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    } catch {
      /* storage blocked */
    }
    const dbs = (await indexedDB.databases()).map((d) => `${d.name}@${d.version}`).sort();
    let trials = null,
      photos = null;
    if (dbs.some((d) => d.startsWith("fairtrial@"))) {
      const db = await new Promise((res, rej) => {
        const rq = indexedDB.open("fairtrial");
        rq.onsuccess = () => res(rq.result);
        rq.onerror = () => rej(rq.error);
      });
      const all = (s) =>
        new Promise((res, rej) => {
          if (!db.objectStoreNames.contains(s)) return res([]);
          const g = db.transaction(s).objectStore(s).getAll();
          g.onsuccess = () => res(g.result);
          g.onerror = () => rej(g.error);
        });
      const hex = async (b) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await b.arrayBuffer()))].map((x) => x.toString(16).padStart(2, "0")).join("");
      trials = (await all("trials")).sort((a, b) => (a.id < b.id ? -1 : 1));
      photos = [];
      for (const p of (await all("photos")).sort((a, b) => (a.id < b.id ? -1 : 1))) photos.push({ ...p, blob: p.blob ? { size: p.blob.size, type: p.blob.type, sha256: await hex(p.blob) } : null });
      db.close();
    }
    const settings = Object.fromEntries(Object.entries(local).filter(([k]) => k.startsWith("fairtrial")));
    return {
      dbs,
      settings,
      otherKeys: Object.keys(local)
        .filter((k) => !k.startsWith("fairtrial"))
        .sort(),
      trials,
      photos,
    };
  });

/** A real trial already on the phone (B3): the app's own database layout (src/lib/trial/store.ts), a trial part-way
 * through its run-in, three analysed photos with their images, and the voice setting switched off. */
function seedRecords(P) {
  const id = `seed-${P.id}`;
  const day0 = "2026-10-26";
  const trial = {
    id,
    createdAt: localTime(day0, 8, P.zone),
    productName: "Calm Barrier Cream",
    actives: ["Centella (cica)"],
    plan: {
      actives: [{ family: "CICA", name: "centella asiatica leaf extract", position: 2, belowOnePercent: false }],
      fallback: false,
      goals: ["redness", "moisture"],
      design: "split_face",
      reason: null,
      goal: "redness",
      rows: ["E16"],
      firstLookWeek: 1,
      verdictWeek: 4,
      adjustToWeek: null,
      visits: [
        { week: 2, days: 1, purpose: "safety" },
        { week: 4, days: 3, purpose: "verdict" },
      ],
      photos: 16,
      power: { worst: 91, best: 99 },
      belowOnePercent: false,
      earlyEffects: [],
    },
    goal: "redness",
    concerns: ["redness", "moisture"],
    side: "subject_right",
    guard: { action: "proceed", rules: [] },
    baseline: { brightness: 0.52, cast: 0.03, sharpness: 0.81 },
    stopped: null,
    verdicts: [],
  };
  const photos = [0, 1, 2].map((i) => {
    const day = addDays(day0, Math.floor(i / 2));
    return {
      id: `${id}-photo-${i}`,
      trialId: id,
      day,
      takenAt: localTime(day, 9, P.zone, i % 2),
      bytes: [255, 216, 255, 224, 0, 16, 74, 70, 73, 70, i],
      stats: { brightness: 0.52 + i / 100, cast: 0.03, sharpness: 0.8 },
      face: { width: 0.42, roll: 1.5 - i, yaw: 2 },
      status: "done",
      result: { raw: { redness: 71 + i, moisture: 64 }, density: { redness: { subject_left: 22.4 + i, subject_right: 23.1 + i }, moisture: { subject_left: 30, subject_right: 31 } } },
    };
  });
  return { trial, photos };
}
async function seed(page, P) {
  await page.evaluate(async (s) => {
    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open("fairtrial", 1);
      rq.onupgradeneeded = () => {
        rq.result.createObjectStore("trials", { keyPath: "id" });
        rq.result.createObjectStore("photos", { keyPath: "id" }).createIndex("byTrial", "trialId");
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    const tx = db.transaction(["trials", "photos"], "readwrite");
    tx.objectStore("trials").put(s.trial);
    for (const { bytes, ...p } of s.photos) tx.objectStore("photos").put({ ...p, blob: new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }) });
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    localStorage.setItem("fairtrial.voice", "off");
  }, seedRecords(P));
}

// ---------- S17's screen check (unchanged) ----------
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
      await page.screenshot({ path: path.join(outDir, scheme === "dark" ? "shots_dark" : "shots", `${key.replace(/:/g, "_")}.png`), fullPage: !camera }).catch(() => {});
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

// ---------- S17's keyboard: Tab stops and actions (unchanged) ----------
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
      if (contrast == null || c < contrast)
        behind = `${under.tagName}${under.id ? "#" + under.id : ""}.${String(under.className?.baseVal ?? under.className ?? "")
          .split(/s+/)
          .slice(0, 3)
          .join(".")} ${bg.slice(0, 3).map(Math.round).join(" ")}`;
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

/** A judge's hands: the keyboard alone on keyboard paths, the mouse (on the control that is on screen) otherwise. */
const act = (page, R) =>
  R.keyboard
    ? { click: (sel) => kbPress(page, R, sel), pick: (name, value) => kbPick(page, R, name, value) }
    : { click: (sel) => page.locator(`${sel} >> visible=true`).first().click(), pick: (name, value) => page.check(`input[name="${name}"][value="${value}"]`) };

// ---------- what a demo view shows ----------
const readView = (page) =>
  page.evaluate(() => {
    const vis = (e) => !!e && e.getClientRects().length > 0;
    const main = [...document.querySelectorAll("main")].find(vis);
    const label = document.getElementById("demo-label");
    const first = main ? [...main.children].find(vis) : null;
    const st = document.getElementById("demo-stop");
    const cert = document.getElementById("certificate-verdict");
    const img = main?.querySelector("img");
    const cards = [...document.querySelectorAll("[data-verdict][data-week]")].filter(vis).map((p) => {
      const m = (p.closest("section")?.textContent ?? "").match(/Product side against bare side: ([0-9]+\.[0-9]) points (better|worse), give or take ([0-9]+\.[0-9])/);
      return { week: Number(p.dataset.week), verdict: p.dataset.verdict, title: p.textContent.trim(), change: m ? (m[2] === "better" ? 1 : -1) * Number(m[1]) : null, se: m ? Number(m[3]) : null };
    });
    return {
      view: vis(st) ? "trial" : vis(cert) ? "certificate" : vis(document.getElementById("demo-start")) ? "intro" : "other",
      url: location.pathname,
      title: document.title,
      h1: [...document.querySelectorAll("h1")]
        .filter(vis)
        .map((h) => h.textContent.trim())
        .join(" | "),
      label: vis(label) ? label.textContent.replace(/\s+/g, " ").trim() : null,
      labelFirst: !!label && first === label,
      at: st ? Number(st.dataset.at) : null,
      of: st ? Number(st.dataset.of) : null,
      day: st?.dataset.day ?? null,
      stop: st ? st.textContent.replace(/\s+/g, " ").trim() : null,
      play: document.getElementById("demo-play")?.textContent.trim() ?? null,
      status: main ? [...main.querySelectorAll('[role="status"]')].map((e) => e.textContent.trim()).join(" | ") : "",
      cards,
      today: document.getElementById("today")?.dataset.kind ?? null,
      certificateButton: vis(document.getElementById("certificate")),
      realControls: ["take-photos", "retry", "stop-trial", "stop-headroom", "confirm-stop", "delete-everything"].filter((id) => vis(document.getElementById(id))),
      certificate: cert ? { verdict: cert.dataset.verdict, title: cert.textContent.trim(), improvement: document.getElementById("certificate-improvement")?.textContent.trim() ?? null } : null,
      simulated: /simulated/i.test(main?.textContent ?? ""),
      image: img ? { ok: img.complete && img.naturalWidth > 0, alt: img.alt } : null,
      outcomes: [...document.querySelectorAll('input[name="outcome"]')].map((i) => `${i.value}${i.checked ? "*" : ""}`).join(","),
    };
  });
const atNow = async (page) => {
  await page.waitForTimeout(80);
  return page.$eval("#demo-stop", (e) => Number(e.dataset.at)).catch(() => null);
};
async function view(page, R, key, screenCheck = true) {
  await settle(page);
  const v = await readView(page);
  R.views.push({ path: R.id, kind: R.kind, key, ...v });
  if (screenCheck) await check(page, R, `${R.id}:${key}`, null);
  return v;
}

// ---------- B5: Play, Pause, Back and Next on the page's own clock ----------
async function playTest(page, R, A) {
  const out = { steps: [] };
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await A.click("#demo-start");
  await page.waitForSelector("#demo-stop", { timeout: STEP_MS });
  await focusAfter(page, R, "demo:play", "H1");
  let v = await view(page, R, "play0", false);
  const last = v.of - 1;
  out.of = v.of;
  out.steps.push({ s: 0, at: v.at });
  let fake = 0;
  while (fake < 75_000 && out.steps.at(-1).at < last) {
    await page.clock.runFor(1000);
    fake += 1000;
    const at = await atNow(page);
    if (at !== out.steps.at(-1).at) {
      v = await view(page, R, `play${at}`, false);
      out.steps.push({ s: fake / 1000, at });
    }
  }
  out.reached = out.steps.at(-1).at === last ? out.steps.at(-1).s : null;
  out.endLabel = (await readView(page)).play;
  // Pause holds: two stops back, play one stop, pause, then 10 s on the page's clock
  await A.click("#demo-back");
  await A.click("#demo-back");
  out.a0 = await atNow(page);
  await A.click("#demo-play");
  out.playingLabel = (await readView(page)).play;
  await page.clock.runFor(5000);
  out.a1 = await atNow(page);
  await A.click("#demo-play");
  out.pausedLabel = (await readView(page)).play;
  await page.clock.runFor(10_000);
  out.a2 = await atNow(page);
  // Back and Next move one stop
  await A.click("#demo-next");
  out.a3 = await atNow(page);
  await A.click("#demo-back");
  out.a4 = await atNow(page);
  await A.click("#demo-next");
  out.a5 = await atNow(page);
  await page.clock.resume();
  out.last = last;
  R.outcome.play = out;
}

// ---------- every stop, one at a time, then the certificate ----------
async function stepThrough(page, R, A) {
  for (let i = 0; i < 20 && (await atNow(page)) > 0; i++) await A.click("#demo-back");
  R.outcome.firstStop = await atNow(page);
  await A.click("#demo-back"); // Back at the first stop: the start of the demo
  await page.waitForSelector("#demo-start", { timeout: STEP_MS });
  await focusAfter(page, R, "demo:back_to_start", "H1");
  R.outcome.backAtFirst = (await readView(page)).view;
  await A.click("#demo-steps");
  await page.waitForSelector("#demo-stop", { timeout: STEP_MS });
  await focusAfter(page, R, "demo:steps", "H1");
  for (let i = 0; i < 20; i++) {
    const v = await view(page, R, `stop${i}`);
    if (v.at >= v.of - 1) break;
    await A.click("#demo-next");
    await focusAfter(page, R, `demo:next_${i + 1}`, "BUTTON#demo-next");
  }
  R.outcome.lastPlay = (await readView(page)).play;
  await A.click("#certificate");
  await page.waitForSelector("#certificate-verdict", { timeout: STEP_MS });
  await focusAfter(page, R, "demo:certificate", "H1");
  await view(page, R, "certificate");
  await page.emulateMedia({ media: "print" });
  await page.waitForTimeout(150);
  R.outcome.print = await page.evaluate(() => {
    const l = document.getElementById("demo-label");
    const cs = l && getComputedStyle(l);
    const main = [...document.querySelectorAll("main")].find((m) => m.getClientRects().length > 0);
    return {
      shown: !!l && l.getClientRects().length > 0 && cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) > 0,
      text: l?.textContent.replace(/\s+/g, " ").trim() ?? "",
      simulated: /simulated/i.test(main?.textContent ?? ""),
      title: document.title,
    };
  });
  await page.screenshot({ path: path.join(outDir, "print", `${R.id}.png`), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await A.click("#print");
  R.outcome.printed = await page.evaluate(() => window.__printed);
  // the certificate's way back leads to the trial at its last stop; Next there opens the certificate again
  await A.click("[data-back]");
  await page.waitForSelector("#demo-stop", { timeout: STEP_MS });
  await focusAfter(page, R, "demo:certificate_back", "H1");
  const back = await readView(page);
  R.outcome.certificateBack = { at: back.at, of: back.of };
  await A.click("#demo-next");
  await page.waitForSelector("#certificate-verdict", { timeout: STEP_MS });
  R.outcome.nextAtLast = (await readView(page)).view;
  // and out: certificate -> trial -> the demo's start -> home
  await A.click("[data-back]");
  await page.waitForSelector("#demo-stop", { timeout: STEP_MS });
  await A.click("[data-back]");
  await page.waitForSelector("#demo-start", { timeout: STEP_MS });
  await A.click("[data-back]");
  await page.waitForSelector("#demo-link", { timeout: STEP_MS });
}

// ---------- one path ----------
async function runPath(browser, P) {
  const R = {
    id: P.id,
    kind: P.kind,
    type: P.keyboard ? "keyboard" : "mouse",
    keyboard: !!P.keyboard,
    scheme: P.scheme,
    motion: P.motion,
    zone: P.zone,
    rows: [],
    errors: [],
    stops: [],
    kb: { actions: [] },
    focus: [],
    views: [],
    requests: [],
    outcome: {},
  };
  const t0 = Date.now();
  R.context = await browser.newContext({ ...devices["Pixel 7"], timezoneId: P.zone, colorScheme: P.scheme, reducedMotion: P.motion });
  await R.context.addInitScript(stubs);
  const [day, hm] = P.clock.split(" ");
  const [hh, mm] = hm.split(":").map(Number);
  await R.context.clock.install({ time: localTime(day, hh, P.zone, mm) });
  if (P.data) {
    // a held-out dataset in place of the shipped demo, and its face
    await R.context.route("**/demo/demo.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fs.readFileSync(P.data) }));
    await R.context.route("**/demo/heldout-face.jpg", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: fs.readFileSync(P.face) }));
  }
  const page = await R.context.newPage();
  page.on("pageerror", (e) => R.errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && R.errors.push(m.text()));
  page.on("request", (q) => R.requests.push(new URL(q.url()).pathname));
  const A = act(page, R);
  try {
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    if (P.seed) {
      await seed(page, P);
      await page.goto(`${base}/`, { waitUntil: "networkidle" });
      await page.waitForSelector("#continue-trial", { timeout: STEP_MS });
    }
    R.outcome.before = await dump(page);
    R.outcome.requestsBefore = R.requests.length;
    await A.click("#demo-link");
    await page.waitForSelector("#demo-start", { timeout: STEP_MS });
    await focusAfter(page, R, "demo:start", "H1");
    await view(page, R, "start");
    await A.pick("outcome", P.outcome);
    R.outcome.picked = (await readView(page)).outcomes;
    await playTest(page, R, A);
    await stepThrough(page, R, A);
    R.outcome.after = await dump(page);
    R.outcome.home = (await readView(page)).url;
  } catch (e) {
    R.outcome.crash = String(e?.stack ?? e).slice(0, 2000);
    await page.screenshot({ path: path.join(outDir, `${P.id}_crash.png`) }).catch(() => {});
  }
  R.outcome.leftErrors = R.errors.splice(0);
  const demoRequests = R.requests.slice(R.outcome.requestsBefore ?? 0);
  await R.context.close();
  return {
    id: P.id,
    kind: P.kind,
    data: P.data ? path.basename(P.data) : "public/demo/demo.json",
    outcomePicked: P.outcome,
    keyboard: R.keyboard,
    scheme: P.scheme,
    motion: P.motion,
    zone: P.zone,
    seed: !!P.seed,
    outcome: R.outcome,
    focus: R.focus,
    kb: R.kb,
    requests: { total: demoRequests.length, api: demoRequests.filter((u) => u.startsWith("/api/")), demoData: demoRequests.filter((u) => u === "/demo/demo.json").length },
    seconds: Math.round((Date.now() - t0) / 1000),
    rows: R.rows,
    stops: R.stops,
    views: R.views,
  };
}

const toCsv = (rows, cols) => {
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n") + "\n";
};
const SCREEN_COLS = [
  "path",
  "kind",
  "type",
  "scheme",
  "motion",
  "screen",
  "url",
  "title",
  "h1",
  "mains",
  "headings",
  "heading_skip",
  "focus",
  "claims",
  "axe_light",
  "axe_dark",
  "axe_all",
  "anims_long",
  "hscroll",
  "hscroll360",
  "hscroll320",
  "small",
  "errors",
];
const STOP_COLS = ["path", "n", "why", "el", "text", "indicator", "width", "contrast", "ring", "behind", "visible"];

const only = process.env.S18_ONLY ? new Set(process.env.S18_ONLY.split(",")) : null;
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
  const p = r.outcome.play ?? {};
  console.log(
    `${r.id} ${r.kind} ${r.outcomePicked} ${r.zone} ${r.scheme}/${r.motion} ${r.keyboard ? "keyboard" : "mouse"}${r.seed ? " seeded" : ""} ${r.seconds}s views=${r.views.length} screens=${r.rows.length} flagged=${bad.length} focus=${r.focus.length - badFocus.length}/${r.focus.length} stops=${r.stops.length - badStops.length}/${r.stops.length} play=${p.reached ?? "-"}s pause=${p.a1}->${p.a2} api=${r.requests.api.length}${r.outcome.crash ? " CRASH " + r.outcome.crash.split("\n")[0] : ""}`,
  );
}
await browser.close();
fs.writeFileSync(
  path.join(outDir, "screens.csv"),
  toCsv(
    results.flatMap((r) => r.rows),
    SCREEN_COLS,
  ),
);
fs.writeFileSync(
  path.join(outDir, "stops.csv"),
  toCsv(
    results.flatMap((r) => r.stops),
    STOP_COLS,
  ),
);
fs.writeFileSync(
  path.join(outDir, "views.json"),
  JSON.stringify(
    results.flatMap((r) => r.views),
    null,
    1,
  ),
);
fs.writeFileSync(
  path.join(outDir, "paths.json"),
  JSON.stringify(
    results.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !["rows", "stops", "views"].includes(k)))),
    null,
    1,
  ),
);
