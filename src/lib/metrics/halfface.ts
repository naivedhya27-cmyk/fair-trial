// Half-face metric (validation step S10). Splits a YouCam concern mask at the facial midline and reports, per half,
// the mask's alpha mass per 1,000 skin pixels ("density") and, for point-like concerns, the number of detections.
// Skin = face oval minus eyes, brows and lips, minus a band either side of the midline (product application is never
// exact at the centre line). Works on any mask the size of the analysed image.
import { FACE_OVAL, LEFT_BROW, LEFT_EYE, LIPS, RIGHT_BROW, RIGHT_EYE, hull, midlineFit, pick, rasterize, type FaceGeometry } from "../vision/geometry";

/** Subject's own sides. Camera frames are not mirrored, so the image's left half is the subject's right cheek. */
export type Side = "subject_left" | "subject_right";

export interface HalfRegions {
  width: number;
  height: number;
  /** 0 = not skin, 1 = image-left half (subject's right), 2 = image-right half (subject's left) */
  label: Uint8Array;
  pixels: { subject_right: number; subject_left: number };
  midline: { a: number; b: number };
}

export interface HalfValue {
  density: number;
  count: number;
}

export type HalfMetric = Record<Side, HalfValue>;

/** Width of the excluded centre band, as a fraction of face width, each side of the midline. */
export const MIDLINE_BAND = 0.04;

export function halfRegions(g: FaceGeometry, band = MIDLINE_BAND): HalfRegions {
  const { width: W, height: H } = g;
  const skin = rasterize(pick(g.points, FACE_OVAL), W, H);
  const holes = new Uint8Array(W * H);
  for (const part of [LEFT_EYE, RIGHT_EYE, LIPS, LEFT_BROW, RIGHT_BROW]) {
    rasterize(dilate(hull(pick(g.points, part)), 1.25), W, H, holes);
  }
  const oval = pick(g.points, FACE_OVAL);
  const faceW = Math.max(...oval.map((p) => p.x)) - Math.min(...oval.map((p) => p.x));
  const { a, b } = midlineFit(g.points);
  const half = band * faceW;
  const label = new Uint8Array(W * H);
  let nl = 0,
    nr = 0;
  for (let y = 0; y < H; y++) {
    const mx = a + b * (y + 0.5);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!skin[i] || holes[i]) continue;
      const d = x + 0.5 - mx;
      if (d < -half) {
        label[i] = 1;
        nl++;
      } else if (d > half) {
        label[i] = 2;
        nr++;
      }
    }
  }
  return { width: W, height: H, label, pixels: { subject_right: nl, subject_left: nr }, midline: { a, b } };
}

/** Grow a polygon about its centroid (to cover lashes and lip edges). */
function dilate(poly: { x: number; y: number }[], f: number) {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f }));
}

/**
 * Per-half density and detection count for one mask. `alpha` is the mask's alpha channel (0-255), one byte per pixel,
 * the same size as the regions. Detections are 8-connected components of alpha > 0, assigned to the half holding the
 * component's centroid; components whose centroid is outside the skin halves are not counted.
 */
export function halfMetric(regions: HalfRegions, alpha: Uint8Array | Uint8ClampedArray): HalfMetric {
  const { width: W, height: H, label } = regions;
  if (alpha.length !== W * H) throw new Error(`mask is ${alpha.length} px, regions are ${W * H} px`);
  let mr = 0,
    ml = 0;
  for (let i = 0; i < label.length; i++) {
    const l = label[i];
    if (l === 1) mr += alpha[i];
    else if (l === 2) ml += alpha[i];
  }
  const counts = componentsBySide(regions, alpha);
  return {
    subject_right: { density: (1000 * mr) / 255 / Math.max(1, regions.pixels.subject_right), count: counts[1] },
    subject_left: { density: (1000 * ml) / 255 / Math.max(1, regions.pixels.subject_left), count: counts[2] },
  };
}

function componentsBySide(regions: HalfRegions, alpha: Uint8Array | Uint8ClampedArray): [number, number, number] {
  const { width: W, height: H, label } = regions;
  const parent = new Int32Array(W * H).fill(-1);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const n = parent[i];
      parent[i] = r;
      i = n;
    }
    return r;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a),
      rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!alpha[i]) continue;
      parent[i] = i;
      if (x > 0 && alpha[i - 1]) unite(i, i - 1);
      if (y > 0) {
        if (alpha[i - W]) unite(i, i - W);
        if (x > 0 && alpha[i - W - 1]) unite(i, i - W - 1);
        if (x < W - 1 && alpha[i - W + 1]) unite(i, i - W + 1);
      }
    }
  }
  const sx = new Map<number, [number, number, number]>();
  for (let i = 0; i < W * H; i++) {
    if (parent[i] < 0) continue;
    const r = find(i);
    const s = sx.get(r) ?? [0, 0, 0];
    s[0] += i % W;
    s[1] += Math.floor(i / W);
    s[2]++;
    sx.set(r, s);
  }
  const out: [number, number, number] = [0, 0, 0];
  for (const [, [x, y, n]] of sx) {
    const c = Math.round(y / n) * W + Math.round(x / n);
    out[label[c] as 0 | 1 | 2]++;
  }
  return out;
}
