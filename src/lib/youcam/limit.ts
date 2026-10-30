import "server-only";
// Per-visitor limit on paid calls, so one visitor cannot spend the judges' units. In memory: each server instance
// counts on its own, which is enough with the unit floor behind it.

const WINDOW_MS = 24 * 60 * 60 * 1000;
const hits = new Map<string, number[]>();

/** Visitor key from the proxy headers (Vercel sets x-forwarded-for); "local" when there is none. */
export function visitor(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "local";
}

/** Paid calls per visitor per 24 hours (YOUCAM_DAILY_LIMIT, default 6; a value that is not a number counts as 6). */
export function dailyLimit(): number {
  const n = Number(process.env.YOUCAM_DAILY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? n : 6;
}

/** Paid calls per judge per 24 hours (YOUCAM_JUDGE_DAILY_LIMIT, default 8), for requests with the judges' code (S21). */
export function judgeDailyLimit(): number {
  const n = Number(process.env.YOUCAM_JUDGE_DAILY_LIMIT);
  return process.env.YOUCAM_JUDGE_DAILY_LIMIT && Number.isFinite(n) && n >= 0 ? n : 8;
}

/** Count one paid call for this visitor; false when the visitor has used `max` in the last 24 hours. */
export function take(who: string, max = dailyLimit()): boolean {
  const now = Date.now();
  const recent = (hits.get(who) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    hits.set(who, recent);
    return false;
  }
  recent.push(now);
  hits.set(who, recent);
  return true;
}

/** Give back the visitor's latest call when it spent no units (refused for the floor, or YouCam did not start it). */
export function refund(who: string): void {
  hits.get(who)?.pop();
}
