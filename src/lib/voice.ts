"use client";
// The spoken prompts' on/off setting (S15, shared from S17): kept on this device; when storage is blocked it lasts for
// the visit. Speech never replaces the words on screen.
import { useSyncExternalStore } from "react";

const VOICE_KEY = "fairtrial.voice";
const VOICE_EVENT = "fairtrial-voice";

let voiceThisVisit = true;
export function readVoice(): boolean {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    return v === null ? voiceThisVisit : v !== "off";
  } catch {
    return voiceThisVisit;
  }
}
export function writeVoice(v: boolean) {
  voiceThisVisit = v;
  try {
    localStorage.setItem(VOICE_KEY, v ? "on" : "off");
  } catch {
    /* kept for this visit only */
  }
  window.dispatchEvent(new Event(VOICE_EVENT));
}
export function subscribeVoice(cb: () => void) {
  window.addEventListener(VOICE_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(VOICE_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The voice setting, kept in step with every other screen that changes it. */
export function useVoice(): boolean {
  return useSyncExternalStore(subscribeVoice, readVoice, () => true);
}

/** Speak a prompt, cutting off the previous one. */
export function say(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en";
    u.rate = 1;
    synth.speak(u);
  } catch {
    /* no speech on this device; the words on screen still show */
  }
}
