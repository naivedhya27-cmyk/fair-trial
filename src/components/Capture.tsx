"use client";
// Guided capture (S15). The camera loop checks about 4 frames a second at up to 720 px with the validated gate
// (src/lib/gate/capture.ts) and speaks and shows the one thing to fix. After 3 passing checks in a row it takes the
// full-resolution frame and checks that frame again, so the photo kept is always one that passed the gate exactly as
// validated in S07 and S10. With `baseline` (the trial's first photo) the light, colour and sharpness checks apply.
// The preview is mirrored like a mirror; the photo is not, so the subject's left stays their left.
import { useEffect, useRef, useState } from "react";
import { captureStats, gate, type CaptureStats, type GateResult } from "@/lib/gate/capture";
import { CaptureSession, PROMPT_TEXT, type Prompt } from "@/lib/capture/session";
import { detectFace, finderState, getLandmarker, onFinderState, type FinderState } from "@/lib/vision/landmarker";
import type { FaceGeometry } from "@/lib/vision/geometry";
import { say, useVoice, writeVoice } from "@/lib/voice";

export interface CaptureResult {
  blob: Blob;
  stats: CaptureStats;
  gate: GateResult;
  /** the face found in the kept frame, in its pixels: the half-face regions of every mask come from it */
  face: FaceGeometry;
  width: number;
  height: number;
  at: number;
}

type Phase = "starting" | "live" | "taken" | "denied" | "no_camera" | "error" | "finder_failed";

const CHECK_MS = 250;
const CHECK_PX = 720;
export default function Capture({ baseline = null, onCapture, onCancel }: { baseline?: CaptureStats | null; onCapture: (r: CaptureResult) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [prompt, setPrompt] = useState<Prompt>("starting");
  // the face finder's loading (S21): shown once it takes longer than a moment; a failed load offers Try again
  const [finder, setFinder] = useState<FinderState>(finderState);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const voice = useVoice();
  const voiceRef = useRef(voice);
  const done = useRef(onCapture);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);
  // The camera fills the screen: the app bar behind it is taken out, so focus can never land on something hidden.
  useEffect(() => {
    document.body.dataset.camera = "on";
    return () => {
      delete document.body.dataset.camera;
    };
  }, []);
  useEffect(() => {
    done.current = onCapture;
  }, [onCapture]);
  useEffect(() => onFinderState(setFinder), []);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), 1500);
    return () => clearTimeout(id);
  }, [attempt]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    const session = new CaptureSession();
    const small = document.createElement("canvas");
    const full = document.createElement("canvas");

    const show = (p: Prompt, speak: Prompt | null) => {
      setPrompt(p);
      if (speak && voiceRef.current) say(PROMPT_TEXT[speak]);
    };

    async function check(canvas: HTMLCanvasElement) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const det = await detectFace(canvas);
      const stats = captureStats(ctx.getImageData(0, 0, canvas.width, canvas.height), det.face, det.faces);
      return { stats, face: det.face, result: gate(stats, baseline) };
    }

    async function run() {
      // the face finder loads while the camera opens (and may already be on its way from the page before)
      const finding = getLandmarker();
      finding.catch(() => undefined);
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("no_camera");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1440 }, height: { ideal: 1920 } },
          audio: false,
        });
      } catch (e) {
        setPhase((e as DOMException)?.name === "NotAllowedError" ? "denied" : "no_camera");
        return;
      }
      if (stopped) return;
      const el = video.current!;
      el.srcObject = stream;
      await el.play().catch(() => undefined);
      try {
        await finding;
      } catch {
        if (!stopped) setPhase("finder_failed");
        return;
      }
      if (stopped) return;
      setPhase("live");
      while (!stopped) {
        const t0 = performance.now();
        const vw = el.videoWidth,
          vh = el.videoHeight;
        if (vw && vh) {
          const k = Math.min(1, CHECK_PX / Math.max(vw, vh));
          small.width = Math.round(vw * k);
          small.height = Math.round(vh * k);
          small.getContext("2d", { willReadFrequently: true })!.drawImage(el, 0, 0, small.width, small.height);
          const live = await check(small);
          if (stopped) return;
          const step = session.push(live.result, t0);
          show(step.show, step.speak);
          if (step.capture) {
            full.width = vw;
            full.height = vh;
            full.getContext("2d", { willReadFrequently: true })!.drawImage(el, 0, 0, vw, vh);
            const exact = await check(full);
            if (stopped) return;
            if (exact.result.ok && exact.face) {
              const blob = await new Promise<Blob | null>((r) => full.toBlob(r, "image/jpeg", 0.92));
              if (blob && !stopped) {
                stopped = true;
                setPhase("taken");
                if (voiceRef.current) say("Got it.");
                stream?.getTracks().forEach((t) => t.stop());
                done.current({ blob, stats: exact.stats, gate: exact.result, face: exact.face, width: vw, height: vh, at: Date.now() });
                return;
              }
            }
            const again = session.refuse(exact.result, performance.now());
            show(again.show, again.speak);
          }
        }
        await new Promise((r) => setTimeout(r, Math.max(0, CHECK_MS - (performance.now() - t0))));
      }
    }

    run().catch(() => setPhase("error"));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* nothing to cancel */
      }
    };
  }, [baseline, attempt]);

  const toggleVoice = () => {
    const v = !voice;
    voiceRef.current = v;
    writeVoice(v);
    if (!v) window.speechSynthesis?.cancel();
  };

  const retry = () => {
    setPhase("starting");
    setPrompt("starting");
    setSlow(false);
    setAttempt((a) => a + 1);
  };

  const blocked = phase === "denied" || phase === "no_camera" || phase === "error" || phase === "finder_failed";
  const loading = phase === "starting" && finder.phase === "loading" && slow;
  const percent = Math.min(99, Math.floor((100 * finder.received) / Math.max(1, finder.expected)));
  const message =
    phase === "denied"
      ? "The camera is blocked. Allow camera access for this site in your browser settings, then try again."
      : phase === "no_camera"
        ? "No camera was found. Open Fair Trial on a phone or a computer with a front camera."
        : phase === "error"
          ? "The camera stopped unexpectedly. Close other apps using it and try again."
          : phase === "finder_failed"
            ? "The face finder didn't load. Check your connection, then try again."
            : phase === "taken"
              ? "Got it."
              : PROMPT_TEXT[prompt];

  return (
    <section className="fixed inset-0 z-40 flex flex-col bg-black text-white [--focus:#93c5fd]" aria-label="Camera">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video ref={video} className="absolute inset-0 h-full w-full -scale-x-100 object-cover" muted playsInline autoPlay aria-hidden="true" />
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <mask id="oval-hole">
              <rect width="100" height="100" fill="white" />
              <ellipse cx="50" cy="46" rx="31" ry="30" fill="black" />
            </mask>
          </defs>
          <rect width="100" height="100" fill="rgba(0,0,0,0.45)" mask="url(#oval-hole)" />
          <ellipse cx="50" cy="46" rx="31" ry="30" fill="none" stroke={prompt === "hold" ? "#4ade80" : "#ffffff"} strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        </svg>
        {phase === "taken" && <div className="absolute inset-0 bg-white/60 motion-safe:animate-pulse" aria-hidden="true" />}
      </div>
      <div className="flex flex-col gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <p
          id="capture-guidance"
          role="status"
          aria-live="polite"
          data-reason={blocked ? phase : phase === "taken" ? "taken" : prompt}
          data-finder={finder.phase}
          className="min-h-[3.5rem] text-lg font-medium leading-snug"
        >
          {loading ? (
            <>
              Getting the face finder ready. It loads once; a slow connection takes longer.{" "}
              <span aria-hidden="true" className="tabular-nums" id="finder-progress">
                {percent}%
              </span>
            </>
          ) : (
            message
          )}
        </p>
        <div className="flex gap-3">
          {phase === "finder_failed" ? (
            <button type="button" id="capture-retry" onClick={retry} className="min-h-12 flex-1 rounded-xl border border-white/40 px-4 text-base font-medium">
              Try again
            </button>
          ) : (
            <button type="button" onClick={toggleVoice} aria-pressed={voice} className="min-h-12 flex-1 rounded-xl border border-white/40 px-4 text-base font-medium">
              {voice ? "Voice on" : "Voice off"}
            </button>
          )}
          <button type="button" id="capture-cancel" onClick={onCancel} className="min-h-12 flex-1 rounded-xl bg-white/15 px-4 text-base font-medium">
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
