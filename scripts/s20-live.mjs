// S20 live path on the deployed site (prereg and bars in R/s20_score.R). It drives the lab page (src/app/lab/Lab.tsx)
// in headless Chrome against <base>, as the S14 runner (scripts/s14-e2e.mjs) drove the local server:
//   neg   the S14 refusals, which must cost nothing: bad uploads, bad concern lists, bad task ids, bad mask addresses
//   once  the refusals, then one live analysis through the product path (detect, upload, poll, masks, half-face
//         measures); no second paid request is ever sent (the site's daily limit is 3, so a second one would be paid)
// Usage: node scripts/s20-live.mjs <neg|once> <out.json> <face.jpg> <base> [concern,concern,...]
// Every HTTP response the page receives is routed through this script and searched in memory (body and headers) before
// the page gets it: for the key and its first 16 characters when the shell passes YOUCAM_KEY_PROBE (read by R from
// Windows Credential Manager; never printed, and removed from this process's environment before the browser starts),
// for a control string the lab page serves (must be found: the search sees the bodies), and for a fresh random string
// (must not be found). Only counts are written. A response that cannot be fetched is aborted, never re-sent.
import { chromium } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";

const [, , mode, outFile, face, baseArg, concernArg = ""] = process.argv;
if (!["neg", "once"].includes(mode) || !outFile || !face || !baseArg) {
  console.error("usage: node scripts/s20-live.mjs <neg|once> <out.json> <face.jpg> <base> [concerns]");
  process.exit(2);
}
const probe = process.env.YOUCAM_KEY_PROBE ?? "";
delete process.env.YOUCAM_KEY_PROBE;
const base = baseArg.replace(/\/$/, "");
const concerns = concernArg.split(",").map((s) => s.trim()).filter(Boolean);
const faceB64 = fs.readFileSync(face).toString("base64");

const needles = { control: "Validation lab", random: crypto.randomUUID() + crypto.randomUUID() };
if (probe.length >= 16) Object.assign(needles, { key: probe, keyPrefix: probe.slice(0, 16) });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
const seen = { requests: 0, authHeaders: 0, routed: 0, scanned: 0, bytes: 0, unfetched: 0, hits: Object.fromEntries(Object.keys(needles).map((k) => [k, 0])) };
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("request", (rq) => {
  seen.requests++;
  if ("authorization" in rq.headers()) seen.authHeaders++;
});
await page.route("**/*", async (route) => {
  seen.routed++;
  let res;
  try {
    res = await route.fetch({ timeout: 120000 });
  } catch {
    seen.unfetched++;
    return route.abort();
  }
  const body = await res.body();
  const text = body.toString("latin1") + "\n" + JSON.stringify(res.headers());
  seen.scanned++;
  seen.bytes += body.length;
  for (const [k, n] of Object.entries(needles)) if (text.includes(n)) seen.hits[k]++;
  await route.fulfill({ response: res, body });
});

await page.goto(`${base}/lab`, { waitUntil: "load" });
await page.waitForFunction(() => window.__labReady === true, null, { timeout: 120000 });

const result = { mode, base, at: new Date().toISOString(), face, concerns };
result.status = await page.evaluate(async () => (await fetch("/api/status")).json());

// the S14 refusals, unchanged (scripts/s14-e2e.mjs)
result.refusals = await page.evaluate(async (b64) => {
  const jpeg = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const photo = new Blob([jpeg], { type: "image/jpeg" });
  const form = (blob, name, concerns) => {
    const fd = new FormData();
    if (blob) fd.append("photo", blob, name);
    if (concerns !== undefined) fd.append("concerns", concerns);
    return fd;
  };
  const post = async (fd) => (await fetch("/api/analysis", { method: "POST", body: fd })).status;
  const get = async (path) => (await fetch(path)).status;
  const mask = (u) => get(`/api/mask?u=${encodeURIComponent(u)}`);
  const S3 = "https://yce-us.s3-accelerate.amazonaws.com";
  const cases = [
    ["not multipart", 400, async () => (await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status],
    ["no photo", 400, () => post(form(null, null, "wrinkle"))],
    ["GIF type", 415, () => post(form(new Blob([jpeg], { type: "image/gif" }), "x.gif", "wrinkle"))],
    ["no type", 415, () => post(form(new Blob([jpeg]), "x", "wrinkle"))],
    ["4 MB + 1 byte", 413, () => post(form(new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "image/jpeg" }), "x.jpg", "wrinkle"))],
    ["5 kB", 400, () => post(form(new Blob([jpeg.slice(0, 5000)], { type: "image/jpeg" }), "x.jpg", "wrinkle"))],
    ["no concerns field", 400, () => post(form(photo, "x.jpg"))],
    ["empty concerns", 400, () => post(form(photo, "x.jpg", " , "))],
    ["unknown concern", 400, () => post(form(photo, "x.jpg", "freckles"))],
    ["acne (not measurable by side)", 400, () => post(form(photo, "x.jpg", "acne"))],
    ["pore (marginal)", 400, () => post(form(photo, "x.jpg", "pore"))],
    ["radiance (not measurable by side)", 400, () => post(form(photo, "x.jpg", "radiance"))],
    ["five concerns", 400, () => post(form(photo, "x.jpg", "wrinkle,texture,redness,moisture,oiliness"))],
    ["repeated concern", 400, () => post(form(photo, "x.jpg", "wrinkle,wrinkle"))],
    ["upper-case concern", 400, () => post(form(photo, "x.jpg", "WRINKLE"))],
    ["task id too short", 400, () => get("/api/analysis/abc")],
    ["task id with a dot", 400, () => get(`/api/analysis/${encodeURIComponent("abcdefgh.ij")}`)],
    ["task id with a space", 400, () => get(`/api/analysis/${encodeURIComponent("abcdefgh ij")}`)],
    ["task id 201 characters", 400, () => get(`/api/analysis/${"a".repeat(201)}`)],
    ["mask: no address", 400, () => get("/api/mask")],
    ["mask: not a URL", 400, () => mask("nonsense")],
    ["mask: other host", 400, () => mask("https://example.com/m.png")],
    ["mask: look-alike host", 400, () => mask("https://evilamazonaws.com/m.png")],
    ["mask: other bucket", 400, () => mask("https://yce-evil.s3.amazonaws.com/m.png")],
    ["mask: host as a prefix", 400, () => mask("https://yce-us.s3-accelerate.amazonaws.com.evil.example/m.png")],
    ["mask: http", 400, () => mask("http://yce-us.s3-accelerate.amazonaws.com/m.png")],
    ["mask: port", 400, () => mask(`${S3}:8443/m.png`)],
    ["mask: credentials", 400, () => mask("https://user:pw@yce-us.s3-accelerate.amazonaws.com/m.png")],
    ["mask: right host, unsigned", 502, () => mask(`${S3}/nothing.png`)],
  ];
  const out = [];
  for (const [name, expected, run] of cases) {
    let got;
    try {
      got = await run();
    } catch (e) {
      got = `threw ${String(e).slice(0, 80)}`;
    }
    out.push({ name, expected, got, ok: got === expected });
  }
  return out;
}, faceB64);

if (mode === "once") {
  const ext = face.toLowerCase().endsWith(".png") ? "png" : "jpeg";
  const t0 = Date.now();
  result.e2e = await page.evaluate(([u, c]) => window.__lab.e2e(u, c), [`data:image/${ext};base64,${faceB64}`, concerns]);
  result.e2eWallMs = Date.now() - t0;
}

result.pageErrors = pageErrors;
result.browser = { ...seen, keyProbe: needles.key ? "run" : "not run" };
await browser.close();
fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(`mode ${mode}: refusals ok ${result.refusals.filter((r) => r.ok).length} of ${result.refusals.length}; status ${JSON.stringify(result.status)}`);
