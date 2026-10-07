"use client";

import { NeonSwitch } from "@/components/neon-switch";
import { setReducedMotion, useReducedMotion } from "@/lib/motion-preference";

export function SettingsAppearanceCard() {
  const reduced = useReducedMotion();
  return <section className="editor-panel appearance-card" aria-labelledby="motion-settings-title">
    <div className="settings-toggle-heading"><h2 id="motion-settings-title">Riduci animazioni</h2><NeonSwitch label="Riduci animazioni" checked={reduced} describedBy="motion-settings-help" onChange={setReducedMotion} /></div>
    <p id="motion-settings-help" className="form-help">Disattiva glitch, onde e transizioni. La scelta viene salvata automaticamente in questo browser; inizialmente segue le preferenze del dispositivo.</p>
  </section>;
}
