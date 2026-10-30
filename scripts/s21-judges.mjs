// S21 judges' code and status-before-photos check (prereg and bars in R/s21_score.R, B2 and B3), against <base>, 0 units.
//   test        the site deployed with the test configuration (public floor 100000):
//               /api/status with no code, the code and a wrong code; POST /api/analysis with no code and the wrong
//               code (sent only after /api/status confirms the test configuration, so nothing can be spent);
//               a judge's phone (/judges#<code>, a trial, the photo page, "Delete everything"), a phone with a wrong
//               code, and a public phone (a trial and the photo page)
//   production  the site deployed with the production configuration: /api/status with no code and the code, and a
//               public phone (a trial and the photo page)
// The code comes in the environment (JUDGE_PROBE, read by R from Windows Credential Manager) and is removed from this
// process's environment at once. It is never printed or written: only counts and true/false are.
// Usage: node scripts/s21-judges.mjs <test|production> <out.json> <base> <face.jpg>
import { chromium, devices } from "@playwright/test";
import fs from "node:fs";

const [, , mode, outFile, baseArg, face] = process.argv;
if (!["test", "production"].includes(mode) || !outFile || !baseArg || !face) {
  console.error("usage: node scripts/s21-judges.mjs <test|production> <out.json> <base> <face.jpg>");
  process.exit(2);
}
const CODE = process.env.JUDGE_PROBE ?? "";
delete process.env.JUDGE_PROBE;
if (!/^[A-Za-z0-9]{16,64}$/.test(CODE)) throw new Error("JUDGE_PROBE is missing or not a code");
// a wrong code of the same length: the last character changed
const WRONG = CODE.slice(0, -1) + (CODE.at(-1) === "Z" ? "Y" : "Z");
const base = baseArg.replace(/\/$/, "");
const HEADER = "x-fairtrial-judge";
const STEP = 60_000;

const status = async (code) => {
  const r = await fetch(`${base}/api/status`, { headers: code ? { [HEADER]: code } : {} });
  const text = await r.text();
  return { http: r.status, hasCode: text.includes(CODE) || text.includes(CODE.slice(0, 16)), ...JSON.parse(text) };
};
const out = { mode, base, at: new Date().toISOString(), codeLength: CODE.length };
out.status = { none: await status(), code: await status(CODE), wrong: await status(WRONG) };

if (mode === "test") {
  // the interlock: analysis requests go out only when the site says it is in the test configuration
  const s = out.status.none;
  out.testConfiguration = s.live === false && s.floors?.public === 100000 && out.status.code.judge === true;
  out.posts = [];
  if (out.testConfiguration) {
    for (const [label, code] of [["none", null], ["wrong", WRONG]]) {
      const fd = new FormData();
      fd.append("photo", new Blob([fs.readFileSync(face)], { type: "image/jpeg" }), "capture.jpg");
      fd.append("concerns", "wrinkle,texture,redness,moisture");
      const r = await fetch(`${base}/api/analysis`, { method: "POST", body: fd, headers: code ? { [HEADER]: code } : {} });
      const body = await r.json().catch(() => ({}));
      out.posts.push({ label, http: r.status, error: body.error ?? null, taskId: body.taskId ?? null });
    }
  }
}

// ---------- phones ----------
const browser = await chromium.launch({ channel: "chrome", headless: true });

/** A fresh phone whose every response is searched for the code (and its first 16 characters) before the page gets it. */
async function phone() {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  await context.addInitScript(() => {
    if (navigator.mediaDevices) {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 480;
      c.getContext("2d").fillRect(0, 0, 640, 480);
      const stream = c.captureStream(10);
      navigator.mediaDevices.getUserMedia = async () => stream.clone();
    }
  });
  const seen = { scanned: 0, code: 0, prefix: 0, control: 0 };
  await context.route("**/*", async (route) => {
    // a response still in flight when its page closes is dropped, never re-sent
    try {
      const res = await route.fetch({ timeout: 120_000 });
      const body = await res.body();
      const text = body.toString("latin1") + "\n" + JSON.stringify(res.headers());
      seen.scanned++;
      if (text.includes(CODE)) seen.code++;
      if (text.includes(CODE.slice(0, 16))) seen.prefix++;
      if (text.includes("Judge access")) seen.control++;
      await route.fulfill({ response: res, body });
    } catch {
      await route.abort().catch(() => undefined);
    }
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return { context, page, seen, errors };
}
const kept = (page) => page.evaluate((c) => localStorage.getItem("fairtrial.judge") === c, CODE);
const anyKept = (page) => page.evaluate(() => localStorage.getItem("fairtrial.judge") !== null);

async function judgePage(page, code) {
  await page.goto(`${base}/judges#${code}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("judge-state")?.dataset.state !== "checking", null, { timeout: STEP });
  return { state: await page.$eval("#judge-state", (e) => e.dataset.state), hashLeft: await page.evaluate(() => location.hash !== ""), urlHasCode: page.url().includes(code.slice(0, 16)) };
}

async function startTrial(page) {
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.click("#start-trial");
  await page.waitForSelector("#age", { timeout: STEP });
  await page.fill("#age", "34");
  for (const [n, v] of [["pregnancy", "no"], ["redflags", "no"], ["undercare", "no"], ["prescription", "no"]]) await page.check(`input[name="${n}"][value="${v}"]`);
  await page.click("#next");
  await page.waitForSelector("#product-name", { timeout: STEP });
  await page.fill("#product-name", "Cica Barrier Lotion");
  await page.check('input[name="type"][value="cream"]');
  await page.fill("#ingredients", "Aqua, Squalane, Glycerin, Centella Asiatica Extract, Madecassoside, Cetearyl Alcohol, Glyceryl Stearate, Xanthan Gum, Phenoxyethanol");
  await page.check('input[name="medicine"][value="no"]');
  await page.click("#next");
  await page.waitForSelector("#goal", { timeout: STEP });
  await page.click("#next");
  await page.waitForSelector("#draw-side", { timeout: STEP });
  await page.click("#draw-side");
  await page.waitForSelector("#side", { timeout: STEP });
  await page.click("#start-run-in");
  await page.waitForURL(/\/trial$/, { timeout: STEP });
  await page.waitForSelector("#today", { timeout: STEP });
}

/** The photo page: whether the paused notice (and its demo link) shows once /api/status has answered, and whether the
 * camera still opens from it. */
async function photoPage(page) {
  const answered = page.waitForResponse((r) => r.url().endsWith("/api/status"), { timeout: STEP });
  await page.goto(`${base}/trial/photos`, { waitUntil: "load" });
  const st = await (await answered).json();
  await page.waitForSelector("#start-camera", { timeout: STEP });
  await page.waitForTimeout(1500);
  const r = {
    statusLive: st.live,
    notice: (await page.$("#live-paused")) !== null,
    demoLink: await page.$eval("#paused-demo", (a) => a.getAttribute("href")).catch(() => null),
    noticeBeforeCamera: await page.evaluate(() => {
      const n = document.getElementById("live-paused"),
        b = document.getElementById("start-camera");
      return !!n && !!b && !!(n.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  };
  await page.click("#start-camera");
  r.cameraOpens = await page.waitForSelector("#capture-guidance", { timeout: STEP }).then(() => true, () => false);
  return r;
}

async function deleteEverything(page) {
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.click("#delete-everything");
  await page.waitForSelector("#confirm-delete", { timeout: STEP });
  await page.click("#confirm-delete");
  await page.waitForSelector("#start-trial", { timeout: STEP });
}

out.phones = {};
if (mode === "test") {
  {
    const { context, page, seen, errors } = await phone();
    const r = await judgePage(page, CODE);
    r.kept = await kept(page);
    await startTrial(page);
    r.photo = await photoPage(page);
    await deleteEverything(page);
    r.keptAfterDelete = await anyKept(page);
    r.responses = { ...seen };
    r.errors = errors;
    out.phones.judge = r;
    await context.close();
  }
  {
    const { context, page, seen, errors } = await phone();
    const r = await judgePage(page, WRONG);
    r.kept = await anyKept(page);
    r.responses = { ...seen };
    r.errors = errors;
    out.phones.wrong = r;
    await context.close();
  }
}
{
  const { context, page, seen, errors } = await phone();
  await startTrial(page);
  const r = { photo: await photoPage(page), responses: { ...seen }, errors };
  out.phones.public = r;
  await context.close();
}
await browser.close();
fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
const p = out.phones;
console.log(
  `${mode}: status none ${out.status.none.live}/${out.status.none.judge}, code ${out.status.code.live}/${out.status.code.judge}, wrong ${out.status.wrong.live}/${out.status.wrong.judge}` +
    (mode === "test" ? ` | test configuration ${out.testConfiguration}; posts ${out.posts.map((x) => `${x.label} ${x.http}`).join(", ")}` : "") +
    (p.judge ? ` | judge phone ${p.judge.state}, kept ${p.judge.kept}, notice ${p.judge.photo.notice}, after delete ${p.judge.keptAfterDelete}, code in ${p.judge.responses.code}/${p.judge.responses.scanned} responses` : "") +
    (p.wrong ? ` | wrong-code phone ${p.wrong.state}, kept ${p.wrong.kept}` : "") +
    ` | public phone notice ${p.public.photo.notice}, camera opens ${p.public.photo.cameraOpens}`,
);
