// S24a: run the app's verdict engine (src/lib/stats/verdict.ts, ENGINE unless a cap is given) on simulated trial visits
// written by R/s24a_sim.R, streaming, since a held-out file runs to millions of rows.
// Input CSV columns (as S11): id,baseline,checkin,week,verdict_week,adjust_to_week,better,prior_sem,usable; baseline and
// checkin list days separated by ";" and each day's photo D values separated by "|".
// Usage: npx tsx scripts/s24a-verdicts.ts <in.csv> <out.csv> [capMde]
import fs from "node:fs";
import readline from "node:readline";
import { decide, ENGINE, type EngineSettings, type TrialEvidence } from "../src/lib/stats/verdict";

const [, , inFile, outFile, cap] = process.argv;
const settings: EngineSettings = cap ? { ...ENGINE, capMde: Number(cap) } : ENGINE;
const days = (s: string) => s.split(";").map((d) => d.split("|").map(Number));

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream(inFile), crlfDelay: Infinity });
  const out = fs.createWriteStream(outFile);
  out.write("id,verdict,t,df,improvement,mde\n");
  let cols: string[] | null = null;
  let n = 0;
  for await (const line of rl) {
    if (!cols) {
      cols = line.split(",");
      continue;
    }
    const f = line.split(",");
    const v = Object.fromEntries(cols.map((c, i) => [c, f[i]]));
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
    const row = `${v.id},${r.verdict},${r.t.toFixed(4)},${r.df},${r.improvement.toFixed(5)},${r.mde.toFixed(5)}\n`;
    if (!out.write(row)) await new Promise<void>((ok) => out.once("drain", () => ok()));
    n++;
  }
  await new Promise<void>((ok) => out.end(() => ok()));
  console.log("visits", n, JSON.stringify(settings));
}
void main();
