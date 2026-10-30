// Headless-browser runner for the validation lab: for each image in a list, run the app's browser code and write
// one JSON line per image. Uses the installed Chrome (channel "chrome") with a throwaway profile.
// Usage: node scripts/lab-run.mjs <list.txt (one image path per line)> <out.jsonl> [baseUrl]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [, , listFile, outFile, base = "http://localhost:3123"] = process.argv;
const files = fs.readFileSync(listFile, "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const done = new Set(
  fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l).file) : [],
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
await page.goto(`${base}/lab`, { waitUntil: "load" });
await page.waitForFunction(() => window.__labReady === true, null, { timeout: 120000 });
let n = 0;
for (const f of files) {
  if (done.has(f)) continue;
  const ext = path.extname(f).toLowerCase() === ".png" ? "png" : "jpeg";
  const dataUrl = `data:image/${ext};base64,${fs.readFileSync(f).toString("base64")}`;
  let res;
  try {
    res = await page.evaluate((u) => window.__lab.run(u), dataUrl);
  } catch (e) {
    res = { error: String(e).slice(0, 300) };
  }
  fs.appendFileSync(outFile, JSON.stringify({ file: f, ...res }) + "\n");
  if (++n % 25 === 0) console.log(new Date().toISOString().slice(11, 19), n, "of", files.length);
}
console.log("done", n);
await browser.close();
