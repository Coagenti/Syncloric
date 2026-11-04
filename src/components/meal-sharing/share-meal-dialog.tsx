"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState } from "react";
import { slotLabels, type Slot } from "@/lib/diary";
import { Expiry, postJson, requestJson, SharingDialog } from "./common";
type Metadata = { id: string; date: string; slot: Slot; expiresAt: string };
export function ShareMealDialog({ date, slot, onClose }: { date: string; slot: Slot; onClose: () => void }) {
  const { tr } = useI18n();
  const [metadata, setMetadata] = useState<Metadata | null>(null); const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [feedback, setFeedback] = useState("");
  const inFlight = useRef(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson("/api/v1/meals/links", { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setMetadata(data.links.find((link: Metadata) => link.date === date && link.slot === slot) ?? null); setError(""); } })
      .catch(error => { if (!controller.signal.aborted) setError(tr(error.message)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, slot, revision, tr]);
  async function act(revoke: boolean) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setError(""); setFeedback("");
    try {
      if (revoke && metadata) { await requestJson(`/api/v1/meals/links?id=${metadata.id}`, { method: "DELETE" }); setMetadata(null); setUrl(""); setFeedback(tr("Link revocato.")); }
      else { const data = await postJson("/api/v1/meals/links", { date, slot }); setMetadata(data.metadata); setUrl(new URL(data.path, window.location.origin).href); setFeedback(tr("Link pronto. È leggibile da chi lo riceve per 2 ore.")); }
    } catch (error) { setError(tr(error instanceof Error ? error.message : tr("Operazione non verificata. Ricarica i link."))); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <SharingDialog title={tr("Condividi {0}", { "0": tr(slotLabels[slot]) })} busy={busy} onClose={onClose}>
    <p className="form-help">{tr("Il link mostra una copia di questo singolo pasto, con quantità, kcal e nutrienti. Scade dopo 2 ore. Chi ha un account può copiarne tutte le voci o solo alcune.")}</p><p className="form-help">{tr("Le successive modifiche al pasto non aggiornano il link. Generane uno nuovo per condividere i valori aggiornati: quello precedente verrà invalidato.")}</p>
    {loading ? <p role="status">{tr("Caricamento link…")}</p> : <div className="editor-actions"><button type="button" className="primary-btn" disabled={busy} onClick={() => { void act(false); }}>{metadata ? tr("Genera nuovo link") : tr("Genera link · 2 ore")}</button>{metadata && <button type="button" className="danger-btn" disabled={busy} onClick={() => { void act(true); }}>{tr("Revoca link")}</button>}</div>}
    {metadata && <p><Expiry at={metadata.expiresAt} /></p>}{url && <div className="share-secret"><label>{tr("URL del pasto")}<input readOnly value={url} onFocus={e => e.currentTarget.select()} /></label><button type="button" className="secondary-btn" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setFeedback(tr("Link copiato.")), () => setFeedback(tr("Seleziona e copia il link manualmente."))); }}>{tr("Copia link")}</button><a href={url} target="_blank" rel="noopener noreferrer">{tr("Anteprima del pasto")}</a></div>}
    {feedback && <p role="status">{tr(feedback)}</p>}{error && <p role="alert">{tr(error)} <button type="button" className="text-btn" disabled={busy} onClick={() => { setLoading(true); setUrl(""); setRevision(v => v + 1); }}>{tr("Ricarica link")}</button></p>}
  </SharingDialog>;
}
