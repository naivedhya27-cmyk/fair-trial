// Claim linter (validation step S19): finds the claim policy's words (policy.ts) in the text a person can see.
//   TS/TSX (TypeScript's own parser): JSX text as React renders it (each element's text with its children's, entities
//   decoded, line breaks as JSX treats them), the text attributes, and string and template literals, except module
//   paths, directives, object keys, type positions and the direct values of the other JSX attributes (class names,
//   ids, links). A literal inside a function in such an attribute (an onClick that announces something) is read.
//   JSON: every string value. Markdown: the prose, without code, comments and link targets.
// An exemption is a comment with its reason: "claim-lint-ignore-next-line <reason>", or "claim-lint-disable <reason>"
// up to "claim-lint-enable". In Markdown the same words go in an HTML comment.
import ts from "typescript";
import { claimsIn, normalise, type Category } from "./policy";

export interface Finding {
  file: string;
  line: number;
  col: number;
  category: Category;
  rule: string;
  match: string;
  /** the normalised text the claim was found in, shortened */
  context: string;
}
export interface Problem {
  file: string;
  line: number;
  message: string;
}
export interface LintResult {
  findings: Finding[];
  exempted: (Finding & { reason: string })[];
  problems: Problem[];
}

/** JSX attributes whose value is shown or read out. */
export const TEXT_ATTRIBUTES = new Set(["alt", "title", "aria-label", "aria-description", "aria-valuetext", "aria-roledescription", "aria-placeholder", "placeholder", "label"]);

/** A run of source text: `text` is what a person sees, `at[i]` the source offset of text[i]. null = an expression whose
 *  value can't be read here; it keeps the words on either side apart. */
type Piece = { text: string; at: number[] } | null;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ...Object.fromEntries(
    Object.entries({
      nbsp: 0xa0,
      shy: 0xad,
      ndash: 0x2013,
      mdash: 0x2014,
      lsquo: 0x2018,
      rsquo: 0x2019,
      ldquo: 0x201c,
      rdquo: 0x201d,
      hellip: 0x2026,
      middot: 0xb7,
      thinsp: 0x2009,
      ensp: 0x2002,
      emsp: 0x2003,
      zwj: 0x200d,
      zwnj: 0x200c,
      zwsp: 0x200b,
    }).map(([k, c]) => [k, String.fromCharCode(c)]),
  ),
};

/** HTML entities as JSX and Markdown decode them. */
function decodeEntities(raw: string, pos: number): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < raw.length;) {
    if (raw[i] === "&") {
      const m = /^&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/i.exec(raw.slice(i, i + 12));
      if (m) {
        const e = m[1];
        const ch = e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()];
        if (ch !== undefined) {
          for (const c of ch) {
            text += c;
            at.push(pos + i);
          }
          i += m[0].length;
          continue;
        }
      }
    }
    text += raw[i];
    at.push(pos + i);
    i++;
  }
  return { text, at };
}

/** The value of a JS or JSON string body (between the quotes, raw) with each character's source offset. */
function cookString(raw: string, pos: number): { text: string; at: number[] } {
  let text = "";
  const at: number[] = [];
  for (let i = 0; i < raw.length;) {
    const start = pos + i;
    if (raw[i] !== "\\") {
      text += raw[i];
      at.push(start);
      i++;
      continue;
    }
    const n = raw[i + 1];
    let ch = "";
    let len = 2;
    if (n === "u" && raw[i + 2] === "{") {
      const end = raw.indexOf("}", i);
      ch = String.fromCodePoint(parseInt(raw.slice(i + 3, end), 16));
      len = end - i + 1;
    } else if (n === "u") {
      ch = String.fromCharCode(parseInt(raw.slice(i + 2, i + 6), 16));
      len = 6;
    } else if (n === "x") {
      ch = String.fromCharCode(parseInt(raw.slice(i + 2, i + 4), 16));
      len = 4;
    } else if (n === "\r" || n === "\n") {
      len = n === "\r" && raw[i + 2] === "\n" ? 3 : 2; // a line continuation adds nothing
    } else ch = ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[n] ?? n;
    for (const c of ch) {
      text += c;
      at.push(start);
    }
    i += len;
  }
  return { text, at };
}

/** JSX text as React renders it: lines trimmed, blank lines dropped, line breaks between words as one space. */
function jsxText(raw: string, pos: number): Piece {
  const d = decodeEntities(raw, 0);
  // whitespace that holds a line break at either end of the text disappears; elsewhere it is one space (normalise)
  let a = 0,
    b = d.text.length;
  const lead = /^[ \t\r\n]*/.exec(raw)![0];
  const trail = /[ \t\r\n]*$/.exec(raw)![0];
  if (/[\r\n]/.test(lead)) while (a < b && /[ \t\r\n]/.test(d.text[a])) a++;
  if (/[\r\n]/.test(trail)) while (b > a && /[ \t\r\n]/.test(d.text[b - 1])) b--;
  if (a >= b) return { text: "", at: [] };
  return { text: d.text.slice(a, b), at: d.at.slice(a, b).map((o) => o + pos) };
}

interface Unit {
  pieces: Piece[];
}

function scanUnits(file: string, src: string, lineOf: (pos: number) => { line: number; col: number }, units: Unit[], out: Finding[]) {
  for (const u of units) {
    let text = "";
    const at: number[] = [];
    for (const p of u.pieces) {
      if (p === null) {
        text += "\u0001";
        at.push(-1);
      } else {
        text += p.text;
        at.push(...p.at);
      }
    }
    if (!/[a-z]/i.test(text)) continue;
    const m = normalise(text, at);
    for (const c of claimsIn(m)) {
      const pos = c.from >= 0 ? c.from : 0;
      const { line, col } = lineOf(pos);
      out.push({ file, line, col, category: c.category, rule: c.rule, match: c.match, context: m.text.slice(Math.max(0, c.index - 40), c.index + c.match.length + 40).replace(/\u0001/g, "…") });
    }
  }
}

const isFunctionLike = (n: ts.Node) => ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n);
const isJsxContainer = (n: ts.Node) => ts.isJsxElement(n) || ts.isJsxFragment(n);
const attrName = (a: ts.JsxAttribute) => (ts.isIdentifier(a.name) ? a.name.text : `${a.name.namespace.text}:${a.name.name.text}`);

/** Whether a literal is code rather than words a person sees. */
function isCode(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) return true;
  if (ts.isExternalModuleReference(p) || ts.isImportTypeNode(p) || ts.isLiteralTypeNode(p)) return true;
  if (ts.isCallExpression(p) && (p.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(p.expression) && p.expression.text === "require"))) return true;
  if (ts.isExpressionStatement(p) && ts.isStringLiteral(node) && (ts.isSourceFile(p.parent) || ts.isBlock(p.parent))) {
    const stmts = (p.parent as ts.SourceFile | ts.Block).statements;
    const idx = stmts.indexOf(p);
    if (stmts.slice(0, idx + 1).every((s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression))) return true; // a directive
  }
  if (
    (ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) &&
    p.name === node
  )
    return true;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return true;
  if (ts.isComputedPropertyName(p)) return true;
  // the direct value of a JSX attribute that isn't text (class names, ids, links), not crossing a function
  for (let n: ts.Node | undefined = p; n; n = n.parent) {
    if (isFunctionLike(n) || isJsxContainer(n) || ts.isJsxSelfClosingElement(n)) return false;
    if (ts.isJsxAttribute(n)) return !TEXT_ATTRIBUTES.has(attrName(n));
    if (ts.isTypeNode(n)) return true;
  }
  return false;
}

function tsUnits(sf: ts.SourceFile): Unit[] {
  const units: Unit[] = [];
  const consumed = new Set<ts.Node>();
  const src = sf.text;

  /** An element's text with its children's, as one run (React concatenates them). */
  const elementPieces = (el: ts.JsxElement | ts.JsxFragment, out: Piece[]) => {
    for (const ch of el.children) {
      if (ts.isJsxText(ch)) {
        out.push(jsxText(src.slice(ch.pos, ch.end), ch.pos));
      } else if (ts.isJsxExpression(ch)) {
        const e = ch.expression;
        if (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e))) {
          consumed.add(e);
          out.push(cookString(src.slice(e.getStart(sf) + 1, e.end - 1), e.getStart(sf) + 1));
        } else if (e) out.push(null);
      } else if (ts.isJsxElement(ch) || ts.isJsxFragment(ch)) {
        elementPieces(ch, out);
      } else out.push(null); // a self-closing element: its text attributes are read on their own
    }
  };

  const visit = (n: ts.Node) => {
    if ((ts.isJsxElement(n) || ts.isJsxFragment(n)) && !isJsxContainer(n.parent)) {
      const pieces: Piece[] = [];
      elementPieces(n, pieces);
      units.push({ pieces });
    }
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer)) {
      consumed.add(n.initializer);
      if (TEXT_ATTRIBUTES.has(attrName(n))) {
        const s = n.initializer;
        units.push({ pieces: [decodeEntities(src.slice(s.getStart(sf) + 1, s.end - 1), s.getStart(sf) + 1)] });
      }
    }
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && !consumed.has(n) && !isCode(n)) {
      units.push({ pieces: [cookString(src.slice(n.getStart(sf) + 1, n.end - 1), n.getStart(sf) + 1)] });
    }
    if (ts.isTemplateExpression(n) && !isCode(n)) {
      const pieces: Piece[] = [];
      const part = (lit: ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail) => {
        const start = lit.getStart(sf) + 1; // after ` or }
        const endTrim = ts.isTemplateTail(lit) ? 1 : 2; // before ` or ${
        pieces.push(cookString(src.slice(start, lit.end - endTrim), start));
      };
      part(n.head);
      for (const span of n.templateSpans) {
        pieces.push(null);
        part(span.literal);
      }
      units.push({ pieces });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return units;
}

function jsonUnits(file: string, text: string): Unit[] {
  const sf = ts.parseJsonText(file, text);
  const units: Unit[] = [];
  // parseJsonText sets no parents, so the visit carries them
  const visit = (n: ts.Node, parent: ts.Node | null) => {
    if (ts.isStringLiteral(n) && !(parent && ts.isPropertyAssignment(parent) && parent.name === n)) {
      const start = n.getStart(sf) + 1;
      units.push({ pieces: [cookString(text.slice(start, n.end - 1), start)] });
    }
    ts.forEachChild(n, (c) => visit(c, n));
  };
  visit(sf, null);
  return units;
}

function markdownUnits(text: string): Unit[] {
  const units: Unit[] = [];
  const lines = text.split("\n");
  let pos = 0;
  let fence: string | null = null;
  let para: Piece[] = [];
  let inComment = false;
  const flush = () => {
    if (para.length) units.push({ pieces: para });
    para = [];
  };
  for (const line of lines) {
    const start = pos;
    pos += line.length + 1;
    const f = /^\s{0,3}(```|~~~)/.exec(line);
    if (fence) {
      if (f && f[1] === fence) fence = null;
      continue;
    }
    if (f) {
      flush();
      fence = f[1];
      continue;
    }
    if (/^\s*$/.test(line)) {
      flush();
      continue;
    }
    // blank out what isn't prose, keeping offsets: comments, inline code, link targets, autolinks, HTML tags
    let prose = line;
    const blank = (re: RegExp) => (prose = prose.replace(re, (m) => " ".repeat(m.length)));
    if (inComment) {
      const end = prose.indexOf("-->");
      if (end < 0) continue;
      prose = " ".repeat(end + 3) + prose.slice(end + 3);
      inComment = false;
    }
    blank(/<!--.*?-->/g);
    const open = prose.indexOf("<!--");
    if (open >= 0) {
      prose = prose.slice(0, open) + " ".repeat(prose.length - open);
      inComment = true;
    }
    blank(/`[^`]*`/g);
    blank(/\]\([^)]*\)/g);
    blank(/<https?:[^>]*>/g);
    blank(/<\/?[a-z][^>]*>/gi);
    para.push(decodeEntities(prose, start), { text: " ", at: [start + line.length] });
  }
  flush();
  return units;
}

/** Exemption comments: the lines they cover, with their reasons; a reasonless one is a problem. */
function exemptions(file: string, text: string, markdown: boolean): { covered: Map<number, string>; problems: Problem[] } {
  const covered = new Map<number, string>();
  const problems: Problem[] = [];
  const lines = text.split("\n");
  let open: { line: number; reason: string } | null = null;
  const re = markdown
    ? /<!--\s*claim-lint-(disable|enable|ignore-next-line)\b\s*(?:--|:)?\s*(.*?)\s*-->/
    : /(?:\/\/|\/\*)\s*claim-lint-(disable|enable|ignore-next-line)\b\s*(?:--|:)?\s*(.*?)\s*(?:\*\/\}?)?\s*$/;
  lines.forEach((l, i) => {
    const m = re.exec(l);
    if (!m) {
      if (open) covered.set(i + 1, open.reason);
      return;
    }
    const [, kind, why] = m;
    const reason = (why ?? "").replace(/\*\/\}?$/, "").trim();
    if (kind !== "enable" && reason.split(/\s+/).filter(Boolean).length < 3) problems.push({ file, line: i + 1, message: `claim-lint-${kind} needs a reason of three words or more` });
    if (kind === "disable") open = { line: i + 1, reason };
    else if (kind === "enable") open = null;
    else covered.set(i + 2, reason);
    if (open) covered.set(i + 1, open.reason);
  });
  if (open) problems.push({ file, line: (open as { line: number }).line, message: "claim-lint-disable without a claim-lint-enable" });
  return { covered, problems };
}

/** Offsets where each line starts. */
function lineStartsOf(t: string): number[] {
  const s = [0];
  for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10) s.push(i + 1);
  return s;
}

/** Lint one file's text. `file` decides the reader: .ts/.tsx/.js/.jsx/.mjs, .json or .md. */
export function lintText(file: string, text: string): LintResult {
  const lower = file.toLowerCase();
  const markdown = lower.endsWith(".md");
  let units: Unit[];
  let lineStarts: readonly number[];
  if (lower.endsWith(".json")) {
    units = jsonUnits(file, text);
    lineStarts = lineStartsOf(text);
  } else if (markdown) {
    units = markdownUnits(text);
    lineStarts = lineStartsOf(text);
  } else {
    const kind = lower.endsWith(".tsx") || lower.endsWith(".jsx") ? ts.ScriptKind.TSX : lower.endsWith(".ts") || lower.endsWith(".mts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    units = tsUnits(sf);
    lineStarts = sf.getLineStarts();
  }
  const lineOf = (pos: number) => {
    let lo = 0,
      hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: pos - lineStarts[lo] + 1 };
  };
  const all: Finding[] = [];
  scanUnits(file, text, lineOf, units, all);
  // one finding per claim: an element's text and a nested element can both hold it
  const seen = new Set<string>();
  const unique = all.filter((f) => {
    const k = `${f.line}:${f.col}:${f.rule}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const { covered, problems } = exemptions(file, text, markdown);
  const findings: Finding[] = [];
  const exempted: (Finding & { reason: string })[] = [];
  for (const f of unique) {
    const reason = covered.get(f.line);
    if (reason !== undefined) exempted.push({ ...f, reason });
    else findings.push(f);
  }
  return { findings, exempted, problems };
}
