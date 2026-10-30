// S16 judge's path audit: every screen of the trial flow on a fake phone (Pixel 7 with the S15 canvas camera) and a
// fake clock, with every YouCam call answered here, so it spends 0 units. Paths come from R/s16_paths.R.
//   node scripts/s16-audit.mjs <paths.json> <outDir> [base=http://localhost:3123]
// Writes <outDir>/screens.csv (one row per screen check), paths.json (each path's outcome) and photos.csv.
// Each screen check: page errors and console errors since the last check, the number of h1 headings, claim words in
// any text a person can see or hear (the claim policy since S20; the S13 list before), axe-core serious or critical findings (WCAG 2.0/2.1 A and AA),
// sideways scrolling at the phone's width and at 360 x 640, and buttons smaller than 44 px.
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
const SHOTS = new Set();

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
const MASK_W = 270,
  MASK_H = 360,
  GAP_MS = 60_000,
  STEP_MS = 30_000;

// ---------- calendar (the runner's own, from the trial design: 4 run-in days, then visits W weeks after the start) ----------
const addDays = (day, n) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// S24a's rule (its prereg, R/s24a_score.R; S24 brought the runner to it): week 2; the first look F when 2 < F < V; W + 2
// after an adjustment window W when W + 2 < V and no look so far falls after W; week 4 when V >= 6 and no look falls
// between week 2 and V; the verdict week V.
function visitsFor(firstLook, verdict, adjustTo = null) {
  const last = Math.max(verdict, 2);
  const v = [{ week: 2, days: 1, purpose: "safety" }];
  if (firstLook > 2 && firstLook < last) v.push({ week: firstLook, days: 2, purpose: "first_look" });
  if (adjustTo != null && adjustTo + 2 < last && !v.some((x) => x.week > adjustTo)) v.push({ week: adjustTo + 2, days: 2, purpose: "safety" });
  if (last >= 6 && !v.some((x) => x.week > 2 && x.week < last)) v.push({ week: 4, days: 2, purpose: "first_look" });
  v.push({ week: last, days: 3, purpose: "verdict" });
  return v.sort((a, b) => a.week - b.week);
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
      trial: trial && { id: trial.id, side: trial.side, goal: trial.goal, concerns: trial.concerns, stopped: trial.stopped, verdicts: trial.verdicts.map((v) => ({ week: v.week, purpose: v.purpose, verdict: v.result.verdict, improvement: v.result.improvement, mde: v.result.mde })), plan: { verdictWeek: trial.plan.verdictWeek, firstLookWeek: trial.plan.firstLookWeek, adjustToWeek: trial.plan.adjustToWeek ?? null, visits: trial.plan.visits } },
      photos: photos.sort((a, b) => a.takenAt - b.takenAt),
    };
  });

// ---------- one screen check ----------
async function check(page, R, key, ready, { camera = false } = {}) {
  if (ready) await page.waitForSelector(ready, { timeout: STEP_MS });
  await page.waitForTimeout(250);
  const info = await page.evaluate(() => {
    const texts = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("script,style,template,noscript") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) texts.push(n.nodeValue);
    for (const el of document.querySelectorAll("[aria-label],[alt],[title],[placeholder]"))
      for (const a of ["aria-label", "alt", "title", "placeholder"]) if (el.hasAttribute(a)) texts.push(el.getAttribute(a));
    texts.push(document.title, document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "");
    const text = texts.join(" \n ");
    const small = [...document.querySelectorAll("button")]
      .filter((b) => b.offsetParent !== null)
      .map((b) => ({ b, r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width < 44 || r.height < 44)
      .map(({ b }) => b.id || b.textContent.trim().slice(0, 24));
    // a heading counts when it is rendered: Next keeps pages visited earlier, hidden, for the back button
    const h1 = [...document.querySelectorAll("h1")].filter((h) => h.getClientRects().length > 0).length;
    return { h1, text, small, hscroll: document.documentElement.scrollWidth > window.innerWidth, title: document.title };
  });
  info.claims = [...new Set(findClaims(info.text).map((c) => c.match))];
  const ax = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  let hscroll360 = null;
  if (!camera) {
    const vp = page.viewportSize();
    await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForTimeout(150);
    hscroll360 = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.setViewportSize(vp);
  }
  const row = {
    path: R.id,
    type: R.type,
    screen: key,
    url: page.url().replace(base, ""),
    title: info.title,
    h1: info.h1,
    claims: info.claims.join("|"),
    axe_serious: ax.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id).join("|"),
    axe_all: ax.violations.map((v) => `${v.id}:${v.impact}`).join("|"),
    hscroll: info.hscroll,
    hscroll360,
    small: info.small.join("|"),
    errors: R.errors.splice(0).join(" || "),
  };
  R.rows.push(row);
  // one picture of each screen, the first time it is seen in the run (for the report and a human look)
  if (!SHOTS.has(key)) {
    SHOTS.add(key);
    await page.screenshot({ path: path.join(outDir, "shots", `${key.replace(/:/g, "_")}.png`), fullPage: !camera }).catch(() => {});
  }
  return row;
}

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
      const taskId = `s16mock${R.id}${String(R.mock.posts).padStart(4, "0")}`;
      const r = R.rng;
      const shared = r.normal();
      const values = {};
      for (const c of concerns) {
        const n = NOISE.get(c) ?? { mean_half: 30, sem_D: 2 };
        const base = n.mean_half * (1 + 0.05 * shared);
        let L = base + 0.25 * n.sem_D * r.normal(),
          Rt = base + 0.25 * n.sem_D * r.normal();
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
      R.mock.planted.push({ taskId, day: R.day, values });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ taskId, units: 9, concerns }) });
    }
    if (url.pathname.startsWith("/api/analysis/") && req.method() === "GET") {
      R.mock.polls++;
      const id = decodeURIComponent(url.pathname.split("/").pop());
      const t = R.mock.tasks.get(id);
      if (!t) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "error", error: "unknown task" }) });
      const concerns = Object.fromEntries(Object.entries(t.values).map(([c, v]) => [c, { raw: v.raw, mask: `https://yce-us.s3-accelerate.amazonaws.com/s16mock/${id}/${c}.png` }]));
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "success", concerns, image: null }) });
    }
    if (url.pathname === "/api/mask") {
      R.mock.masks++;
      const m = new URL(url.searchParams.get("u") ?? "https://invalid/").pathname.match(/^\/s16mock\/([^/]+)\/([a-z_0-9]+)\.png$/);
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
const fill = async (page, sel, v) => page.fill(sel, String(v));
const pick = async (page, name, value) => page.check(`input[name="${name}"][value="${value}"]`);

async function startTrial(page, R, P) {
  await page.goto(`${base}/`);
  await check(page, R, "home:new", "#start-trial");
  if (P.path === "P1") {
    await page.click("#camera-check");
    await check(page, R, "camera:intro", "#start-camera");
    await page.goto(`${base}/`);
    await page.waitForSelector("#start-trial");
  }
  await page.click("#start-trial");
  await check(page, R, "new:you", "#age");
  const pr = P.person;
  await fill(page, "#age", pr.age);
  await pick(page, "pregnancy", pr.pregnancy);
  await pick(page, "redflags", pr.redFlags ? "yes" : "no");
  await pick(page, "undercare", pr.underCare ? "yes" : "no");
  await pick(page, "prescription", pr.prescription ? "yes" : "no");
  await page.click("#next");
  const firstStop = await page.waitForSelector("#product-name, [data-rule]", { timeout: STEP_MS });
  if ((await firstStop.getAttribute("data-rule")) != null) return checkScreen(page, R, P);
  await fill(page, "#product-name", P.product.name);
  await pick(page, "type", P.product.type);
  await fill(page, "#ingredients", P.product.ingredients);
  await pick(page, "medicine", pr.medicine ? "yes" : "no");
  await check(page, R, "new:product", "#ingredients");
  await page.click("#next");
  const after = await page.waitForSelector("[data-rule], [data-reason], #goal", { timeout: STEP_MS });
  if ((await after.getAttribute("data-rule")) != null) {
    const go = await checkScreen(page, R, P);
    if (go !== "warn") return go;
    await page.click("#next");
    await page.waitForSelector("[data-reason], #goal", { timeout: STEP_MS });
  }
  const reason = await page.$eval("[data-reason]", (e) => e.dataset.reason).catch(() => null);
  if (reason) {
    await check(page, R, "new:plan:no_trial", "[data-reason]");
    R.outcome.noTrial = reason;
    return "no_trial";
  }
  await check(page, R, "new:plan", "#goal");
  R.outcome.planGoal = await page.$eval("#goal", (e) => e.textContent.trim());
  await page.click("#next");
  await check(page, R, "new:side:before", "#draw-side");
  await page.click("#draw-side");
  await check(page, R, "new:side:drawn", "#side");
  R.outcome.shownSide = await page.$eval("#side", (e) => e.dataset.side);
  await page.click("#start-run-in");
  await page.waitForURL(/\/trial$/, { timeout: STEP_MS });
  await page.waitForSelector("#today", { timeout: STEP_MS });
  const s = await stored(page);
  R.side = s.trial.side;
  R.goal = s.trial.goal;
  R.outcome.storedSide = s.trial.side;
  R.outcome.goal = s.trial.goal;
  R.outcome.plan = s.trial.plan;
  R.outcome.dashboardSide = await page.$eval("main", (e) => e.textContent.match(/your (left|right) side only/i)?.[1]?.toLowerCase() ?? null);
  return "started";
}

async function checkScreen(page, R, P) {
  const rules = await page.$$eval("[data-rule]", (els) => els.map((e) => e.dataset.rule));
  const title = await page.$eval("h1", (e) => e.textContent.trim());
  const action = /professional/.test(title) ? "refer" : /can't test/.test(title) ? "refuse" : "warn";
  await check(page, R, `new:check:${action}`, "[data-rule]");
  R.outcome.check = { action, rules, forward: (await page.$("#next")) != null };
  return action;
}

/** Today's photos, as a judge takes them: the dashboard, the photo page, two photos a minute apart, back. */
async function photoDay(page, R, label) {
  await page.goto(`${base}/trial`);
  await page.waitForSelector("#today", { timeout: STEP_MS });
  const kind = await kindNow(page);
  R.kinds.push({ day: R.day, before: kind });
  if (!R.seen.has(`trial:${kind}`)) await check(page, R, `trial:${kind}`, "#take-photos");
  R.seen.add(`trial:${kind}`);
  await page.click("#take-photos");
  await page.waitForSelector("#start-camera", { timeout: STEP_MS });
  if (!R.seen.has("photos:ready")) await check(page, R, "photos:ready", "#start-camera");
  R.seen.add("photos:ready");
  // the first camera of a path is checked while it looks for a face (a steady screen), then the face appears
  const firstCamera = !R.seen.has("photos:camera");
  if (!firstCamera) await face(page, R);
  await page.click("#start-camera");
  await page.waitForSelector("#capture-guidance", { timeout: STEP_MS });
  if (firstCamera) {
    await page.waitForFunction(() => {
      const r = document.getElementById("capture-guidance")?.dataset.reason;
      return r && r !== "starting";
    }, null, { timeout: STEP_MS });
    if (label === "voice-off") {
      await page.click('button[aria-pressed="true"]');
      R.outcome.voiceKey = await page.evaluate(() => localStorage.getItem("fairtrial.voice"));
    }
    await check(page, R, "photos:camera", "#capture-guidance", { camera: true });
    await face(page, R);
  }
  R.seen.add("photos:camera");
  await page.waitForSelector("#countdown", { timeout: STEP_MS });
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
  await page.click("#next-photo");
  await page.waitForSelector("#session-status", { timeout: STEP_MS });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-photo-status]")].every((e) => e.dataset.photoStatus !== "pending"), null, { timeout: STEP_MS });
  const statuses = await page.$$eval("[data-photo-status]", (els) => els.map((e) => e.dataset.photoStatus));
  const doneKey = statuses.includes("error") ? "photos:done_error" : "photos:done";
  if (!R.seen.has(doneKey)) await check(page, R, doneKey, "#back-to-trial");
  R.seen.add(doneKey);
  await page.click("#back-to-trial");
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
  return page.$$eval("[data-verdict][data-week]", (els) => els.map((e) => ({ week: Number(e.dataset.week), verdict: e.dataset.verdict })));
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
  const plan = visitsFor(R.outcome.plan.firstLookWeek, R.outcome.plan.verdictWeek, R.outcome.plan.adjustToWeek ?? null);
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
    if (latest && !R.seen.has(`trial:verdict:${latest.verdict}`)) await check(page, R, `trial:verdict:${latest.verdict}`, `[data-verdict="${latest.verdict}"]`);
    if (latest) R.seen.add(`trial:verdict:${latest.verdict}`);
    if (latest?.verdict === "stop") break;
  }
}

async function certificate(page, R) {
  await page.goto(`${base}/trial`);
  await page.click("#certificate");
  await check(page, R, "certificate", "#certificate-verdict");
  R.outcome.certificate = await page.evaluate(() => ({
    verdict: document.getElementById("certificate-verdict")?.dataset.verdict ?? null,
    improvement: document.getElementById("certificate-improvement")?.textContent ?? null,
    improvementValue: Number(document.getElementById("certificate-improvement")?.dataset.value),
    pubmed: [...document.querySelectorAll('a[href^="https://pubmed.ncbi.nlm.nih.gov/"]')].length,
    trialId: /Trial [0-9a-f-]{36}/.test(document.body.textContent),
    limits: !!document.querySelector('[aria-label="Limits"]'),
  }));
  await page.click("#print");
  R.outcome.certificate.printed = await page.evaluate(() => window.__printed);
}

async function deleteAll(page, R, where) {
  await page.click("#delete-everything");
  await check(page, R, `${where}:delete_confirm`, "#confirm-delete");
  await page.click("#confirm-delete");
  await page.waitForSelector("#start-trial", { timeout: STEP_MS });
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
    zone: P.zone,
    start: P.start,
    rows: [],
    errors: [],
    seen: new Set(),
    kinds: [],
    gaps: [],
    outcome: { verdicts: [] },
    mock: { mode: "ok", posts: 0, polls: 0, masks: 0, refused: 0, other: 0, tasks: new Map(), planted: [] },
    rng: rng(`s16:${P.id}`),
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
  R.context = await browser.newContext({ ...devices["Pixel 7"], timezoneId: P.zone });
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
        R.outcome.paused.after = await stored(page).then((s) => s.photos.map((p) => p.status));
        await page.click("#stop-trial");
        await check(page, R, "trial:stop_confirm", "#confirm-stop");
        await page.click("#confirm-stop");
        await page.waitForSelector('#today[data-kind="stopped"]', { timeout: STEP_MS });
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
    R.errors.length && R.rows.push({ path: R.id, type: R.type, screen: "crash", errors: R.errors.splice(0).join(" || ") });
  }
  await R.context.close();
  return {
    id: P.id,
    path: P.path,
    variant: P.variant,
    zone: P.zone,
    start: P.start,
    product: P.product.class,
    expect: P.expect,
    outcome: R.outcome,
    gaps: R.gaps,
    kinds: R.kinds,
    mock: { posts: R.mock.posts, polls: R.mock.polls, masks: R.mock.masks, refused: R.mock.refused, other: R.mock.other },
    seconds: Math.round((Date.now() - t0) / 1000),
    rows: R.rows,
  };
}

const csv = (rows) => {
  const cols = ["path", "type", "screen", "url", "title", "h1", "claims", "axe_serious", "axe_all", "hscroll", "hscroll360", "small", "errors"];
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n") + "\n";
};

const only = process.env.S16_ONLY ? new Set(process.env.S16_ONLY.split(",")) : null;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
for (const P of paths) {
  if (only && !only.has(P.id)) continue;
  const r = await runPath(browser, P);
  results.push(r);
  const bad = r.rows.filter((x) => x.h1 !== 1 || x.claims || x.axe_serious || x.hscroll === true || x.hscroll360 === true || x.small || x.errors);
  console.log(`${r.id} ${r.path}${r.variant} ${r.zone} ${r.seconds}s screens=${r.rows.length} flagged=${bad.length} posts=${r.mock.posts}${r.outcome.crash ? " CRASH " + r.outcome.crash.split("\n")[0] : ""}`);
}
await browser.close();
fs.writeFileSync(path.join(outDir, "screens.csv"), csv(results.flatMap((r) => r.rows)));
fs.writeFileSync(path.join(outDir, "paths.json"), JSON.stringify(results.map(({ rows, ...r }) => r), null, 1));
console.log(`wrote ${results.length} paths, ${results.reduce((s, r) => s + r.rows.length, 0)} screen checks to ${outDir}`);
