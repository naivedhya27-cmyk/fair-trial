// Live capture session (S15): turns a stream of gate results from the camera loop into what the screen shows, what the
// voice says, and when to take the photo. Pure logic; the camera component feeds it one gate result per check.
import { GUIDANCE, primaryReason, type GateReason, type GateResult } from "../gate/capture";

export type Prompt = GateReason | "starting" | "hold";

export interface SessionSettings {
  /** consecutive passing checks before the photo is taken (about 0.75 s at 4 checks a second) */
  holdChecks: number;
  /** consecutive checks a new problem must persist before it replaces the prompt on screen (no flicker) */
  stableChecks: number;
  /** the same prompt is spoken again only after this long */
  repeatMs: number;
}

export const SESSION: SessionSettings = { holdChecks: 3, stableChecks: 2, repeatMs: 5000 };

export const PROMPT_TEXT: Record<Prompt, string> = {
  ...GUIDANCE,
  starting: "Starting the camera.",
  hold: "That's good. Hold still.",
};

export interface Step {
  /** what the screen shows now */
  show: Prompt;
  /** what to say aloud now, if anything */
  speak: Prompt | null;
  /** take the photo now (the full-resolution frame is then checked again before it is kept) */
  capture: boolean;
}

export class CaptureSession {
  private shown: Prompt = "starting";
  private candidate: Prompt | null = null;
  private run = 0;
  private passes = 0;
  private spoken: Prompt | null = null;
  private spokenAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly s: SessionSettings = SESSION) {}

  push(g: GateResult, now: number): Step {
    const p: Prompt = g.ok ? "hold" : primaryReason(g.reasons);
    this.run = p === this.candidate ? this.run + 1 : 1;
    this.candidate = p;
    this.passes = g.ok ? this.passes + 1 : 0;
    // A pass shows "hold" at once; a problem must persist so one noisy check does not flash a wrong prompt.
    if (p === "hold" || this.run >= this.s.stableChecks || this.shown === "starting") this.shown = p;
    return this.step(now, this.passes >= this.s.holdChecks);
  }

  /** The full-resolution check refused the frame: its reason is confirmed, so it shows at once; counting starts again. */
  refuse(g: GateResult, now: number): Step {
    const p = primaryReason(g.reasons);
    this.passes = 0;
    this.candidate = p;
    this.run = this.s.stableChecks;
    this.shown = p;
    return this.step(now, false);
  }

  private step(now: number, capture: boolean): Step {
    let speak: Prompt | null = null;
    if (this.shown !== this.spoken || (this.shown !== "hold" && now - this.spokenAt >= this.s.repeatMs)) {
      speak = this.shown;
      this.spoken = this.shown;
      this.spokenAt = now;
    }
    return { show: this.shown, speak, capture };
  }
}
