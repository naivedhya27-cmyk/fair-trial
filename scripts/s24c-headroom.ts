// Validation helper (S24c): the app's headroom rule (src/lib/trial/model.ts, with the app's noise table) and the
// trial page's words for it, on saved half-face results. Each face's photos form one run-in day, and every concern in
// the results is judged as the trial's goal. Input: a CSV of photo,face,concern,raw,side,density (one row per photo,
// concern and side). Output: JSON on stdout, one row per face and concern.
// Usage: npx tsx scripts/s24c-headroom.ts <half.csv>
import fs from "node:fs";
import type { Side } from "../src/lib/metrics/halfface";
import { HEADROOM, headroom, type PhotoRecord, type Trial } from "../src/lib/trial/model";
import { GOAL_WORDS, HEADROOM_WORDS } from "../src/lib/trial/words";

const [, , inFile] = process.argv;
const [head, ...lines] = fs.readFileSync(inFile, "utf8").trim().split(/\r?\n/);
const col = Object.fromEntries(head.split(",").map((h, i) => [h, i]));
const photos = new Map<string, { face: string; raw: Record<string, number>; density: Record<string, Record<Side, number>> }>();
for (const l of lines) {
  const x = l.split(",");
  const id = x[col.photo];
  const p = photos.get(id) ?? { face: x[col.face], raw: {}, density: {} };
  const c = x[col.concern];
  p.raw[c] = Number(x[col.raw]);
  p.density[c] = { ...(p.density[c] ?? { subject_left: Number.NaN, subject_right: Number.NaN }), [x[col.side] as Side]: Number(x[col.density]) };
  photos.set(id, p);
}
const faces = [...new Set([...photos.values()].map((p) => p.face))].sort();
const out = [];
for (const face of faces) {
  const recs = [...photos.entries()]
    .filter(([, p]) => p.face === face)
    .map(([id, p], i) => ({ id, trialId: face, day: "2026-11-01", takenAt: i, status: "done", result: { raw: p.raw, density: p.density } }) as unknown as PhotoRecord);
  const concerns = Object.keys(recs[0].result!.raw).sort();
  for (const concern of concerns) {
    const h = headroom({ goal: concern } as Trial, recs);
    const goal = GOAL_WORDS[concern] ?? concern;
    const healthyEnd = h.raw >= HEADROOM.maxRaw;
    out.push({
      face,
      concern,
      photos: recs.length,
      known: h.known,
      flagged: h.known && !h.ok,
      raw: h.raw,
      density: h.density,
      notice: h.known && !h.ok ? { title: HEADROOM_WORDS.title(goal), body: HEADROOM_WORDS.body(goal, h.raw, healthyEnd), healthyEnd } : null,
    });
  }
}
process.stdout.write(JSON.stringify(out, null, 1));
