import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The face finder's files (S21): MediaPipe's, copied at install into public/mediapipe/<version>/ (scripts/
// copy-mediapipe.mjs), and the model in public/models, named by its content hash. A name never changes its contents, so
// browsers may keep them for a year. The app reads the version and the bytes it should expect (for its progress figure)
// from here; the sizes are of the build most browsers load (with SIMD).
const MEDIAPIPE = path.join("node_modules", "@mediapipe", "tasks-vision");
const MEDIAPIPE_VERSION: string = JSON.parse(fs.readFileSync(path.join(MEDIAPIPE, "package.json"), "utf8")).version;
const sizeOf = (p: string) => (fs.existsSync(p) ? fs.statSync(p).size : 0);
const MODEL = fs.readdirSync(path.join("public", "models")).find((f) => /^face_landmarker\.[0-9a-f]{8}\.task$/.test(f)) ?? "";
const FACE_FINDER_BYTES =
  sizeOf(path.join(MEDIAPIPE, "wasm", "vision_wasm_internal.js")) + sizeOf(path.join(MEDIAPIPE, "wasm", "vision_wasm_internal.wasm")) + sizeOf(path.join("public", "models", MODEL));
const KEEP_A_YEAR = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];

// Security headers on every response (S20). The Content-Security-Policy is limited to directives that block no script or
// style the app needs (Next's inline scripts, MediaPipe's WebAssembly): no framing, no <base>, no plugins, forms post
// only here. The camera is allowed for this site alone; the microphone and location are off (voice is spoken, never
// heard).
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  /* config options here */
  env: { NEXT_PUBLIC_MEDIAPIPE_VERSION: MEDIAPIPE_VERSION, NEXT_PUBLIC_FACE_FINDER_BYTES: String(FACE_FINDER_BYTES) },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/mediapipe/:path*", headers: KEEP_A_YEAR },
      { source: "/models/:path*", headers: KEEP_A_YEAR },
    ];
  },
};

export default nextConfig;
