"use client";
import { useSyncExternalStore } from "react";
export type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function captureInstallEvents() {
  const before = (event: Event) => { event.preventDefault(); deferred = event as InstallEvent; notify(); };
  const done = () => { installed = true; deferred = null; notify(); };
  const media = window.matchMedia("(display-mode: standalone)");
  window.addEventListener("beforeinstallprompt", before); window.addEventListener("appinstalled", done); media.addEventListener("change", notify);
  return () => { window.removeEventListener("beforeinstallprompt", before); window.removeEventListener("appinstalled", done); media.removeEventListener("change", notify); };
}
export function clearInstallPrompt() { deferred = null; notify(); }
export function usePwaStatus() {
  const prompt = useSyncExternalStore(subscribe, () => deferred, () => null);
  const secure = useSyncExternalStore(subscribe, () => window.isSecureContext, () => true);
  const isInstalled = useSyncExternalStore(subscribe, () => installed || window.matchMedia("(display-mode: standalone)").matches || !!(navigator as Navigator & { standalone?: boolean }).standalone, () => false);
  return { prompt, secure, installed: isInstalled };
}
