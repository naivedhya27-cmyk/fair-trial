import { describe, expect, it } from "vitest";
import { plan, type Plan } from "../src/lib/planner/plan";

const RETINOL_SERUM = "Aqua, Glycerin, Caprylic/Capric Triglyceride, Squalane, Retinol, Tocopherol, Polysorbate 20, Carbomer, Phenoxyethanol";
const RETINOL_HA = "Aqua, Cetearyl Alcohol, Dimethicone, Glycerin, Retinol, Ceramide NP, Sodium Hyaluronate, Tocopheryl Acetate, Phenoxyethanol";
const NIACINAMIDE = "Aqua, Niacinamide, Glycerin, Pentylene Glycol, Zinc PCA, Phenoxyethanol";
const SUNSCREEN = "Aqua, Avobenzone, Homosalate, Octocrylene, Glycerin, Dimethicone, Phenoxyethanol";
const TEA_TREE = "Aqua, Melaleuca Alternifolia Leaf Oil, Glycerin, Xanthan Gum, Phenoxyethanol";
const PLAIN = "Aqua, Glycerin, Cetearyl Alcohol, Dimethicone, Shea Butter, Tocopherol, Phenoxyethanol";
const visits = (p: Plan) => p.visits.map((v) => [v.week, v.days, v.purpose]);

describe("trial planner", () => {
  it("plans retinol on fine lines from its evidence row: a week-2 safety look, a first look, the verdict week", () => {
    const p = plan(RETINOL_SERUM, "wrinkle");
    expect(p).toMatchObject({ design: "split_face", goal: "wrinkle", rows: ["E02"], firstLookWeek: 4, verdictWeek: 12, adjustToWeek: 4 });
    expect(visits(p)).toEqual([
      [2, 1, "safety"],
      [4, 2, "first_look"],
      [12, 3, "verdict"],
    ]);
    expect(p.goals).toEqual(["wrinkle", "texture", "age_spot"]);
  });

  it("merges every row that names the goal: earliest first look, latest verdict week, latest irritation window", () => {
    const p = plan(RETINOL_HA, "wrinkle");
    expect(p).toMatchObject({ rows: ["E02", "E11"], firstLookWeek: 2, verdictWeek: 12, adjustToWeek: 4 });
    // a first look at week 2 is the safety look, so this plan has no look between week 2 and week 12 (S18 finding)
    expect(visits(p)).toEqual([
      [2, 1, "safety"],
      [12, 3, "verdict"],
    ]);
  });

  it("never splits a face for a sunscreen", () => {
    expect(plan(SUNSCREEN)).toMatchObject({ design: "no_trial", reason: "split_face_unsafe", rows: ["E13"] });
  });

  it("turns down a goal photos can't measure or the evidence doesn't name", () => {
    expect(plan(TEA_TREE)).toMatchObject({ design: "no_trial", reason: "not_measurable", rows: ["E19"] });
    expect(plan(NIACINAMIDE, "acne")).toMatchObject({ design: "no_trial", reason: "not_measurable" });
    expect(plan(NIACINAMIDE, "oiliness")).toMatchObject({ design: "no_trial", reason: "no_evidence", rows: [] });
  });

  it("takes the first measurable goal when none is asked", () => {
    const p = plan(NIACINAMIDE);
    expect(p).toMatchObject({ design: "split_face", goal: "age_spot", rows: ["E07"] });
    expect(visits(p).map((v) => v[0])).toEqual([2, 4, 8]);
  });

  it("tests a product with none of the actives as a moisturiser", () => {
    const p = plan(PLAIN);
    expect(p).toMatchObject({ fallback: true, design: "split_face", goal: "moisture", rows: ["E12"] });
    expect(visits(p)).toEqual([
      [2, 1, "safety"],
      [4, 3, "verdict"],
    ]);
  });
});
