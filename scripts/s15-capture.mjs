// S15 runner: guided capture sessions on the camera check page (/capture) in a phone-sized headless Chrome (Pixel 7
// profile) whose camera is scripted. Each session (R/s15_sessions.R) is one person: the first-photo fault for 4 s of live
// checking, then their face until the photo is taken; then the check-in fault for 4 s, then their face until the
// check-in photo is taken. The page is driven only through what a person sees and taps; the runner records the prompt
// on screen, what is spoken, and when each photo was taken. Then every saved photo is checked again through the lab's
// still-photo path, the layout is checked on two phone sizes, and (with `live`) one drawn photo goes to the live API.
// Usage: node scripts/s15-capture.mjs <sessions.json> <outDir> [live=<sessionId>:<baseline|checkin>:<concern,...>]
import AxeBuilder from "@axe-core/playwright";
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [, , sessionsFile, outDir, liveArg] = process.argv;
const base = "http://localhost:3123";
const FAULT_MS = 4000;
const CAPTURE_TIMEOUT_MS = 20000;
fs.mkdirSync(outDir, { recursive: true });
const sessions = JSON.parse(fs.readFileSync(sessionsFile, "utf8"));
const dataUrl = (f) => `data:image/jpeg;base64,${fs.readFileSync(f).toString("base64")}`;

// Runs in the page before its own scripts: a 1080x1440 canvas camera the runner sets scenes on, a spoken-text log and a
// log of every prompt shown in #capture-guidance. Each scene is rendered once (S07's own recipes for side light and
// colour casts: a mean-preserving left-right ramp, per-channel scaling) and replayed at 30 frames a second.
function fakeCamera() {
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
  const face = (u, { scale = 1, dx = 0, dy = 0, rot = 0, filter = "none" } = {}) => {
    const im = images.get(u);
    const s = Math.max(W / im.naturalWidth, H / im.naturalHeight) * scale;
    fctx.save();
    fctx.translate(W / 2 + dx * W, H / 2 + dy * H);
    fctx.rotate((rot * Math.PI) / 180);
    fctx.filter = filter;
    fctx.drawImage(im, (-im.naturalWidth * s) / 2, (-im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
    fctx.restore();
  };
  const render = (sc) => {
    fctx.save();
    fctx.fillStyle = "rgb(200,200,200)";
    fctx.fillRect(0, 0, W, H);
    fctx.restore();
    if (sc.kind === "face") face(sc.url, sc);
    if (sc.kind === "two") {
      face(sc.url, { scale: 0.5, dx: -0.25 });
      face(sc.url2, { scale: 0.5, dx: 0.25 });
    }
    if (!sc.ramp && !sc.rgb) return;
    const img = fctx.getImageData(0, 0, W, H);
    const d = img.data;
    const [kr, kg, kb] = sc.rgb ?? [1, 1, 1];
    for (let x = 0; x < W; x++) {
      // S07 ramp: x (1 - g) at the darker edge to x (1 + g) at the other
      let m = 1;
      if (sc.ramp) {
        const u = (x + 0.5) / W;
        m = 1 - sc.ramp + 2 * sc.ramp * (sc.side === "left" ? u : 1 - u);
      }
      for (let y = 0; y < H; y++) {
        const i = 4 * (y * W + x);
        d[i] = Math.min(255, Math.round(d[i] * m * kr));
        d[i + 1] = Math.min(255, Math.round(d[i + 1] * m * kg));
        d[i + 2] = Math.min(255, Math.round(d[i + 2] * m * kb));
      }
    }
    fctx.putImageData(img, 0, 0);
  };
  render({ kind: "blank" });
  setInterval(() => ctx.drawImage(frame, 0, 0), 33);
  const stream = c.captureStream(30);
  if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => stream.clone();
  const log = { prompts: [], spoken: [] };
  window.__s15 = {
    log,
    set: async (s) => {
      await load(s.url);
      await load(s.url2);
      render(s);
      ctx.drawImage(frame, 0, 0);
      return Date.now();
    },
  };
  try {
    window.speechSynthesis.speak = (u) => log.spoken.push({ t: Date.now(), text: u.text });
    window.speechSynthesis.cancel = () => {};
  } catch {
    /* no speech object */
  }
  let last = null;
  new MutationObserver(() => {
    const el = document.getElementById("capture-guidance");
    const r = el ? el.dataset.reason : null;
    if (r !== last) {
      last = r;
      if (r) log.prompts.push({ t: Date.now(), reason: r, text: el.textContent });
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

function firstScene(s) {
  const f = s.first,
    u = dataUrl(s.face);
  switch (f.fault) {
    case "no_face":
      return { kind: "blank" };
    case "several_faces":
      return { kind: "two", url: u, url2: dataUrl(f.other) };
    case "too_far":
      return { kind: "face", url: u, scale: 0.4 };
    case "off_centre":
      return { kind: "face", url: u, dx: 0.3 };
    case "tilted":
      return { kind: "face", url: u, rot: 22 };
    case "turned":
      return { kind: "face", url: dataUrl(f.yaw) };
  }
  throw new Error(`unknown first-photo fault ${f.fault}`);
}

function checkinScene(s) {
  const c = s.checkin,
    u = dataUrl(s.face);
  switch (c.fault) {
    case "too_dark":
      return { kind: "face", url: u, filter: "brightness(0.45)" };
    case "too_bright":
      return { kind: "face", url: u, filter: "brightness(1.9)" };
    case "side_light":
      return { kind: "face", url: u, ramp: 0.4, side: c.side };
    case "colour_changed":
      return { kind: "face", url: u, rgb: c.cast === "warm" ? [1.18, 1, 0.8] : [0.84, 1, 1.18] };
    case "blurry":
      return { kind: "face", url: u, filter: "blur(5px)" };
  }
  throw new Error(`unknown check-in fault ${c.fault}`);
}

const reasonNow = (page) => page.evaluate(() => document.getElementById("capture-guidance")?.dataset.reason ?? null);

async function segment(page, id, mode, fault, faultScene, goodScene, startButton) {
  const startAt = await page.evaluate((s) => window.__s15.set(s), faultScene);
  await page.click(startButton);
  await page.waitForFunction(() => {
    const r = document.getElementById("capture-guidance")?.dataset.reason;
    return (r && r !== "starting") || document.getElementById("capture-photo");
  }, null, { timeout: 60000 });
  const liveAt = await page.evaluate(() => Date.now());
  await page.waitForTimeout(FAULT_MS);
  const faultPrompt = await reasonNow(page);
  const clearedAt = await page.evaluate((s) => window.__s15.set(s), goodScene);
  const shot = await page.waitForSelector(`#capture-photo[data-mode="${mode}"]`, { timeout: CAPTURE_TIMEOUT_MS }).catch(() => null);
  const seg = { mode, fault, startAt, liveAt, clearedAt, faultPrompt, capturedAt: null, photo: null };
  if (shot) {
    seg.capturedAt = Number(await shot.getAttribute("data-at"));
    const url = await page.evaluate(async () => {
      const b = await (await fetch(document.getElementById("capture-photo").src)).blob();
      return await new Promise((r) => {
        const fr = new FileReader();
        fr.onload = () => r(fr.result);
        fr.readAsDataURL(b);
      });
    });
    seg.photo = path.join(outDir, `${id}_${mode}.jpg`);
    fs.writeFileSync(seg.photo, Buffer.from(url.split(",")[1], "base64"));
  }
  return seg;
}

async function layoutCheck(page, where) {
  return page.evaluate((where) => {
    const vw = window.innerWidth,
      vh = window.innerHeight;
    const boxes = [...document.querySelectorAll("button, #capture-guidance")].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.id || el.textContent.trim().slice(0, 24), tag: el.tagName, x: r.x, y: r.y, w: r.width, h: r.height };
    });
    return {
      where,
      vw,
      vh,
      horizontalScroll: document.documentElement.scrollWidth > vw,
      smallTargets: boxes.filter((b) => b.tag === "BUTTON" && (b.w < 44 || b.h < 44)).map((b) => b.id),
      offScreen: where === "camera" ? boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > vw + 0.5 || b.y + b.h > vh + 0.5).map((b) => b.id) : [],
    };
  }, where);
}

const axe = async (page, where) => {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return { where, serious: r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id), all: r.violations.map((v) => `${v.id}:${v.impact}`) };
};

const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
for (const s of sessions) {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  await context.addInitScript(fakeCamera);
  const page = await context.newPage();
  const rec = { id: s.id, face: s.face };
  try {
    await page.goto(`${base}/capture`, { waitUntil: "load" });
    await page.waitForSelector("#start-camera");
    rec.first = await segment(page, s.id, "baseline", s.first.fault, firstScene(s), { kind: "face", url: dataUrl(s.face) }, "#start-camera");
    if (rec.first.photo) {
      await page.click("#use-photo");
      await page.waitForSelector("#start-checkin");
      rec.checkin = await segment(page, s.id, "checkin", s.checkin.fault, checkinScene(s), { kind: "face", url: dataUrl(s.face) }, "#start-checkin");
    }
  } catch (e) {
    rec.error = String(e).slice(0, 300);
  }
  rec.log = await page.evaluate(() => window.__s15?.log ?? null).catch(() => null);
  results.push(rec);
  fs.appendFileSync(path.join(outDir, "sessions.jsonl"), JSON.stringify(rec) + "\n");
  console.log(s.id, rec.first?.faultPrompt, rec.first?.capturedAt ? "photo" : "no photo", rec.checkin?.faultPrompt, rec.checkin?.capturedAt ? "photo" : "no photo", rec.error ?? "");
  await context.close();
}

// Every saved photo through the lab's still-photo path, with the gate in its mode.
const lab = await (await browser.newContext()).newPage();
await lab.goto(`${base}/lab`, { waitUntil: "load" });
await lab.waitForFunction(() => window.__labReady === true, null, { timeout: 120000 });
const rescore = [];
for (const r of results) {
  const row = { id: r.id };
  if (r.first?.photo) {
    const b = await lab.evaluate((u) => window.__lab.run(u), dataUrl(r.first.photo));
    row.baseline = await lab.evaluate((st) => window.__lab.gate(st, null), b.stats);
    if (r.checkin?.photo) {
      const c = await lab.evaluate((u) => window.__lab.run(u), dataUrl(r.checkin.photo));
      row.checkin = await lab.evaluate(([st, bs]) => window.__lab.gate(st, bs), [c.stats, b.stats]);
    }
  }
  rescore.push(row);
}
fs.writeFileSync(path.join(outDir, "rescore.json"), JSON.stringify(rescore, null, 2));

// Layout on two phone sizes: intro, camera (live) and review screens; accessibility rules on the larger one.
const layout = [];
for (const [name, ctxOpts] of [
  ["Pixel 7", { ...devices["Pixel 7"] }],
  ["360x640", { viewport: { width: 360, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const context = await browser.newContext(ctxOpts);
  await context.addInitScript(fakeCamera);
  const page = await context.newPage();
  await page.goto(`${base}/capture`, { waitUntil: "load" });
  await page.waitForSelector("#start-camera");
  const entry = { device: name, checks: [], axe: [] };
  entry.checks.push(await layoutCheck(page, "intro"));
  if (name === "Pixel 7") entry.axe.push(await axe(page, "intro"));
  await page.evaluate((s) => window.__s15.set(s), { kind: "face", url: dataUrl(sessions[0].face), scale: 0.4 });
  await page.click("#start-camera");
  await page.waitForFunction(() => (document.getElementById("capture-guidance")?.dataset.reason ?? "starting") !== "starting", null, { timeout: 60000 });
  entry.checks.push(await layoutCheck(page, "camera"));
  if (name === "Pixel 7") entry.axe.push(await axe(page, "camera"));
  await page.evaluate((s) => window.__s15.set(s), { kind: "face", url: dataUrl(sessions[0].face) });
  if (await page.waitForSelector("#capture-photo", { timeout: CAPTURE_TIMEOUT_MS }).catch(() => null)) {
    entry.checks.push(await layoutCheck(page, "review"));
    if (name === "Pixel 7") entry.axe.push(await axe(page, "review"));
  } else entry.checks.push({ where: "review", missing: true });
  layout.push(entry);
  await context.close();
}
fs.writeFileSync(path.join(outDir, "layout.json"), JSON.stringify(layout, null, 2));

// One drawn photo through the live API (the S14 path): 9 units.
if (liveArg) {
  const [id, mode, concerns] = liveArg.replace(/^live=/, "").split(":");
  const requested = concerns.split(",");
  const file = path.join(outDir, `${id}_${mode}.jpg`);
  const live = fs.existsSync(file)
    ? await lab.evaluate(([u, c]) => window.__lab.e2e(u, c), [dataUrl(file), requested])
    : { error: `no photo for ${id} ${mode}` };
  fs.writeFileSync(path.join(outDir, "live.json"), JSON.stringify({ id, mode, requested, ...live }, null, 2));
  console.log("live:", live.error ?? `task ok, ${Object.keys(live.concerns ?? {}).length} concerns`);
}
await browser.close();
console.log("done");
