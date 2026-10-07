"use client";
import { useEffect } from "react";
import { captureInstallEvents } from "@/lib/pwa-install";
export function PwaRuntime() {
  useEffect(() => {
    if (window.isSecureContext && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    return captureInstallEvents();
  }, []);
  return null;
}
