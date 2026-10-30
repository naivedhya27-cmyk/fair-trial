import { describe, expect, it } from "vitest";
import { primaryReason } from "../src/lib/gate/capture";
import { CaptureSession } from "../src/lib/capture/session";

const ok = { ok: true, reasons: [] };
const bad = (...reasons: Parameters<typeof primaryReason>[0]) => ({ ok: false, reasons: [...reasons] });

describe("capture session", () => {
  it("takes the photo only after three passing checks in a row", () => {
    const s = new CaptureSession();
    expect(s.push(ok, 0).capture).toBe(false);
    expect(s.push(ok, 250).capture).toBe(false);
    expect(s.push(bad("blurry"), 500).capture).toBe(false);
    expect(s.push(ok, 750).capture).toBe(false);
    expect(s.push(ok, 1000).capture).toBe(false);
    expect(s.push(ok, 1250).capture).toBe(true);
  });

  it("shows the first problem at once, then needs two checks before a new problem replaces it", () => {
    const s = new CaptureSession();
    expect(s.push(bad("too_far"), 0).show).toBe("too_far");
    expect(s.push(bad("tilted"), 250).show).toBe("too_far");
    expect(s.push(bad("tilted"), 500).show).toBe("tilted");
    expect(s.push(ok, 750).show).toBe("hold");
  });

  it("speaks each new prompt once and repeats a lasting problem after five seconds", () => {
    const s = new CaptureSession();
    expect(s.push(bad("too_dark"), 0).speak).toBe("too_dark");
    expect(s.push(bad("too_dark"), 2000).speak).toBe(null);
    expect(s.push(bad("too_dark"), 5100).speak).toBe("too_dark");
    expect(s.push(ok, 5300).speak).toBe("hold");
    expect(s.push(ok, 5550).speak).toBe(null);
  });

  it("fixes framing before pose and light, and light before blur and hidden eyes", () => {
    expect(primaryReason(["eyes_hidden", "too_dark", "too_far"])).toBe("too_far");
    expect(primaryReason(["eyes_hidden", "blurry", "too_dark"])).toBe("too_dark");
    expect(primaryReason(["eyes_hidden", "blurry"])).toBe("blurry");
    expect(primaryReason(["too_far", "several_faces"])).toBe("several_faces");
  });

  it("starts counting again when the full-resolution check refuses the frame", () => {
    const s = new CaptureSession();
    s.push(ok, 0);
    s.push(ok, 250);
    expect(s.push(ok, 500).capture).toBe(true);
    const r = s.refuse(bad("blurry"), 600);
    expect(r.capture).toBe(false);
    expect(r.show).toBe("blurry");
    expect(s.push(ok, 850).capture).toBe(false);
  });
});
