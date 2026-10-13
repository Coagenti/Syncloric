"use client";
import { useEffect, useRef, useState } from "react";
import { UiIcon } from "@/components/ui-icon";
import type { Label } from "@/server/services/ai/extract";
type Status = { ready: boolean; provider: "openai" | "anthropic" | "ollama" | null; cloud: boolean };
/** Selection/preview stay local; only the explicit extraction button sends a photo. */
export function LabelScan({ onExtract, onBusy, variant = "inline" }: { onExtract: (label: Label) => void; onBusy: (busy: boolean) => void; variant?: "inline" | "view" }) {
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
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { setError("Usa JPEG, PNG o WebP fino a 5 MB. Puoi compilare manualmente."); return; }
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
          setError("Il provider AI è cambiato. Verifica il nuovo destinatario prima di riprovare o compila manualmente: i tuoi valori sono stati mantenuti.");
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
    } catch { if (!controller.signal.aborted && current === run.current) setError("Etichetta non leggibile o AI non disponibile. Riprova o compila manualmente: i tuoi valori sono stati mantenuti."); }
    finally { if (current === run.current) { setBusy(false); onBusy(false); } }
  }
  const ready = !!status?.ready && !!status.provider;
  const ledState = checking ? "checking" : ready ? "ready" : "off";
  return <section className={variant === "view" ? "scanner-view label-scanner" : undefined} aria-label="Scansione AI etichetta">
    {variant === "view" ? <>
      <div className="label-scanner-heading"><span className="section-kicker">ETICHETTA / AI</span><span className="ai-service-status" data-state={ledState} role="status"><i aria-hidden="true" />{checking ? "Verifica AI…" : ready ? "AI attiva" : status ? "AI disattivata" : "AI non disponibile"}</span></div>
      <div className="camera-stage label-camera-stage">
        <div className="scanner-reticle" aria-hidden="true"><i /><i /><i /><i /></div>
        {image ? <>
          {/* Local data URL preview, no image optimization or remote upload. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="label-photo-preview" src={`data:${image.mime};base64,${image.base64}`} alt="Anteprima etichetta" />
        </> : <div className="camera-placeholder"><UiIcon name="camera" /><h2>Fotografa la tabella nutrizionale</h2><p>Kcal, nutrienti e unità devono essere ben leggibili. L’AI estrae automaticamente i valori: verificali prima di salvare.</p><button type="button" className="primary-btn" disabled={!ready || checking || busy} onClick={() => photoInput.current?.click()}><UiIcon name="camera" />Fotografa o carica</button></div>}
      </div>
      <input ref={photoInput} hidden aria-label="Foto etichetta" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={!ready || checking || busy} onChange={event => void select(event.target.files?.[0])} />
    </> : <><h3>Etichetta nutrizionale con AI</h3><p className="form-help">AI assistiva: verifica e modifica i valori prima di registrare. Nessun salvataggio automatico.</p></>}
    {checking ? variant === "inline" && <p role="status">Verifica disponibilità AI…</p> : !ready ? <p role="status">{status ? "AI non configurata o disabilitata. Compila il prodotto manualmente." : "Impossibile verificare la disponibilità AI. Riprova o compila il prodotto manualmente."}</p> : <>
      {variant === "inline" && <label>Foto etichetta<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={busy} onChange={event => void select(event.target.files?.[0])} /></label>}
      <p className="form-help">{status.cloud ? `La foto sarà inviata a ${status.provider === "openai" ? "OpenAI" : "Anthropic"} solo premendo Scansiona etichetta. Non includere dati personali.` : "La foto sarà inviata al server Ollama configurato, solo premendo Scansiona etichetta."} Syncloric non conserva le foto.</p>
      {image && <>
        {variant === "inline" && <>
          {/* Local data URL preview, no image optimization or remote upload. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:${image.mime};base64,${image.base64}`} alt="Anteprima etichetta" style={{ maxWidth: "100%", maxHeight: 220, objectFit: "contain" }} />
        </>}
        <div className={variant === "view" ? "label-photo-actions" : undefined}>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => void extract()}>Scansiona etichetta</button>
          <button type="button" className="secondary-btn" disabled={busy} onClick={() => { run.current++; setImage(null); if (photoInput.current) photoInput.current.value = ""; }}>Rimuovi foto</button>
        </div>
      </>}
    </>}
    {busy && <p role="status">Lettura etichetta in corso…</p>}
    {error && <p role="alert">{error}</p>}
    {result && <p role="status">Valori proposti da AI: verifica il form prima di confermare.{result.servingSize != null && ` Porzione indicata: ${result.servingSize} g (non modifica i grammi registrati).`}{result.per100g.fiber != null && ` Fibre: ${result.per100g.fiber} g/100 g.`}{result.per100g.salt != null && ` Sale: ${result.per100g.salt} g/100 g.`} I nutrienti leggibili sono riportati nel modulo; controlla anche le unità di vitamine e minerali.</p>}
  </section>;
}
