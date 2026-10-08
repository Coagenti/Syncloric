"use client";
import { useEffect, useRef, useState } from "react";
import { slotLabels, type Slot } from "@/lib/diary";
import { Expiry, postJson, requestJson, SharingDialog } from "./common";
type Metadata = { id: string; date: string; slot: Slot; expiresAt: string };
export function ShareMealDialog({ date, slot, onClose }: { date: string; slot: Slot; onClose: () => void }) {
  const [metadata, setMetadata] = useState<Metadata | null>(null); const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [feedback, setFeedback] = useState("");
  const inFlight = useRef(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson("/api/v1/meals/links", { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setMetadata(data.links.find((link: Metadata) => link.date === date && link.slot === slot) ?? null); setError(""); } })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, slot, revision]);
  async function act(revoke: boolean) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      if (revoke && metadata) { await requestJson(`/api/v1/meals/links?id=${metadata.id}`, { method: "DELETE" }); setMetadata(null); setUrl(""); setFeedback("Link revocato."); }
      else { const data = await postJson("/api/v1/meals/links", { date, slot }); setMetadata(data.metadata); setUrl(new URL(data.path, window.location.origin).href); setFeedback("Link pronto. È leggibile da chi lo riceve per 2 ore."); }
    } catch (error) { setError(error instanceof Error ? error.message : "Operazione non verificata. Ricarica i link."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <SharingDialog title={`Condividi ${slotLabels[slot]}`} busy={busy} onClose={onClose}>
    <p className="form-help">Il link mostra una copia di questo singolo pasto, con quantità, kcal e nutrienti. Scade dopo 2 ore. Chi ha un account può copiarne tutte le voci o solo alcune.</p><p className="form-help">Le successive modifiche al pasto non aggiornano il link. Generane uno nuovo per condividere i valori aggiornati: quello precedente verrà invalidato.</p>
    {loading ? <p role="status">Caricamento link…</p> : <div className="editor-actions"><button type="button" className="primary-btn" disabled={busy} onClick={() => { void act(false); }}>{metadata ? "Genera nuovo link" : "Genera link · 2 ore"}</button>{metadata && <button type="button" className="danger-btn" disabled={busy} onClick={() => { void act(true); }}>Revoca link</button>}</div>}
    {metadata && <p><Expiry at={metadata.expiresAt} /></p>}{url && <div className="share-secret"><label>URL del pasto<input readOnly value={url} onFocus={e => e.currentTarget.select()} /></label><button type="button" className="secondary-btn" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setFeedback("Link copiato."), () => setFeedback("Seleziona e copia il link manualmente.")); }}>Copia link</button><a href={url} target="_blank" rel="noopener noreferrer">Anteprima del pasto</a></div>}
    {feedback && <p role="status">{feedback}</p>}{error && <p role="alert">{error} <button type="button" className="text-btn" disabled={busy} onClick={() => { setLoading(true); setUrl(""); setRevision(v => v + 1); }}>Ricarica link</button></p>}
  </SharingDialog>;
}
