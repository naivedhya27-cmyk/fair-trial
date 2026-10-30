// S24a demo check (prereg in R/s24a_score.R): plays every outcome of public/demo/demo.json through the demo page's own
// stops (src/lib/demo/stops.ts: the app's planner, guard, trial model and verdict engine) and writes each outcome's
// recorded verdicts and its number of stops, for R/s24a_check.R to compare with the R twin (R/s18_demo.R).
// Usage (from the app folder): npx tsx scripts/s24a-demo.ts <out.json>
import fs from "node:fs";
import { STEP_MS, stopsOf, type DemoData } from "../src/lib/demo/stops";

const [, , outFile] = process.argv;
const d = JSON.parse(fs.readFileSync("public/demo/demo.json", "utf8")) as DemoData;
const out = d.outcomes.map((o) => {
  const stops = stopsOf(d, o);
  const last = stops[stops.length - 1].trial;
  return {
    id: o.id,
    stops: stops.length,
    seconds: (stops.length * STEP_MS) / 1000,
    stopped: last.stopped != null,
    verdicts: last.verdicts.map((v) => ({ week: v.week, purpose: v.purpose, verdict: v.result.verdict, improvement: v.result.improvement })),
  };
});
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`demo: ${out.map((o) => `${o.id} ${o.stops} stops, ${o.verdicts.map((v) => `w${v.week} ${v.verdict}`).join(" ")}`).join(" | ")}`);
