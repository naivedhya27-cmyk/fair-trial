import { describe, expect, it } from "vitest";
import { decide, type TrialEvidence } from "../src/lib/stats/verdict";
import golden from "./fixtures/verdict_golden.json";

// 300 check-ins decided by an independent R twin of the engine (R/s19_engine.R, seed 2026103030): run-ins of 2 to 6
// days, check-ins of 1 to 3, empty days, both directions of "better", noise below and above the floor, all six
// verdicts, and since S24a severe worsenings inside the irritation window on both sides of the size cap. The app's t
// table is rounded to 4 decimals, so a t within 1e-4 of a critical value, or a change within 1e-4 (relative) of the
// cap, may fall either way.
interface Twin {
  verdict: string;
  improvement?: number;
  se?: number;
  t?: number;
  df?: number;
  work?: number;
  stop?: number;
  cap_at?: number;
}
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

describe("verdict engine against its R twin", () => {
  it("gives the twin's verdict, change, give-or-take, t and degrees of freedom", () => {
    const wrong: string[] = [];
    for (const c of golden.cases as { id: string; evidence: TrialEvidence; twin: Twin }[]) {
      const r = decide(c.evidence);
      const tw = c.twin;
      const nearCap = tw.cap_at != null && Math.abs(tw.improvement! - tw.cap_at) < 1e-4 * Math.abs(tw.cap_at);
      const nearCritical = (tw.t != null && [tw.work!, tw.stop!].some((x) => Math.abs(tw.t! - x) < 1e-4)) || nearCap;
      if (r.verdict !== tw.verdict && !nearCritical) wrong.push(`${c.id}: ${r.verdict} vs ${tw.verdict}`);
      if (tw.improvement != null && !(close(r.improvement, tw.improvement) && close(r.se, tw.se!) && close(r.t, tw.t!) && r.df === tw.df)) wrong.push(`${c.id}: numbers`);
    }
    expect(golden.cases).toHaveLength(300);
    expect(wrong).toEqual([]);
  });
});
