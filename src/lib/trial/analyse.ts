"use client";
// Running the analysis of a trial's photos (S16). A photo is analysed once: a second request for the same photo while
// the first is still running waits for it instead of spending units again.
import { analyse, AnalysisError } from "../youcam/client";
import type { PhotoRecord, Trial } from "./model";
import { savePhoto } from "./store";
import { ANALYSIS_WORDS } from "./words";

const running = new Map<string, Promise<PhotoRecord>>();

/** Analyse one photo and save the outcome; resolves to the saved record (status "done" or "error"). */
export function analysePhoto(trial: Trial, photo: PhotoRecord): Promise<PhotoRecord> {
  const now = running.get(photo.id);
  if (now) return now;
  const job = (async () => {
    let out: PhotoRecord;
    try {
      const a = await analyse(photo.blob, trial.concerns, photo.face);
      out = { ...photo, status: "done", error: undefined, errorKind: undefined, result: { raw: a.raw, density: a.density } };
    } catch (e) {
      const kind = e instanceof AnalysisError ? e.kind : "unreachable";
      out = { ...photo, status: "error", error: ANALYSIS_WORDS[kind], errorKind: kind };
    }
    await savePhoto(out);
    return out;
  })();
  running.set(photo.id, job);
  void job.finally(() => running.delete(photo.id));
  return job;
}

export const isRunning = (id: string) => running.has(id);

/** Analyse every photo not yet done, oldest first; stops at the first refusal that would repeat (daily limit or pause). */
export async function analysePending(trial: Trial, photos: PhotoRecord[], onChange: () => void): Promise<void> {
  for (const p of photos.filter((x) => x.status !== "done")) {
    const out = await analysePhoto(trial, p);
    onChange();
    if (out.status === "error" && (out.errorKind === "limit" || out.errorKind === "paused")) return;
  }
}
