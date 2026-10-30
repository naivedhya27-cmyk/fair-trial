// Validation helper: the app's half-face metric (src/lib/metrics/halfface.ts) on saved Skin Analysis results.
// For each photo: its landmarks from the lab run, its analysis JSON and its downloaded masks -> one row per concern
// and side. Usage: npx tsx scripts/halfmetrics.ts <photos.csv: id,file,apidir> <lab.jsonl> <out.csv>
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { halfMetric, halfRegions, type HalfRegions } from "../src/lib/metrics/halfface";
import { scaleGeometry, type FaceGeometry } from "../src/lib/vision/geometry";
import { outputOf, parseAnalysis } from "../src/lib/youcam/parse";

const [, , photosFile, labFile, outFile] = process.argv;
const [head, ...rows] = fs.readFileSync(photosFile, "utf8").trim().split(/\r?\n/);
const cols = head.split(",");
const photos = rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r.split(",")[i]])));
const lab = new Map<string, { width: number; height: number; points: [number, number][]; stats: { yaw: number; pitch: number; roll: number } }>();
for (const l of fs.readFileSync(labFile, "utf8").split(/\r?\n/).filter(Boolean)) {
  const j = JSON.parse(l);
  if (j.points) lab.set(j.file, j);
}
const out = ["photo,concern,raw,side,density,count,skin_px"];
for (const p of photos) {
  const L = lab.get(p.file);
  if (!L) {
    console.error("no landmarks for", p.file);
    continue;
  }
  const geo: FaceGeometry = {
    width: L.width,
    height: L.height,
    points: L.points.map(([x, y]) => ({ x, y })),
    pose: { yaw: L.stats.yaw, pitch: L.stats.pitch, roll: L.stats.roll },
  };
  const json = JSON.parse(fs.readFileSync(path.join(p.apidir + ".json"), "utf8"));
  const parsed = parseAnalysis(outputOf(json));
  const cache = new Map<string, HalfRegions>();
  for (const [concern, res] of Object.entries(parsed.concerns)) {
    const f = path.join(p.apidir, `${concern}.png`);
    if (!fs.existsSync(f)) continue;
    const png = PNG.sync.read(fs.readFileSync(f));
    const key = `${png.width}x${png.height}`;
    if (!cache.has(key)) cache.set(key, halfRegions(scaleGeometry(geo, png.width, png.height)));
    const R = cache.get(key)!;
    const alpha = new Uint8Array(png.width * png.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = png.data[4 * i + 3];
    const m = halfMetric(R, alpha);
    for (const side of ["subject_left", "subject_right"] as const) {
      out.push([p.id, concern, res?.raw ?? "", side, m[side].density.toFixed(4), m[side].count, R.pixels[side]].join(","));
    }
  }
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log("rows", out.length - 1);
