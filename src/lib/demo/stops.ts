// The demo trial's stops (S18; moved out of the demo page in S24a so the S24a check runs the page's own code): the
// trial the app would build from the demo's answers, its simulated photos kept as analysed ones, and every stop of the
// player with the trial as it stands that evening.
import type { CaptureStats } from "../gate/capture";
import { guard, type ProductType } from "../guard/guard";
import type { Side } from "../metrics/halfface";
import { FAMILY_NAME } from "../planner/inci";
import { plan, type Concern } from "../planner/plan";
import { RUN_IN_DAYS } from "../trial/design";
import { runIn, settle, visitStates, type PhotoRecord, type StoredVerdict, type Trial } from "../trial/model";
import type { FaceGeometry } from "../vision/geometry";

/** How long the player stays on each stop: 13 stops at most since S24a (a retinol plan's week-6 look), so a whole trial
 *  plays in under a minute (52 s). */
export const STEP_MS = 4000;
const PURPOSE = { safety: "safety look", first_look: "first look", verdict: "verdict" } as const;

export interface DemoPhoto {
  day: string;
  time: string;
  raw: number;
  density: Record<Side, number>;
}
export interface DemoOutcome {
  id: string;
  label: string;
  about: string;
  photos: DemoPhoto[];
}
export interface DemoData {
  version: number;
  person: { name: string; age: number; photo: string; alt: string };
  product: { name: string; type: ProductType; ingredients: string };
  goal: Concern;
  side: Side;
  outcomes: DemoOutcome[];
}
export interface Stop {
  day: string;
  label: string;
  trial: Trial;
  photos: PhotoRecord[];
  now: number;
  fresh: StoredVerdict[];
}

/** The trial the app would build from these answers (as "Start a trial" does), with the side already drawn. */
export function trialOf(d: DemoData): Trial {
  const p = plan(d.product.ingredients, d.goal);
  const g = guard(
    { age: d.person.age, pregnancy: "no", redFlags: false, underCare: false, prescription: false, medicineProduct: false },
    { name: d.product.name, type: d.product.type, ingredients: d.product.ingredients },
  );
  return {
    id: "demo",
    createdAt: new Date(`${d.outcomes[0].photos[0].day}T08:00:00`).getTime(),
    productName: d.product.name,
    actives: [...new Set(p.actives.map((a) => FAMILY_NAME[a.family]))],
    plan: p,
    goal: p.goal ?? d.goal,
    concerns: [p.goal ?? d.goal, ...p.goals.filter((c) => c !== p.goal)].slice(0, 4),
    side: d.side,
    guard: { action: g.action === "warn" ? "warn" : "proceed", rules: g.findings.map((f) => f.rule) },
    baseline: null,
    stopped: null,
    verdicts: [],
  };
}

/** A simulated photo kept the way the app keeps an analysed one. There is no image behind it, so it has no capture
 * statistics or face geometry; nothing on the trial screen or the certificate reads them. */
const recordOf = (d: DemoData, p: DemoPhoto, i: number): PhotoRecord => ({
  id: `demo-${i}`,
  trialId: "demo",
  day: p.day,
  takenAt: new Date(`${p.day}T${p.time}:00`).getTime(),
  blob: new Blob(),
  stats: null as unknown as CaptureStats,
  face: null as unknown as FaceGeometry,
  status: "done",
  result: { raw: { [d.goal]: p.raw }, density: { [d.goal]: p.density } },
});

/** Every stop of the demo (each run-in day, the first day of the product, each check-in day) with the trial as it
 * stands that evening: verdicts settle stop by stop, exactly as they would on the phone. */
export function stopsOf(d: DemoData, o: DemoOutcome): Stop[] {
  const base = trialOf(d);
  const photos = o.photos.map((p, i) => recordOf(d, p, i));
  const r = runIn(photos);
  const days = r.days.map((day, i) => ({ day, label: `Run-in, day ${i + 1} of ${RUN_IN_DAYS}` }));
  if (r.complete) {
    days.push({ day: r.startDay!, label: "First day of the product" });
    for (const v of visitStates(base, photos, r.startDay!)) v.photoDays.forEach((day, j) => days.push({ day, label: `Week ${v.week} ${PURPOSE[v.purpose]}, day ${j + 1} of ${v.days}` }));
  }
  let t = base;
  return days.map(({ day, label }) => {
    const shown = photos.filter((p) => p.day <= day);
    const now = new Date(`${day}T20:00:00`).getTime();
    const s = settle(t, shown, now);
    t = s.trial;
    return { day, label, trial: t, photos: shown, now, fresh: s.fresh };
  });
}
