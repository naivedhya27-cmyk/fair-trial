"use client";
// Trial storage (S16): everything stays on this device, in the browser's IndexedDB. Nothing is sent anywhere except the
// photo for each analysis, which passes through our server to YouCam and is not stored there.
import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PhotoRecord, Trial } from "./model";

const NAME = "fairtrial";

interface Schema extends DBSchema {
  trials: { key: string; value: Trial };
  photos: { key: string; value: PhotoRecord; indexes: { byTrial: string } };
}

let open: Promise<IDBPDatabase<Schema>> | null = null;
function db() {
  open ??= openDB<Schema>(NAME, 1, {
    upgrade(d) {
      d.createObjectStore("trials", { keyPath: "id" });
      d.createObjectStore("photos", { keyPath: "id" }).createIndex("byTrial", "trialId");
    },
  });
  return open;
}

/** Whether the database exists; reading never creates it, so "delete everything" leaves nothing behind. */
async function exists(): Promise<boolean> {
  if (open || typeof indexedDB.databases !== "function") return true;
  return (await indexedDB.databases()).some((d) => d.name === NAME);
}

/** The newest trial, or null. */
export async function currentTrial(): Promise<Trial | null> {
  if (!(await exists())) return null;
  const all = await (await db()).getAll("trials");
  return all.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export async function saveTrial(t: Trial): Promise<void> {
  await (await db()).put("trials", t);
}

export async function savePhoto(p: PhotoRecord): Promise<void> {
  await (await db()).put("photos", p);
}

export async function photosOf(trialId: string): Promise<PhotoRecord[]> {
  return (await (await db()).getAllFromIndex("photos", "byTrial", trialId)).sort((a, b) => a.takenAt - b.takenAt);
}

/** Remove one trial and its photos. */
export async function deleteTrial(trialId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(["trials", "photos"], "readwrite");
  for (const key of await tx.objectStore("photos").index("byTrial").getAllKeys(trialId)) await tx.objectStore("photos").delete(key);
  await tx.objectStore("trials").delete(trialId);
  await tx.done;
}

/** Delete everything Fair Trial keeps on this device: every trial, every photo and every saved setting. */
export async function deleteEverything(): Promise<void> {
  if (open) (await open).close();
  open = null;
  await deleteDB(NAME);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("fairtrial.")) localStorage.removeItem(k);
  } catch {
    /* storage blocked: nothing was kept there */
  }
}

/** Counts of what is stored, for the delete screen and the audit. */
export async function storedCounts(): Promise<{ trials: number; photos: number }> {
  if (!(await exists())) return { trials: 0, photos: 0 };
  const d = await db();
  return { trials: await d.count("trials"), photos: await d.count("photos") };
}
