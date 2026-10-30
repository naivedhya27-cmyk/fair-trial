import { SD_CONCERNS, type ParsedAnalysis, type RawOutputItem, type SdConcern } from "./types";

const KNOWN = new Set<string>(SD_CONCERNS);

/**
 * Read every field of a Skin Analysis `results.output` array (S06 bar: 100% of fields).
 * raw_score becomes the measurement; ui_score, the overall score and skin age go to `ignored`.
 */
export function parseAnalysis(output: RawOutputItem[]): ParsedAnalysis {
  const parsed: ParsedAnalysis = { concerns: {}, ignored: { ui_score: {} }, unknownTypes: [] };
  for (const item of output) {
    const type = item.type;
    if (type === "all") {
      parsed.ignored.overall_score = item.score;
      continue;
    }
    if (type === "skin_age") {
      parsed.ignored.skin_age = item.score;
      continue;
    }
    if (type === "resize_image") {
      parsed.resizeImageUrl = item.mask_urls?.[0];
      continue;
    }
    if (type === "skin_type") {
      const region = (item.region ?? "whole") as "whole" | "t_zone" | "u_zone";
      parsed.skinType = { ...parsed.skinType, [region]: item.skin_type };
      if (region === "whole" && item.mask_urls?.[0]) {
        parsed.concerns.skin_type = { raw: Number.NaN, maskUrl: item.mask_urls[0] };
      }
      continue;
    }
    if (!KNOWN.has(type)) {
      parsed.unknownTypes.push(type);
      continue;
    }
    if (typeof item.raw_score !== "number" || !Number.isFinite(item.raw_score)) {
      throw new Error(`Skin Analysis returned ${type} without a numeric raw_score`);
    }
    parsed.concerns[type as SdConcern] = { raw: item.raw_score, maskUrl: item.mask_urls?.[0] };
    if (typeof item.ui_score === "number") parsed.ignored.ui_score[type] = item.ui_score;
  }
  return parsed;
}

/** Pull `data.results.output` out of a task-status response, or explain why it is missing. */
export function outputOf(body: unknown): RawOutputItem[] {
  const b = body as { data?: { task_status?: string; error?: unknown; results?: { output?: RawOutputItem[] } } };
  const status = b?.data?.task_status;
  if (status !== "success") throw new Error(`Skin Analysis task is ${status ?? "unknown"}`);
  const out = b.data?.results?.output;
  if (!Array.isArray(out)) throw new Error("Skin Analysis succeeded without an output array");
  return out;
}
