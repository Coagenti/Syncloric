"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState } from "react";
import { UiIcon } from "@/components/ui-icon";
import type { Label } from "@/server/services/ai/extract";
type Status = { ready: boolean; provider: "openai" | "anthropic" | "ollama" | null; cloud: boolean };
/** Selection/preview stay local; only the explicit extraction button sends a photo. */
export function LabelScan({ onExtract, onBusy, variant = "inline" }: { onExtract: (label: Label) => void; onBusy: (busy: boolean) => void; variant?: "inline" | "view" }) {
  const { tr } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(true);
  const [image, setImage] = useState<{ mime: string; base64: string } | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Label | null>(null);
  const request = useRef<AbortController | null>(null); const run = useRef(0);
  const photoInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const controller = new AbortController(); const generation = run;
    void fetch("/api/v1/label-scan", { signal: controller.signal, cache: "no-store" }).then(async response => {
      if (!response.ok) return; const data = await response.json() as Status; if (!controller.signal.aborted) setStatus(data);
    }).catch(() => {}).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => { controller.abort(); request.current?.abort(); generation.current++; };
  }, []);
  async function select(file?: File) {
    const current = ++run.current; setImage(null); setResult(null); setError("");
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { setError(tr("Usa JPEG, PNG o WebP fino a 5 MB. Puoi compilare manualmente.")); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (run.current !== current) return;
    let text = ""; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    setImage({ mime: file.type, base64: btoa(text) });
  }
  async function extract() {
    if (!image || busy || !status?.ready || !status.provider) return;
    const current = ++run.current; const controller = new AbortController(); request.current = controller;
    setBusy(true); onBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/v1/label-scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...image, expectedProvider: status.provider }), signal: controller.signal });
      if (!response.ok) {
        const failure = await response.json() as { code?: string };
        if (response.status === 409 && failure.code === "AI_PROVIDER_CHANGED") {
          if (current !== run.current || controller.signal.aborted) return;
          setStatus(null);
          setChecking(true);
          setError(tr("Il provider AI è cambiato. Verifica il nuovo destinatario prima di riprovare o compila manualmente: i tuoi valori sono stati mantenuti."));
          try {
            const refreshed = await fetch("/api/v1/label-scan", { signal: controller.signal, cache: "no-store" });
            if (refreshed.ok) { const next = await refreshed.json() as Status; if (current === run.current && !controller.signal.aborted) setStatus(next); }
          } finally { if (current === run.current && !controller.signal.aborted) setChecking(false); }
          return;
        }
        throw new Error("failed");
      }
      const data = await response.json() as { label: Label };
      if (current !== run.current || controller.signal.aborted) return;
      onExtract(data.label); setResult(data.label); setImage(null); if (photoInput.current) photoInput.current.value = "";
    } catch { if (!controller.signal.aborted && current === run.current) setError(tr("Etichetta non leggibile o AI non disponibile. Riprova o compila manualmente: i tuoi valori sono stati mantenuti.")); }
    finally { if (current === run.current) { setBusy(false); onBusy(false); } }
  }
  const ready = !!status?.ready && !!status.provider;
  const ledState = checking ? "checking" : ready ? "ready" : "off";
  return <section className={variant === "view" ? "scanner-view label-scanner" : undefined} aria-label={tr("Scansione AI etichetta")}>
    {variant === "view" ? <>
      <div className="label-scanner-heading"><span className="section-kicker">{tr("ETICHETTA / AI")}</span><span className="ai-service-status" data-state={ledState} role="status"><i aria-hidden="true" />{checking ? tr("Verifica AI…") : ready ? tr("AI attiva") : status ? tr("AI disattivata") : tr("AI non disponibile")}</span></div>
      <div className="camera-stage label-camera-stage">
        <div className="scanner-reticle" aria-hidden="true"><i /><i /><i /><i /></div>
        {image ? <>
          {/* Local data URL preview, no image optimization or remote upload. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="label-photo-preview" src={`data:${image.mime};base64,${image.base64}`} alt={tr("Anteprima etichetta")} />
        </> : <div className="camera-placeholder"><UiIcon name="camera" /><h2>{tr("Fotografa la tabella nutrizionale")}</h2><p>{tr("Kcal, nutrienti e unità devono essere ben leggibili. L’AI estrae automaticamente i valori: verificali prima di salvare.")}</p><button type="button" className="primary-btn" disabled={!ready || checking || busy} onClick={() => photoInput.current?.click()}><UiIcon name="camera" />{tr("Fotografa o carica")}</button></div>}
      </div>
      <input ref={photoInput} hidden aria-label={tr("Foto etichetta")} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!ready || checking || busy} onChange={event => void select(event.target.files?.[0])} />
    </> : <><h3>{tr("Etichetta nutrizionale con AI")}</h3><p className="form-help">{tr("AI assistiva: verifica e modifica i valori prima di registrare. Nessun salvataggio automatico.")}</p></>}
    {checking ? variant === "inline" && <p role="status">{tr("Verifica disponibilità AI…")}</p> : !ready ? <p role="status">{status ? tr("AI non configurata o disabilitata. Compila il prodotto manualmente.") : tr("Impossibile verificare la disponibilità AI. Riprova o compila il prodotto manualmente.")}</p> : <>
      {variant === "inline" && <label>{tr("Foto etichetta")}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={event => void select(event.target.files?.[0])} /></label>}
      <p className="form-help">{status.cloud ? tr("La foto sarà inviata a {0} solo premendo Scansiona etichetta. Non includere dati personali.", { "0": status.provider === "openai" ? "OpenAI" : "Anthropic" }) : tr("La foto sarà inviata al server Ollama configurato, solo premendo Scansiona etichetta.")}{tr(" Syncloric non conserva le foto.")}</p>
      {image && <>
        {variant === "inline" && <>
          {/* Local data URL preview, no image optimization or remote upload. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:${image.mime};base64,${image.base64}`} alt={tr("Anteprima etichetta")} style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }} />
        </>}
        <div className={variant === "view" ? "label-photo-actions" : undefined}>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => void extract()}>{tr("Scansiona etichetta")}</button>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => { run.current++; setImage(null); if (photoInput.current) photoInput.current.value = ""; }}>{tr("Rimuovi foto")}</button>
        </div>
      </>}
    </>}
    <p className="form-help">{tr("Se visibile nella foto, viene proposto anche il codice a barre: verificalo prima di salvare.")}</p>
    {busy && <p role="status">{tr("Lettura etichetta in corso…")}</p>}
    {error && <p role="alert">{tr(error)}</p>}
    {result && <p role="status">{tr("Valori proposti da AI: verifica il form prima di confermare.")}{result.servingSize != null && tr(" Porzione indicata: {0} g (non modifica i grammi registrati).", { "0": result.servingSize })}{result.per100g.fiber != null && tr(" Fibre: {0} g/100 g.", { "0": result.per100g.fiber })}{result.per100g.salt != null && tr(" Sale: {0} g/100 g.", { "0": result.per100g.salt })}{tr(" I nutrienti leggibili sono riportati nel modulo; controlla anche le unità di vitamine e minerali.")}</p>}
  </section>;
}
