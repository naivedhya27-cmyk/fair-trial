// The app's own plan for ingredient lists (S18): R/s18_demo.R times a demo's simulated photos by the plan the demo page
// will make, so the demo's check-ins fall where the app expects them. Prints JSON.
// Usage: npx tsx scripts/plan-of.ts <file.json>   with [{ "ingredients": "...", "goal": "wrinkle" }, ...]
import { readFileSync } from "node:fs";
import { plan } from "../src/lib/planner/plan";

const asks = JSON.parse(readFileSync(process.argv[2], "utf8")) as { ingredients: string; goal: string }[];
const out = asks.map((a) => {
  const p = plan(a.ingredients, a.goal as Parameters<typeof plan>[1]);
  return {
    design: p.design,
    goal: p.goal,
    rows: p.rows,
    families: [...new Set(p.actives.map((x) => x.family))],
    firstLookWeek: p.firstLookWeek,
    verdictWeek: p.verdictWeek,
    adjustToWeek: p.adjustToWeek,
    visits: p.visits,
  };
});
process.stdout.write(JSON.stringify(out));
