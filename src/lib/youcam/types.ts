// YouCam Skin Analysis (S2S v2.0) shapes, as documented and as seen in saved responses (validation step S06).

/** SD concerns the app requests. HD and SD cannot be mixed in one task. */
export const SD_CONCERNS = [
  "acne",
  "age_spot",
  "pore",
  "texture",
  "wrinkle",
  "redness",
  "oiliness",
  "moisture",
  "radiance",
  "dark_circle_v2",
  "eye_bag",
  "tear_trough",
  "droopy_upper_eyelid",
  "droopy_lower_eyelid",
  "firmness",
  "skin_type",
] as const;
export type SdConcern = (typeof SD_CONCERNS)[number];

/** The concerns a trial measures per half-face (S06: masks that can be split by side). */
export const SPLIT_CONCERNS = ["acne", "age_spot", "pore", "texture", "wrinkle", "redness", "oiliness", "moisture", "radiance", "dark_circle_v2", "eye_bag"] as const;
export type SplitConcern = (typeof SPLIT_CONCERNS)[number];

/** Mask families from S06: counted points/lines, averaged maps, paired eye regions. */
export const MASK_FAMILY: Record<SplitConcern, "points" | "map" | "eyes"> = {
  acne: "points",
  age_spot: "points",
  pore: "points",
  texture: "points",
  wrinkle: "points",
  redness: "map",
  oiliness: "map",
  moisture: "map",
  radiance: "map",
  dark_circle_v2: "eyes",
  eye_bag: "eyes",
};

/** Units per SD analysis by number of concerns (docs, checked against the credit endpoint in S03/S06). */
export function sdUnits(nConcerns: number): number {
  if (nConcerns <= 4) return 9;
  if (nConcerns <= 8) return 12;
  if (nConcerns <= 12) return 14;
  return 16;
}

export interface RawOutputItem {
  type: string;
  region?: string;
  raw_score?: number;
  ui_score?: number;
  score?: number;
  skin_type?: string;
  mask_urls?: string[];
  url?: unknown;
}

export interface ConcernResult {
  /** raw_score, 1-100, higher = healthier. The only score used as a measurement. */
  raw: number;
  maskUrl?: string;
}

export interface ParsedAnalysis {
  concerns: Partial<Record<SdConcern, ConcernResult>>;
  skinType?: { whole?: string; t_zone?: string; u_zone?: string };
  /** Vendor summary numbers, kept for completeness and never shown as a measurement. */
  ignored: {
    ui_score: Partial<Record<string, number>>;
    overall_score?: number;
    skin_age?: number;
  };
  /** The analysed (resized) image the masks align to. */
  resizeImageUrl?: string;
  unknownTypes: string[];
}
