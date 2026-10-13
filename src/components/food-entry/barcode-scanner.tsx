"use client";
import { useEffect, useRef, useState } from "react";
import { UiIcon } from "@/components/ui-icon";
import { createBarcodeReader } from "@/lib/barcode-reader";
export function BarcodeScanner({ onCode, busy }: { onCode: (code: string) => void; busy: boolean }) {
  const [code, setCode] = useState(""); const [camera, setCamera] = useState(false); const [starting, setStarting] = useState(false); const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const generation = useRef(0);
  function stop() { generation.current++; if (timer.current) clearTimeout(timer.current); timer.current = null; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; if (video.current) video.current.srcObject = null; setCamera(false); setStarting(false); }
  useEffect(() => {
    const current = generation;
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", stop);
    return () => { current.current++; if (timer.current) clearTimeout(timer.current); stream.current?.getTracks().forEach(track => track.stop()); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", stop); };
  }, []);
  async function start() {
    if (camera || starting || busy) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError("Per la fotocamera apri Syncloric tramite HTTPS attendibile. Puoi inserire il codice manualmente."); return; }
    setStarting(true); setError(""); const run = ++generation.current;
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } }, audio: false });
      if (run !== generation.current) { captured.getTracks().forEach(track => track.stop()); return; }
      stream.current = captured; setCamera(true); setStarting(false);
      const element = video.current!; element.srcObject = captured; await element.play();
      const reader = await createBarcodeReader((window as unknown as { BarcodeDetector?: Parameters<typeof createBarcodeReader>[0] }).BarcodeDetector);
      async function detect() {
        if (run !== generation.current) return;
        try { const found = (await reader.detect(element)).find(v => /^\d{8,14}$/.test(v.rawValue)); if (found && run === generation.current) { stop(); setCode(found.rawValue); onCode(found.rawValue); return; } }
        catch { if (run === generation.current) { stop(); setError("Lettura interrotta. Riavvia la fotocamera o inserisci il codice."); } return; }
        if (run === generation.current) timer.current = setTimeout(() => void detect(), 180);
      }
      void detect();
    } catch (failure) {
      if (run !== generation.current) return;
      stop(); setError(failure instanceof DOMException && failure.name === "NotAllowedError" ? "Accesso alla fotocamera negato. Consenti l’accesso nel browser o inserisci il codice." : "Fotocamera non disponibile. Inserisci il codice manualmente.");
    }
  }
  return <section className="scanner-view" aria-label="Scansione codice a barre">
    <div className={`camera-stage ${camera ? "is-live" : ""}`}><video ref={video} muted playsInline hidden={!camera} aria-label="Anteprima scanner" /><div className="scanner-reticle" aria-hidden="true"><i /><i /><i /><i />{camera && <span />}</div>{!camera && <div className="camera-placeholder"><UiIcon name="scan" /><h2>Inquadra il codice a barre</h2><p>Il prodotto si apre appena viene riconosciuto.</p><button type="button" className="primary-btn" disabled={starting || busy} onClick={() => void start()}>{starting ? "Avvio fotocamera…" : "Avvia fotocamera"}</button></div>}</div>
    {camera && <button type="button" className="secondary-btn" onClick={stop}>Ferma fotocamera</button>}
    <p className="form-help">La lettura avviene sul dispositivo. Le immagini della fotocamera non vengono inviate.</p>
    <form className="barcode-manual" onSubmit={event => { event.preventDefault(); if (!busy) { stop(); onCode(code); } }}><label>Codice a barre<input required inputMode="numeric" pattern="[0-9]{8,14}" maxLength={14} value={code} disabled={busy || starting} placeholder="Es. 8001234567890" onChange={event => setCode(event.target.value)} /></label><button type="submit" className="secondary-btn" disabled={busy || starting}>Cerca prodotto<UiIcon name="right" /></button></form>
    {error && <p role="alert" className="entry-error">{error}</p>}
  </section>;
}
