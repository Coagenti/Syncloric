import Link from "next/link";

export type SyncState = { status: "ok" | "partial" | "error"; reason: "auth" | null; origin: string | null; finishedAt?: string | null } | null;

/** Only a completed latest auth failure prompts explicit reassociation; no automatic credential writes. */
export function SyncNotice({ sync, message }: { sync: SyncState; message?: string | null }) {
  if (message) return <p className="status-note" role="status">{message}{message === "Configura la tua chiave Norish in Impostazioni." && <> <Link href="/settings#norish">Apri Impostazioni</Link></>}</p>;
  if (!sync) return <p className="status-note" role="status">Nessuna sincronizzazione Norish ancora eseguita.</p>;
  if (sync.status === "error" && sync.reason === "auth") return <div className="demo-alert" role="alert">
    <strong>Sincronizzazione fallita per autenticazione</strong>
    <span>Norish ha rifiutato la tua chiave{sync.origin ? ` per ${sync.origin}` : ""}. Verifica o sostituisci la tua chiave personale in <Link href="/settings#norish">Impostazioni</Link>.</span>
  </div>;
  if (sync.status === "error") return <p className="status-note" role="status">Ultima sincronizzazione non riuscita. Riprova più tardi.</p>;
  return <p className="status-note" role="status">Sincronizzazione Norish: {sync.status === "ok" ? "completata" : "parziale"}.</p>;
}
