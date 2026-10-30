// The face finder's model (MediaPipe Face Landmarker), named by the first 8 hex digits of its SHA-256, so a name never
// changes its contents and browsers may keep it for a year (S21; test/facefinder.test.ts checks the name).
export const FACE_MODEL = "/models/face_landmarker.64184e22.task";
export const FACE_MODEL_HASH = FACE_MODEL.match(/\.([0-9a-f]{8})\.task$/)![1];
