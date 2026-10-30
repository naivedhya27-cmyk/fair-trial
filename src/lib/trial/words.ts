// Plain words for the trial screens (S16). Kept free of medical-claim words (the S13 claim list is checked on every
// screen by the S16 audit), so the halves are the "product side" and the "bare side".
import type { NoTrialReason } from "../planner/plan";
import type { Verdict } from "../stats/verdict";

export const GOAL_WORDS: Record<string, string> = {
  wrinkle: "fine lines and wrinkles",
  texture: "skin texture",
  age_spot: "dark spots",
  oiliness: "oiliness",
  redness: "redness",
  moisture: "dryness",
  acne: "spots and breakouts",
  pore: "pores",
  radiance: "dullness",
};

export const NO_TRIAL_WORDS: Record<NoTrialReason, string> = {
  split_face_unsafe:
    "This product protects skin from the sun. Using it on half your face would leave the other half unprotected, so Fair Trial won't test it. Keep using sunscreen on your whole face.",
  not_measurable:
    "The evidence for this product is about something photos can't yet compare reliably between the two halves of a face, such as breakouts or pores. Fair Trial won't give you a verdict it can't back up.",
  no_evidence: "None of the trials behind this product's ingredients measured that. Choose one of the goals the evidence covers.",
};

export const VERDICT_WORDS: Record<Verdict, { title: string; body: (weeks: { verdict: number; adjust: number | null }) => string }> = {
  working: {
    title: "Working",
    body: () => "The product side changed for the better, more than the bare side, by more than your own day-to-day noise.",
  },
  not_yet: {
    title: "Not yet",
    body: (w) => `Trials judge this at week ${w.verdict}. Nothing has gone wrong; keep going.`,
  },
  no_effect: {
    title: "No measurable effect",
    body: () => "At the week trials say to look, the two sides differ by less than your own day-to-day noise. The product may still do something too small for photos to see.",
  },
  stop: {
    title: "Stop and check",
    body: () => "The product side looks worse than the bare side, beyond your noise. Stop using the product. If your skin hasn't settled in a few days, see a pharmacist or doctor.",
  },
  adjusting: {
    title: "Expected adjustment",
    body: (w) => `The product side looks worse, inside the early-irritation window the trials describe (up to week ${w.adjust}). Keep going unless it stings, burns or swells; then stop.`,
  },
  cant_tell: {
    title: "Can't tell",
    body: () => "There isn't enough usable data at this check-in to compare the two sides.",
  },
};

export const STOP_WORDS = {
  user: "You stopped this trial.",
  stop: "The trial stopped because the product side looked worse than the bare side.",
  headroom: "The trial stopped because there was no room to show an improvement on that goal.",
};

/** What the trial page says about photos still waiting for their analysis, by the last refusal. */
export const RETRY_WORDS: Record<"limit" | "paused" | "rejected" | "unreachable" | "timeout", string> = {
  limit: "Today's analyses from this phone are used up. Your photos are saved; try again tomorrow.",
  paused: "Live analysis is paused for now. Your photos are saved; try again later.",
  rejected: "YouCam couldn't read one photo, so it won't count. The other photos still do.",
  unreachable: "YouCam couldn't be reached. Your photos are saved; try again in a moment.",
  timeout: "The last analysis took too long. Your photos are saved; try again.",
};

/** What a person reads when a photo's analysis can't run; the photo itself is always kept. */
export const ANALYSIS_WORDS: Record<"limit" | "paused" | "rejected" | "unreachable" | "timeout", string> = {
  limit: "Today's analyses from this phone are used up. Your photo is saved; analyse it tomorrow from your trial page.",
  paused: "Live analysis is paused for now. Your photo is saved; analyse it later from your trial page.",
  rejected: "YouCam couldn't read this photo, so it won't count. The other photos still do.",
  unreachable: "YouCam couldn't be reached. Your photo is saved; try again in a moment from your trial page.",
  timeout: "The analysis took too long. Your photo is saved; try again later from your trial page.",
};
