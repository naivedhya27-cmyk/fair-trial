import "server-only";
// The judges' code (S21): judges get it in the entry's testing instructions and open /judges#<code> once; the page keeps
// it on that browser and sends it with every live analysis (src/lib/judge.ts). With it, live analysis may spend down to
// the unit floor; without it, it stops at the public floor, so visitors cannot use up what is kept for judging.
import { timingSafeEqual } from "node:crypto";

export const JUDGE_HEADER = "x-fairtrial-judge";

/** True when the request carries the judges' code (YOUCAM_JUDGE_CODE, at least 16 characters), compared in constant
 * time. Without a code configured, nobody is a judge. */
export function isJudge(req: Request): boolean {
  const want = process.env.YOUCAM_JUDGE_CODE ?? "";
  const got = req.headers.get(JUDGE_HEADER) ?? "";
  if (want.length < 16 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
