// Claim linter command (validation step S19): `npm run claims` from the app folder, or
// `npx tsx tools/claim-lint/cli.ts [--json] [file ...]`. With no files it reads every file a person can see text
// from: src/ (TS, TSX and JSON), public/ (JSON; the copied MediaPipe files and the face model left out), README.md and
// docs/. Exits 1 on any finding or any exemption without a reason.
import fs from "node:fs";
import path from "node:path";
import { lintText, type Finding } from "./lint";

const SKIP_DIRS = new Set(["node_modules", ".next", "mediapipe", "models"]);
const READ = /\.(tsx?|mts|json|md)$/i;

function walk(dir: string, out: string[]) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), out);
    } else if (READ.test(e.name)) out.push(path.join(dir, e.name));
  }
}

/** The files the linter reads by default, relative to the app folder. */
export function defaultFiles(root: string): string[] {
  const out: string[] = [];
  walk(path.join(root, "src"), out);
  walk(path.join(root, "public"), out);
  walk(path.join(root, "docs"), out);
  if (fs.existsSync(path.join(root, "README.md"))) out.push(path.join(root, "README.md"));
  return out.filter((f) => !/\.d\.ts$/.test(f) && (!f.includes(`${path.sep}public${path.sep}`) || f.endsWith(".json"))).map((f) => path.relative(root, f).split(path.sep).join("/"));
}

const args = process.argv.slice(2);
const json = args.includes("--json");
const root = process.cwd();
const files = args.filter((a) => a !== "--json");
const list = files.length ? files : defaultFiles(root);

const findings: Finding[] = [];
const problems: { file: string; line: number; message: string }[] = [];
let exempted = 0;
for (const f of list) {
  const r = lintText(f, fs.readFileSync(path.resolve(root, f), "utf8"));
  findings.push(...r.findings);
  problems.push(...r.problems);
  exempted += r.exempted.length;
}

if (json) {
  process.stdout.write(JSON.stringify({ files: list.length, findings, problems, exempted }, null, 1) + "\n");
} else {
  for (const f of findings) console.log(`${f.file}:${f.line}:${f.col}  ${f.category}/${f.rule}  "${f.match}"  in "…${f.context}…"`);
  for (const p of problems) console.log(`${p.file}:${p.line}  ${p.message}`);
  console.log(`claim lint: ${list.length} files, ${findings.length} findings, ${problems.length} problems, ${exempted} exempted`);
}
process.exitCode = findings.length || problems.length ? 1 : 0;
