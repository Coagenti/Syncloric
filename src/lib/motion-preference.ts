"use client";

import { useSyncExternalStore } from "react";

const key = "syncloric.reduce-motion";
const changeEvent = "syncloric:motion-change";
let sessionPreference: boolean | undefined;

function snapshot() {
  if (sessionPreference !== undefined) return sessionPreference;
  try {
    const saved = window.localStorage.getItem(key);
    if (saved === "true" || saved === "false") return saved === "true";
  } catch { /* Storage can be unavailable in private or restricted browsers. */ }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribe(notify: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) { sessionPreference = undefined; notify(); } };
  window.addEventListener(changeEvent, notify);
  window.addEventListener("storage", storage);
  media.addEventListener("change", notify);
  return () => {
    window.removeEventListener(changeEvent, notify);
    window.removeEventListener("storage", storage);
    media.removeEventListener("change", notify);
  };
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

export function syncMotionPreference() {
  document.documentElement.dataset.motion = snapshot() ? "reduce" : "full";
}

export function setReducedMotion(reduced: boolean) {
  sessionPreference = reduced;
  try { window.localStorage.setItem(key, String(reduced)); } catch { /* The preference still works for this session. */ }
  document.documentElement.dataset.motion = reduced ? "reduce" : "full";
  window.dispatchEvent(new Event(changeEvent));
}
