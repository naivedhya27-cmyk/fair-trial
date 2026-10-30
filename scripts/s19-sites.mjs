// S19 user-text sites for the claim mutants (prereg in R/s19_score.R). A second reader, independent of the linter: it
// parses with Babel (the linter uses the TypeScript compiler) and lists every place a person's text lives, by its own
// rules, with the offsets where a phrase can go in (after a space, or at the start of the text).
//   jsx_text  JSX text with a letter in it
//   jsx_attr  the string value of alt, title, aria-label, aria-description, aria-valuetext, aria-roledescription,
//             aria-placeholder, placeholder or label
//   string    a string literal with a space in it, except import and export paths, require and import() paths, object
//             keys, TypeScript literal types and the direct values of other JSX attributes (not crossing a function)
//   template  a template literal's text part with a space in it, under the same exceptions
//   json      a JSON string value (not a key) with a space in it
//   md        Markdown prose outside code fences, comments, inline code and link targets
// Lines that a claim-lint exemption covers are left out. Usage (from the app folder):
//   node scripts/s19-sites.mjs <out.json>
import fs from "node:fs";
import path from "node:path";
import { parse, parseExpression } from "@babel/parser";

const out = process.argv[2];
const ROOT = process.cwd();
const TEXT = new Set(["alt", "title", "aria-label", "aria-description", "aria-valuetext", "aria-roledescription", "aria-placeholder", "placeholder", "label"]);
const SKIP = new Set(["node_modules", ".next", "mediapipe", "models"]);

function files() {
  const list = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(p);
      } else list.push(p);
    }
  };
  walk(path.join(ROOT, "src"));
  walk(path.join(ROOT, "public"));
  walk(path.join(ROOT, "docs"));
  if (fs.existsSync(path.join(ROOT, "README.md"))) list.push(path.join(ROOT, "README.md"));
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
  return list.map(rel).filter((f) => (f.startsWith("public/") ? f.endsWith(".json") : /\.(tsx?|json|md)$/.test(f) && !f.endsWith(".d.ts")));
}

/** Lines an exemption covers, by its own reading of the comments. */
function exemptLines(text) {
  const covered = new Set();
  let open = false;
  text.split("\n").forEach((l, i) => {
    const n = i + 1;
    if (/claim-lint-disable/.test(l)) open = true;
    if (open) covered.add(n);
    if (/claim-lint-enable/.test(l)) open = false;
    if (/claim-lint-ignore-next-line/.test(l)) covered.add(n + 1);
  });
  return covered;
}

const lineAt = (text, off) => text.slice(0, off).split("\n").length;

/** Offsets inside [a, b) where a phrase can go: right after a space that is followed by a letter or digit, or at a
 *  if the text starts with a letter. `ok(i)` vetoes offsets (escapes, indentation). */
function spots(text, a, b, ok = () => true) {
  const s = [];
  if (/[A-Za-z]/.test(text[a] ?? "") && ok(a)) s.push(a);
  for (let i = a + 1; i < b; i++) if (text[i - 1] === " " && /[A-Za-z0-9]/.test(text[i]) && ok(i)) s.push(i);
  return s;
}

function walkAst(node, parents, visit) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parents);
  parents.push(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra" || key === "leadingComments" || key === "trailingComments" || key === "innerComments") continue;
    const v = node[key];
    if (Array.isArray(v)) for (const c of v) walkAst(c, parents, visit);
    else if (v && typeof v.type === "string") walkAst(v, parents, visit);
  }
  parents.pop();
}

const FUNCTION = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration", "ObjectMethod", "ClassMethod"]);

/** A literal that is code by these rules. */
function isCode(node, parents) {
  const p = parents[parents.length - 1];
  if (!p) return false;
  if ((p.type === "ImportDeclaration" || p.type === "ExportNamedDeclaration" || p.type === "ExportAllDeclaration") && p.source === node) return true;
  if (p.type === "ImportExpression" || p.type === "TSExternalModuleReference" || p.type === "TSImportType") return true;
  if (p.type === "CallExpression" && (p.callee.type === "Import" || (p.callee.type === "Identifier" && p.callee.name === "require"))) return true;
  if ((p.type === "ObjectProperty" || p.type === "ClassProperty" || p.type === "TSPropertySignature" || p.type === "ObjectMethod" || p.type === "TSEnumMember") && p.key === node && !p.computed) return true;
  if (p.type === "MemberExpression" && p.property === node && p.computed) return true;
  for (let i = parents.length - 1; i >= 0; i--) {
    const a = parents[i];
    if (a.type.startsWith("TS") && a.type !== "TSAsExpression" && a.type !== "TSSatisfiesExpression" && a.type !== "TSNonNullExpression") return true;
    if (FUNCTION.has(a.type) || a.type === "JSXElement" || a.type === "JSXFragment") return false;
    if (a.type === "JSXAttribute") return !TEXT.has(a.name.type === "JSXNamespacedName" ? `${a.name.namespace.name}:${a.name.name.name}` : a.name.name);
  }
  return false;
}

function codeSites(file, text) {
  const ast = parse(text, { sourceType: "module", plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"], errorRecovery: true });
  const sites = [];
  const add = (kind, offs, quote = null) => {
    for (const o of offs) sites.push({ file, kind, offset: o, quote, line: lineAt(text, o) });
  };
  // inside a JS string or template, never right after a backslash
  const noEscape = (i) => text[i - 1] !== "\\";
  walkAst(ast.program, [], (n, parents) => {
    const p = parents[parents.length - 1];
    if (n.type === "JSXText" && /[A-Za-z]/.test(n.value)) {
      // not in the indentation of a line
      add("jsx_text", spots(text, n.start, n.end, (i) => !/^\s*$/.test(text.slice(text.lastIndexOf("\n", i - 1) + 1, i))));
    } else if (n.type === "StringLiteral" && p && p.type === "JSXAttribute" && p.value === n) {
      const name = p.name.type === "JSXNamespacedName" ? `${p.name.namespace.name}:${p.name.name.name}` : p.name.name;
      if (TEXT.has(name)) add("jsx_attr", spots(text, n.start + 1, n.end - 1), text[n.start]);
    } else if (n.type === "StringLiteral" && / /.test(n.value) && /[A-Za-z]/.test(n.value) && !isCode(n, parents)) {
      add("string", spots(text, n.start + 1, n.end - 1, noEscape), text[n.start]);
    } else if (n.type === "TemplateLiteral" && !isCode(n, parents)) {
      for (const q of n.quasis) if (/ /.test(q.value.cooked ?? "")) add("template", spots(text, q.start, q.end, noEscape), "`");
    }
  });
  return sites;
}

function jsonSites(file, text) {
  const ast = parseExpression(text, { sourceType: "module" });
  const sites = [];
  walkAst(ast, [], (n, parents) => {
    const p = parents[parents.length - 1];
    if (n.type === "StringLiteral" && !(p && p.type === "ObjectProperty" && p.key === n) && / /.test(n.value) && /[A-Za-z]/.test(n.value)) {
      for (const o of spots(text, n.start + 1, n.end - 1, (i) => text[i - 1] !== "\\")) sites.push({ file, kind: "json", offset: o, quote: '"', line: lineAt(text, o) });
    }
  });
  return sites;
}

function mdSites(file, text) {
  const sites = [];
  let pos = 0,
    fence = false,
    comment = false;
  for (const line of text.split("\n")) {
    const start = pos;
    pos += line.length + 1;
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || /^\s*$/.test(line) || /^\s{4}/.test(line)) continue;
    // mask what isn't prose with a placeholder that never takes a phrase
    let prose = line;
    const mask = (re) => (prose = prose.replace(re, (m) => "\u0000".repeat(m.length)));
    if (comment) {
      const e = prose.indexOf("-->");
      if (e < 0) continue;
      prose = "\u0000".repeat(e + 3) + prose.slice(e + 3);
      comment = false;
    }
    mask(/<!--.*?-->/g);
    const o = prose.indexOf("<!--");
    if (o >= 0) {
      prose = prose.slice(0, o) + "\u0000".repeat(prose.length - o);
      comment = true;
    }
    mask(/`[^`]*`/g);
    mask(/\]\([^)]*\)/g);
    mask(/<[^>]*>/g);
    mask(/^\s*(#+|[-*+]|\d+\.)\s/);
    for (const i of spots(prose, 0, prose.length)) sites.push({ file, kind: "md", offset: start + i, quote: null, line: lineAt(text, start + i) });
  }
  return sites;
}

const all = [];
for (const f of files()) {
  const text = fs.readFileSync(path.join(ROOT, f), "utf8");
  const ex = exemptLines(text);
  const s = f.endsWith(".json") ? jsonSites(f, text) : f.endsWith(".md") ? mdSites(f, text) : codeSites(f, text);
  all.push(...s.filter((x) => !ex.has(x.line)));
}
fs.writeFileSync(out, JSON.stringify(all));
const by = {};
for (const s of all) by[s.kind] = (by[s.kind] ?? 0) + 1;
console.log(`sites: ${all.length} in ${new Set(all.map((s) => s.file)).size} files`, by);
