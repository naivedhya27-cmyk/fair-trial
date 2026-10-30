// Trial design (S11 design B, chosen on development simulations, reports/s11_REPORT.md; looks added in S24a). Two
// photos a day, a minute apart, each through the capture gate; the day is the unit of the verdict engine.
//   run-in: 4 days before the first application;
//   week 2: 1 day, a safety look only ("stop and check" can fire, nothing else);
//   first look (evidence table): 2 days, a trend and safety look;
//   after an irritation window ending at week W: a safety look at week W + 2, 2 days, so a product that keeps the
//     skin worse after the window is stopped before the verdict week (S18 finding 1);
//   no look between week 2 and a verdict week of 6 or later: a first look at week 4, 2 days (S18 finding 1);
//   verdict week (evidence table): 3 days, the verdict.

export const PHOTOS_PER_DAY = 2;
export const RUN_IN_DAYS = 4;

export interface Visit {
  week: number;
  days: number;
  purpose: "safety" | "first_look" | "verdict";
}

/** Check-in visits for a trial whose evidence gives a first-look week, a verdict week and an irritation window (or null). */
export function visits(firstLookWeek: number, verdictWeek: number, adjustToWeek: number | null = null): Visit[] {
  const last = Math.max(verdictWeek, 2);
  const v: Visit[] = [{ week: 2, days: 1, purpose: "safety" }];
  if (firstLookWeek > 2 && firstLookWeek < last) v.push({ week: firstLookWeek, days: 2, purpose: "first_look" });
  if (adjustToWeek != null && adjustToWeek + 2 < last && !v.some((x) => x.week > adjustToWeek)) v.push({ week: adjustToWeek + 2, days: 2, purpose: "safety" });
  if (last >= 6 && !v.some((x) => x.week > 2 && x.week < last)) v.push({ week: 4, days: 2, purpose: "first_look" });
  v.sort((a, b) => a.week - b.week);
  v.push({ week: last, days: 3, purpose: "verdict" });
  return v;
}

/** Photos a trial asks for in all (run-in plus every visit). */
export function photoCount(firstLookWeek: number, verdictWeek: number, adjustToWeek: number | null = null): number {
  return PHOTOS_PER_DAY * (RUN_IN_DAYS + visits(firstLookWeek, verdictWeek, adjustToWeek).reduce((s, v) => s + v.days, 0));
}
