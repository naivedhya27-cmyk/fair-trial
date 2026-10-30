// S24a: the app's own visits (src/lib/trial/design.ts) for the plan shapes R/s24a_sim.R simulates, for R/s24a_check.R.
// Usage (from the app folder): npx tsx scripts/s24a-visits.ts
import { visits } from "../src/lib/trial/design";

const SHAPES: Record<string, [number, number, number | null]> = {
  F4V8: [4, 8, null],
  F4V12: [4, 12, null],
  F2V8: [2, 8, null],
  ret: [4, 12, 4],
  merged: [2, 12, 4],
};
console.log(JSON.stringify(Object.fromEntries(Object.entries(SHAPES).map(([k, [f, v, w]]) => [k, visits(f, v, w)]))));
