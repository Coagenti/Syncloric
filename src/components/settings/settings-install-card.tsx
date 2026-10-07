"use client";
import { useState } from "react";
import { clearInstallPrompt, usePwaStatus } from "@/lib/pwa-install";
export function SettingsInstallCard() {
  const { prompt, secure, installed } = usePwaStatus();
  const [busy, setBusy] = useState(false);
  return <section className="editor-panel" aria-labelledby="install-settings-title"><h2 id="install-settings-title">Syncloric sul telefono</h2>
    <p className="form-help">{installed ? "Syncloric è disponibile come app installata." : !secure ? "Per installare l’app e usare la fotocamera, apri Syncloric tramite HTTPS. HTTP sulla rete locale non abilita queste funzioni." : "Installa Syncloric sulla schermata Home. Su iPhone: Condividi → Aggiungi alla schermata Home → Apri come app web. Su Android: menu del browser → Installa app / Aggiungi a schermata Home."}</p>
    {prompt && !installed && <button type="button" className="primary-btn" disabled={busy} onClick={async () => { setBusy(true); try { await prompt.prompt(); await prompt.userChoice; } finally { clearInstallPrompt(); setBusy(false); } }}>Installa Syncloric</button>}
  </section>;
}
