"use client";
import { useEffect, useRef, useState } from "react";
import type { Household } from "@/lib/meal-sharing";
import { Expiry, postJson, requestJson } from "@/components/meal-sharing/common";
import { UiIcon } from "@/components/ui-icon";
const endpoint = "/api/v1/household";
type Confirmation = { action: "leave" | "remove" | "transfer"; userId?: string; message: string };
export function SettingsHouseholdCard() {
  const [household, setHousehold] = useState<Household | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); const [feedback, setFeedback] = useState("");
  const [code, setCode] = useState(""); const [joinCode, setJoinCode] = useState(""); const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<Confirmation | null>(null); const inFlight = useRef(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson(endpoint, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setHousehold(data.household); setError(""); } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  async function act(data: Record<string, unknown>) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      const result = await postJson(endpoint, data); setHousehold(result.household); setCode(result.code ?? ""); setJoinCode(""); setName(""); setConfirm(null);
      setFeedback(data.action === "join" ? "Sei nel nucleo. Puoi consultare i pasti dei membri dal diario." : data.action === "leave" ? "Hai lasciato il nucleo." : "Nucleo aggiornato.");
    } catch (error) { setError(error instanceof Error ? error.message : "Operazione non verificata. Ricarica la pagina."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const owner = household?.ownerId === household?.currentUserId;
  return <section className="editor-panel settings-card household-card" aria-labelledby="household-title" aria-busy={busy || loading}>
    <div className="settings-card-heading"><UiIcon name="family" /><h2 id="household-title">Nucleo familiare</h2></div>
    <p className="form-help">Nel nucleo tutti possono leggere i pasti degli altri e copiarli nel proprio diario. Obiettivi, chiavi e impostazioni restano personali.</p>
    {loading ? <p role="status">Caricamento nucleo…</p> : !household ? <fieldset disabled={busy}>
      <form onSubmit={e => { e.preventDefault(); void act({ action: "create", name }); }}><label>Nome del nucleo<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label><button type="submit" className="primary-btn">Crea nucleo</button></form>
      <form className="household-join" onSubmit={e => { e.preventDefault(); void act({ action: "join", code: joinCode }); }}><label>Codice di invito<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" value={joinCode} onChange={e => setJoinCode(e.target.value.replace(/\D/g, ""))} /></label><button type="submit" className="secondary-btn">Unisciti al nucleo</button></form>
    </fieldset> : <fieldset disabled={busy}>
      <h3 className="household-name">{household.name}</h3><p className="form-help">{owner ? "Amministratore del nucleo" : "Membro del nucleo"} · {household.members.length} membri</p>
      <ul className="household-member-list">{household.members.map(member => <li key={member.id}><span><strong>{member.username}</strong>{member.isOwner && <small>Amministratore</small>}{member.banned && <small>Account sospeso</small>}</span>{owner && member.id !== household.currentUserId && <div className="household-member-actions"><button type="button" className="secondary-btn" disabled={member.banned} onClick={() => setConfirm({ action: "transfer", userId: member.id, message: `Passare l’amministrazione a ${member.username}?` })}>Passa amministrazione</button><button type="button" className="neon-action delete-action" aria-label={`Rimuovi ${member.username}`} onClick={() => setConfirm({ action: "remove", userId: member.id, message: `Rimuovere ${member.username} dal nucleo?` })}><UiIcon name="trash" /></button></div>}</li>)}</ul>
      {owner && <><div className="household-invite"><button type="button" className="secondary-btn" onClick={() => { void act({ action: "regenerate" }); }}><UiIcon name="plus" />{code ? "Rigenera codice" : "Genera codice di invito"}</button><p className="form-help">Codice valido 10 minuti. Rigenerarlo invalida quello precedente.</p>{code && household.joinCodeExpiresAt && <div className="share-secret"><label>Codice da condividere<input readOnly value={code} /></label><Expiry at={household.joinCodeExpiresAt} /></div>}</div>
        <details><summary>Modifica nome del nucleo</summary><form onSubmit={e => { e.preventDefault(); void act({ action: "rename", name }); }}><label>Nuovo nome<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label><button type="submit" className="secondary-btn">Salva nome</button></form></details></>}
      <button type="button" className="secondary-btn" onClick={() => setConfirm({ action: "leave", message: household.members.length === 1 ? "Uscire e chiudere il nucleo? I diari personali restano disponibili." : "Uscire dal nucleo? Le copie già inserite resteranno nel tuo diario." })}>Esci dal nucleo</button>
      {confirm && <div className="household-confirm" role="group" aria-label="Conferma modifica del nucleo"><p>{confirm.message}</p><button type="button" className="secondary-btn" onClick={() => setConfirm(null)}>Annulla</button><button type="button" className="danger-btn" onClick={() => { const { action, userId } = confirm; void act({ action, ...(userId ? { userId } : {}) }); }}>Conferma</button></div>}
    </fieldset>}
    {feedback && <p role="status">{feedback}</p>}{error && <p role="alert">{error} <button type="button" className="text-btn" disabled={busy} onClick={() => { setLoading(true); setCode(""); setConfirm(null); setRevision(value => value + 1); }}>Ricarica nucleo</button></p>}
  </section>;
}
