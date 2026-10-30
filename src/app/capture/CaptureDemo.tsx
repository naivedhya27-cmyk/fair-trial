"use client";
// Camera check (S15, restyled in S17): a first photo, then a check-in photo compared with it, the way every trial photo
// is taken. Nothing leaves the device here; the trial flow (S16) decides what is analysed.
import Link from "next/link";
import { useEffect, useState } from "react";
import Capture, { type CaptureResult } from "@/components/Capture";
import { IconCamera, IconLock } from "@/components/icons";
import { btn, Notice, Screen } from "@/components/ui";
import { preloadLandmarker } from "@/lib/vision/landmarker";

type Step = "intro" | "baseline" | "review_baseline" | "checkin_intro" | "checkin" | "review_checkin" | "done";
type Photo = CaptureResult & { url: string };

/** A taken photo with a local address for showing it; the address is released when the photo is replaced. */
function usePhoto() {
  const [photo, setPhoto] = useState<Photo | null>(null);
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url);
    },
    [photo],
  );
  const keep = (r: CaptureResult | null) => setPhoto(r ? { ...r, url: URL.createObjectURL(r.blob) } : null);
  return [photo, keep] as const;
}

export default function CaptureDemo() {
  const [step, setStep] = useState<Step>("intro");
  const [moved, setMoved] = useState(false);
  // the face finder starts loading while the page explains the check (S21)
  useEffect(() => preloadLandmarker(), []);
  const [first, setFirst] = usePhoto();
  const [checkin, setCheckin] = usePhoto();
  const go = (s: Step) => {
    setMoved(true);
    setStep(s);
  };

  if (step === "baseline")
    return (
      <main className="flex min-h-dvh flex-1 flex-col">
        <h1 className="sr-only">Camera check: first photo</h1>
        <Capture
          onCapture={(r) => {
            setFirst(r);
            go("review_baseline");
          }}
          onCancel={() => go("intro")}
        />
      </main>
    );
  if (step === "checkin" && first)
    return (
      <main className="flex min-h-dvh flex-1 flex-col">
        <h1 className="sr-only">Camera check: check-in photo</h1>
        <Capture
          baseline={first.stats}
          onCapture={(r) => {
            setCheckin(r);
            go("review_checkin");
          }}
          onCancel={() => go("checkin_intro")}
        />
      </main>
    );

  if (step === "review_baseline" || step === "review_checkin") {
    const base = step === "review_baseline";
    const shot = base ? first : checkin;
    if (!shot) return null;
    return (
      <Screen key={step} title={base ? "Your first photo" : "Your check-in photo"} step={{ at: base ? 1 : 2, of: 2, label: base ? "First photo" : "Check-in photo" }} autoFocus={moved}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local photo that never leaves the device */}
        <img
          id="capture-photo"
          data-mode={base ? "baseline" : "checkin"}
          data-at={shot.at}
          src={shot.url}
          alt={base ? "Your first photo" : "Your check-in photo"}
          className="ft-reveal w-full rounded-3xl border border-line"
        />
        <Notice tone="good">
          <p className="text-base leading-relaxed">
            {base
              ? "Face straight, well framed and sharp. Later photos are compared with this one."
              : "Framing, light, colour and sharpness match your first photo, so the two can be compared fairly."}
          </p>
        </Notice>
        <div className="flex flex-col gap-3">
          <button type="button" id="use-photo" className={btn.primary} onClick={() => go(base ? "checkin_intro" : "done")}>
            Use this photo
          </button>
          <button type="button" id="retake" className={btn.secondary} onClick={() => go(base ? "baseline" : "checkin")}>
            Retake
          </button>
        </div>
      </Screen>
    );
  }

  if (step === "checkin_intro")
    return (
      <Screen key="checkin_intro" title="Now a check-in photo" step={{ at: 2, of: 2, label: "Check-in photo" }} autoFocus={moved}>
        <p className="text-base leading-relaxed text-muted">Stand in the same place, in the same light. The camera checks this photo against your first one.</p>
        <button type="button" id="start-checkin" className={btn.primary} onClick={() => go("checkin")}>
          <IconCamera size={20} />
          Take the check-in photo
        </button>
      </Screen>
    );

  if (step === "done")
    return (
      <Screen key="done" title="Both photos passed" autoFocus={moved}>
        <Notice tone="good">
          <p className="text-base leading-relaxed">That is how every photo in a trial is taken.</p>
        </Notice>
        <div className="flex flex-col gap-3">
          <Link href="/" id="camera-home" className={btn.primary}>
            Back to the start
          </Link>
          <button
            type="button"
            id="start-again"
            className={btn.secondary}
            onClick={() => {
              setFirst(null);
              setCheckin(null);
              go("intro");
            }}
          >
            Start again
          </button>
        </div>
      </Screen>
    );

  return (
    <Screen key="intro" title="Camera check" back={{ href: "/", label: "Home" }} autoFocus={moved}>
      <p className="text-base leading-relaxed text-muted">
        A fair comparison needs the same framing and the same light every time. Hold your phone at arm&apos;s length and face a window or a lamp. The camera takes the photo by itself once everything
        is right, and tells you what to change until then.
      </p>
      <p className="flex items-start gap-3 text-base leading-relaxed">
        <IconLock size={18} className="mt-1 shrink-0 text-accent" />
        <span>Nothing leaves your phone in this check.</span>
      </p>
      <button type="button" id="start-camera" className={btn.primary} onClick={() => go("baseline")}>
        <IconCamera size={20} />
        Start the camera
      </button>
    </Screen>
  );
}
