// Claim policy (validation step S19): the words Fair Trial must never put in front of a person, in the app, its data
// or its docs. It starts from the S13 claim list, which every screen check has used since S13, and adds what public
// rules on cosmetic and health claims forbid (read in full, work/s19/sources):
//   EU   Regulation (EU) No 655/2013, annex: 1(1) no "approved by an authority"; 4(1) performance never beyond the
//        evidence; 5(1) never denigrate legally used ingredients. Technical document on cosmetic claims (2017),
//        annex III ("free from") and annex IV ("hypoallergenic").
//   US   FD&C Act 201(g)(1), as FDA's "Is It a Cosmetic, a Drug, or Both?" quotes it: a product meant for the
//        diagnosis, cure, mitigation, treatment or prevention of disease, or to affect the structure or any function
//        of the body, is a drug (FDA's examples: restore hair growth, reduce cellulite, treat varicose veins, increase
//        or decrease melanin production, regenerate cells; antibacterial). FDA, "Hypoallergenic" Cosmetics: the word
//        has no agreed meaning. FTC Health Products Compliance Guidance (2022): "clinically proven", expert
//        endorsements and "without the side effects" all need proof Fair Trial doesn't have.
//   IN   Drugs and Magic Remedies (Objectionable Advertisements) Act, 1954: no claim of miraculous powers to cure,
//        diagnose, prevent or mitigate disease, or to change the structure or function of an organ.
// S20 adds the gaps S19 found (work/s20/sources): FDA, "Wrinkle Treatments and Other Anti-aging Products": a product
// meant to remove wrinkles or raise collagen is a drug or a device, so erasing or melting away a skin feature and a
// cosmetic sold as a facelift, Botox, fillers or surgery are body-function claims; dermatologist- or doctor-grade sits
// with medical grade; zero irritation sits with "won't irritate".
// Fair Trial measures and reports; it never claims. A rule is a regular expression over normalised text (normalise
// below); "_" in a rule stands for one space or hyphen between words.

export type Category = "medical" | "body_function" | "approval" | "proof" | "safety" | "denigration" | "magic" | "permanence";

export interface ClaimRule {
  id: string;
  category: Category;
  pattern: string;
}

export const CATEGORY_SOURCE: Record<Category, string> = {
  medical: "S13 claim list; FD&C Act 201(g)(1) (diagnosis, cure, mitigation, treatment, prevention); Drugs and Magic Remedies Act 1954",
  body_function:
    "FD&C Act 201(g)(1)(C) and FDA's examples (hair growth, cellulite, varicose veins, melanin production, regenerating cells); FDA, Wrinkle Treatments and Other Anti-aging Products (removing wrinkles, collagen)",
  approval: "EU 655/2013 annex 1(1); FTC Health Products Compliance Guidance 2022 (expert endorsements)",
  proof: "EU 655/2013 annex 4(1); FTC Health Products Compliance Guidance 2022 (clinically proven); S13 claim list (guarantee)",
  safety: "FTC Health Products Compliance Guidance 2022 (without the side effects); FDA and EU technical document annex IV (hypoallergenic)",
  denigration: "EU 655/2013 annex 5(1); EU technical document annex III (free from)",
  magic: "Drugs and Magic Remedies Act 1954 (miraculous powers)",
  permanence: "EU 655/2013 annex 4(1) and the technical document's '48-hour hydration' example: no effect beyond the evidence",
};

const R = (id: string, category: Category, pattern: string): ClaimRule => ({ id, category, pattern });

export const RULES: ClaimRule[] = [
  // medical: the S13 list, with every inflection, plus mitigation, relief and the anti-infective words
  R("cure", "medical", "cur(?:e|es|ed|ing|ative)"),
  R("treat", "medical", "treat(?:s|ed|ing|ment|ments|able)?"),
  R("heal", "medical", "heal(?:s|ed|ing|er|ers)?"),
  R("diagnose", "medical", "diagnos[a-z]*"),
  R("prevent", "medical", "prevent(?:s|ed|ing|ion|ions|ive|ative|atives)?"),
  R("therapy", "medical", "therap[a-z]*"),
  R("remedy", "medical", "remed(?:y|ies|ial|iate|iates|iated|iating)"),
  R("mitigate", "medical", "mitigat[a-z]*"),
  R("disease", "medical", "diseases?|diseased"),
  R("eliminate", "medical", "eliminat[a-z]*"),
  R("get_rid_of", "medical", "(?:get|gets|getting|got)_rid_of"),
  R("medical_grade", "medical", "(?:medical|pharmaceutical|prescription|clinical|clinic|dermatologist|dermatological|doctor|physician|hospital|surgical)_(?:grade|strength)"),
  R("fight", "medical", "fight(?:s|ing)?"),
  R("kill", "medical", "kill(?:s|ed|ing)?"),
  R("repair", "medical", "repair(?:s|ed|ing)?"),
  R("reverse", "medical", "revers(?:e|es|ed|ing|al)"),
  R("relieve", "medical", "reliev(?:e|es|ed|ing)|relief"),
  R("anti_infective", "medical", "anti_?(?:inflammatory|bacterial|biotics?|fungal|viral|septic|microbial|acne|dandruff)"),

  // body function: changing the body's structure or function
  R("regenerate", "body_function", "regenerat[a-z]*"),
  R(
    "collagen",
    "body_function",
    "(?:boost|stimulat|increas|restor|rebuild|produc|build|renew)[a-z]*_(?:(?:your|the|skin's|skin|new|more)_)?(?:collagen|elastin)|(?:collagen|elastin)_(?:production|synthesis|booster|boosting|builder|building)",
  ),
  R("hair_growth", "body_function", "(?:restor|regrow|stimulat|promot|boost)[a-z]*_(?:(?:your|the|new)_)?hair_?(?:re)?growth|hair_regrowth"),
  R("cellulite", "body_function", "(?:reduc|remov|eliminat|dissolv|melt|banish|break|smooth)[a-z]*_(?:(?:your|the)_)?cellulite"),
  R("melanin", "body_function", "melanin_(?:production|synthesis)|(?:increas|decreas|reduc|block|inhibit|suppress|stop|lower|control|regulat)[a-z]*_(?:(?:the|your)_)?(?:production_of_)?melanin"),
  R("cell_renewal", "body_function", "cell(?:ular)?_(?:renewal|regeneration|turnover|repair|rejuvenation)"),
  R("dna", "body_function", "(?:repair|alter|change|protect|rewrite|reprogram)[a-z]*_(?:(?:your|the)_)?(?:dna|genes)"),
  R("detox", "body_function", "detox(?:es|ed|ing|ify|ifies|ified|ifying|ification)?"),
  R("immunity", "body_function", "(?:boost|strengthen|enhanc)[a-z]*_(?:(?:your|the)_)?immun[a-z]*"),
  R("penetrate", "body_function", "penetrat[a-z]*_(?:deep|deeply|deeper|into_the_dermis|the_dermis|below_the_skin|beneath_the_skin)"),
  R("varicose", "body_function", "varicose_veins"),
  R(
    "erase",
    "body_function",
    "(?:eras(?:e|es|ed|ing)|melt(?:s|ed|ing)?)_(?:away_)?(?:[a-z0-9']+_){0,2}(?:wrinkles?|lines|spots|pigmentation|scars?|acne|pimples?|blemish(?:es)?|marks|freckles|pores|redness|circles|bags|cellulite|fat|years|ageing|aging)",
  ),
  R(
    "procedure_like",
    "body_function",
    "(?:face_?lifts?|botox|fillers?|surgery|injectables?|injections?)_in_a_(?:bottle|jar|tube|pot|cream|serum)|(?:like|as_good_as|alternative_to|better_than|instead_of|replaces?|replacing)_(?:a_)?(?:botox|fillers?|surgery|face_?lifts?|injections?|injectables?)|needle_?free_(?:botox|fillers?|injections?|injectables?)|non_?surgical_(?:face_?lifts?|lifts?|botox|fillers?)",
  ),

  // approval and endorsement
  R(
    "authority_approved",
    "approval",
    "(?:fda|cdsco|ema|mhra|government|ministry|authority|authorities|regulator|regulators)_(?:approved|approval|cleared|certified|endorsed|registered|authori[sz]ed)",
  ),
  R("approved_by", "approval", "(?:approved|authori[sz]ed|certified|endorsed|accredited)_by"),
  R("recommended_by", "approval", "recommended_by_(?:(?:the|most|top|leading|many)_)?(?:doctors?|dermatologists?|experts?|professionals?|pharmacists?|physicians?|clinicians?|skin_experts?)"),
  R("expert_approved", "approval", "(?:dermatologists?|doctors?|physicians?|pharmacists?|clinicians?|experts?)_(?:approved|recommended|endorsed|certified|tested|backed|trusted|developed|formulated)"),
  R("dermatologically_tested", "approval", "dermatologically_(?:tested|approved|proven|certified)"),

  // proof and certainty beyond the evidence
  R("prove", "proof", "prov(?:e|es|ed|en|ing)"),
  R("proof", "proof", "proof"),
  R("guarantee", "proof", "guarantee[a-z]*"),
  R("clinically_proven", "proof", "(?:clinically|scientifically|medically|lab|laboratory)_(?:proven|tested|shown|validated|approved|demonstrated|backed)"),
  R("hundred_percent", "proof", "(?:100|hundred)_?(?:%|percent|per_cent)_?(?:effective|accurate|safe|natural|guaranteed|success|successful|results?|pure|reliable)"),
  R("fully_effective", "proof", "(?:completely|totally|fully|perfectly|absolutely)_(?:effective|accurate|reliable)"),
  R("always_works", "proof", "(?:always|definitely|certainly|surely)_works?|works?_(?:for_everyone|for_everybody|on_everyone|every_time)|never_fails?"),

  // safety beyond what anyone can promise
  R("absolutely_safe", "safety", "(?:completely|totally|perfectly|absolutely|entirely|fully|always|guaranteed)_safe"),
  R("safe_for_all", "safety", "safe_for_(?:all|everyone|everybody|every_skin|any_skin|all_skin)"),
  R("is_safe", "safety", "(?:it_is|it's|its|is|are|they're|they_are|that's|that_is|this_is)_safe"),
  R("no_side_effects", "safety", "no_(?:known_)?side_?effects?|side_?effects?_?free|without_(?:any_)?(?:the_)?side_?effects?"),
  R("risk_free", "safety", "risk_?free|no_risks?"),
  R("harmless", "safety", "harmless|non_?toxic"),
  R(
    "hypoallergenic",
    "safety",
    "hypo_?allergenic|non_?irritating|non_?irritant|(?:won't|will_not|never|doesn't|does_not|can't|cannot)_(?:ever_)?irritate|(?:zero|0)_irritation|irritation_?free|(?:causes?|caused)_no_irritation",
  ),

  // denigrating ingredients that are legally used
  R(
    "free_from",
    "denigration",
    "chemical_?free|free_(?:from|of)_(?:all_)?(?:chemicals|toxins|nasties|parabens|sulfates|sulphates|harmful_[a-z]+|toxic_[a-z]+)|(?:paraben|sulfate|sulphate|toxin)s?_?free",
  ),
  R("toxic_chemicals", "denigration", "toxic_(?:chemicals|ingredients|substances)|harmful_chemicals|nasties"),

  // magic
  R("miracle", "magic", "miracles?|miraculous(?:ly)?|magic(?:al|ally)?|wonder_(?:cream|serum|drug|product|ingredient|potion)|breakthroughs?|revolutionary|fountain_of_youth"),

  // permanence and instant results
  R("permanent", "permanence", "permanent(?:ly)?|forever|instant(?:ly|aneous|aneously)?|(?:immediate|overnight|lasting|lifelong)_results?"),
];

const COMPILED = RULES.map((r) => ({ ...r, re: new RegExp(`\\b(?:${r.pattern.replace(/_/g, "[ -]")})\\b`, "g") }));

/** Normalised text with, for each of its characters, the offset of the source character it came from. */
export interface Mapped {
  text: string;
  map: number[];
}

// characters by code point, so no invisible character sits in this file
const set = (...codes: number[]) => new Set(codes.map((c) => String.fromCharCode(c)));
const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** soft hyphen, zero-width space, non-joiner, joiner, word joiner, byte order mark */
const DROP = set(0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff);
/** ASCII white space, no-break space, Ogham space, en quad to hair space, line and paragraph separators, narrow
 *  no-break space, medium mathematical space, ideographic space */
const SPACE = set(0x20, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0xa0, 0x1680, ...span(0x2000, 0x200a), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000);
/** hyphen to horizontal bar, minus sign, small and full-width hyphen-minus */
const DASH = set(...span(0x2010, 0x2015), 0x2212, 0xfe58, 0xfe63, 0xff0d);
/** single curly quotes, reversed quote, prime, modifier apostrophe */
const QUOTE1 = set(0x2018, 0x2019, 0x201b, 0x2032, 0x02bc);
/** double curly quotes, reversed double quote, double prime */
const QUOTE2 = set(0x201c, 0x201d, 0x201f, 0x2033);

/** Lower case; every run of spaces (no-break and narrow ones too) as one space; dashes as "-"; curly quotes as straight
 *  ones; soft hyphens and zero-width characters dropped. `at[i]` is the source offset of input character i. */
export function normalise(input: string, at?: number[]): Mapped {
  let text = "";
  const map: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    const src = at ? at[i] : i;
    if (DROP.has(c)) continue;
    if (SPACE.has(c)) {
      if (!text.endsWith(" ")) {
        text += " ";
        map.push(src);
      }
      continue;
    }
    const out = DASH.has(c) ? "-" : QUOTE1.has(c) ? "'" : QUOTE2.has(c) ? '"' : c.toLowerCase();
    for (const o of out) {
      text += o;
      map.push(src);
    }
  }
  return { text, map };
}

export interface ClaimMatch {
  rule: string;
  category: Category;
  /** the matched words, normalised */
  match: string;
  /** source offsets of the first and last matched characters */
  from: number;
  to: number;
  /** where the match starts in the normalised text */
  index: number;
}

/** Every claim in already normalised text. */
export function claimsIn(m: Mapped): ClaimMatch[] {
  const out: ClaimMatch[] = [];
  for (const r of COMPILED) {
    r.re.lastIndex = 0;
    for (const x of m.text.matchAll(r.re)) {
      const i = x.index ?? 0;
      out.push({ rule: r.id, category: r.category, match: x[0], from: m.map[i], to: m.map[i + x[0].length - 1], index: i });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Every claim in plain text (the runtime screen checks use this on rendered text). */
export function findClaims(text: string): ClaimMatch[] {
  return claimsIn(normalise(text));
}
