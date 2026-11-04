"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useCallback, useEffect, useRef, useState } from "react";

type User = { id: string; username: string; role: string; banned: boolean; banReason: string | null; createdAt: string };
type Action = "promote" | "demote" | "ban" | "unban";
const labels: Record<Action, string> = { promote: "Promuovi ad amministratore", demote: "Rimuovi ruolo amministratore", ban: "Sospendi utente", unban: "Riattiva utente" };
const confirms: Record<Action, string> = { promote: "Conferma promozione", demote: "Conferma rimozione ruolo", ban: "Conferma sospensione", unban: "Conferma riattivazione" };
const endpoint = "/api/v1/admin/users";
const buttonStyle = { minHeight: 44, overflowWrap: "anywhere" as const };

function UserCard({ user, protectedAdmin, self, refresh, onAccessLost }: { user: User; protectedAdmin: boolean; self: boolean; refresh: () => Promise<boolean>; onAccessLost: () => void }) {
  const { tr, formatTimestamp } = useI18n();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const busy = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const container = useRef<HTMLLIElement | null>(null);
  const confirm = useRef<HTMLButtonElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const restoreFocus = useRef(false);
  const needsReason = action === "ban" || action === "unban";
  useEffect(() => {
    if (action && (document.activeElement === trigger.current || document.activeElement === document.body)) {
      (needsReason ? textarea.current : confirm.current)?.focus();
    }
  }, [action, needsReason]);
  useEffect(() => {
    if (!action && restoreFocus.current) {
      restoreFocus.current = false;
      if (document.activeElement === document.body) (trigger.current?.isConnected ? trigger.current : heading.current)?.focus();
    }
  }, [action, user]);
  function open(next: Action, button: HTMLButtonElement) {
    if (busy.current || needsReload) return;
    trigger.current = button; setReason(""); setError(""); setFeedback(""); setAction(next);
  }
  function cancel() {
    if (busy.current || needsReload) return;
    setAction(null); trigger.current?.focus();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!action || busy.current || needsReload) return;
    if (needsReason && !reason.trim()) { setError(tr("Indica un motivo non vuoto.")); textarea.current?.focus(); return; }
    busy.current = true; setSaving(true); setError(""); setFeedback("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, action, ...(needsReason ? { reason: reason.trim() } : {}) }) });
      if (response.status === 401 || response.status === 403) { onAccessLost(); return; }
      if (!response.ok) {
        if (response.status === 409 || response.status === 422 || response.status === 404) {
          const body = await response.json(); setError(tr(typeof body.error === "string" ? body.error : tr("Operazione rifiutata. Ricarica lo stato."))); await refresh(); return;
        }
        throw new Error("uncertain");
      }
      const body = await response.json(); if (body.saved_ok !== true) throw new Error("uncertain");
      if (body.accessLost) { onAccessLost(); return; }
      // Only restore when focus is still in this confirmation, never from another section.
      restoreFocus.current = Boolean(container.current?.contains(document.activeElement));
      if (!await refresh()) throw new Error("refresh unavailable");
      setAction(null); setFeedback(tr("Operazione completata."));
    } catch { setNeedsReload(true); setError(tr("Non è stato possibile verificare l’operazione. Ricarica la lista prima di riprovare.")); }
    finally { busy.current = false; setSaving(false); }
  }
  const roleAction: Action = user.role === "admin" ? "demote" : "promote";
  const banAction: Action = user.banned ? "unban" : "ban";
  const roleBlocked = roleAction === "demote" && protectedAdmin;
  const banBlocked = banAction === "ban" && (protectedAdmin || self);
  return <li ref={container} className="editor-panel border border-cyber-border bg-cyber-surface" style={{ minWidth: 0, overflowWrap: "anywhere", marginTop: 12 }}>
    <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold">{user.username}</h3>
    <dl><dt>{tr("Ruolo")}</dt><dd>{user.role === "admin" ? tr("Amministratore") : tr("Utente")}</dd><dt>{tr("Stato")}</dt><dd>{user.banned ? tr("Sospeso") : tr("Attivo")}</dd><dt>{tr("Creato il")}</dt><dd>{formatTimestamp(user.createdAt)}</dd></dl>
    {user.banReason && <p>{tr("Motivo: ")}{user.banReason}</p>}
    {protectedAdmin && <p id={`protected-${user.id}`} className="form-help">{tr("Deve restare almeno un amministratore attivo. Promuovi prima un altro utente.")}</p>}
    {self && !protectedAdmin && <p className="form-help">{tr("Non puoi sospendere il tuo account.")}</p>}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
      <button type="button" style={buttonStyle} className="secondary-btn" disabled={roleBlocked} aria-describedby={roleBlocked ? `protected-${user.id}` : undefined} title={roleBlocked ? tr("Ultimo amministratore attivo") : undefined} aria-disabled={saving || needsReload} onClick={e => open(roleAction, e.currentTarget)}>{tr(labels[roleAction])}</button>
      <button type="button" style={buttonStyle} className="secondary-btn" disabled={banBlocked} aria-describedby={protectedAdmin ? `protected-${user.id}` : undefined} title={banBlocked ? tr("Azione non consentita") : undefined} aria-disabled={saving || needsReload} onClick={e => open(banAction, e.currentTarget)}>{tr(labels[banAction])}</button>
    </div>
    {action && <form onSubmit={submit} aria-busy={saving} className="mt-4">
      <p>{tr(labels[action])}: {user.username}. {action === "ban" ? tr("L’utente non potrà accedere e le sessioni saranno revocate.") : action === "demote" ? tr("L’utente perderà i permessi amministrativi.") : action === "unban" ? tr("L’utente potrà accedere nuovamente.") : tr("L’utente potrà modificare la configurazione globale e gestire gli utenti.")}</p>
      {needsReason && <><label htmlFor={`reason-${user.id}`}>{tr("Motivo")}</label><textarea ref={textarea} id={`reason-${user.id}`} value={reason} maxLength={2000} readOnly={saving} onChange={e => { if (!busy.current) setReason(e.target.value); }} aria-invalid={error === tr("Indica un motivo non vuoto.")} aria-describedby={error ? `error-${user.id}` : undefined} className="w-full rounded-md border border-cyber-border bg-cyber-surface px-3 py-2" /></>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}><button ref={confirm} style={buttonStyle} className="primary-btn" type="submit" aria-disabled={saving || needsReload}>{tr(confirms[action])}</button><button type="button" style={buttonStyle} className="secondary-btn" aria-disabled={saving || needsReload} onClick={cancel}>{tr("Annulla")}</button></div>
    </form>}
    {saving && <p role="status">{tr("Operazione in corso…")}</p>}
    {feedback && <p role="status">{tr(feedback)}</p>}
    {error && <p id={`error-${user.id}`} role="alert">{tr(error)}</p>}
    {needsReload && <button type="button" className="secondary-btn" style={buttonStyle} onClick={async () => {
      if (busy.current) return;
      busy.current = true;
      try { if (await refresh()) { restoreFocus.current = true; setAction(null); setNeedsReload(false); setError(""); } }
      finally { busy.current = false; }
    }}>{tr("Ricarica lista")}</button>}
  </li>;
}
export function SettingsUsersCard({ onAccessLost }: { onAccessLost: () => void }) {
  const { tr } = useI18n();
  const [users, setUsers] = useState<User[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const lost = useRef(onAccessLost);
  useEffect(() => { lost.current = onAccessLost; }, [onAccessLost]);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) { lost.current(); return false; }
      if (!response.ok) throw new Error("unavailable");
      const body = await response.json(); if (!Array.isArray(body.users)) throw new Error("invalid");
      if (mounted.current) { setUsers(body.users); setCurrentUserId(body.currentUserId); return true; }
      return false;
    } catch { if (mounted.current) setError(tr("Lista utenti non disponibile. Riprova.")); return false; }
    finally { if (mounted.current) setLoading(false); }
  }, [tr]);
  useEffect(() => {
    mounted.current = true;
    // Loading is initially true; initiate I/O after subscribing to mount lifetime.
    const timer = setTimeout(() => { void load(); }, 0);
    return () => { mounted.current = false; clearTimeout(timer); };
  }, [load]);
  const activeAdmins = users?.filter(user => user.role === "admin" && !user.banned).length;
  return <section aria-labelledby="admin-users-heading" className="max-w-2xl mt-6">
    <h2 id="admin-users-heading" className="text-lg font-semibold">{tr("Utenti")}</h2>
    <p className="form-help">{tr("Gestisci ruoli e accesso all’istanza. Ogni azione richiede conferma.")}</p>
    {loading && users === null && <p role="status">{tr("Caricamento utenti…")}</p>}
    {error && <><p role="alert">{tr(error)}</p><button type="button" className="secondary-btn" style={buttonStyle} onClick={() => { void load(); }}>{tr("Riprova")}</button></>}
    {users?.length === 0 && <p>{tr("Nessun utente disponibile.")}</p>}
    {users && <ul style={{ padding: 0, listStyle: "none" }}>{users.map(user => <UserCard key={user.id} user={user} protectedAdmin={activeAdmins === 1 && user.role === "admin" && !user.banned} self={user.id === currentUserId} refresh={load} onAccessLost={onAccessLost} />)}</ul>}
  </section>;
}
