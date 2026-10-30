// S10b: the gate in check-in mode (each photo against the clean photo of the same face) under the current rule (light
// judged on the eye and lip references) and the retired S07 rule (light judged on the cheeks), for every labelled photo.
// Usage: npx tsx scripts/s10b-gate.ts <labels.csv[;labels2.csv]> <lab.jsonl[;lab2.jsonl]> <out.csv>
import fs from "node:fs";
import { gate, gateS07, type CaptureStats } from "../src/lib/gate/capture";

const [, , labelsArg, labArg, outFile] = process.argv;
const parseCsv = (s: string) => {
  const [head, ...rows] = s.trim().split(/\r?\n/);
  const cols = head.split(",");
  return rows.map((r) => {
    const v = r.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, v[i]]));
  });
};
const key = (f: string) => f.replace(/\\/g, "/");
const labels = labelsArg.split(";").flatMap((f) => parseCsv(fs.readFileSync(f, "utf8")));
const lab = new Map<string, CaptureStats>();
for (const f of labArg.split(";")) {
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean)) {
    const j = JSON.parse(line);
    if (j.stats) lab.set(key(j.file), j.stats);
  }
}
const clean = new Map<string, CaptureStats>();
for (const l of labels) if (l.kind === "clean" && lab.has(key(l.file))) clean.set(l.face, lab.get(key(l.file))!);
const out = ["file,face,fitz,split,kind,level,truth,rule,ok,reasons"];
let missing = 0;
for (const l of labels) {
  const s = lab.get(key(l.file));
  const base = clean.get(l.face);
  if (!s || !base) {
    missing++;
    continue;
  }
  for (const [rule, g] of [["current", gate(s, base)], ["s07", gateS07(s, base)]] as const) {
    out.push([l.file, l.face, l.fitz, l.split, l.kind, l.level, l.truth, rule, g.ok ? 1 : 0, g.reasons.join("|")].join(","));
  }
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log(`decisions ${out.length - 1}, photos without stats or baseline ${missing}`);
