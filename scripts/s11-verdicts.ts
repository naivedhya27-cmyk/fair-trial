// S11: run the app's verdict engine (src/lib/stats/verdict.ts) on simulated trial visits written by R, and, for
// comparison only, the z rule it replaced (photos pooled with the S08 floor at 2 degrees of freedom, z 1.645 / 1.28).
// Input CSV columns: id,baseline,checkin,week,verdict_week,adjust_to_week,better,prior_sem,usable, where baseline and
// checkin list days separated by ";" and each day's photo D values separated by "|".
// Usage: npx tsx scripts/s11-verdicts.ts <in.csv> <out.csv> [alphaWork alphaStop floor(0|1)]
import fs from "node:fs";
import { decide, ENGINE, type EngineSettings, type TrialEvidence, type Verdict } from "../src/lib/stats/verdict";

const [, , inFile, outFile, aw, as, fl] = process.argv;
const settings: EngineSettings = aw ? { alphaWork: Number(aw), alphaStop: Number(as), floor: fl !== "0" } : ENGINE;
const days = (s: string) => s.split(";").map((d) => d.split("|").map(Number));

/** The pre-S11 rule: every photo a unit, sigma pooled with the S08 floor at 2 df, normal critical values. */
function oldRule(e: TrialEvidence): Verdict {
  const b = e.baseline.flat(),
    c = e.checkin.flat();
  const mb = b.reduce((s, v) => s + v, 0) / b.length,
    mc = c.reduce((s, v) => s + v, 0) / c.length;
  const own = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (b.length - 1);
  const sigma = Math.sqrt((2 * e.priorSem ** 2 + (b.length - 1) * own) / (2 + b.length - 1));
  const z = (e.better === "lower" ? mb - mc : mc - mb) / (sigma * Math.sqrt(1 / c.length + 1 / b.length));
  const inWindow = e.adjustToWeek != null && e.week <= e.adjustToWeek;
  if (z <= -1.28) return inWindow ? "adjusting" : "stop";
  if (e.week < e.verdictWeek) return "not_yet";
  return z >= 1.645 ? "working" : "no_effect";
}

const lines = fs.readFileSync(inFile, "utf8").trim().split(/\r?\n/);
const cols = lines[0].split(",");
const out = ["id,verdict,t,df,improvement,se,mde,old_verdict"];
for (const line of lines.slice(1)) {
  const v = Object.fromEntries(cols.map((c, i) => [c, line.split(",")[i]]));
  const e: TrialEvidence = {
    baseline: days(v.baseline),
    checkin: days(v.checkin),
    week: Number(v.week),
    verdictWeek: Number(v.verdict_week),
    adjustToWeek: v.adjust_to_week === "NA" || v.adjust_to_week === "" ? null : Number(v.adjust_to_week),
    better: v.better as "lower" | "higher",
    priorSem: Number(v.prior_sem),
    usable: v.usable as "usable" | "marginal" | "unusable",
  };
  const r = decide(e, settings);
  out.push([v.id, r.verdict, r.t.toFixed(4), r.df, r.improvement.toFixed(5), r.se.toFixed(5), r.mde.toFixed(5), oldRule(e)].join(","));
}
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log("visits", lines.length - 1, JSON.stringify(settings));
