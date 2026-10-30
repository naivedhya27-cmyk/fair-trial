// S19 engine run (prereg in R/s19_score.R): decides every case in an engine-case file (R/s19_engine.R) with the app's
// engine (src/lib/stats/verdict.ts) and writes the results for R/s19_score.R to compare with the R twin.
// Usage (from the app folder): npx tsx scripts/s19-engine.ts <cases.json> <out.json>
import fs from "node:fs";
import { decide, type TrialEvidence } from "../src/lib/stats/verdict";

const [, , inFile, outFile] = process.argv;
const { cases } = JSON.parse(fs.readFileSync(inFile, "utf8")) as { cases: { id: string; evidence: TrialEvidence }[] };
const out = cases.map((c) => {
  const r = decide(c.evidence);
  return { id: c.id, verdict: r.verdict, improvement: r.improvement, se: r.se, t: r.t, df: r.df };
});
fs.writeFileSync(outFile, JSON.stringify(out));
console.log(`engine: ${out.length} cases decided`);
