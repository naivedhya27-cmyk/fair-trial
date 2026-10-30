"use client";
// The judges' code on this browser (S21): kept by /judges, sent with live analysis and status checks so judges may use
// the units kept for judging (src/lib/youcam/judge.ts). It is a setting like the voice: "Delete everything" removes it.

const KEY = "fairtrial.judge";
export const JUDGE_HEADER = "x-fairtrial-judge";
/** What a code looks like: letters and digits, 16 to 64 of them. */
export const CODE_SHAPE = /^[A-Za-z0-9]{16,64}$/;

export function judgeCode(): string | null {
  try {
    const c = localStorage.getItem(KEY);
    return c && CODE_SHAPE.test(c) ? c : null;
  } catch {
    return null;
  }
}

export function keepJudgeCode(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* storage blocked: judge access lasts for this page only */
  }
}

export function forgetJudgeCode(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing kept */
  }
}

/** The header that carries the code, or none. */
export function judgeHeaders(code = judgeCode()): Record<string, string> {
  return code ? { [JUDGE_HEADER]: code } : {};
}
