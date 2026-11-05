"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import Link from "next/link";

export type SyncState = { status: "ok" | "partial" | "error"; reason: "auth" | null; origin: string | null; finishedAt?: string | null } | null;

/** Only a completed latest auth failure prompts explicit reassociation; no automatic credential writes. */
export function SyncNotice({ sync, message }: { sync: SyncState; message?: string | null }) {
  const { tr } = useI18n();
  if (message) return <p className="status-note" role="status">{tr(message)}{tr(message) === tr("Configura la tua chiave Norish in Impostazioni.") && <> <Link href="/settings#norish">{tr("Apri Impostazioni")}</Link></>}</p>;
  if (!sync) return <p className="status-note" role="status">{tr("Nessuna sincronizzazione Norish ancora eseguita.")}</p>;
  if (sync.status === "error" && sync.reason === "auth") return <div className="demo-alert" role="alert">
    <strong>{tr("Sincronizzazione fallita per autenticazione")}</strong>
    <span>{tr("Norish ha rifiutato la tua chiave")}{sync.origin ? tr(" per {0}", { "0": sync.origin }) : ""}{tr(". Verifica o sostituisci la tua chiave personale in ")}<Link href="/settings#norish">{tr("Impostazioni")}</Link>.</span>
  </div>;
  if (sync.status === "error") return <p className="status-note" role="status">{tr("Ultima sincronizzazione non riuscita. Riprova più tardi.")}</p>;
  return <p className="status-note" role="status">{tr("Sincronizzazione Norish: ")}{sync.status === "ok" ? tr("completata") : tr("parziale")}.</p>;
}
