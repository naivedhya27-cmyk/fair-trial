// S19 mutant run (prereg in R/s19_score.R): puts each mutant (R/s19_mutants.R) into its file's pristine text in memory,
// lints that file as the linter would (tools/claim-lint/lint.ts), and records what the linter says. Bad-claim mutants
// should give a finding inside the inserted text's lines; near-miss mutants should give none.
// Usage (from the app folder): npx tsx scripts/s19-mutants.ts <mutants.json> <out.json>
import fs from "node:fs";
import path from "node:path";
import { lintText } from "../tools/claim-lint/lint";

interface Mutant {
  id: string;
  file: string;
  kind: string;
  offset: number;
  category: string;
  phrase: string;
  insert: string;
}

const [, , inFile, outFile] = process.argv;
const mutants: Mutant[] = JSON.parse(fs.readFileSync(inFile, "utf8"));
const pristine = new Map<string, string>();
const read = (f: string) => {
  if (!pristine.has(f)) pristine.set(f, fs.readFileSync(path.resolve(f), "utf8"));
  return pristine.get(f)!;
};
const lineAt = (text: string, off: number) => text.slice(0, off).split("\n").length;

const base = new Map<string, number>();
const rows = mutants.map((m) => {
  const text = read(m.file);
  if (!base.has(m.file)) base.set(m.file, lintText(m.file, text).findings.length);
  const mutated = text.slice(0, m.offset) + m.insert + text.slice(m.offset);
  const r = lintText(m.file, mutated);
  const from = lineAt(mutated, m.offset);
  const to = lineAt(mutated, m.offset + m.insert.trimEnd().length - 1);
  const inside = r.findings.filter((f) => f.line >= from && f.line <= to);
  return {
    id: m.id,
    file: m.file,
    kind: m.kind,
    category: m.category,
    phrase: m.phrase,
    insert: m.insert,
    line_from: from,
    line_to: to,
    pristine_findings: base.get(m.file),
    findings: r.findings.length,
    inside: inside.length,
    rules: [...new Set(r.findings.map((f) => f.rule))].join(";"),
    lines: [...new Set(r.findings.map((f) => f.line))].join(";"),
    exit: r.findings.length || r.problems.length ? 1 : 0,
  };
});
fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
const claims = rows.filter((r) => r.category !== "near");
const near = rows.filter((r) => r.category === "near");
if (claims.length) console.log(`bad claims: ${claims.filter((r) => r.exit === 1 && r.inside > 0).length} of ${claims.length} caught at their lines`);
if (near.length) console.log(`near-misses: ${near.filter((r) => r.findings === 0).length} of ${near.length} left alone`);
