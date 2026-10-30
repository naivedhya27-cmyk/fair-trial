// Face geometry from MediaPipe Face Landmarker (478 points), in pixel coordinates of the analysed image.
// Shared by the capture gate (S07) and the half-face metric (S10), so both use the same regions.

export interface Pt {
  x: number;
  y: number;
}

export interface Pose {
  /** degrees; positive = the face turned toward the image's right */
  yaw: number;
  /** degrees; positive = chin up */
  pitch: number;
  /** degrees; positive = clockwise in the image */
  roll: number;
}

export interface FaceGeometry {
  width: number;
  height: number;
  points: Pt[];
  pose: Pose;
}

/** Face oval (MediaPipe FACEMESH_FACE_OVAL), clockwise from the top of the forehead. */
export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];

/** Points on the facial midline, forehead to chin. */
export const MIDLINE = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 164, 0, 11, 12, 13, 14, 15, 16, 17, 18, 200, 199, 175, 152];

/** Cheek patches as mirror pairs (image-left set, image-right set). */
export const CHEEK_L = [116, 117, 118, 100, 126, 142, 36, 205, 187, 147, 123];
export const CHEEK_R = [345, 346, 347, 329, 355, 371, 266, 425, 411, 376, 352];

/** Eyes, brows and lips: excluded from skin regions (masks there are not skin). */
export const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const RIGHT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
export const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
export const LEFT_BROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
export const RIGHT_BROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

export function pick(points: Pt[], idx: number[]): Pt[] {
  return idx.map((i) => points[i]);
}

/** Convex hull (monotone chain), counter-clockwise. */
export function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Rasterise a polygon into a mask (1 = inside) over a width x height grid, even-odd rule, pixel centres. */
export function rasterize(poly: Pt[], width: number, height: number, into?: Uint8Array): Uint8Array {
  const m = into ?? new Uint8Array(width * height);
  if (poly.length < 3) return m;
  let y0 = Infinity,
    y1 = -Infinity;
  for (const q of poly) {
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  const ys = Math.max(0, Math.floor(y0)),
    ye = Math.min(height - 1, Math.ceil(y1));
  const xs: number[] = [];
  for (let y = ys; y <= ye; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i],
        b = poly[j];
      if (a.y > cy !== b.y > cy) xs.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)),
        xb = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) m[y * width + x] = 1;
    }
  }
  return m;
}

/** Least-squares line x = a + b*y through the midline points (robust to roll; faces are upright in the gate). */
export function midlineFit(points: Pt[]): { a: number; b: number } {
  const p = pick(points, MIDLINE);
  const n = p.length;
  let sy = 0,
    sx = 0,
    syy = 0,
    sxy = 0;
  for (const q of p) {
    sy += q.y;
    sx += q.x;
    syy += q.y * q.y;
    sxy += q.x * q.y;
  }
  const b = (n * sxy - sy * sx) / (n * syy - sy * sy);
  const a = (sx - b * sy) / n;
  return { a, b };
}

/** Scale geometry to another image size (masks are the size of the analysed image). */
export function scaleGeometry(g: FaceGeometry, width: number, height: number): FaceGeometry {
  const sx = width / g.width,
    sy = height / g.height;
  return { width, height, pose: g.pose, points: g.points.map((q) => ({ x: q.x * sx, y: q.y * sy })) };
}

/** Euler angles from MediaPipe's 4x4 facial transformation matrix (column-major). */
export function poseFromMatrix(m: ArrayLike<number>): Pose {
  const r00 = m[0],
    r10 = m[1],
    r20 = m[2],
    r21 = m[6],
    r22 = m[10];
  const deg = 180 / Math.PI;
  return {
    pitch: Math.atan2(r21, r22) * deg,
    yaw: Math.atan2(-r20, Math.hypot(r21, r22)) * deg,
    roll: Math.atan2(r10, r00) * deg,
  };
}
