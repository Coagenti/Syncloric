"use client";

import { useEffect } from "react";
import { syncMotionPreference, useReducedMotion } from "@/lib/motion-preference";

export function MotionPreferences() {
  const reduced = useReducedMotion();
  useEffect(() => { syncMotionPreference(); }, [reduced]);
  return null;
}
