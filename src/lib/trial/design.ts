// Trial design (S11 design B, chosen on development simulations, reports/s11_REPORT.md). Two photos a day, a minute
// apart, each through the capture gate; the day is the unit of the verdict engine.
//   run-in: 4 days before the first application;
//   week 2: 1 day, a safety look only ("stop and check" can fire, nothing else);
//   first look (evidence table): 2 days, a trend and safety look;
//   verdict week (evidence table): 3 days, the verdict.

export const PHOTOS_PER_DAY = 2;
export const RUN_IN_DAYS = 4;

export interface Visit {
  week: number;
  days: number;
  purpose: "safety" | "first_look" | "verdict";
}

/** Check-in visits for a trial whose evidence row gives a first-look week and a verdict week. */
export function visits(firstLookWeek: number, verdictWeek: number): Visit[] {
  const v: Visit[] = [{ week: 2, days: 1, purpose: "safety" }];
  if (firstLookWeek > 2 && firstLookWeek < verdictWeek) v.push({ week: firstLookWeek, days: 2, purpose: "first_look" });
  v.push({ week: Math.max(verdictWeek, 2), days: 3, purpose: "verdict" });
  return v;
}

/** Photos a trial asks for in all (run-in plus every visit). */
export function photoCount(firstLookWeek: number, verdictWeek: number): number {
  return PHOTOS_PER_DAY * (RUN_IN_DAYS + visits(firstLookWeek, verdictWeek).reduce((s, v) => s + v.days, 0));
}
