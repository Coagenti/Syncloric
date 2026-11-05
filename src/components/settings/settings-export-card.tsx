"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState } from "react";
import { UiIcon } from "@/components/ui-icon";
type Token = { id: string; label: string; createdAt: string; expiresAt: string; lastUsedAt: string | null };
const endpoint = "/api/v1/settings/export-tokens";
export function SettingsExportCard() {
  const { tr, formatTimestamp } = useI18n();
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
    }).catch(() => { if (!controller.signal.aborted && initial === revision.current) setError(tr("Elenco token non disponibile. Ricarica la pagina per riprovare.")); });
    return () => controller.abort();
  }, [tr]);
  async function mutate(id?: string) {
    if (inFlight.current) return;
    inFlight.current = true; revision.current++; setBusy(true); setError(""); setFeedback("");
    const submittedLabel = label;
    try {
      const response = await fetch(id ? `${endpoint}?id=${encodeURIComponent(id)}` : endpoint, { method: id ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: id ? undefined : JSON.stringify({ label, expiresInDays: Number(days) }) });
      if (!response.ok) { const data = await response.json().catch(() => null); setError(tr(data?.error ?? "Operazione non riuscita.")); return; }
      const data = await response.json();
      if (id) { setTokens(current => current.filter(token => token.id !== id)); setRevoking(null); setFeedback(tr("Token revocato.")); }
      else { setTokens(current => [data.metadata, ...current]); setSecret(data.token); setLabel(current => current === submittedLabel ? "" : current); setFeedback(tr("Token creato. Copialo ora: non sarà mostrato di nuovo.")); }
    } catch { setError(tr("Operazione non verificata. Ricarica l’elenco prima di riprovare.")); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function url(format: string) { const params = new URLSearchParams({ format }); if (from) params.set("from", from); if (to) params.set("to", to); return `/api/v1/export?${params}`; }
  const validRange = !from || !to || from <= to;
  return <section className="editor-panel export-card" aria-labelledby="export-settings-title"><h2 id="export-settings-title">{tr("I tuoi dati")}</h2>
    <p className="form-help">{tr("JSON contiene profilo, alimenti creati da te e diario con nutrienti. CSV contiene le voci del diario con una colonna per ogni nutriente. Password, chiavi API e token sono esclusi.")}</p>
    <div className="form-columns"><label>{tr("Dal giorno")}<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{tr("Al giorno")}<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
    {!validRange && <p role="alert">{tr("La data finale deve essere successiva o uguale alla data iniziale.")}</p>}
    <div className="export-actions export-downloads">{validRange && <>
      <a className="export-download export-download-json" href={url("json")} download aria-label={tr("Esporta JSON")}><UiIcon name="download" /><span className="export-download-label"><span>{tr("Esporta")}</span><strong>JSON</strong></span></a>
      <a className="export-download export-download-csv" href={url("csv")} download aria-label={tr("Esporta CSV")}><UiIcon name="download" /><span className="export-download-label"><span>{tr("Esporta")}</span><strong>CSV</strong></span></a>
    </>}</div>
    <h3>{tr("Accesso API personale")}</h3><p className="form-help">{tr("Crea un token di sola lettura per esportare soltanto i tuoi dati. Puoi revocarlo in qualsiasi momento; non permette modifiche al diario.")}</p>
    <form onSubmit={e => { e.preventDefault(); void mutate(); }}><label>{tr("Nome token")}<input required maxLength={64} value={label} onChange={e => setLabel(e.target.value)} placeholder={tr("Es. Il mio script")} /></label>
      <label>{tr("Scadenza token")}<select value={days} onChange={e => setDays(e.target.value)}><option value="30">{tr("30 giorni")}</option><option value="90">{tr("90 giorni")}</option><option value="365">{tr("365 giorni")}</option></select></label>
      <button type="submit" className="primary-btn" disabled={busy || !label.trim()}>{tr("Genera token export")}</button></form>
    {secret && <div className="token-secret"><label>{tr("Token appena creato")}<input readOnly value={secret} autoComplete="off" spellCheck={false} /></label><div className="export-actions"><button type="button" className="secondary-btn" onClick={async () => { try { await navigator.clipboard.writeText(secret); setFeedback(tr("Token copiato.")); } catch { setError(tr("Copia non disponibile. Seleziona e copia il token manualmente.")); } }}>{tr("Copia token")}</button><button type="button" className="secondary-btn" onClick={() => setSecret("")}>{tr("Nascondi token")}</button></div></div>}
    {tokens.length > 0 && <ul className="export-token-list">{tokens.map(token => <li key={token.id}><strong>{token.label}</strong><span>{tr("Scade: ")}{formatTimestamp(token.expiresAt)}</span>{revoking === token.id ? <div className="export-actions"><button type="button" className="danger-btn" disabled={busy} onClick={() => { void mutate(token.id); }}>{tr("Conferma revoca")}</button><button type="button" className="secondary-btn" disabled={busy} onClick={() => setRevoking(null)}>{tr("Annulla revoca")}</button></div> : <button type="button" className="secondary-btn" disabled={busy} onClick={() => { setSecret(""); setRevoking(token.id); }} aria-label={tr("Revoca token {0}", { "0": token.label })}>{tr("Revoca")}</button>}</li>)}</ul>}
    <details className="export-api-help"><summary>{tr("Come usare l’API")}</summary><p>GET <code>/api/v1/export?format=json</code>{tr(" oppure ")}<code>format=csv</code>{tr(", con header ")}<code>Authorization: Bearer &lt;token&gt;</code>{tr(". Filtri facoltativi: ")}<code>from</code>{tr(" e ")}<code>to</code>{tr(" (YYYY-MM-DD). Usa HTTPS per le richieste da altri dispositivi.")}</p></details>
    {busy && <p role="status">{tr("Operazione token in corso…")}</p>}{feedback && <p role="status">{tr(feedback)}</p>}{error && <p role="alert">{tr(error)}</p>}
  </section>;
}
