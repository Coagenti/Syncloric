"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import Link from "next/link";

export function SettingsAccessNotice() {
  const { tr } = useI18n();
  return <section className="auth-card" aria-labelledby="settings-access-title">
    <h2 id="settings-access-title">{tr("Richiede amministratore")}</h2>
      <p>{tr("URL del server Norish, provider e chiavi AI, barcode e utenti sono configurabili soltanto dagli amministratori.")}</p>
      <p>{tr("Puoi gestire la tua chiave personale Norish nella scheda qui sopra. Se il server Norish non è configurato, chiedi all’amministratore di impostarne l’URL.")}</p>
    <Link className="auth-switch" href="/diary">{tr("Torna al diario")}</Link>
  </section>;
}
