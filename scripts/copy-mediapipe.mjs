// Copies MediaPipe's WebAssembly files from its npm package into public/mediapipe/<version>/wasm, where the face
// landmarker loads them (src/lib/vision/landmarker.ts). Runs after every install, so the served files always match the
// installed version and the repository never carries 41 MB of copies. The folder is named by the version (S21), so a
// name never changes its contents and browsers may keep the files for a year (next.config.ts); older versions go.
import fs from "node:fs";
import path from "node:path";

const pkg = path.join("node_modules", "@mediapipe", "tasks-vision");
const from = path.join(pkg, "wasm");
if (!fs.existsSync(from)) {
  console.error(`copy-mediapipe: ${from} is missing; run npm install`);
  process.exit(1);
}
const { version } = JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8"));
const root = path.join("public", "mediapipe");
const to = path.join(root, version, "wasm");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
const files = fs.readdirSync(from).filter((f) => /\.(js|wasm)$/.test(f));
for (const f of files) fs.copyFileSync(path.join(from, f), path.join(to, f));
console.log(`copy-mediapipe: ${files.length} files to ${to}`);
