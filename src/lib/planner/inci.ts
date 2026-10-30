// Active detection in an ingredient list (validation step S12). The families are the evidence table's actives (S04);
// the names each family covers follow the S12 coding rules (work/s12/CODING_RULES.md), so "salicylate" UV filters are
// not salicylic acid, "TEA" (triethanolamine) is not tea tree, and zinc oxide or titanium dioxide count as sunscreen
// only when the text sells sun protection.

/** In evidence-table order (the order of each family's first row); ties in list position follow this order. */
export const FAMILIES = ["RET", "BPO", "SAL", "AZE", "NIA", "VITC", "AHA", "HA", "SUN", "TXA", "ARB", "CICA", "BAK", "PEP", "TEA"] as const;
export type Family = (typeof FAMILIES)[number];

export const FAMILY_NAME: Record<Family, string> = {
  RET: "Retinoid",
  BPO: "Benzoyl peroxide",
  SAL: "Salicylic acid",
  AZE: "Azelaic acid",
  NIA: "Niacinamide",
  VITC: "Vitamin C",
  AHA: "Alpha hydroxy acid",
  HA: "Hyaluronic acid",
  SUN: "Sunscreen filters",
  TXA: "Tranexamic acid",
  ARB: "Arbutin or kojic acid",
  CICA: "Centella (cica)",
  BAK: "Bakuchiol",
  PEP: "Peptides",
  TEA: "Tea tree oil",
};

const PATTERNS: Record<Family, RegExp> = {
  RET: /retinol|retnol|retinal|retinyl|retinoyl|hydroxypinacolone retinoate|granactive retinoid|adapalene|tretinoin|tazarotene|trifarotene|vitamin a(?![a-z])/,
  BPO: /benzoyl peroxide/,
  SAL: /(^|[^a-z])salicylic acid|betaine salicylate|willow\)? bark|salix (alba|nigra)[a-z ()]*bark/,
  AZE: /azelaic acid|azeloyl diglycinate/,
  NIA: /niacinamide|nicotinamide/,
  VITC: /ascorbic acid|ascorbyl|ascorbate|ethyl ascorbic|vitamin[- ]?c(?![a-z])/,
  AHA: /glycolic acid|(^|[^a-z])lactic acid|mandelic acid|alpha[- ]hydroxy/,
  HA: /hyaluron/,
  SUN: /avobenzone|butyl methoxydibenzoylmethane|octocrylene|homosalate|octisalate|ethylhexyl salicylate|octinoxate|(ethylhexyl|octyl) methoxycinnamate|benzophenone-3|oxybenzone|ethylhexyl triazone|bemotrizinol|methoxyphenyl triazine|diethylamino hydroxybenzoyl|phenylbenzimidazole sulfonic|terephthalylidene dicamphor|polysilicone-15|drometrizole trisiloxane|tetramethylbutylphenol|tris-biphenyl triazine|butamido triazone|isoamyl p-methoxycinnamate|methylbenzylidene camphor|dimethyl paba/,
  TXA: /tranexamic/,
  ARB: /arbutin|kojic/,
  CICA: /centella|madecassoside|asiaticoside|asiatic acid|madecassic acid|(^|[^a-z])cica([^a-z]|$)/,
  BAK: /bakuchiol/,
  PEP: /peptide-\d+|copper tripeptide|matrixyl|argireline/,
  TEA: /melaleuca alternifolia|tea tree/,
};
const MINERAL = /zinc oxide|titanium dioxide|titanium oxide/;
const SUN_CLAIM = /(^|[^a-z])(spf|lsf)([^a-z]|$)|sunscreen|sunblock|sun filter|uv filter/;
/** Ingredients used at 1% or less; actives listed after the first of them are probably below 1%. */
const ONE_PERCENT =
  /^(phenoxyethanol|parfum|fragrance|perfume|sodium benzoate|potassium sorbate|ethylhexylglycerin|chlorphenesin|benzyl alcohol|caprylyl glycol|dehydroacetic acid|methylparaben|xanthan gum|disodium edta|tetrasodium edta)/;

/** Characters that separate ingredients (line breaks, bullets, middle dot, en and em dash, ideographic and fullwidth
 * comma and semicolon; the last three added in S13) or join them. */
const SEPARATOR = new Set([0x0a, 0x0d, 0x2022, 0x00b7, 0x2013, 0x2014, 0x25cf, 0x3001, 0xff0c, 0xff1b]);
const HYPHEN = new Set([0x2010, 0x2011, 0x2212]);

export interface Detected {
  family: Family;
  /** the ingredient that names the family, normalised */
  ingredient: string;
  /** position in the list, 0 = first */
  position: number;
  /** listed after a 1% marker (preservative, fragrance, gum), so probably under 1% */
  belowOnePercent: boolean;
}

/** Lower case, accents removed, separators turned into commas, anything else odd into spaces, spaces collapsed. */
export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^ -~]/g, (c) => (SEPARATOR.has(c.charCodeAt(0)) ? "," : HYPHEN.has(c.charCodeAt(0)) ? "-" : " "))
    .replace(/[^a-z0-9%+.,;:/&()\- ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split into ingredients at commas, semicolons, spaced dashes and full stops that end a word. */
export function ingredients(text: string): string[] {
  return normalise(text)
    .split(/,|;| - |\.(?= |$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function detect(text: string): Detected[] {
  const list = ingredients(text);
  const all = normalise(text);
  const marker = list.findIndex((s) => ONE_PERCENT.test(s));
  // first ingredient naming the pattern; a name broken across a split still counts, placed last
  const at = (re: RegExp) => {
    const i = list.findIndex((s) => re.test(s));
    return i >= 0 ? i : re.test(all) ? list.length : -1;
  };
  const out: Detected[] = [];
  for (const family of FAMILIES) {
    let position = at(PATTERNS[family]);
    if (family === "SUN" && position < 0 && SUN_CLAIM.test(all)) position = at(MINERAL);
    if (position < 0) continue;
    out.push({ family, ingredient: list[position] ?? "", position, belowOnePercent: marker >= 0 && position > marker });
  }
  return out.sort((a, b) => a.position - b.position || FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family));
}
