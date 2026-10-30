// Scope and safety guard (validation step S13). Runs before the planner and decides whether a trial may start:
// proceed, warn (start, with a note), refuse (out of scope) or refer (a doctor or pharmacist first). Every message is
// fixed text, checked for medical claims. The guard never reads free text about health: the person answers set
// questions, and only the product name and ingredient text are read.
import { detect, normalise, type Detected } from "../planner/inci";

export type ProductType = "face_leave_on" | "face_rinse_off" | "makeup_remover" | "hair" | "lip" | "body" | "makeup" | "other";
export type Pregnancy = "no" | "pregnant" | "trying" | "breastfeeding";
export interface Person {
  age: number | null;
  /** null = not answered, treated like "pregnant" for retinoids */
  pregnancy: Pregnancy | null;
  /** a spot or mole that is new, changing, bleeding, itching or not healing; deep painful lumps; a spreading rash,
   * swelling, pus or fever */
  redFlags: boolean;
  /** a doctor is looking after a skin condition on the face */
  underCare: boolean;
  /** uses a prescription medicine on the face now */
  prescription: boolean;
  /** a doctor or pharmacist gave them this product as a medicine (added after S13b: text alone misses new drugs) */
  medicineProduct?: boolean;
}
export interface Product {
  name: string;
  type: ProductType | null;
  ingredients: string;
}
export type Action = "proceed" | "warn" | "refuse" | "refer";
export type Rule =
  | "age_missing"
  | "under_18"
  | "see_doctor"
  | "under_care"
  | "on_prescription"
  | "medicine_product"
  | "pregnancy_retinoid"
  | "breastfeeding_retinoid"
  | "product_type"
  | "not_a_list"
  | "medicine"
  | "strength"
  | "sun_sensitivity"
  | "type_mismatch";
export interface Finding {
  rule: Rule;
  action: Action;
  message: string;
}
export interface GuardResult {
  action: Action;
  /** strongest first */
  findings: Finding[];
  actives: Detected[];
}

export const RULE_ACTION: Record<Rule, Action> = {
  age_missing: "refuse",
  under_18: "refuse",
  see_doctor: "refer",
  under_care: "refer",
  on_prescription: "refer",
  medicine_product: "refer",
  pregnancy_retinoid: "refuse",
  breastfeeding_retinoid: "warn",
  product_type: "refuse",
  not_a_list: "refuse",
  medicine: "refer",
  strength: "refer",
  sun_sensitivity: "warn",
  type_mismatch: "warn",
};
const SEVERITY: Record<Action, number> = { proceed: 0, warn: 1, refuse: 2, refer: 3 };

export const MESSAGES: Record<Rule, string> = {
  age_missing: "Please tell us your age to start a trial.",
  under_18: "Fair Trial is for adults. If you're under 18, a parent, pharmacist or doctor can help you choose skincare.",
  see_doctor: "Please show that spot or skin change to a doctor before trying new products on it. Fair Trial won't start a trial on skin that needs a doctor's look.",
  under_care: "A doctor is looking after your skin, so ask them before adding a new product. Fair Trial won't run alongside that care.",
  on_prescription: "You're using a prescription medicine on your face. Ask the doctor who prescribed it before adding a new product.",
  medicine_product: "A doctor or pharmacist gave you this as a medicine, so use it as they advised. Fair Trial doesn't test medicines.",
  pregnancy_retinoid: "This product contains a retinoid, and retinoids aren't advised during pregnancy or when trying to conceive. Choose a product without one, or ask your doctor.",
  breastfeeding_retinoid: "This product contains a retinoid. Check with your doctor before using it while breastfeeding.",
  product_type: "Fair Trial tests leave-on face products: creams, lotions, serums, gels, oils, mists and toners.",
  not_a_list: "That doesn't look like an ingredient list. Please type or scan the ingredients from the back of the pack.",
  medicine: "This looks like a medicine rather than a cosmetic. Use it only as your doctor or pharmacist advised; Fair Trial doesn't test medicines.",
  strength: "At this strength it's a peel or a pharmacy product, not everyday skincare. Please ask a dermatologist before using it.",
  sun_sensitivity: "This product can make skin more sensitive to the sun. Use sunscreen on your whole face every morning during the trial.",
  type_mismatch: "This list looks like a cleanser, a hair product or a spray. Please check that it's a leave-on face product.",
};

// --- the product's text ---

/** Medicines that are never cosmetic ingredients: corticosteroids, prescription retinoids, depigmenting drugs,
 * antibiotics, antifungals, antivirals, immunomodulators, anaesthetics, antihistamines, antiparasitics, hormones. */
const MEDICINE_NAME = new RegExp(
  [
    "hydrocortisone|cortisone|betamethasone|clobetasol|halobetasol|mometasone|fluticasone|fluocinolone|fluocinonide",
    "triamcinolone|desonide|desoximetasone|diflorasone|alclometasone|amcinonide|halcinonide|flurandrenolide|clocortolone",
    "prednicarbate|prednisolone|dexamethasone|beclomethasone|budesonide|fluorometholone",
    "tretinoin|isotretinoin|tazarotene|trifarotene|adapalene|alitretinoin|bexarotene",
    "hydroquinone|monobenzone|mequinol",
    "clindamycin|erythromycin|gentamicin|neomycin|mupirocin|fusidic|fusidate|bacitracin|polymyxin|retapamulin|ozenoxacin",
    "metronidazole|ornidazole|nadifloxacin|ofloxacin|minocycline|doxycycline|tetracycline|sulfacetamide|sulfadiazine",
    "chloramphenicol|framycetin|mafenide|nitrofurazone|silver nitrate",
    "[a-z]*conazole|clotrimazole|miconazole|econazole|terbinafine|naftifine|butenafine|ciclopirox|tolnaftate|nystatin",
    "tavaborole|amorolfine|griseofulvin|undecylenic",
    "acyclovir|aciclovir|penciclovir|docosanol",
    "tacrolimus|pimecrolimus|crisaborole|ruxolitinib|tapinarof|roflumilast|imiquimod|fluorouracil|ingenol|podofilox",
    "podophyll|cantharidin|calcipotriene|calcipotriol|calcitriol|anthralin|dithranol|coal tar|methoxsalen|tirbanibulin",
    "diclofenac|cyclosporin|ciclosporin|ivermectin|brimonidine|oxymetazoline|phenylephrine",
    "lidocaine|lignocaine|benzocaine|prilocaine|tetracaine|pramoxine|pramocaine|dibucaine|dyclonine",
    "diphenhydramine|doxepin|permethrin|lindane|malathion|spinosad|crotamiton",
    "estradiol|estriol|testosterone|progesterone|finasteride|minoxidil|eflornithine",
    "heparin|mucopolysaccharide polysulfate|collagenase|becaplermin|capsaicin|methyl salicylate|trolamine salicylate",
    "carbamide peroxide|benzalkonium chloride 0|povidone-iodine|chlorhexidine gluconate [0-9]|cocaine|histamine",
    "nitroglycerin|selenium sulfide|sinecatechins|fibrinogen|thrombin",
  ].join("|"),
);
/** Words a cosmetic list never carries: drug classes, homeopathy, pharmacy dosing ("each mL contains", "mg/g"),
 * routes other than the skin, and conditions that need a doctor or pharmacist (in the product name or text). */
const MEDICINE_WORDS =
  /corticosteroid|steroid|antifungal|antibiotic|antibacterial agent|antiviral|anesthetic|anaesthetic|analgesic|nsaid|anti-inflammatory drug|keratolytic|immunosuppress|calcineurin|antipruritic|antiseptic|virucid|bactericid|fungicid|germicid|homeopathic|(^|[^a-z])h\.?p\.?u\.?s\.?([^a-z]|$)|dermatologic(al)? use|topical (administration|use only)|ophthalmic|(^|[^a-z])nasal([^a-z]|$)|vaginal|rectal|(^|[^a-z])otic([^a-z]|$)|ear drops|(^|[^a-z])each [a-z0-9. ]{0,20}?(ml|gram|grams|g|gm|inch|patch)([^a-z](?:[^.]|\.(?=\d)){0,80}?)?contains|\d+(\.\d+)? ?mg ?(\/|per) ?(\d+ ?)?(ml|g|gram)([^a-z]|$)|\d+(\.\d+)? ?(mg|mcg|units?|iu) of [a-z]|drug (product|substance)|(is|as) the active ingredient|(^|[^a-z])pka([^a-z]|$)|in an? ([a-z-]+ ){0,3}base (of|consisting|containing)|vehicle consisting|for topical use([^a-z]|$)|(^|[^a-z])moles?([^a-z]|$)|skin tags?|(^|[^a-z])joints?([^a-z]|$)|arthritis|psoria|(^|[^a-z])warts?([^a-z]|$)|fung(al|us)|jock itch|ringworm|athlete s foot|cold sore|fever blister|herpes|pain relie|(^|[^a-z])pain([^a-z]|$)|ingrown|(^|[^a-z])lice([^a-z]|$)|scabies|cramp/;

/** Actives allowed in a Drug Facts "Active ingredient" section: sunscreen filters, acne actives, skin protectants,
 * witch hazel, the evidence table's cosmetic actives (not prescription retinoids) and adenosine. */
const ALLOWED_ACTIVE = new RegExp(
  [
    "avobenzone|butyl methoxydibenzoylmethane|cinoxate|dioxybenzone|ensulizole|phenylbenzimidazole sulfonic acid|homosalate",
    "meradimate|menthyl anthranilate|octinoxate|(ethylhexyl|octyl) methoxycinnamate|octisalate|(ethylhexyl|octyl) salicylate",
    "octocrylene|oxybenzone|benzophenone-[34]|padimate o|sulisobenzone|titanium dioxide|zinc oxide|ecamsule|bemotrizinol",
    "bisoctrizole|bis-ethylhexyloxyphenol methoxyphenyl triazine|methylene bis-benzotriazolyl tetramethylbutylphenol",
    "diethylamino hydroxybenzoyl hexyl benzoate|ethylhexyl triazone|iscotrizinol|diethylhexyl butamido triazone",
    "drometrizole trisiloxane|terephthalylidene dicamphor sulfonic acid|tris-biphenyl triazine|polysilicone-15",
    "benzoyl peroxide|salicylic acid|sulfur|sulphur|resorcinol monoacetate|resorcinol",
    "allantoin|cocoa butter|theobroma cacao|colloidal oatmeal|oatmeal|avena sativa|dimethicone|glycerin|hard fat|kaolin",
    "lanolin|mineral oil|white petrolatum|petrolatum|shark liver oil|topical starch|corn starch|zinc acetate|zinc carbonate",
    "sodium bicarbonate|witch hazel|hamamelis virginiana",
    "retinol|retinal|retinaldehyde|retinyl [a-z]+|hydroxypinacolone retinoate|niacinamide|nicotinamide|ascorbic acid",
    "ascorbyl [a-z]+|[a-z]+ ascorbyl phosphate|ethyl ascorbic acid|tetrahexyldecyl ascorbate|glycolic acid|lactic acid",
    "mandelic acid|hyaluronic acid|sodium hyaluronate|hyaluronan|tranexamic acid|alpha-arbutin|arbutin|kojic acid",
    "centella asiatica( [a-z]+)?|madecassoside|asiaticoside|bakuchiol|[a-z]* ?peptide-[0-9]+|tea tree oil",
    "melaleuca alternifolia( [a-z]+)?|azelaic acid|adenosine",
  ].join("|"),
  "g",
);
/** Purposes, grades, forms, units and filler: what may be left of an active section once the allowed actives are
 * taken out, without being a medicine. */
// claim-lint-disable -- words read off Drug Facts labels and stripped before judging the rest; never shown to anyone
const FILLER_WORDS = [
  "drug facts",
  "active ingredients",
  "active ingredient",
  "purposes",
  "purpose",
  "sunscreen",
  "skin protectant",
  "protectant",
  "acne treatment",
  "acne medication",
  "acne medicine",
  "acne",
  "treatment",
  "astringent",
  "broad spectrum",
  "uva",
  "uvb",
  "spf",
  "each",
  "grams",
  "gram",
  "ml",
  "mg",
  "contains",
  "contain",
  "in",
  "of",
  "per",
  "w/w",
  "w/v",
  "v/v",
  "total",
  "usp",
  "nf",
  "bp",
  "ip",
  "anhydrous",
  "micronized",
  "non-nano",
  "nano",
  "coated",
  "uncoated",
  "white",
  "purified",
  "stabilized",
  "equivalent",
  "to",
  "as",
  "from",
  "with",
  "and",
  "the",
  "form",
  "unspecified",
  "by",
  "weight",
  "blemish",
  "pimples",
  "pimple",
  "helps",
  "prevents",
  "prevent",
  "reduces",
  "reduce",
  "clears",
  "clear",
  "decreases",
  "decrease",
  "sunburn",
  "skin",
  "protection",
  "moisturizer",
  "moisturiser",
  "dry",
  "chapped",
  "lips",
  "lip",
  "aids",
  "aid",
  "temporarily",
  "protects",
  "relieves",
  "relieve",
  "minor",
  "irritation",
  "oil",
  "top",
  "water",
  "distillate",
  "extract",
  "leaf",
  "plant",
  "whole",
  "root",
  "section",
  "carton",
  "label",
  "panel",
  "box",
  "principal",
  "display",
  "front",
  "back",
];
// claim-lint-enable
const FILLER = new RegExp(`(^|[^a-z])(${FILLER_WORDS.join("|")})(?=[^a-z]|$)`, "g");
const STRENGTH: { re: RegExp; max: number }[] = [
  { re: /salicylic acid|(^|[^a-z])bha([^a-z]|$)/, max: 2 },
  { re: /benzoyl peroxide/, max: 10 },
  { re: /(^|[^a-z])(sulfur|sulphur)([^a-z]|$)/, max: 10 },
  { re: /(^|[^a-z])resorcinol([^a-z]|$)/, max: 2 },
  { re: /glycolic acid|(^|[^a-z])lactic acid|mandelic acid|ammonium lactate|(^|[^a-z])ahas?([^a-z]|$)/, max: 10 },
  { re: /azelaic acid/, max: 10 },
  { re: /(^|[^a-z])urea([^a-z]|$)/, max: 10 },
];
const PEEL = /trichloroacetic|(^|[^a-z])tca([^a-z]|$)|jessner|phenol peel/;
/** Words that make a list: base ingredients nearly every cosmetic list carries. */
const LIST_WORD =
  /^(aqua|water|eau|glycer\w*|\w*glycol|\w*dimethicon\w*|\w*methicone|\w*siloxane|alcohol|acid|extract|oil|butter|\w*stearate|sodium|potassium|cetearyl|cetyl|stearyl|behenyl|phenoxyethanol|parfum|fragrance|tocopher\w*|xanthan|carbomer|triglyceride|glyceryl|peg-\d+|polysorbate|hydroxide|citrate|benzoate|sorbate|edta|silica|mica|wax|paraffin\w*|petrolatum|lanolin|squalane|panthenol|allantoin|niacinamide|hyaluron\w*|ceramide|caprylyl|\w*hexanediol|propanediol|butylene|pentylene|ethylhexyl\w*|isopropyl|myristate|palmitate|\w*olivate|copolymer|crosspolymer|gum|leaf|seed|root|flower|juice|powder|zinc|titanium|oxide|chloride|lactate|urea|betaine|caffeine|cellulose|starch|ester|esters|laureth|sulfate|glucoside|kernel|fruit|emulsifying|carbonate|phosphate|chlorphenesin|ethylhexylglycerin|disodium|tetrasodium|trisodium|lecithin|dimethiconol|cyclopentasiloxane|isododecane|talc|kaolin|caprylic|capric|stearic|cetyl|lauryl|coco\w*|polyquaternium-\d+|dipropylene|benzyl|limonene|linalool|citronellol|geraniol|hexyl|cinnamal)$/;
/** Ingredients that make a list a rinse-off, hair or spray product when they sit among the first five. */
const TYPE_SIGNAL =
  /sodium laureth sulfate|sodium lauryl sulfate|ammonium lauryl sulfate|cocamidopropyl (betaine|hydroxysultaine)|coco-glucoside|decyl glucoside|lauryl glucoside|sodium cocoyl (isethionate|glutamate|glycinate)|sodium lauroyl (sarcosinate|methyl isethionate)|disodium laureth sulfosuccinate|sodium c14-16 olefin sulfonate|potassium cocoate|sodium (cocoate|palmate|tallowate)|hydrogen peroxide|behentrimonium|cetrimonium|amodimethicone|p-phenylenediamine|toluene-2,5-diamine|ammonium hydroxide|(^|[^a-z])(butane|propane|isobutane)(?![a-z0-9-])/;

/** Strengths stated for a name, either way round: "salicylic acid 2%" or "15% (w/w) azelaic acid". */
function percents(text: string, name: RegExp): number[] {
  const n = `(?:${name.source})`;
  const v = "(?<v>\\d+(?:[.,]\\d+)?)";
  const out: number[] = [];
  // name first may take one comma straight before the number ("ammonium lactate cream, 12%")
  for (const re of [`${n}[^0-9%,;]{0,15}?(?:,\\s*)?${v}\\s*%`, `${v}\\s*%[^0-9%,;]{0,15}?${n}`]) for (const m of text.matchAll(new RegExp(re, "g"))) out.push(Number(m.groups!.v.replace(",", ".")));
  return out;
}

/** The Drug Facts active section: after an "active ingredient(s)" header (misspelt or broken by OCR too), up to the
 * next header, or to where an inactive list without a header begins (the first item with no number). */
function activeSection(t: string): string | null {
  const m = t.match(/(?<![a-z])a ?ctive ?ingre[a-z]*(.*?)(?=(?<![a-z])(inactive ?ingre[a-z]*|other information|warnings?|directions|uses|questions)(?![a-z])|$)/);
  if (!m) return null;
  const items = m[1].split(/,|;/);
  const end = items.findIndex((s, i) => i > 0 && !/\d/.test(s));
  return (end < 0 ? items : items.slice(0, end)).join(",");
}

// a bracket after an active gives its synonym or form ("sodium bicarbonate (baking soda)"), so brackets are dropped
const leftover = (s: string) =>
  s
    .replace(/\([^()]*\)/g, " ")
    .replace(ALLOWED_ACTIVE, " ")
    .replace(/[0-9.,;:%()\-* ]+/g, " ")
    .replace(FILLER, " ")
    .split(/\s+/)
    .filter((w) => /^[a-z]{3,}$/.test(w));

export function productFindings(product: Product): { rules: Rule[]; actives: Detected[] } {
  const name = normalise(product.name ?? "");
  const text = normalise(product.ingredients ?? "");
  const both = `${name} , ${text}`;
  const actives = detect(product.ingredients ?? "");
  const rules = new Set<Rule>();
  if (product.type !== "face_leave_on") rules.add("product_type");
  const words = new Set(text.split(/[^a-z0-9-]+/).filter((w) => LIST_WORD.test(w)));
  if (words.size < 3) rules.add("not_a_list");

  const section = activeSection(text);
  if (MEDICINE_NAME.test(both) || MEDICINE_WORDS.test(both)) rules.add("medicine");
  if (section != null && leftover(section).length) rules.add("medicine");

  if (PEEL.test(both) || STRENGTH.some((s) => percents(both, s.re).some((p) => p > s.max))) rules.add("strength");
  const fam = new Set(actives.map((a) => a.family));
  // retinoids always; an AHA only above the 1% line (a trace of lactic acid as a pH adjuster is not an AHA product)
  if (fam.has("RET") || actives.some((a) => a.family === "AHA" && !a.belowOnePercent)) rules.add("sun_sensitivity");
  // the first five ingredients; a list with no separators, or run-on items, gives its first 15 words instead
  const items = text.split(/,|;/);
  const listed = items.length >= 5 && items.slice(0, 5).every((s) => s.length <= 80);
  const first = listed ? items.slice(0, 5).join(",") : text.split(" ").slice(0, 15).join(" ");
  if (TYPE_SIGNAL.test(first)) rules.add("type_mismatch");
  return { rules: [...rules], actives };
}

export function guard(person: Person, product: Product): GuardResult {
  const { rules: found, actives } = productFindings(product);
  const rules = new Set<Rule>(found);
  if (person.age == null || !Number.isFinite(person.age)) rules.add("age_missing");
  else if (person.age < 18) rules.add("under_18");
  if (person.redFlags) rules.add("see_doctor");
  if (person.underCare) rules.add("under_care");
  if (person.prescription) rules.add("on_prescription");
  if (person.medicineProduct) rules.add("medicine_product");
  if (actives.some((a) => a.family === "RET")) {
    if (person.pregnancy == null || person.pregnancy === "pregnant" || person.pregnancy === "trying") rules.add("pregnancy_retinoid");
    else if (person.pregnancy === "breastfeeding") rules.add("breastfeeding_retinoid");
  }
  const findings = [...rules].map((rule) => ({ rule, action: RULE_ACTION[rule], message: MESSAGES[rule] })).sort((a, b) => SEVERITY[b.action] - SEVERITY[a.action]);
  return { action: findings[0]?.action ?? "proceed", findings, actives };
}
