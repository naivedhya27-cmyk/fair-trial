// S07: apply the app's gate decision (src/lib/gate/capture.ts) to the lab statistics of every labelled photo.
// Check-in mode compares each photo with the clean photo of the same face (the trial's baseline);
// absolute mode uses no baseline (a first photo). Turned-head photos are other people, so absolute mode only.
// Usage: npx tsx scripts/s07-gate.ts <labels.csv> <lab.jsonl> <out.csv>
import fs from "node:fs";
import { gate, THRESHOLDS, type CaptureStats } from "../src/lib/gate/capture";

const [, , labelsFile, labFile, outFile] = process.argv;
const parseCsv = (s: string) => {
  const [head, ...rows] = s.trim().split(/\r?\n/);
  const cols = head.split(",");
  return rows.map((r) => {
    const v = r.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
};
const labels = labelsFile.split(";").flatMap((f) => parseCsv(fs.readFileSync(f, "utf8")));
const lab = new Map<string, { stats?: CaptureStats; error?: string }>();
for (const line of fs.readFileSync(labFile, "utf8").split(/\r?\n/).filter(Boolean)) {
  const j = JSON.parse(line);
  lab.set(j.file.replace(/\\/g, "/"), j);
}
const key = (f: string) => f.replace(/\\/g, "/");
const clean = new Map<string, CaptureStats>();
for (const l of labels) if (l.kind === "clean") {
  const s = lab.get(key(l.file))?.stats;
  if (s) clean.set(l.face, s);
}
const out = ["file,face,fitz,split,kind,level,truth,mode,ok,reasons"];
let missing = 0;
for (const l of labels) {
  const r = lab.get(key(l.file));
  if (!r?.stats) {
    missing++;
    continue;
  }
  const modes: [string, CaptureStats | null][] = [["absolute", null]];
  if (l.kind !== "yaw") modes.push(["checkin", clean.get(l.face) ?? null]);
  for (const [mode, base] of modes) {
    const g = gate(r.stats, base, THRESHOLDS);
    out.push([l.file, l.face, l.fitz, l.split, l.kind, l.level, l.truth, mode, g.ok ? 1 : 0, g.reasons.join("|")].join(","));
  }
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log(`decisions ${out.length - 1}, photos without lab stats ${missing}`);
