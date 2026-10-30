import { describe, expect, it } from "vitest";
import type { CaptureStats } from "../src/lib/gate/capture";
import type { Person } from "../src/lib/guard/guard";
import type { Side } from "../src/lib/metrics/halfface";
import { plan } from "../src/lib/planner/plan";
import { addDays, dayOf, drawSide, headroom, newTrial, runIn, settle, today, verdictFor, visitStates, type PhotoRecord, type Trial } from "../src/lib/trial/model";
import { HEADROOM_WORDS, STOP_WORDS } from "../src/lib/trial/words";

const NIACINAMIDE = "Aqua, Niacinamide, Glycerin, Pentylene Glycol, Zinc PCA, Phenoxyethanol";
const p = plan(NIACINAMIDE);

const trial = (over: Partial<Trial> = {}): Trial => ({
  id: "t1",
  createdAt: 0,
  productName: "Test serum",
  actives: ["Niacinamide"],
  plan: p,
  goal: p.goal!,
  concerns: [p.goal!],
  side: "subject_left",
  guard: { action: "proceed", rules: [] },
  baseline: null,
  stopped: null,
  verdicts: [],
  ...over,
});

let n = 0;
const photo = (day: string, left: number, right: number, raw = 60, status: PhotoRecord["status"] = "done"): PhotoRecord => ({
  id: `p${n++}`,
  trialId: "t1",
  day,
  takenAt: new Date(`${day}T09:00:00`).getTime() + n,
  blob: new Blob(),
  stats: {} as CaptureStats,
  face: { width: 1, height: 1, points: [], pose: { yaw: 0, pitch: 0, roll: 0 } },
  status,
  result: { raw: { [p.goal!]: raw }, density: { [p.goal!]: { subject_left: left, subject_right: right } as Record<Side, number> } },
});
const two = (day: string, left: number, right: number, raw = 60) => [photo(day, left, right, raw), photo(day, left + 0.3, right - 0.2, raw)];

describe("trial calendar", () => {
  it("counts local days across month ends", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(dayOf(new Date(2026, 9, 29, 23, 59))).toBe("2026-10-29");
  });

  it("finishes the run-in after 4 days with 2 photos each and starts the next day", () => {
    const ph = ["2026-11-01", "2026-11-02", "2026-11-04", "2026-11-05"].flatMap((d) => two(d, 16, 16));
    const r = runIn(ph);
    expect(r.complete).toBe(true);
    expect(r.startDay).toBe("2026-11-06");
    expect(runIn(ph.slice(0, 7)).complete).toBe(false);
  });

  it("never counts a day left at one photo", () => {
    const at = (day: string) => new Date(`${day}T10:00:00`).getTime();
    const ph = [photo("2026-11-01", 16, 16), ...["2026-11-02", "2026-11-03", "2026-11-04"].flatMap((d) => two(d, 16, 16))];
    expect(runIn(ph)).toMatchObject({ complete: false, days: ["2026-11-02", "2026-11-03", "2026-11-04"] });
    expect(today(trial(), ph, at("2026-11-05"))).toMatchObject({ kind: "run_in", day: 4, taken: 0 });
    ph.push(...two("2026-11-05", 16, 16));
    expect(runIn(ph)).toMatchObject({ complete: true, startDay: "2026-11-06" });
    ph.push(photo("2026-11-20", 16, 16));
    expect(visitStates(trial(), ph, "2026-11-06")[0].photoDays).toEqual([]);
    expect(today(trial(), ph, at("2026-11-20"))).toMatchObject({ kind: "visit", taken: 1, need: 2 });
  });

  it("sets each visit W weeks after the first application, open for a week", () => {
    expect(p.visits.map((v) => [v.week, v.days])).toEqual([
      [2, 1],
      [4, 2],
      [8, 3],
    ]);
    const v = visitStates(trial(), [], "2026-11-06");
    expect(v.map((x) => x.due)).toEqual(["2026-11-20", "2026-12-04", "2027-01-01"]);
    expect(v[0].closes).toBe("2026-11-26");
  });

  it("walks a whole trial day by day", () => {
    const ph: PhotoRecord[] = [];
    const at = (day: string) => new Date(`${day}T10:00:00`).getTime();
    expect(today(trial(), ph, at("2026-11-01"))).toMatchObject({ kind: "run_in", day: 1, taken: 0 });
    for (const d of ["2026-11-01", "2026-11-02", "2026-11-03"]) ph.push(...two(d, 16, 16));
    expect(today(trial(), ph, at("2026-11-04"))).toMatchObject({ kind: "run_in", day: 4, taken: 0 });
    ph.push(...two("2026-11-04", 16, 16));
    expect(today(trial(), ph, at("2026-11-04"))).toMatchObject({ kind: "run_in_done_today", startDay: "2026-11-05" });
    expect(today(trial(), ph, at("2026-11-10"))).toMatchObject({ kind: "waiting", daysToGo: 9 });
    expect(today(trial(), ph, at("2026-11-19"))).toMatchObject({ kind: "visit", dayIndex: 1 });
    ph.push(...two("2026-11-19", 16, 16));
    expect(today(trial(), ph, at("2026-11-19"))).toMatchObject({ kind: "visit_day_done" });
    expect(today(trial(), ph, at("2026-11-21"))).toMatchObject({ kind: "waiting" });
    expect(today(trial({ stopped: { at: 0, reason: "user" } }), ph, at("2026-11-21"))).toMatchObject({ kind: "stopped" });
  });
});

describe("trial evidence", () => {
  it("calls a clear improvement on the product half working at the verdict week, and not before", () => {
    const ph = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].flatMap((d, i) => two(d, 16 + (i % 2) * 0.4, 16));
    const start = "2026-11-05";
    // product (subject_left) half falls by 6 density points; the bare half stays
    for (const d of [addDays(start, 56), addDays(start, 57), addDays(start, 58)]) ph.push(...two(d, 10, 16));
    const v = visitStates(trial(), ph, start).find((x) => x.purpose === "verdict")!;
    expect(v.complete).toBe(true);
    expect(verdictFor(trial(), ph, v).verdict).toBe("working");
    const early = { ...v, week: 4 };
    expect(verdictFor(trial(), ph, early).verdict).toBe("not_yet");
  });

  it("finds no headroom when the goal is already at the top of the scale", () => {
    const flat = ["2026-11-01", "2026-11-02"].flatMap((d) => two(d, 0.02, 0, 100));
    expect(headroom(trial(), flat)).toMatchObject({ known: true, ok: false });
    const usual = ["2026-11-01", "2026-11-02"].flatMap((d) => two(d, 16, 17, 60));
    expect(headroom(trial(), usual)).toMatchObject({ known: true, ok: true });
    expect(headroom(trial(), usual.slice(0, 1)).known).toBe(false);
  });

  it("says what YouCam reads when there's no room to show a change, not what the skin is like (S24c)", () => {
    expect(HEADROOM_WORDS.title("redness")).toBe("Can't measure a change in redness");
    expect(HEADROOM_WORDS.body("redness", 96.6, true)).toBe("YouCam already scores your redness 97 out of 100, the healthy end of its scale, so a trial can't measure an improvement in it.");
    expect(HEADROOM_WORDS.body("redness", 80, false)).toBe("YouCam finds very little redness on your face, so a trial can't measure a change in it.");
    expect(STOP_WORDS.headroom).toBe("The trial stopped because a change on that goal couldn't be measured.");
    for (const s of [HEADROOM_WORDS.body("redness", 99, true), HEADROOM_WORDS.body("redness", 50, false), STOP_WORDS.headroom]) expect(s).not.toMatch(/nothing left|no room/i);
  });

  it("draws either side", () => {
    expect(drawSide(() => 0.1)).toBe("subject_left");
    expect(drawSide(() => 0.9)).toBe("subject_right");
  });
});

// settle() records verdicts for the trial screen and replays them stop by stop in the demo (S18)
describe("settling verdicts", () => {
  const runInDays = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
  const start = "2026-11-05";
  const wk2 = addDays(start, 14);

  it("records a visit's verdict once all its photos are analysed, and only once", () => {
    const ph = runInDays.flatMap((d, i) => two(d, 16 + (i % 2) * 0.4, 16));
    expect(settle(trial(), ph.slice(0, 6), 1).fresh).toEqual([]);
    expect(settle(trial(), ph, 1).fresh).toEqual([]);
    expect(settle(trial(), [...ph, photo(wk2, 16, 16), photo(wk2, 16.3, 15.8, 60, "pending")], 2).fresh).toEqual([]);
    const done = [...ph, ...two(wk2, 16, 16)];
    const s = settle(trial(), done, 3);
    expect(s.fresh.map((v) => [v.week, v.purpose, v.at])).toEqual([[2, "safety", 3]]);
    expect(s.trial.verdicts).toHaveLength(1);
    expect(settle(s.trial, done, 4).fresh).toEqual([]);
  });

  it("counts a photo refused for good as analysed", () => {
    const ph = runInDays.flatMap((d) => two(d, 16, 16));
    const refused: PhotoRecord = { ...photo(wk2, 16, 16, 60, "error"), errorKind: "rejected" };
    expect(settle(trial(), [...ph, photo(wk2, 16, 16), refused], 5).fresh.map((v) => v.week)).toEqual([2]);
    const paused: PhotoRecord = { ...refused, errorKind: "paused" };
    expect(settle(trial(), [...ph, photo(wk2, 16, 16), paused], 5).fresh).toEqual([]);
  });

  it("stops the trial on a clear worsening and settles nothing after it", () => {
    const ph = runInDays.flatMap((d, i) => two(d, 16 + (i % 2) * 0.4, 16));
    ph.push(...two(wk2, 26, 16));
    for (const d of [addDays(start, 28), addDays(start, 29)]) ph.push(...two(d, 16, 16));
    const s = settle(trial(), ph, 7);
    expect(s.fresh.map((v) => [v.week, v.result.verdict])).toEqual([[2, "stop"]]);
    expect(s.trial.stopped).toEqual({ at: 7, reason: "stop" });
    expect(settle(s.trial, ph, 8).fresh).toEqual([]);
  });
});

// the record a new trial stores keeps its safety findings (S17 finding 2: a copy from the check screen was empty)
describe("starting a trial", () => {
  const RETINOL = "Aqua, Squalane, Glycerin, Retinol, Cetearyl Alcohol, Tocopherol, Xanthan Gum, Phenoxyethanol";
  const adult: Person = { age: 34, pregnancy: "no", redFlags: false, underCare: false, prescription: false, medicineProduct: false };
  const start = (ingredients: string, person = adult, goal: "wrinkle" | "age_spot" = "wrinkle") =>
    newTrial({ id: "t9", createdAt: 5, person, product: { name: "  Night serum ", type: "face_leave_on", ingredients }, plan: plan(ingredients, goal), side: "subject_right" });

  it("stores the safety check's warnings with the trial", () => {
    const t = start(RETINOL);
    expect(t.guard).toEqual({ action: "warn", rules: ["sun_sensitivity"] });
    expect(start(RETINOL, { ...adult, pregnancy: "breastfeeding" }).guard).toEqual({ action: "warn", rules: ["sun_sensitivity", "breastfeeding_retinoid"] });
    expect(start(NIACINAMIDE, adult, "age_spot").guard).toEqual({ action: "proceed", rules: [] });
  });

  it("keeps the plan, the drawn side and the goal first among the concerns", () => {
    const t = start(RETINOL);
    expect(t).toMatchObject({ id: "t9", createdAt: 5, productName: "Night serum", actives: ["Retinoid"], goal: "wrinkle", side: "subject_right", baseline: null, stopped: null, verdicts: [] });
    expect(t.concerns[0]).toBe("wrinkle");
    expect(t.concerns.length).toBeLessThanOrEqual(4);
  });
});
