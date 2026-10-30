// S14 dev check (free): register and upload one photo through the File API with the app's own server client; no
// analysis is started. Started by R/s14_probe.R, which puts the key in this process's environment only.
// Needs the react-server condition (server-only marker): NODE_OPTIONS=--conditions=react-server npx tsx <this> <photo>
import fs from "node:fs";
import { uploadPhoto } from "../src/lib/youcam/server";

async function main() {
  const [, , photo] = process.argv;
  const bytes = new Uint8Array(fs.readFileSync(photo));
  const t0 = Date.now();
  try {
    const id = await uploadPhoto(bytes, "image/jpeg", "probe.jpg");
    console.log(JSON.stringify({ uploaded: id.length > 0, idLength: id.length, ms: Date.now() - t0 }));
  } catch (e) {
    console.log(JSON.stringify({ uploaded: false, error: String(e).slice(0, 200), ms: Date.now() - t0 }));
  }
}

main();
