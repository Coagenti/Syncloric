import Link from "next/link";

export type SyncState = { status: "ok" | "partial" | "error"; reason: "auth" | null; origin: string | null } | null;

/** Only a completed latest auth failure prompts explicit reassociation; no automatic credential writes. */
export function SyncNotice({ sync }: { sync: SyncState }) {
  if (!sync) return <p className="status-note" role="status">Nessuna sincronizzazione Norish ancora eseguita.</p>;
  if (sync.status === "error" && sync.reason === "auth") return <div className="demo-alert" role="alert">
    <strong>Sincronizzazione fallita per autenticazione</strong>
    <span>Norish ha rifiutato la chiave{sync.origin ? ` per ${sync.origin}` : ""}. La chiave è globale: chiedi all’amministratore di verificare la configurazione in <Link href="/settings">Impostazioni</Link>.</span>
  </div>;
  if (sync.status === "error") return <p className="status-note" role="status">Ultima sincronizzazione non riuscita. Riprova più tardi.</p>;
  return <p className="status-note" role="status">Sincronizzazione Norish: {sync.status === "ok" ? "completata" : "parziale"}.</p>;
}
