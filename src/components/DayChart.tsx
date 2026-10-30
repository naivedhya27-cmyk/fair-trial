"use client";
// The trial's chart (S16, redrawn in S17): each day's mean difference between the product half and the bare half,
// against the run-in's own level, before and after the product starts. The verdict compares the check-in days with the
// run-in days, so that level, not zero, is the line that matters. Days are spaced evenly and grouped by stage (the
// run-in, then each check-in week), so four run-in days and a check-in weeks later stay apart and readable. Used on the
// trial screen and the certificate; the numbers behind it are one tap away in a table.
import { useId } from "react";
import { Card } from "@/components/ui";
import { dOfDay, runIn, visitStates, type PhotoRecord, type Trial } from "@/lib/trial/model";
import { GOAL_WORDS } from "@/lib/trial/words";

/** A day as "Fri, Oct 30", held together on one line. */
export const fmtDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }).replace(/\s/g, " ");
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** A change on the product side against the bare side, in points, as "better" or "worse". */
export const changeWords = (improvement: number) => `${Math.abs(improvement).toFixed(1)} points ${improvement >= 0 ? "better" : "worse"}`;

const mean = (v: number[]) => v.reduce((s, y) => s + y, 0) / v.length;
/** Plot area in the 300 x 170 view: the axis runs from AXIS_L to AXIS_R, the dots from DOT_L to DOT_R, at most STEP apart. */
const AXIS_L = 48,
  AXIS_R = 286,
  DOT_L = 58,
  DOT_R = 270,
  STEP = 40;

/** Each day's mean difference (product half minus bare half) over the trial; lower is better for every goal. */
export function DayChart({ trial, photos, numbers = "toggle" }: { trial: Trial; photos: PhotoRecord[]; numbers?: "toggle" | "open" }) {
  const id = useId();
  const pts = [...new Set(photos.map((p) => p.day))]
    .sort()
    .map((d) => ({ d, v: dOfDay(trial, photos, d) }))
    .filter((x) => x.v.length)
    .map((x) => ({ d: x.d, m: mean(x.v) }));
  if (pts.length < 2) return null;
  const r = runIn(photos);
  const start = r.startDay;
  const runInDays = new Set(r.days);
  const base = pts.filter((p) => runInDays.has(p.d));
  const level = base.length > 0 ? mean(base.map((p) => p.m)) : null;
  const on = (d: string) => !!start && d >= start;
  const visits = start ? visitStates(trial, photos, start) : [];
  /** The stage a day belongs to: the run-in, or the check-in week whose window holds it. */
  const stage = (d: string) => {
    if (!on(d)) return "Run-in";
    const v = visits.find((w) => d >= w.due && d <= w.closes);
    return v ? `Week ${v.week}` : "Product";
  };

  // One slot per day, and one empty slot between stages.
  const groups: { label: string; from: number; to: number }[] = [];
  const slots: number[] = [];
  let slot = 0;
  for (const p of pts) {
    const s = stage(p.d);
    const last = groups[groups.length - 1];
    if (last && last.label !== s) slot += 1;
    if (!last || last.label !== s) groups.push({ label: s, from: slot, to: slot });
    groups[groups.length - 1].to = slot;
    slots.push(slot);
    slot += 1;
  }
  const step = Math.min(STEP, (DOT_R - DOT_L) / Math.max(1, slots[slots.length - 1]));
  const x = (s: number) => DOT_L + s * step;
  const vals = level == null ? pts.map((p) => p.m) : [...pts.map((p) => p.m), level];
  const lo = Math.min(...vals),
    hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.2);
  const y = (v: number) => 14 + ((hi + pad - v) / (hi - lo + 2 * pad)) * 122;
  const line = (g: { from: number; to: number }) =>
    pts
      .map((p, i) => ({ s: slots[i], p }))
      .filter((q) => q.s >= g.from && q.s <= g.to)
      .map((q) => `${x(q.s)},${y(q.p.m)}`)
      .join(" ");
  const firstOn = pts.findIndex((p) => on(p.d));
  const startX = firstOn > 0 ? (x(slots[firstOn - 1]) + x(slots[firstOn])) / 2 : null;
  const goal = GOAL_WORDS[trial.goal] ?? trial.goal;
  const summary =
    `Each dot is one day: YouCam's ${goal} reading on the product half minus the bare half, over ${plural(pts.length, "day", "days")}, spaced evenly and grouped by stage. ` +
    (level == null ? "Lower means the product side is doing better." : "Below the run-in level means the product side is doing better than before.");
  const table = (
    <table className="mb-3 w-full text-left text-sm">
      <caption className="sr-only">Each day&apos;s {goal} reading, product half minus bare half</caption>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className="py-2 pr-2 font-semibold">
            Day
          </th>
          <th scope="col" className="py-2 pr-2 font-semibold">
            Stage
          </th>
          <th scope="col" className="py-2 text-right font-semibold">
            Difference
          </th>
        </tr>
      </thead>
      <tbody>
        {pts.map((p) => (
          <tr key={p.d} className="border-b border-line last:border-0">
            <td className="py-2 pr-2">{fmtDay(p.d)}</td>
            <td className="py-2 pr-2">{on(p.d) ? stage(p.d) : runInDays.has(p.d) ? "Run-in" : "Before the product"}</td>
            <td className="py-2 text-right tabular-nums">{p.m.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <Card label="Chart">
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        Product side against bare side
      </h2>
      <svg viewBox="0 0 300 170" className="w-full" role="img" aria-labelledby={`${id}-title ${id}-summary`}>
        {startX != null && <rect x={AXIS_L} y="14" width={Math.max(0, startX - AXIS_L)} height="122" fill="var(--surface-2)" />}
        <line x1={AXIS_L} y1="136" x2={AXIS_R} y2="136" stroke="var(--line)" strokeWidth="1.5" />
        {level != null && <line x1={AXIS_L} y1={y(level)} x2={AXIS_R} y2={y(level)} stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="5 4" />}
        {startX != null && <line x1={startX} y1="14" x2={startX} y2="136" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 3" />}
        {groups.map((g) => (g.to > g.from ? <polyline key={g.from} fill="none" stroke="var(--line-strong)" strokeWidth="1.5" strokeLinejoin="round" points={line(g)} /> : null))}
        {pts.map((p, i) =>
          on(p.d) ? (
            <circle key={p.d} cx={x(slots[i])} cy={y(p.m)} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />
          ) : (
            <circle key={p.d} cx={x(slots[i])} cy={y(p.m)} r="4" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" />
          ),
        )}
        <text x="2" y="22" fontSize="11" fill="var(--muted)">
          worse
        </text>
        <text x="2" y="134" fontSize="11" fill="var(--muted)">
          better
        </text>
        {groups.map((g) => (
          <text key={g.from} x={(x(g.from) + x(g.to)) / 2} y="156" fontSize="11" fill="var(--muted)" textAnchor="middle">
            {g.label}
          </text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="4" fill="var(--surface)" stroke="var(--ink)" strokeWidth="1.5" />
          </svg>
          before the product
        </span>
        {firstOn >= 0 && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <circle cx="6" cy="6" r="4.5" fill="var(--accent)" />
            </svg>
            with the product
          </span>
        )}
        {level != null && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="12" viewBox="0 0 18 12">
              <line x1="1" y1="6" x2="17" y2="6" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            run-in level
          </span>
        )}
        {startX != null && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="12" height="14" viewBox="0 0 12 14">
              <line x1="6" y1="1" x2="6" y2="13" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="3 2" />
            </svg>
            product starts
          </span>
        )}
      </div>
      <p id={`${id}-summary`} className="text-sm leading-relaxed text-muted">
        {summary}
      </p>
      {numbers === "open" ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold">The numbers</h3>
          {table}
        </div>
      ) : (
        <details className="rounded-2xl border border-line px-4">
          <summary className="min-h-12 cursor-pointer text-base font-medium leading-[3rem]">Show the numbers</summary>
          {table}
        </details>
      )}
    </Card>
  );
}
