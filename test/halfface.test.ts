import { describe, expect, it } from "vitest";
import { halfMetric, halfRegions } from "@/lib/metrics/halfface";
import type { FaceGeometry, Pt } from "@/lib/vision/geometry";

// A synthetic upright "face": 478 points where the oval is a 200 x 260 ellipse centred at (150, 170) in a 300 x 340
// image, midline points on x = 150, every other point on the midline below the image (zero-area eyes, brows, lips).
function fakeFace(): FaceGeometry {
  const W = 300,
    H = 340;
  const pts: Pt[] = Array.from({ length: 478 }, () => ({ x: 150, y: 1000 }));
  const oval = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  oval.forEach((idx, k) => {
    const t = -Math.PI / 2 + (2 * Math.PI * k) / oval.length;
    pts[idx] = { x: 150 + 100 * Math.cos(t), y: 170 + 130 * Math.sin(t) };
  });
  const mid = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 0, 11, 12, 13, 14, 15, 16, 17, 18, 200, 199, 175, 152];
  mid.forEach((idx, k) => {
    if (idx === 10 || idx === 152) return;
    pts[idx] = { x: 150, y: 50 + (240 * k) / mid.length };
  });
  return { width: W, height: H, points: pts, pose: { yaw: 0, pitch: 0, roll: 0 } };
}

describe("half-face metric", () => {
  const g = fakeFace();
  const R = halfRegions(g);

  it("splits the skin into two near-equal halves with a centre band", () => {
    const { subject_left: l, subject_right: r } = R.pixels;
    expect(Math.abs(l - r) / (l + r)).toBeLessThan(0.02);
    expect(R.label[170 * 300 + 150]).toBe(0); // on the midline: excluded
  });

  it("puts a blob on the image's left half into the subject's right side", () => {
    const a = new Uint8Array(300 * 340);
    for (let y = 160; y < 170; y++) for (let x = 90; x < 100; x++) a[y * 300 + x] = 255;
    const m = halfMetric(R, a);
    expect(m.subject_right.count).toBe(1);
    expect(m.subject_left.count).toBe(0);
    expect(m.subject_right.density).toBeGreaterThan(0);
    expect(m.subject_left.density).toBe(0);
  });

  it("counts separate detections and ignores ones outside the face", () => {
    const a = new Uint8Array(300 * 340);
    const dot = (cx: number, cy: number) => {
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) a[y * 300 + x] = 200;
    };
    dot(200, 150);
    dot(210, 200);
    dot(190, 230);
    dot(5, 5);
    const m = halfMetric(R, a);
    expect(m.subject_left.count).toBe(3);
    expect(m.subject_right.count).toBe(0);
  });

  it("is symmetric for a symmetric mask", () => {
    const a = new Uint8Array(300 * 340);
    for (let y = 100; y < 250; y++) for (let x = 0; x < 300; x++) a[y * 300 + x] = (x * 7 + y * 3) % 2 ? 0 : 128;
    for (let y = 100; y < 250; y++) for (let x = 0; x < 150; x++) a[y * 300 + (299 - x)] = a[y * 300 + x];
    const m = halfMetric(R, a);
    expect(Math.abs(m.subject_left.density - m.subject_right.density) / m.subject_left.density).toBeLessThan(0.03);
  });
});
