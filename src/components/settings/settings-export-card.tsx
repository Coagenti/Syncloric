"use client";
import { useEffect, useRef, useState } from "react";
type Token = { id: string; label: string; createdAt: string; expiresAt: string; lastUsedAt: string | null };
const endpoint = "/api/v1/settings/export-tokens";
export function SettingsExportCard() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [label, setLabel] = useState(""); const [days, setDays] = useState("90");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [secret, setSecret] = useState(""); const [error, setError] = useState(""); const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false); const inFlight = useRef(false); const revision = useRef(0);
  const [revoking, setRevoking] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); const initial = revision.current;
    void fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error(); const data = await response.json(); if (!Array.isArray(data.tokens)) throw new Error();
      if (!controller.signal.aborted && initial === revision.current) setTokens(data.tokens);
    }).catch(() => { if (!controller.signal.aborted && initial === revision.current) setError("Elenco token non disponibile. Ricarica la pagina per riprovare."); });
    return () => controller.abort();
  }, []);
  async function mutate(id?: string) {
    if (inFlight.current) return;
    inFlight.current = true; revision.current++; setBusy(true); setError(""); setFeedback("");
    const submittedLabel = label;
    try {
      const response = await fetch(id ? `${endpoint}?id=${encodeURIComponent(id)}` : endpoint, { method: id ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: id ? undefined : JSON.stringify({ label, expiresInDays: Number(days) }) });
      if (!response.ok) { const data = await response.json().catch(() => null); setError(data?.error ?? "Operazione non riuscita."); return; }
      const data = await response.json();
      if (id) { setTokens(current => current.filter(token => token.id !== id)); setRevoking(null); setFeedback("Token revocato."); }
      else { setTokens(current => [data.metadata, ...current]); setSecret(data.token); setLabel(current => current === submittedLabel ? "" : current); setFeedback("Token creato. Copialo ora: non sarà mostrato di nuovo."); }
    } catch { setError("Operazione non verificata. Ricarica l’elenco prima di riprovare."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function url(format: string) { const params = new URLSearchParams({ format }); if (from) params.set("from", from); if (to) params.set("to", to); return `/api/v1/export?${params}`; }
  const validRange = !from || !to || from <= to;
  return <section className="editor-panel export-card" aria-labelledby="export-settings-title"><h2 id="export-settings-title">I tuoi dati</h2>
    <p className="form-help">JSON contiene profilo, alimenti creati da te e diario con nutrienti. CSV contiene le voci del diario con una colonna per ogni nutriente. Password, chiavi API e token sono esclusi.</p>
    <div className="form-columns"><label>Dal giorno<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Al giorno<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
    {!validRange && <p role="alert">La data finale deve essere successiva o uguale alla data iniziale.</p>}
    <div className="export-actions">{validRange && <><a className="secondary-btn" href={url("json")} download>Esporta JSON</a><a className="secondary-btn" href={url("csv")} download>Esporta CSV</a></>}</div>
    <h3>Accesso API personale</h3><p className="form-help">Crea un token di sola lettura per esportare soltanto i tuoi dati. Puoi revocarlo in qualsiasi momento; non permette modifiche al diario.</p>
    <form onSubmit={e => { e.preventDefault(); void mutate(); }}><label>Nome token<input required maxLength={64} value={label} onChange={e => setLabel(e.target.value)} placeholder="Es. Il mio script" /></label>
      <label>Scadenza token<select value={days} onChange={e => setDays(e.target.value)}><option value="30">30 giorni</option><option value="90">90 giorni</option><option value="365">365 giorni</option></select></label>
      <button type="submit" className="primary-btn" disabled={busy || !label.trim()}>Genera token export</button></form>
    {secret && <div className="token-secret"><label>Token appena creato<input readOnly value={secret} autoComplete="off" spellCheck={false} /></label><div className="export-actions"><button type="button" className="secondary-btn" onClick={async () => { try { await navigator.clipboard.writeText(secret); setFeedback("Token copiato."); } catch { setError("Copia non disponibile. Seleziona e copia il token manualmente."); } }}>Copia token</button><button type="button" className="secondary-btn" onClick={() => setSecret("")}>Nascondi token</button></div></div>}
    {tokens.length > 0 && <ul className="export-token-list">{tokens.map(token => <li key={token.id}><strong>{token.label}</strong><span>Scade: {new Intl.DateTimeFormat("it-IT").format(new Date(token.expiresAt))}</span>{revoking === token.id ? <div className="export-actions"><button type="button" className="danger-btn" disabled={busy} onClick={() => { void mutate(token.id); }}>Conferma revoca</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => setRevoking(null)}>Annulla revoca</button></div> : <button type="button" className="secondary-btn" disabled={busy} onClick={() => { setSecret(""); setRevoking(token.id); }} aria-label={`Revoca token ${token.label}`}>Revoca</button>}</li>)}</ul>}
    <details className="export-api-help"><summary>Come usare l’API</summary><p>GET <code>/api/v1/export?format=json</code> oppure <code>format=csv</code>, con header <code>Authorization: Bearer &lt;token&gt;</code>. Filtri facoltativi: <code>from</code> e <code>to</code> (YYYY-MM-DD). Usa HTTPS per le richieste da altri dispositivi.</p></details>
    {busy && <p role="status">Operazione token in corso…</p>}{feedback && <p role="status">{feedback}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
