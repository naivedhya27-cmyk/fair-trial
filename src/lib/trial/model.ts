// Trial model (S16): what a trial keeps on the phone, its calendar, and how analysed photos become the verdict
// engine's evidence (src/lib/stats/verdict.ts, S11). Pure functions; dates are local calendar days ("YYYY-MM-DD").
//   Run-in: the first RUN_IN_DAYS days with photos, before any product goes on. The first application is the next day.
//   Visits: week W is due W weeks after the first application and stays open for 7 days; a visit needs its number of
//   days with photos (design.ts). The verdict visit's days are the verdict's check-in days.
//   Headroom (S15 finding): a goal already at the top of the scale cannot show an improvement; checked on the run-in.
import noise from "../../data/noise.json";
import type { CaptureStats } from "../gate/capture";
import { guard, type Person, type Product } from "../guard/guard";
import type { Side } from "../metrics/halfface";
import { FAMILY_NAME } from "../planner/inci";
import type { Concern, Plan } from "../planner/plan";
import { decide, splitDifference, type TrialEvidence, type VerdictResult } from "../stats/verdict";
import type { FaceGeometry } from "../vision/geometry";
import { PHOTOS_PER_DAY, RUN_IN_DAYS, type Visit } from "./design";

export interface Trial {
  id: string;
  createdAt: number;
  productName: string;
  /** names of the actives found in the ingredient list */
  actives: string[];
  plan: Plan;
  goal: Concern;
  /** concerns asked of each analysis: the goal first, then up to 3 more from the plan (same units for 1 to 4) */
  concerns: string[];
  /** the half that gets the product, drawn at random when the trial starts */
  side: Side;
  guard: { action: "proceed" | "warn"; rules: string[] };
  /** the first photo's capture statistics: later photos must match its light, colour and sharpness */
  baseline: CaptureStats | null;
  stopped: { at: number; reason: "stop" | "user" | "headroom" } | null;
  verdicts: StoredVerdict[];
}

export interface PhotoRecord {
  id: string;
  trialId: string;
  day: string;
  takenAt: number;
  blob: Blob;
  stats: CaptureStats;
  face: FaceGeometry;
  status: "pending" | "done" | "error";
  error?: string;
  /** why the last analysis failed: "limit" and "paused" clear by themselves later; "rejected" will not */
  errorKind?: "limit" | "paused" | "rejected" | "unreachable" | "timeout";
  result?: { raw: Record<string, number>; density: Record<string, Record<Side, number>> };
}

export interface StoredVerdict {
  week: number;
  purpose: Visit["purpose"];
  at: number;
  result: VerdictResult;
}

/** The record a new trial stores. The safety check runs again on the answers being saved, so its warnings stay with
 *  the trial (S17: a copy taken from the check screen was empty by the time the trial was saved). */
export function newTrial(a: { id: string; createdAt: number; person: Person; product: Product; plan: Plan; side: Side }): Trial {
  const g = guard(a.person, a.product);
  return {
    id: a.id,
    createdAt: a.createdAt,
    productName: a.product.name.trim(),
    actives: [...new Set(a.plan.actives.map((x) => FAMILY_NAME[x.family]))],
    plan: a.plan,
    goal: a.plan.goal!,
    concerns: [a.plan.goal!, ...a.plan.goals.filter((c) => c !== a.plan.goal)].slice(0, 4),
    side: a.side,
    guard: { action: g.action === "warn" ? "warn" : "proceed", rules: g.findings.map((f) => f.rule) },
    baseline: null,
    stopped: null,
    verdicts: [],
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local calendar day of a time. */
export function dayOf(t: number | Date): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The calendar day `n` days after `day` (local, safe across daylight-saving changes). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayOf(new Date(y, m - 1, d + n, 12));
}

export const daysBetween = (a: string, b: string) => {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / DAY_MS);
};

const byDay = (photos: PhotoRecord[]) => {
  const m = new Map<string, PhotoRecord[]>();
  for (const p of [...photos].sort((a, b) => a.takenAt - b.takenAt)) m.set(p.day, [...(m.get(p.day) ?? []), p]);
  return m;
};

/** Days with a full set of photos (PHOTOS_PER_DAY or more), in order. A day left at one photo never counts, so it can
 * never block the run-in or fill a visit with half a day. */
const fullDays = (photos: PhotoRecord[]) =>
  [...byDay(photos)]
    .filter(([, ph]) => ph.length >= PHOTOS_PER_DAY)
    .map(([d]) => d)
    .sort();

/** Run-in days in order (the first RUN_IN_DAYS full days) and the first application day, once the run-in is done. */
export function runIn(photos: PhotoRecord[]): { days: string[]; complete: boolean; startDay: string | null } {
  const days = fullDays(photos).slice(0, RUN_IN_DAYS);
  const complete = days.length === RUN_IN_DAYS;
  return { days, complete, startDay: complete ? addDays(days[RUN_IN_DAYS - 1], 1) : null };
}

export interface VisitState extends Visit {
  due: string;
  closes: string;
  /** full days inside the visit's window */
  photoDays: string[];
  complete: boolean;
}

export function visitStates(trial: Trial, photos: PhotoRecord[], startDay: string): VisitState[] {
  const days = fullDays(photos.filter((p) => p.day >= startDay));
  return trial.plan.visits.map((v) => {
    const due = addDays(startDay, 7 * v.week);
    const closes = addDays(due, 6);
    const photoDays = days.filter((d) => d >= due && d <= closes).slice(0, v.days);
    return { ...v, due, closes, photoDays, complete: photoDays.length >= v.days };
  });
}

/** D (product half minus bare half, goal concern) for each analysed photo of a day. */
export function dOfDay(trial: Trial, photos: PhotoRecord[], day: string): number[] {
  return photos.filter((p) => p.day === day && p.status === "done" && p.result?.density[trial.goal]).map((p) => splitDifference(p.result!.density[trial.goal], trial.side));
}

const NOISE = new Map(noise.map((n) => [n.concern, n]));

/** The verdict engine's input for a visit: the run-in days against the visit's days. */
export function evidenceFor(trial: Trial, photos: PhotoRecord[], visit: VisitState): TrialEvidence {
  const n = NOISE.get(trial.goal);
  return {
    baseline: runIn(photos).days.map((d) => dOfDay(trial, photos, d)),
    checkin: visit.photoDays.map((d) => dOfDay(trial, photos, d)),
    week: visit.week,
    verdictWeek: trial.plan.verdictWeek ?? visit.week,
    adjustToWeek: trial.plan.adjustToWeek,
    better: "lower",
    priorSem: n?.sem_D ?? Number.NaN,
    usable: (n?.split_use ?? "unusable") as TrialEvidence["usable"],
  };
}

export function verdictFor(trial: Trial, photos: PhotoRecord[], visit: VisitState): VerdictResult {
  return decide(evidenceFor(trial, photos, visit));
}

/** A photo whose analysis is final: done, or refused for good (a refusal that would repeat on a retry). */
export const settled = (p: PhotoRecord) => p.status === "done" || p.errorKind === "rejected";

/** The verdict of every visit whose run-in and visit photos are all analysed, recorded at time `at`; a "stop" verdict
 * stops the trial. Pure: the trial screen saves the result, and the demo (S18) replays it stop by stop. */
export function settle(trial: Trial, photos: PhotoRecord[], at: number): { trial: Trial; fresh: StoredVerdict[] } {
  const r = runIn(photos);
  if (!r.complete || trial.stopped) return { trial, fresh: [] };
  let t = trial;
  const fresh: StoredVerdict[] = [];
  for (const v of visitStates(trial, photos, r.startDay!)) {
    if (t.stopped || !v.complete || t.verdicts.some((x) => x.week === v.week)) continue;
    const days = new Set([...r.days, ...v.photoDays]);
    if (!photos.filter((p) => days.has(p.day)).every(settled)) continue;
    const result = verdictFor(t, photos, v);
    const stored: StoredVerdict = { week: v.week, purpose: v.purpose, at, result };
    fresh.push(stored);
    t = { ...t, verdicts: [...t.verdicts, stored] };
    if (result.verdict === "stop") t = { ...t, stopped: { at, reason: "stop" } };
  }
  return { trial: t, fresh };
}

/** Headroom rule, fixed in S16 before the audit: no room to improve when the run-in's mean raw score for the goal is
 * 95 or more (the healthy end of 1-100), or its mask covers both halves at under a tenth of the usual density. Judged
 * once at least 2 run-in photos are analysed. */
export const HEADROOM = { maxRaw: 95, minDensityShare: 0.1, minPhotos: 2 };

export function headroom(trial: Trial, photos: PhotoRecord[]): { known: boolean; ok: boolean; raw: number; density: number } {
  const days = new Set(runIn(photos).days);
  const done = photos.filter((p) => days.has(p.day) && p.status === "done" && p.result?.density[trial.goal]);
  if (done.length < HEADROOM.minPhotos) return { known: false, ok: true, raw: Number.NaN, density: Number.NaN };
  const raw = done.reduce((s, p) => s + (p.result!.raw[trial.goal] ?? Number.NaN), 0) / done.length;
  const density = done.reduce((s, p) => s + (p.result!.density[trial.goal].subject_left + p.result!.density[trial.goal].subject_right) / 2, 0) / done.length;
  const usual = NOISE.get(trial.goal)?.mean_half ?? Number.NaN;
  const ok = !(raw >= HEADROOM.maxRaw) && !(density < HEADROOM.minDensityShare * usual);
  return { known: true, ok, raw, density };
}

export type Today =
  | { kind: "stopped"; reason: "stop" | "user" | "headroom" }
  | { kind: "run_in"; day: number; taken: number; need: number }
  | { kind: "run_in_done_today"; startDay: string }
  | { kind: "waiting"; next: VisitState; daysToGo: number }
  | { kind: "visit"; visit: VisitState; dayIndex: number; taken: number; need: number }
  | { kind: "visit_day_done"; visit: VisitState }
  | { kind: "finished"; last: VisitState };

/** What the trial asks of the person today. */
export function today(trial: Trial, photos: PhotoRecord[], now: number): Today {
  if (trial.stopped) return { kind: "stopped", reason: trial.stopped.reason };
  const d = dayOf(now);
  const takenToday = photos.filter((p) => p.day === d).length;
  const r = runIn(photos);
  if (!r.complete) {
    const position = r.days.includes(d) ? r.days.indexOf(d) + 1 : r.days.length + 1;
    return { kind: "run_in", day: Math.min(position, RUN_IN_DAYS), taken: takenToday, need: PHOTOS_PER_DAY };
  }
  if (d < r.startDay!) return { kind: "run_in_done_today", startDay: r.startDay! };
  const visits = visitStates(trial, photos, r.startDay!);
  for (const v of visits) {
    if (v.complete) {
      if (v.photoDays.includes(d) && v.photoDays[v.photoDays.length - 1] === d) return { kind: "visit_day_done", visit: v };
      continue;
    }
    if (d < v.due) return { kind: "waiting", next: v, daysToGo: daysBetween(d, v.due) };
    if (d <= v.closes) {
      const i = v.photoDays.includes(d) ? v.photoDays.indexOf(d) + 1 : v.photoDays.length + 1;
      if (v.photoDays.includes(d) && takenToday >= PHOTOS_PER_DAY) return { kind: "visit_day_done", visit: v };
      return { kind: "visit", visit: v, dayIndex: i, taken: takenToday, need: PHOTOS_PER_DAY };
    }
    // this visit's window closed without enough days: move on to the next one
  }
  return { kind: "finished", last: visits[visits.length - 1] };
}

/** A random side, from the browser's cryptographic generator (never Math.random). */
export function drawSide(random: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32): Side {
  return random() < 0.5 ? "subject_left" : "subject_right";
}

export const SIDE_WORDS: Record<Side, string> = { subject_left: "left", subject_right: "right" };
