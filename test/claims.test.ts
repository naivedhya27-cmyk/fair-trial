import { describe, expect, it } from "vitest";
import { lintText } from "../tools/claim-lint/lint";
import { findClaims, RULES } from "../tools/claim-lint/policy";

// characters by code point, so this file holds no invisible character
const ch = (c: number) => String.fromCharCode(c);
const NBSP = ch(0xa0),
  NNBSP = ch(0x202f),
  SHY = ch(0xad),
  ZWSP = ch(0x200b),
  EN_DASH = ch(0x2013),
  RSQUO = ch(0x2019);
const BS = "\\";

const rules = (file: string, text: string) => lintText(file, text).findings.map((f) => f.rule);
const lines = (file: string, text: string) => lintText(file, text).findings.map((f) => f.line);

describe("claim policy", () => {
  it("finds each category's words in plain text", () => {
    const hits = (s: string) => findClaims(s).map((c) => c.category);
    expect(hits("This serum cures acne")).toEqual(["medical"]);
    expect(hits("boosts collagen production")).toContain("body_function");
    expect(hits("Dermatologist-approved")).toEqual(["approval"]);
    expect(hits("clinically proven")).toContain("proof");
    expect(hits("100% safe")).toEqual(expect.arrayContaining(["proof"]));
    expect(hits("no side effects")).toEqual(["safety"]);
    expect(hits("paraben-free")).toEqual(["denigration"]);
    expect(hits("a miracle cream")).toEqual(["magic"]);
    expect(hits("instant results")).toEqual(["permanence"]);
  });

  it("leaves the app's own words alone", () => {
    for (const s of [
      "Working",
      "No measurable effect",
      "Stop and check",
      "Expected adjustment",
      "The product side improved more than the bare side",
      "Fair Trial is not a medical service",
      "Please ask a dermatologist before using it.",
      "Show me the certificate",
      "The week-2 safety look",
      "improved, improvement, approve, provide",
      "healthy-looking skin, a secure upload, a curated list",
    ])
      expect(findClaims(s)).toEqual([]);
  });

  it("reads through spaces, dashes, quotes and invisible characters", () => {
    expect(findClaims(`clinically${NBSP}proven`)).not.toEqual([]);
    expect(findClaims(`clinically${NNBSP}proven`)).not.toEqual([]);
    expect(findClaims(`dermatologist${EN_DASH}approved`)).not.toEqual([]);
    expect(findClaims(`it${RSQUO}s safe`)).not.toEqual([]);
    expect(findClaims(`tre${SHY}ats`)).not.toEqual([]);
    expect(findClaims(`he${ZWSP}als`)).not.toEqual([]);
    expect(findClaims("CLINICALLY  PROVEN")).not.toEqual([]);
  });

  it("gives every rule a pattern that compiles", () => {
    for (const r of RULES) expect(() => new RegExp(r.pattern)).not.toThrow();
  });
});

describe("claim linter, TSX", () => {
  it("reads JSX text, entities and line breaks as React renders them", () => {
    expect(rules("a.tsx", "const A = () => <p>This cures acne</p>;")).toEqual(["cure"]);
    expect(rules("a.tsx", "const A = () => <p>clinically&nbsp;proven</p>;")).toContain("clinically_proven");
    expect(rules("a.tsx", "const A = () => (\n  <p>\n    clinically\n    proven\n  </p>\n);")).toContain("clinically_proven");
    expect(rules("a.tsx", 'const A = () => (\n  <p>\n    clinically{" "}\n    proven\n  </p>\n);')).toContain("clinically_proven");
    expect(rules("a.tsx", "const A = () => <p>clinically <b>proven</b></p>;")).toContain("clinically_proven");
  });

  it("keeps words apart across an expression it can't read", () => {
    expect(rules("a.tsx", "const A = ({ x }: { x: string }) => <p>clinically {x} proven</p>;")).toContain("prove");
    expect(rules("a.tsx", "const A = ({ x }: { x: string }) => <p>clinically {x} proven</p>;")).not.toContain("clinically_proven");
  });

  it("reads text attributes and skips the others", () => {
    expect(rules("a.tsx", 'const A = () => <img alt="a miracle serum" src="/x.png" />;')).toEqual(["miracle"]);
    expect(rules("a.tsx", 'const A = () => <button aria-label="Heals skin" />;')).toEqual(["heal"]);
    expect(rules("a.tsx", 'const A = () => <div className="cure-grid" id="treat" />;')).toEqual([]);
    expect(rules("a.tsx", "const A = () => <div className={`cure ${1}`} />;")).toEqual([]);
  });

  it("reads strings inside handlers, even in a non-text attribute", () => {
    expect(rules("a.tsx", 'const A = ({ say }: { say: (s: string) => void }) => <button onClick={() => say("It cures acne")}>Go</button>;')).toEqual(["cure"]);
  });

  it("reads string and template literals, with their escapes", () => {
    expect(rules("a.ts", 'export const T = "Guaranteed results";')).toEqual(["guarantee"]);
    expect(rules("a.ts", "export const T = (w: number) => `Week ${w}: it heals`;")).toEqual(["heal"]);
    expect(rules("a.ts", `export const T = "clinically${BS}u00a0proven";`)).toContain("clinically_proven");
    expect(rules("a.ts", `export const T = "tre${BS}u00adats";`)).toEqual(["treat"]);
  });

  it("skips module paths, directives, object keys and types", () => {
    expect(rules("a.ts", '"use client";\nimport x from "./cure";\nexport type T = "treated";\nexport const o = { "treatment": x };')).toEqual([]);
  });

  it("names the line of the claim", () => {
    expect(lines("a.tsx", "const A = () => (\n  <div>\n    <p>Fine</p>\n    <p>It cures acne</p>\n  </div>\n);")).toEqual([4]);
  });

  it("honours an exemption only with a reason", () => {
    const ok = lintText("a.ts", "// claim-lint-ignore-next-line -- parsing words, never shown\nconst W = ['treatment'];");
    expect(ok.findings).toEqual([]);
    expect(ok.exempted).toHaveLength(1);
    const bare = lintText("a.ts", "// claim-lint-ignore-next-line\nconst W = ['treatment'];");
    expect(bare.problems).toHaveLength(1);
    const block = lintText("a.ts", "// claim-lint-disable -- parsing words, never shown\nconst W = [\n  'treatment',\n  'cure',\n];\n// claim-lint-enable\nconst V = 'heals';");
    expect(block.findings.map((f) => f.rule)).toEqual(["heal"]);
    expect(block.exempted).toHaveLength(2);
  });
});

describe("claim linter, JSON and Markdown", () => {
  it("reads JSON string values, not keys", () => {
    expect(rules("a.json", '{ "cure": "fine", "about": "It treats acne" }')).toEqual(["treat"]);
    expect(rules("a.json", `{ "about": "clinically${BS}u00a0proven" }`)).toContain("clinically_proven");
  });

  it("reads Markdown prose but not code, comments or link targets", () => {
    const md = "# Fair Trial\n\nIt measures; it never claims.\n\n```sh\nnpm run cure\n```\n\nSee [the docs](https://x.org/cures) and `treat()`.\n<!-- heals -->\n";
    expect(rules("README.md", md)).toEqual([]);
    expect(rules("README.md", "It is\nclinically proven.\n")).toContain("clinically_proven");
  });
});
