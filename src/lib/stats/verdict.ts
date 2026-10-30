// Verdict engine (validation step S11). One primary concern per trial, split-face design:
//   D = density(treated half) - density(control half) for each photo; photos are grouped by the day they were taken,
//   and the unit is a day's mean D, since photos of one day share that day's light and skin;
//   change = mean of the check-in days - mean of the run-in days (a difference in differences);
//   improvement = -change when "better" means a lower mask density (all concerns, S09), +change otherwise;
//   noise: the spread of day means within the run-in and within the check-in, pooled, never below the camera's own
//   floor from S08 (prior SEM squared over the photos per day); one-sided Student t on the pooled degrees of freedom.
// The S11 simulations replaced a z rule that pooled the run-in with the S08 floor: with a few photos and skin noisier
// than the floor it called "working" too often (reports/s11_REPORT.md).
// Inside the irritation window a worsening reads "expected adjustment", unless it is larger than capMde times the
// look's smallest detectable change (S24a): then "stop and check", as outside the window.
// Verdicts: Working, Not yet, No measurable effect, Stop and check, Expected adjustment, Can't tell.
import type { Side } from "../metrics/halfface";
import { T_CRIT, Z_CRIT } from "./ttable";

export type Verdict = "working" | "not_yet" | "no_effect" | "stop" | "adjusting" | "cant_tell";

export interface EngineSettings {
  /** one-sided alpha for "working" (false "working" under no effect, checked by simulation in S11) */
  alphaWork: number;
  /** one-sided alpha for "stop and check" on worsening */
  alphaStop: number;
  /** never let the person's spread fall below the camera's noise floor */
  floor: boolean;
  /** inside the irritation window, a worsening beyond this many smallest detectable changes stops the trial (S24a) */
  capMde?: number;
}

/** Set on S11 development simulations and frozen for its held-out run (reports/s11_REPORT.md): "working" at 4% so the
 *  5% bar holds with room for simulation error; "stop" at 5% per visit (10% fired falsely in up to a quarter of trials).
 *  The cap was set on S24a development simulations (reports/s24a_REPORT.md). */
export const ENGINE: EngineSettings = { alphaWork: 0.04, alphaStop: 0.05, floor: true, capMde: 5 };

export interface TrialEvidence {
  /** run-in days (at least 2), each the D values of that day's photos */
  baseline: number[][];
  /** days of this check-in (at least 1), each the D values of that day's photos */
  checkin: number[][];
  week: number;
  verdictWeek: number;
  /** end of the expected irritation window from the evidence table, or null */
  adjustToWeek: number | null;
  better: "lower" | "higher";
  /** population SEM of D for one photo (S08) */
  priorSem: number;
  usable: "usable" | "marginal" | "unusable";
}

export interface VerdictResult {
  verdict: Verdict;
  /** signed so that positive = improvement on the treated half relative to the control half */
  improvement: number;
  se: number;
  t: number;
  df: number;
  /** spread of a day's mean D */
  sigma: number;
  /** smallest improvement this design would call "working" 80% of the time */
  mde: number;
  reason: string;
}

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
const ss = (x: number[]) => {
  const m = mean(x);
  return x.reduce((s, v) => s + (v - m) ** 2, 0);
};

/** One-sided critical value t(1 - alpha, df). */
export function tCrit(alpha: number, df: number): number {
  const row = T_CRIT[alpha];
  if (!row) throw new Error(`no critical values for alpha ${alpha}`);
  return df <= row.length ? row[Math.max(1, Math.round(df)) - 1] : Z_CRIT[alpha];
}

export function decide(e: TrialEvidence, s: EngineSettings = ENGINE): VerdictResult {
  const empty: Omit<VerdictResult, "verdict" | "reason"> = { improvement: Number.NaN, se: Number.NaN, t: Number.NaN, df: 0, sigma: Number.NaN, mde: Number.NaN };
  if (e.usable === "unusable") return { ...empty, verdict: "cant_tell", reason: "This concern is too noisy to judge one half against the other." };
  const B = e.baseline.filter((d) => d.length > 0).map(mean),
    C = e.checkin.filter((d) => d.length > 0).map(mean);
  if (B.length < 2) return { ...empty, verdict: "cant_tell", reason: "The run-in needs photos on at least two days." };
  if (C.length < 1) return { ...empty, verdict: "cant_tell", reason: "No usable photo at this check-in." };
  const df = B.length - 1 + (C.length - 1);
  const photos = [...e.baseline, ...e.checkin].filter((d) => d.length > 0);
  const perDay = photos.length / photos.reduce((h, d) => h + 1 / d.length, 0); // harmonic mean of photos per day
  const floor2 = e.priorSem ** 2 / perDay;
  const own2 = (ss(B) + ss(C)) / df;
  const sigma = Math.sqrt(s.floor ? Math.max(own2, floor2) : own2);
  const se = sigma * Math.sqrt(1 / B.length + 1 / C.length);
  const change = mean(C) - mean(B);
  const improvement = e.better === "lower" ? -change : change;
  const t = improvement / se;
  const work = tCrit(s.alphaWork, df);
  const mde = (work + Z_CRIT[0.2]) * se;
  const r = { improvement, se, t, df, sigma, mde };
  const inWindow = e.adjustToWeek != null && e.week <= e.adjustToWeek;
  if (t <= -tCrit(s.alphaStop, df)) {
    if (!inWindow) return { ...r, verdict: "stop", reason: "The product side is worse than the bare side, beyond your noise floor." };
    if (s.capMde != null && -improvement > s.capMde * mde)
      return { ...r, verdict: "stop", reason: "The product side is far worse than the bare side, more than the early irritation the trials describe." };
    return { ...r, verdict: "adjusting", reason: "The product side looks worse, inside the early-irritation window the trials describe." };
  }
  if (e.week < e.verdictWeek) return { ...r, verdict: "not_yet", reason: `Trials judge this at week ${e.verdictWeek}.` };
  if (t >= work) return { ...r, verdict: "working", reason: "The product side improved more than the bare side, beyond your noise floor." };
  return { ...r, verdict: "no_effect", reason: "No difference between the halves beyond your noise floor at the evidence timepoint." };
}

/** Plain-language labels for the verdict screen. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  working: "Working",
  not_yet: "Not yet",
  no_effect: "No measurable effect",
  stop: "Stop and check",
  adjusting: "Expected adjustment",
  cant_tell: "Can't tell",
};

/** Map a half-face metric to D for a given treated side. */
export function splitDifference(density: Record<Side, number>, treated: Side): number {
  const control: Side = treated === "subject_left" ? "subject_right" : "subject_left";
  return density[treated] - density[control];
}
