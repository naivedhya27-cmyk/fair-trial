import { describe, expect, it } from "vitest";
import { findClaims } from "../tools/claim-lint/policy";
import { guard, MESSAGES, type Person, type Pregnancy, type Product, type ProductType } from "../src/lib/guard/guard";
import fixture from "./fixtures/guard_cases.json";

const ADULT: Person = { age: 30, pregnancy: "no", redFlags: false, underCare: false, prescription: false };
const PLAIN = "Aqua, Glycerin, Caprylic/Capric Triglyceride, Cetearyl Alcohol, Dimethicone, Shea Butter, Tocopherol, Phenoxyethanol";
const RETINOL = "Aqua, Squalane, Glycerin, Retinol, Cetearyl Alcohol, Tocopherol, Xanthan Gum, Phenoxyethanol";
const cream = (ingredients = PLAIN, type: ProductType | null = "face_leave_on"): Product => ({ name: "Test cream", type, ingredients });
const rules = (person: Partial<Person>, product: Product = cream()) =>
  guard({ ...ADULT, ...person }, product)
    .findings.map((f) => f.rule)
    .sort();

describe("safety guard, rule by rule", () => {
  it("lets an adult test a plain leave-on cream", () => {
    expect(guard(ADULT, cream())).toMatchObject({ action: "proceed", findings: [] });
  });

  it("refuses a missing age and anyone under 18", () => {
    expect(rules({ age: null })).toEqual(["age_missing"]);
    expect(rules({ age: Number.NaN })).toEqual(["age_missing"]);
    expect(rules({ age: 17 })).toEqual(["under_18"]);
    expect(rules({ age: 18 })).toEqual([]);
    expect(guard({ ...ADULT, age: 17 }, cream()).action).toBe("refuse");
  });

  it("refers a worrying sign, a doctor's care, a prescription and a product given as a medicine", () => {
    for (const [answer, rule] of [
      [{ redFlags: true }, "see_doctor"],
      [{ underCare: true }, "under_care"],
      [{ prescription: true }, "on_prescription"],
      [{ medicineProduct: true }, "medicine_product"],
    ] as const) {
      const g = guard({ ...ADULT, ...answer }, cream());
      expect(g.findings.map((f) => f.rule)).toEqual([rule]);
      expect(g.action).toBe("refer");
    }
  });

  it("refuses a retinoid in pregnancy, when trying to conceive or unanswered, and warns when breastfeeding", () => {
    for (const pregnancy of ["pregnant", "trying", null] as (Pregnancy | null)[]) {
      expect(rules({ pregnancy }, cream(RETINOL))).toEqual(["pregnancy_retinoid", "sun_sensitivity"]);
      expect(guard({ ...ADULT, pregnancy }, cream(RETINOL)).action).toBe("refuse");
    }
    expect(rules({ pregnancy: "breastfeeding" }, cream(RETINOL))).toEqual(["breastfeeding_retinoid", "sun_sensitivity"]);
    expect(guard({ ...ADULT, pregnancy: "breastfeeding" }, cream(RETINOL)).action).toBe("warn");
    expect(rules({ pregnancy: "pregnant" })).toEqual([]);
  });

  it("warns about the sun with a retinoid, or an AHA above the 1% line but not a trace of one", () => {
    expect(rules({}, cream(RETINOL))).toEqual(["sun_sensitivity"]);
    expect(rules({}, cream("Aqua, Glycolic Acid, Glycerin, Sodium Hydroxide, Aloe Barbadensis Leaf Juice, Xanthan Gum, Phenoxyethanol"))).toEqual(["sun_sensitivity"]);
    expect(rules({}, cream("Aqua, Glycerin, Cetearyl Alcohol, Dimethicone, Shea Butter, Phenoxyethanol, Lactic Acid"))).toEqual([]);
  });

  it("refers medicines and strengths past everyday skincare", () => {
    expect(rules({}, cream("Hydrocortisone 1%, Aqua, Glycerin, Cetearyl Alcohol, Dimethicone, Phenoxyethanol"))).toContain("medicine");
    expect(rules({}, cream("Aqua, Salicylic Acid 5%, Glycerin, Cetearyl Alcohol, Dimethicone, Phenoxyethanol"))).toContain("strength");
    expect(guard(ADULT, cream("Aqua, Salicylic Acid 5%, Glycerin, Cetearyl Alcohol, Dimethicone, Phenoxyethanol")).action).toBe("refer");
    expect(rules({}, cream("Aqua, Salicylic Acid 2%, Glycerin, Cetearyl Alcohol, Dimethicone, Phenoxyethanol"))).toEqual([]);
  });

  it("refuses what isn't a leave-on face product or isn't an ingredient list, and flags a cleanser's list", () => {
    expect(rules({}, cream(PLAIN, "hair"))).toEqual(["product_type"]);
    expect(rules({}, cream(PLAIN, null))).toEqual(["product_type"]);
    expect(rules({}, cream("my favourite night cream"))).toEqual(["not_a_list"]);
    expect(rules({}, cream("Aqua, Sodium Laureth Sulfate, Cocamidopropyl Betaine, Glycerin, Sodium Chloride, Citric Acid, Phenoxyethanol"))).toEqual(["type_mismatch"]);
  });

  it("puts the strongest finding first: refer, then refuse, then warn", () => {
    const g = guard({ ...ADULT, age: 16, prescription: true }, cream(RETINOL));
    expect(g.action).toBe("refer");
    expect(g.findings.map((f) => f.action)).toEqual(["refer", "refuse", "warn"]);
  });

  it("keeps every message free of claim words", () => {
    for (const m of Object.values(MESSAGES)) expect(findClaims(m)).toEqual([]);
  });
});

describe("safety guard, the S13 intake cases", () => {
  it("gives the expected rules and action in all 900", () => {
    const products = fixture.products as Record<string, string>;
    const wrong = fixture.cases.filter((c) => {
      const person: Person = { age: c.age, pregnancy: c.pregnancy as Pregnancy | null, redFlags: c.redFlags, underCare: c.underCare, prescription: c.prescription };
      const g = guard(person, { name: "", type: c.type as ProductType | null, ingredients: products[c.pid] });
      return (
        g.action !== c.action ||
        g.findings
          .map((f) => f.rule)
          .sort()
          .join(";") !== c.rules.join(";")
      );
    });
    expect(fixture.cases).toHaveLength(900);
    expect(wrong.map((c) => c.case)).toEqual([]);
  });
});
