// S21b face finder check (prereg in R/s21b_score.R, B1): scripts/s21-finder.mjs with three changes, so one failure never
// loses what was measured: each case runs in its own try/catch (an error is recorded with the case), the results are
// saved after every case, and the headers are read with HEAD requests (no body), each retried once.
// S21 face finder check (prereg and bars in R/s21_score.R, B1): the /capture page, which never analyses (0 units), in
// fresh headless Chrome phones (Pixel 7, the S15 canvas camera) against <base>:
//   cold    throttled to Chrome DevTools' "Fast 3G" preset; when the camera says the face finder is loading, and when
//           the photo is taken; then warm: the same phone reloads with every face finder request blocked and takes a
//           photo again (the files must come from the app's own saved copy)
//   hung    the first request for MediaPipe's WebAssembly file never answers; when the photo is taken
//   failed  every request for the face finder's files fails; when the camera says so and offers Try again
//   headers the three files' Cache-Control under their versioned names
// Usage: node scripts/s21b-finder.mjs <out.json> <base> <face.jpg,face.jpg,...> (3 cold, 3 hung, 2 failed, in order)
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";

const [, , outFile, baseArg, facesArg] = process.argv;
if (!outFile || !baseArg || !facesArg) {
  console.error("usage: node scripts/s21b-finder.mjs <out.json> <base> <face,face,...>");
  process.exit(2);
}
const base = baseArg.replace(/\/$/, "");
const faces = facesArg.split(",");
if (faces.length !== 8) throw new Error("8 faces: 3 cold, 3 hung, 2 failed");
// Chrome DevTools' "Fast 3G": 1.6 Mbps down and 750 kbps up (each x 0.9), 150 ms x 3.75 latency
const FAST_3G = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1000 * 1000) / 8 * 0.9, uploadThroughput: (750 * 1000) / 8 * 0.9 };
const FINDER = /\/(mediapipe\/[^/]+\/wasm\/[^/?]+|models\/face_landmarker\.[0-9a-f]{8}\.task)(\?|$)/;
const WASM = /\/mediapipe\/[^/]+\/wasm\/vision_wasm[a-z_]*_internal\.wasm(\?|$)/;

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
  let im = null;
  const render = () => {
    fctx.fillStyle = "rgb(200,200,200)";
    fctx.fillRect(0, 0, W, H);
    if (!im) return;
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight);
    fctx.drawImage(im, W / 2 - (im.naturalWidth * s) / 2, H / 2 - (im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
  };
  render();
  setInterval(() => ctx.drawImage(frame, 0, 0), 33);
  const stream = c.captureStream(30);
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => stream.clone();
  window.__cam = {
    face: async (u) => {
      const i = new Image();
      i.src = u;
      await i.decode();
      im = i;
      render();
      ctx.drawImage(frame, 0, 0);
    },
  };
  try {
    window.speechSynthesis.speak = () => {};
    window.speechSynthesis.cancel = () => {};
  } catch {
    /* no speech object */
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });

async function phone() {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  await context.addInitScript(fakePhone);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (rq) => {
    const u = new URL(rq.url());
    if (FINDER.test(u.pathname)) finderPaths.add(u.pathname);
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  return { context, page, cdp, errors };
}
const finderPaths = new Set();

/** Open /capture, put the face on the camera, start it; times are from the camera opening. */
async function openCamera(page, face, reload = false) {
  if (reload) await page.reload({ waitUntil: "load", timeout: 180_000 });
  else await page.goto(`${base}/capture`, { waitUntil: "load", timeout: 180_000 });
  await page.waitForSelector("#start-camera", { timeout: 180_000 });
  await page.evaluate((u) => window.__cam.face(u), `data:image/jpeg;base64,${fs.readFileSync(face).toString("base64")}`);
  await page.click("#start-camera");
  await page.waitForSelector("#capture-guidance", { timeout: 60_000 });
  return Date.now();
}

/** Seconds from `t0` until `fn` is true in the page (null if it never is within `limit` s). */
async function secondsUntil(page, t0, fn, limit) {
  try {
    await page.waitForFunction(fn, null, { timeout: limit * 1000, polling: 100 });
    return Math.round((Date.now() - t0) / 100) / 10;
  } catch {
    return null;
  }
}
const loadingShown = () => !!document.getElementById("finder-progress");
const photoTaken = () => !!document.getElementById("capture-photo");
const failedShown = () => document.getElementById("capture-guidance")?.dataset.reason === "finder_failed" && !!document.getElementById("capture-retry");
const guidance = (page) => page.evaluate(() => ({ reason: document.getElementById("capture-guidance")?.dataset.reason ?? null, finder: document.getElementById("capture-guidance")?.dataset.finder ?? null, text: document.getElementById("capture-guidance")?.textContent ?? null })).catch(() => null);

const out = { base, at: new Date().toISOString(), throttle: FAST_3G, cold: [], hung: [], failed: [], headers: [] };
const save = () => fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
/** Run one case; an error is kept with the case instead of ending the run. */
async function attempt(list, base, run) {
  const r = { ...base };
  try {
    await run(r);
  } catch (e) {
    r.error = String(e?.message ?? e).slice(0, 300);
  }
  list.push(r);
  save();
  return r;
}

for (const [i, face] of faces.slice(0, 3).entries()) {
  const { context, page, cdp, errors } = await phone();
  const blocked = [];
  const r = await attempt(out.cold, { face }, async (r) => {
    await cdp.send("Network.emulateNetworkConditions", FAST_3G);
    const t0 = await openCamera(page, face);
    r.loadingShown = await secondsUntil(page, t0, loadingShown, 5);
    r.photo = await secondsUntil(page, t0, photoTaken, 120);
    r.end = await guidance(page);
    // warm: the same phone, every face finder request blocked
    await context.route(FINDER, (route) => {
      blocked.push(route.request().url().replace(base, ""));
      return route.abort("failed");
    });
    const t1 = await openCamera(page, face, true);
    r.warmPhoto = await secondsUntil(page, t1, photoTaken, 30);
  });
  r.warmBlocked = blocked;
  r.errors = errors.filter((e) => !/Failed to load resource/.test(e));
  save();
  console.log(`cold ${i + 1}: loading shown ${r.loadingShown} s, photo ${r.photo} s; warm photo ${r.warmPhoto} s with ${blocked.length} finder requests blocked; errors ${r.errors.length}${r.error ? `; failed: ${r.error}` : ""}`);
  await context.close().catch(() => undefined);
}

for (const [i, face] of faces.slice(3, 6).entries()) {
  const { context, page, errors } = await phone();
  const held = [];
  await context.route(WASM, (route) => {
    if (!held.length) {
      held.push(route.request().url().replace(base, "")); // never answered
      return;
    }
    return route.continue();
  });
  const r = await attempt(out.hung, { face, held }, async (r) => {
    const t0 = await openCamera(page, face);
    r.photo = await secondsUntil(page, t0, photoTaken, 90);
    r.end = await guidance(page);
  });
  r.errors = errors.filter((e) => !/Failed to load resource/.test(e));
  save();
  console.log(`hung ${i + 1}: held ${held.length}, photo ${r.photo} s; errors ${r.errors.length}${r.error ? `; failed: ${r.error}` : ""}`);
  await context.close().catch(() => undefined);
}

for (const [i, face] of faces.slice(6, 8).entries()) {
  const { context, page, errors } = await phone();
  const refused = [];
  await context.route(FINDER, (route) => {
    refused.push(route.request().url().replace(base, ""));
    return route.abort("failed");
  });
  const r = await attempt(out.failed, { face }, async (r) => {
    const t0 = await openCamera(page, face);
    r.failedShown = await secondsUntil(page, t0, failedShown, 90);
    r.end = await guidance(page);
  });
  r.refused = refused.length;
  r.errors = errors.filter((e) => !/Failed to load resource/.test(e));
  save();
  console.log(`failed ${i + 1}: shown ${r.failedShown} s after ${refused.length} refused requests: "${r.end?.text}"; errors ${r.errors.length}${r.error ? `; failed: ${r.error}` : ""}`);
  await context.close().catch(() => undefined);
}
await browser.close().catch(() => undefined);

// the face finder's files as the phones asked for them (their versioned names), and their cache header
// (HEAD: the header without the body, each request tried twice)
for (const p of [...finderPaths].sort()) {
  let h = { path: p, status: null, cacheControl: null };
  for (let t = 1; t <= 2; t++) {
    try {
      const res = await fetch(base + p, { method: "HEAD", signal: AbortSignal.timeout(30_000) });
      h = { path: p, status: res.status, cacheControl: res.headers.get("cache-control"), tries: t };
      break;
    } catch (e) {
      h = { path: p, status: null, cacheControl: null, tries: t, error: String(e?.message ?? e).slice(0, 200) };
    }
  }
  out.headers.push(h);
  save();
}
save();
console.log(`headers: ${out.headers.map((h) => `${h.path} ${h.status} ${h.cacheControl}`).join(" | ")}`);
