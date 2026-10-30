// S12: run the trial planner (src/lib/planner) on one split of the Open Beauty Facts sample (work/s12/products.csv),
// once with no goal and once per evidence-table concern, and write one row per product and goal for R/s12_score.R.
// The planner sees the ingredient text only. Ids follow the file order within the split (D01.., H01..).
// Usage: npx tsx scripts/s12-plan.ts <dev|heldout> <out.csv>
import fs from "node:fs";
import { CONCERNS, plan } from "../src/lib/planner/plan";

/** RFC 4180: quoted fields may hold commas, doubled quotes and line breaks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows;
}

const [, , split, outFile] = process.argv;
if (split !== "dev" && split !== "heldout") throw new Error("split must be dev or heldout");
const [head, ...body] = parseCsv(fs.readFileSync("D:/devpost_lane/youcam/work/s12/products.csv", "utf8"));
const col = (name: string) => head.indexOf(name);
const mine = body.filter((r) => r[col("split")] === split);
const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
const out = ["id,asked,actives,below1,fallback,goals,design,reason,goal,rows,first_look,verdict_wk,adjust_wk,visits,photos"];
mine.forEach((r, i) => {
  const id = (split === "dev" ? "D" : "H") + String(i + 1).padStart(2, "0");
  for (const asked of [null, ...CONCERNS]) {
    const p = plan(r[col("inci")], asked);
    out.push(
      [
        id,
        asked ?? "",
        p.actives.map((a) => `${a.family}@${a.position}`).join(";"),
        p.actives.filter((a) => a.belowOnePercent).map((a) => a.family).join(";"),
        p.fallback ? 1 : 0,
        p.goals.join(";"),
        p.design,
        p.reason ?? "",
        p.goal ?? "",
        p.rows.join(";"),
        p.firstLookWeek ?? "",
        p.verdictWeek ?? "",
        p.adjustToWeek ?? "",
        p.visits.map((v) => `${v.week}:${v.days}:${v.purpose}`).join(";"),
        p.photos,
      ]
        .map(q)
        .join(","),
    );
  }
});
fs.writeFileSync(outFile, out.join("\n") + "\n");
console.log(`${mine.length} products, ${out.length - 1} plans -> ${outFile}`);
