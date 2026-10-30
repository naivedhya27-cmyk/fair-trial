// S08: gate every replicate draw against its face's original (check-in mode, current thresholds) and keep the first
// passing draw per replicate. Usage: npx tsx scripts/s08-gatecheck.ts <captures.csv> <lab.jsonl> <chosen.csv>
import fs from "node:fs";
import { gate, type CaptureStats } from "../src/lib/gate/capture";

const [, , capFile, labFile, outFile] = process.argv;
const [head, ...rows] = fs.readFileSync(capFile, "utf8").trim().split(/\r?\n/);
const cols = head.split(",");
const caps = rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r.split(",")[i]])));
const lab = new Map<string, CaptureStats>();
for (const l of fs.readFileSync(labFile, "utf8").split(/\r?\n/).filter(Boolean)) {
  const j = JSON.parse(l);
  if (j.stats) lab.set(j.file, j.stats);
}
const out = ["face,fitz,rep,draw,file,ok,reasons"];
const kept = new Set<string>();
for (const c of caps) {
  const base = lab.get(caps.find((x) => x.face === c.face && x.rep === "0")!.file)!;
  const s = lab.get(c.file);
  const g = s ? gate(s, c.rep === "0" ? null : base) : { ok: false, reasons: ["no_face"] };
  const k = `${c.face}-${c.rep}`;
  const keep = g.ok && !kept.has(k);
  if (keep) kept.add(k);
  out.push([c.face, c.fitz, c.rep, c.draw, c.file, keep ? "kept" : g.ok ? "spare" : "rejected", g.reasons.join("|")].join(","));
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
const faces = new Set(caps.map((c) => c.face));
console.log(`kept ${kept.size} of ${faces.size * 3} needed; rejected draws: ${out.filter((l) => l.includes(",rejected,")).length}`);
