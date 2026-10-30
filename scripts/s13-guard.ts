// S13: run the scope and safety guard (src/lib/guard/guard.ts) on one truth set and write its decisions for
// R/s13_score.R. Product sets run with a neutral adult (30, not pregnant, no red flags, no doctor's care, no
// prescription) who says the product is a leave-on face product, so only the product's own text decides.
// Sets labels_b and obf_b are the fresh S13b held-out sets (work/s13b); labels_r and obf_r are the sets reserved at S13b
// for the final audit (work/s24_reserve), read once by the S24a held-out check.
// Usage: npx tsx scripts/s13-guard.ts <labels|obf|labels_b|obf_b|labels_r|obf_r|s12|cases|messages> <dev|heldout|all> <out.csv>
import { guard, MESSAGES, type Person, type Pregnancy, type ProductType } from "../src/lib/guard/guard";
import { readCsv, writeCsv } from "./csv";

const W = "D:/devpost_lane/youcam/work";
const [, , set, split, outFile] = process.argv;
const adult: Person = { age: 30, pregnancy: "no", redFlags: false, underCare: false, prescription: false };
const header = ["id", "action", "rules"];
const decide = (person: Person, name: string, type: ProductType | null, ingredients: string) => {
  const g = guard(person, { name, type, ingredients });
  return [g.action, g.findings.map((f) => f.rule).sort().join(";")];
};
const mine = (rows: Record<string, string>[]) => rows.filter((r) => split === "all" || r.split === split);
const DIR: Record<string, string> = { labels: "s13", labels_b: "s13b", labels_r: "s24_reserve", obf: "s13", obf_b: "s13b", obf_r: "s24_reserve" };

let out: unknown[][] = [];
if (set === "labels" || set === "labels_b" || set === "labels_r") {
  out = mine(readCsv(`${W}/${DIR[set]}/labels.csv`)).map((r) => [r.id, ...decide(adult, r.brand, "face_leave_on", r.text)]);
} else if (set === "obf" || set === "obf_b" || set === "obf_r") {
  out = mine(readCsv(`${W}/${DIR[set]}/obf.csv`)).map((r) => [r.id, ...decide(adult, r.name, "face_leave_on", r.inci)]);
} else if (set === "s12") {
  const rows = readCsv(`${W}/s12/products.csv`);
  const n: Record<string, number> = {};
  out = rows.map((r) => {
    n[r.split] = (n[r.split] ?? 0) + 1;
    const id = (r.split === "dev" ? "D" : "H") + String(n[r.split]).padStart(2, "0");
    return [id, ...decide(adult, r.name, "face_leave_on", r.inci)];
  });
} else if (set === "cases") {
  const text = Object.fromEntries(readCsv(`${W}/s13/products_fixed.csv`).map((p) => [p.pid, p.text]));
  out = readCsv(`${W}/s13/cases_${split}.csv`).map((c) => {
    const person: Person = {
      age: c.age === "" || c.age === "NA" ? null : Number(c.age),
      pregnancy: c.pregnancy === "" || c.pregnancy === "NA" ? null : (c.pregnancy as Pregnancy),
      redFlags: c.red_flags === "TRUE",
      underCare: c.under_care === "TRUE",
      prescription: c.prescription === "TRUE",
    };
    const type = c.type === "" || c.type === "NA" ? null : (c.type as ProductType);
    return [c.case, ...decide(person, "", type, text[c.pid])];
  });
} else if (set === "messages") {
  header.splice(0, 3, "rule", "message");
  out = Object.entries(MESSAGES);
} else throw new Error("set must be labels, obf, labels_b, obf_b, labels_r, obf_r, s12, cases or messages");
writeCsv(outFile, header, out);
console.log(`${set} ${split}: ${out.length} rows -> ${outFile}`);
