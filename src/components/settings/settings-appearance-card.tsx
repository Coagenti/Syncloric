"use client";

import { useI18n } from "@/components/ui-preferences-provider";
import { NeonSwitch } from "@/components/neon-switch";
import { setReducedMotion, useReducedMotion } from "@/lib/motion-preference";

export function SettingsAppearanceCard() {
  const { tr } = useI18n();
  const reduced = useReducedMotion();
  return <section className="editor-panel appearance-card" aria-labelledby="motion-settings-title">
    <div className="settings-toggle-heading"><h2 id="motion-settings-title">{tr("Riduci animazioni")}</h2><NeonSwitch label={tr("Riduci animazioni")} checked={reduced} describedBy="motion-settings-help" onChange={setReducedMotion} /></div>
    <p id="motion-settings-help" className="form-help">{tr("Disattiva glitch, onde e transizioni. La scelta viene salvata automaticamente in questo browser; inizialmente segue le preferenze del dispositivo.")}</p>
  </section>;
}
