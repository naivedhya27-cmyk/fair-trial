import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { outputOf, parseAnalysis } from "@/lib/youcam/parse";

const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8"));

describe("parseAnalysis (S06 bar: every field of the saved development responses)", () => {
  it("reads all 16 SD concerns, skin type regions and the vendor summary", () => {
    const p = parseAnalysis(outputOf(fixture("analysis_sd16.json")));
    expect(Object.keys(p.concerns).sort()).toEqual([
      "acne",
      "age_spot",
      "dark_circle_v2",
      "droopy_lower_eyelid",
      "droopy_upper_eyelid",
      "eye_bag",
      "firmness",
      "moisture",
      "oiliness",
      "pore",
      "radiance",
      "redness",
      "skin_type",
      "tear_trough",
      "texture",
      "wrinkle",
    ]);
    expect(p.concerns.pore?.raw).toBeCloseTo(50.12228, 4);
    expect(p.concerns.acne?.raw).toBeCloseTo(46.41028, 4);
    expect(p.skinType).toEqual({ whole: "Oily", t_zone: "Oily", u_zone: "Oily" });
    expect(p.ignored.overall_score).toBeCloseTo(71.06667, 4);
    expect(p.ignored.skin_age).toBe(37);
    expect(p.resizeImageUrl).toBeTruthy();
    expect(p.unknownTypes).toEqual([]);
  });

  it("keeps ui_score out of the measurements", () => {
    const p = parseAnalysis(outputOf(fixture("analysis_sd16.json")));
    expect(p.ignored.ui_score.moisture).toBe(62);
    expect(p.concerns.moisture?.raw).toBeCloseTo(29.04918, 4);
    expect(JSON.stringify(p.concerns)).not.toContain("ui");
  });

  it("is deterministic across the two runs on the same photo (S06 finding)", () => {
    const a = parseAnalysis(outputOf(fixture("analysis_sd4.json")));
    const b = parseAnalysis(outputOf(fixture("analysis_sd16.json")));
    for (const c of ["pore", "age_spot", "acne", "redness"] as const) expect(a.concerns[c]?.raw).toBe(b.concerns[c]?.raw);
  });

  it("refuses a task that did not succeed", () => {
    expect(() => outputOf({ data: { task_status: "error", error: "x" } })).toThrow(/error/);
  });
});
