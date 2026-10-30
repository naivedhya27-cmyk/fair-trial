"use client";
// Today's photos (S16, restyled in S17): two photos a minute apart, each through the capture check against the trial's
// first photo. Each photo is saved on the phone at once and analysed while the person waits; a failed analysis keeps the
// photo for later. With the voice on, the session is spoken too: the photo taken, the next one ready, the day done.
import Link from "next/link";
import { useEffect, useState } from "react";
import Capture, { type CaptureResult } from "@/components/Capture";
import { IconAlert, IconCamera, IconCheck, IconClock, IconInfo } from "@/components/icons";
import { btn, Card, Screen } from "@/components/ui";
import { analysePhoto } from "@/lib/trial/analyse";
import { dayOf, SIDE_WORDS, today, type PhotoRecord, type Trial } from "@/lib/trial/model";
import { currentTrial, photosOf, savePhoto, saveTrial } from "@/lib/trial/store";
import { judgeHeaders } from "@/lib/judge";
import { preloadLandmarker } from "@/lib/vision/landmarker";
import { say, useVoice } from "@/lib/voice";

/** Seconds between the two photos of a day (trial design, S11). */
export const GAP_S = 60;
/** A second photo taken within this long of the first belongs to the first one's day, even across midnight. */
const SAME_SESSION_MS = 15 * 60 * 1000;

type Step = "ready" | "camera" | "wait" | "done";

/** Photos still to take today, or null when today asks for none. */
function stillToTake(trial: Trial, photos: PhotoRecord[], now: number): number | null {
  const td = today(trial, photos, now);
  if (td.kind !== "run_in" && td.kind !== "visit") return null;
  return td.taken < td.need ? td.need - td.taken : null;
}

const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;

function StatusLine({ p, n }: { p: PhotoRecord; n: number }) {
  return (
    <li className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-base" data-photo-status={p.status}>
      {p.status === "done" ? (
        <IconCheck className="mt-0.5 shrink-0 text-good" />
      ) : p.status === "pending" ? (
        <svg width="20" height="20" viewBox="0 0 24 24" className="mt-0.5 shrink-0 text-accent motion-safe:animate-spin" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      ) : (
        <IconAlert className="mt-0.5 shrink-0 text-warn" />
      )}
      <span>
        Photo {n}: {p.status === "done" ? "analysed." : p.status === "pending" ? "analysing…" : <span data-error-kind={p.errorKind}>{p.error}</span>}
      </span>
    </li>
  );
}

/** The minute between photos as a ring that empties; the time is also in words for screen readers. */
function Ring({ secs }: { secs: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const ready = secs <= 0;
  return (
    <div className="relative mx-auto h-40 w-40">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true" focusable="false">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke={ready ? "var(--good)" : "var(--accent)"}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={ready ? 0 : c * (1 - Math.min(1, secs / GAP_S))}
          className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-500 motion-safe:ease-linear"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {ready && <IconCheck size={28} className="text-good" />}
        <p className="text-3xl font-semibold tabular-nums" role="timer" aria-live="off" id="countdown" data-seconds={secs}>
          {ready ? (
            <span className="text-xl">Ready</span>
          ) : (
            <>
              <span className="sr-only">Next photo in </span>
              {clock(secs)}
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function PhotoSession() {
  const [trial, setTrial] = useState<Trial | null | undefined>(undefined);
  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [session, setSession] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("ready");
  const [now, setNow] = useState(0);
  const [moved, setMoved] = useState(false);
  // whether live analysis is open to this person (S21): when it is not, the page says so before the camera
  const [paused, setPaused] = useState(false);
  const voice = useVoice();

  useEffect(() => {
    preloadLandmarker();
    let live = true;
    fetch("/api/status", { headers: judgeHeaders(), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (live && s && s.live === false) setPaused(true);
      })
      .catch(() => undefined);
    (async () => {
      const t = await currentTrial();
      const ph = t ? await photosOf(t.id) : [];
      if (!live) return;
      setPhotos(ph);
      setTrial(t);
      setNow(Date.now());
    })();
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (step !== "wait" && step !== "ready") return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [step]);

  const last = [...photos].sort((a, b) => a.takenAt - b.takenAt).at(-1);
  const readyAt = last && last.day === dayOf(now) ? last.takenAt + GAP_S * 1000 : 0;
  const secs = Math.max(0, Math.ceil((readyAt - now) / 1000));
  const nextReady = step === "wait" && secs === 0;
  useEffect(() => {
    if (nextReady && voice) say("Ready for the next photo.");
  }, [nextReady, voice]);

  if (trial === undefined)
    return (
      <Screen title="Today's photos">
        <p className="text-base text-muted">Loading…</p>
      </Screen>
    );
  if (trial === null)
    return (
      <Screen title="No trial yet" back={{ href: "/", label: "Home" }}>
        <p className="text-base leading-relaxed text-muted">Start a trial first; its photos are taken here.</p>
        <Link href="/trial/new" id="start-trial" className={btn.primary}>
          Start a trial
        </Link>
      </Screen>
    );

  const mine = session.map((id) => photos.find((p) => p.id === id)!).filter(Boolean);
  const left = stillToTake(trial, photos, now);
  const side = SIDE_WORDS[trial.side];
  const td = today(trial, photos, now);
  const runIn = td.kind === "run_in";
  const count = td.kind === "run_in" || td.kind === "visit" ? `Photo ${td.taken + 1} of ${td.need} today` : "Today's photo";
  const go = (s: Step) => {
    setMoved(true);
    setStep(s);
  };

  const onCapture = async (r: CaptureResult) => {
    const prev = mine.at(-1);
    const day = prev && r.at - prev.takenAt < SAME_SESSION_MS ? prev.day : dayOf(r.at);
    const rec: PhotoRecord = { id: crypto.randomUUID(), trialId: trial.id, day, takenAt: r.at, blob: r.blob, stats: r.stats, face: r.face, status: "pending" };
    await savePhoto(rec);
    let t = trial;
    if (!t.baseline) {
      t = { ...t, baseline: r.stats };
      await saveTrial(t);
      setTrial(t);
    }
    const all = [...photos, rec];
    const more = !!stillToTake(t, all, r.at);
    setPhotos(all);
    setSession((s) => [...s, rec.id]);
    setNow(r.at);
    go(more ? "wait" : "done");
    if (voice) say(more ? "Got it. Next photo in a minute." : "Got it. Today's photos are in.");
    const out = await analysePhoto(t, rec);
    setPhotos((ph) => ph.map((p) => (p.id === out.id ? out : p)));
  };

  if (step === "camera")
    return (
      <main className="flex min-h-dvh flex-1 flex-col">
        <h1 className="sr-only">{count}</h1>
        <Capture baseline={trial.baseline} onCapture={onCapture} onCancel={() => go(mine.length ? "wait" : "ready")} />
      </main>
    );

  if (step === "ready" && !left)
    return (
      <Screen key="none" title="No photos today" back={{ href: "/trial", label: "Your trial" }} autoFocus={moved}>
        <p className="text-base leading-relaxed text-muted">Today doesn&apos;t need any photos. Your trial page shows when the next ones are due.</p>
        <Link href="/trial" id="back-to-trial" className={btn.primary}>
          Back to your trial
        </Link>
      </Screen>
    );

  if (step === "ready")
    return (
      <Screen key="ready" title="Today's photos" back={{ href: "/trial", label: "Your trial" }} autoFocus={moved}>
        <p className="text-lg font-medium leading-snug">{left === 1 ? "One photo to go today." : `${left} photos today, a minute apart.`}</p>
        {paused && (
          <Card tone="warn" label="Live analysis is paused">
            <p className="flex gap-3 text-base leading-relaxed" id="live-paused">
              <IconAlert size={18} className="mt-1 shrink-0 text-warn" />
              <span>
                Live analysis is paused: Fair Trial is keeping its last YouCam units for the judges. Your photos are still saved on this phone, and your trial page can analyse them once it opens
                again. The demo shows a whole trial meanwhile.
              </span>
            </p>
            <Link href="/demo" id="paused-demo" className={btn.secondary}>
              See the demo
            </Link>
          </Card>
        )}
        <Card label="Before you start">
          <ul className="flex flex-col gap-3">
            {[
              "Stand where you took your first photo, in the same light, with a clean face and no make-up.",
              "Hold the phone at arm's length, level with your face.",
              "The camera takes each photo by itself once everything is right.",
            ].map((tip) => (
              <li key={tip} className="flex gap-3 text-base leading-relaxed">
                <IconCheck size={18} className="mt-1 shrink-0 text-accent" />
                <span>{tip}</span>
              </li>
            ))}
            <li className="flex gap-3 text-base font-medium leading-relaxed">
              <IconInfo size={18} className="mt-1 shrink-0 text-accent" />
              <span>{runIn ? "Don't use the product yet: these days measure your skin without it." : `Keep using the product on your ${side} side as usual.`}</span>
            </li>
          </ul>
        </Card>
        {secs > 0 && (
          <p className="flex items-center gap-2 text-base" role="timer" id="countdown" data-seconds={secs}>
            <IconClock size={18} className="shrink-0 text-muted" />
            Your last photo was under a minute ago. Next photo in {clock(secs)}.
          </p>
        )}
        <button type="button" id="start-camera" className={btn.primary} disabled={secs > 0} onClick={() => go("camera")}>
          <IconCamera size={20} />
          Start the camera
        </button>
      </Screen>
    );

  if (step === "wait")
    return (
      <Screen key="wait" title="Second photo in a minute" autoFocus={moved}>
        <Card label="Waiting">
          <Ring secs={secs} />
          <p className="text-center text-base leading-relaxed text-muted">Stay where you are, in the same light. Two photos a minute apart show how much your measurements wobble on their own.</p>
          <p className="sr-only" aria-live="polite">
            {secs > 0 ? "" : "Ready for the next photo."}
          </p>
        </Card>
        <ul className="flex flex-col gap-2" aria-live="polite">
          {mine.map((p, i) => (
            <StatusLine key={p.id} p={p} n={i + 1} />
          ))}
        </ul>
        <button type="button" id="next-photo" className={btn.primary} disabled={secs > 0} onClick={() => go("camera")}>
          <IconCamera size={20} />
          Take the next photo
        </button>
      </Screen>
    );

  return (
    <Screen key="done" title="Today's photos are in" autoFocus={moved}>
      <ul className="flex flex-col gap-2" id="session-status" aria-live="polite">
        {mine.map((p, i) => (
          <StatusLine key={p.id} p={p} n={i + 1} />
        ))}
      </ul>
      <p className="text-base leading-relaxed text-muted">
        {mine.some((p) => p.status === "pending") ? "The analysis carries on if you leave this page; your trial page shows the results." : "Your trial page has the latest."}
      </p>
      <Link href="/trial" id="back-to-trial" className={btn.primary}>
        Back to your trial
      </Link>
    </Screen>
  );
}
