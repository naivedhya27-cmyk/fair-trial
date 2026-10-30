// Trial planner (validation step S12): turns a product's ingredient list, and the one goal the person picks, into a
// split-face trial plan taken from the evidence table (S04). The rules were fixed before tuning; R/s12_score.R holds
// the same rules written separately in R and checks every plan against them.
// 1. An active whose evidence row rules out split-face use (sunscreen, E13) means no trial: the other half of the face
//    would go unprotected.
// 2. Rows: every active found, in list order (ties in table order), each with its evidence rows in table order; a
//    product with none of the actives is tested as a moisturiser (E12).
// 3. Goals on offer: the rows' concerns that photos measure well enough for a split-face verdict (S08 "usable"), in
//    row order.
// 4. No goal given: the first goal on offer, or no trial when nothing on offer can be measured. A goal given: no trial
//    when no row names it (no evidence) or when photos cannot measure it (acne, pores, radiance).
// 5. One goal per trial, the verdict's only test. Timeline from the rows naming it: earliest first look, latest verdict
//    week, latest window in which early worsening is expected.
import evidence from "../../data/evidence.json";
import noise from "../../data/noise.json";
import powerTable from "../../data/power.json";
import { photoCount, visits, type Visit } from "../trial/design";
import { detect, type Detected, type Family } from "./inci";

export const CONCERNS = ["acne", "wrinkle", "texture", "age_spot", "pore", "oiliness", "redness", "radiance", "moisture"] as const;
export type Concern = (typeof CONCERNS)[number];

export interface EvidenceRow {
  id: string;
  active: string;
  concerns: Concern[];
  firstLookWeek: number;
  verdictWeek: number;
  adjustToWeek: number | null;
  splitFace: boolean;
  earlyEffects: string;
  note: string;
  sources: string[];
}

interface RawRow {
  id: string;
  active: string;
  concerns: string | string[];
  first_look_wk: number;
  verdict_wk: number;
  adjust_to_wk: number | null;
  split_face_ok: string;
  early_ae: string;
  note: string;
  sources: string | string[];
}

function asArray<T>(v: T | T[]): T[] {
  return Array.isArray(v) ? v : [v];
}

export const EVIDENCE: EvidenceRow[] = (evidence as RawRow[]).map((r) => ({
  id: r.id,
  active: r.active,
  concerns: asArray(r.concerns) as Concern[],
  firstLookWeek: r.first_look_wk,
  verdictWeek: r.verdict_wk,
  adjustToWeek: r.adjust_to_wk,
  splitFace: r.split_face_ok === "yes",
  earlyEffects: r.early_ae,
  note: r.note,
  sources: asArray(r.sources),
}));
const ROW = new Map(EVIDENCE.map((r) => [r.id, r]));

/** Each family's evidence rows, in table order (S04). */
export const FAMILY_ROWS: Record<Family, string[]> = {
  RET: ["E01", "E02"],
  BPO: ["E03"],
  SAL: ["E04"],
  AZE: ["E05", "E06"],
  NIA: ["E07"],
  VITC: ["E08"],
  AHA: ["E09"],
  HA: ["E10", "E11"],
  SUN: ["E13"],
  TXA: ["E14"],
  ARB: ["E15"],
  CICA: ["E16"],
  BAK: ["E17"],
  PEP: ["E18"],
  TEA: ["E19"],
};
/** A product with none of the actives is tested as a moisturiser. */
export const FALLBACK_ROW = "E12";

/** Concerns whose split-face difference photos measure well enough for a verdict (S08 and S08b pooled). */
export const MEASURABLE: ReadonlySet<string> = new Set(noise.filter((n) => n.split_use === "usable").map((n) => n.concern));

const POWER = new Map(powerTable.map((p) => [p.concern, p]));

export type NoTrialReason = "split_face_unsafe" | "not_measurable" | "no_evidence";

export interface Plan {
  /** actives found, in list order */
  actives: Detected[];
  /** none of the evidence-table actives: tested as a moisturiser (E12) */
  fallback: boolean;
  /** goals this product's evidence covers and photos can measure, in row order */
  goals: Concern[];
  design: "split_face" | "no_trial";
  reason: NoTrialReason | null;
  /** the one concern the verdict tests */
  goal: Concern | null;
  /** evidence rows behind the plan; with no trial, the rows that stopped it */
  rows: string[];
  firstLookWeek: number | null;
  verdictWeek: number | null;
  adjustToWeek: number | null;
  visits: Visit[];
  photos: number;
  /** % chance of catching a change of one smallest detectable change (S11, worst and best case) */
  power: { worst: number; best: number } | null;
  /** every active behind the plan sits after the 1% line */
  belowOnePercent: boolean;
  /** early side effects the week-2 safety check asks about */
  earlyEffects: string[];
}

const unique = <T>(xs: T[]) => [...new Set(xs)];
const ids = (rows: EvidenceRow[]) => rows.map((r) => r.id);

export function planFromActives(actives: Detected[], asked?: Concern | null): Plan {
  const fallback = actives.length === 0;
  const rows = (fallback ? [FALLBACK_ROW] : actives.flatMap((a) => FAMILY_ROWS[a.family])).map((id) => ROW.get(id)!);
  const noTrial = (reason: NoTrialReason, behind: EvidenceRow[], goals: Concern[]): Plan => ({
    actives,
    fallback,
    goals,
    design: "no_trial",
    reason,
    goal: null,
    rows: ids(behind),
    firstLookWeek: null,
    verdictWeek: null,
    adjustToWeek: null,
    visits: [],
    photos: 0,
    power: null,
    belowOnePercent: false,
    earlyEffects: [],
  });

  const unsafe = rows.filter((r) => !r.splitFace);
  if (unsafe.length) return noTrial("split_face_unsafe", unsafe, []);
  const goals = unique(rows.flatMap((r) => r.concerns)).filter((c) => MEASURABLE.has(c));
  let goal: Concern;
  if (asked == null) {
    if (!goals.length) return noTrial("not_measurable", rows, goals);
    goal = goals[0];
  } else {
    const naming = rows.filter((r) => r.concerns.includes(asked));
    if (!naming.length) return noTrial("no_evidence", [], goals);
    if (!MEASURABLE.has(asked)) return noTrial("not_measurable", naming, goals);
    goal = asked;
  }

  const m = rows.filter((r) => r.concerns.includes(goal));
  const firstLookWeek = Math.min(...m.map((r) => r.firstLookWeek));
  const verdictWeek = Math.max(...m.map((r) => r.verdictWeek));
  const windows = m.map((r) => r.adjustToWeek).filter((w): w is number => w != null);
  const adjustToWeek = windows.length ? Math.max(...windows) : null;
  const behind = actives.filter((a) => FAMILY_ROWS[a.family].some((id) => m.some((r) => r.id === id)));
  const p = POWER.get(goal);
  return {
    actives,
    fallback,
    goals,
    design: "split_face",
    reason: null,
    goal,
    rows: ids(m),
    firstLookWeek,
    verdictWeek,
    adjustToWeek,
    visits: visits(firstLookWeek, verdictWeek, adjustToWeek),
    photos: photoCount(firstLookWeek, verdictWeek, adjustToWeek),
    power: p ? { worst: p.worst, best: p.best } : null,
    belowOnePercent: behind.length > 0 && behind.every((a) => a.belowOnePercent),
    earlyEffects: unique(m.map((r) => r.earlyEffects).filter((e) => e && !e.startsWith("not reported"))),
  };
}

export function plan(text: string, asked?: Concern | null): Plan {
  return planFromActives(detect(text), asked);
}
