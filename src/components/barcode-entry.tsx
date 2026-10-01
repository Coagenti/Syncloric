"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Product = { name: string; brand: string | null; kcalPer100g: number | null; proteinPer100g: number | string | null; fatPer100g: number | string | null; carbsPer100g: number | string | null; source?: string };
type Detector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** Native camera only; all lookup and persistence goes through the authenticated API. */
export function BarcodeEntry({ date, onSaved }: { date: string; onSaved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraRun = useRef(0);
  const [code, setCode] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [origin, setOrigin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const request = useRef<AbortController | null>(null);

  function stopCamera() {
    cameraRun.current++;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera(false);
  }
  function close() {
    request.current?.abort(); stopCamera(); dialog.current?.close(); setBusy(false); trigger.current?.focus();
  }
  useEffect(() => () => {
    request.current?.abort(); cameraRun.current++; stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function lookup(barcode: string) {
    stopCamera(); setCode(barcode); setBusy(true); setError(""); setProduct(null);
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch(`/api/v1/barcode?code=${encodeURIComponent(barcode)}`, { signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setOrigin("manual"); setProduct({ name: "", brand: null, kcalPer100g: null, proteinPer100g: null, fatPer100g: null, carbsPer100g: null });
        setError(response.status === 401 ? "Accedi per registrare un prodotto." : "Ricerca non disponibile. Puoi compilare il prodotto manualmente."); return;
      }
      const data = await response.json() as { origin: string; food: Product | null };
      if (controller.signal.aborted) return;
      setOrigin(data.origin); setProduct(data.food ?? { name: "", brand: null, kcalPer100g: null, proteinPer100g: null, fatPer100g: null, carbsPer100g: null });
    } catch { if (!controller.signal.aborted) setError("Ricerca non disponibile. Riprova."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function startCamera() {
    const NativeDetector = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    if (!NativeDetector || !navigator.mediaDevices?.getUserMedia) { setError("Fotocamera non supportata: inserisci il codice manualmente."); return; }
    stopCamera(); const run = cameraRun.current; setError("");
    try {
      const detector = new NativeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (run !== cameraRun.current || !dialog.current?.open) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media; setCamera(true);
      if (!video.current) { stopCamera(); return; }
      video.current.srcObject = media; await video.current.play();
      while (run === cameraRun.current) {
        const found = await detector.detect(video.current);
        if (run !== cameraRun.current) return;
        const barcode = found.find(item => /^\d{8,14}$/.test(item.rawValue))?.rawValue;
        if (barcode) { await lookup(barcode); return; }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch { if (run === cameraRun.current) { stopCamera(); setError("Fotocamera non disponibile o permesso negato: usa il codice manuale."); } }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    // Invalidate pending detection/permission before sharing the POST controller.
    stopCamera();
    const values = new FormData(event.currentTarget);
    const nutrient = (key: string) => values.get(key) === "" ? null : Number(values.get(key));
    setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/v1/barcode", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ barcode: code, name: values.get("name"), brand: values.get("brand"), kcalPer100g: Number(values.get("kcal")), proteinPer100g: nutrient("protein"), fatPer100g: nutrient("fat"), carbsPer100g: nutrient("carbs"), grams: Number(values.get("grams")), date, slot: values.get("slot") }) });
      if (controller.signal.aborted) return;
      if (!response.ok) { setError(response.status === 401 ? "Accedi per registrare un prodotto." : "Non è stato possibile salvare. Controlla i valori e riprova."); return; }
      close(); onSaved();
    } catch { if (!controller.signal.aborted) setError("Non è stato possibile salvare. Riprova."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <>
    <button ref={trigger} className="primary-cta" type="button" onClick={() => { setCode(""); setProduct(null); setOrigin(""); setError(""); dialog.current?.showModal(); }}>Scansiona</button>
    <dialog ref={dialog} className="editor-panel barcode-dialog" aria-labelledby="barcode-title" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="editor-heading"><h2 id="barcode-title">Registra un prodotto</h2><button className="close-editor" type="button" aria-label="Chiudi scanner" onClick={close}>×</button></div>
      <p className="form-help">Inserisci il codice o usa la fotocamera. Nessuna foto viene inviata all’esterno.</p>
      <form onSubmit={event => { event.preventDefault(); void lookup(code); }}>
        <label>Codice a barre<input autoFocus inputMode="numeric" pattern="[0-9]{8,14}" required value={code} onChange={event => { setCode(event.target.value); setProduct(null); }} disabled={busy} /></label>
        <button className="secondary-btn" disabled={busy} type="submit">Cerca prodotto</button>
        <button className="secondary-btn" disabled={busy} type="button" onClick={() => void startCamera()}>Usa fotocamera</button>
      </form>
      <video ref={video} hidden={!camera} muted playsInline style={{ width: "100%" }} aria-label="Anteprima scanner" />
      {camera && <button type="button" className="secondary-btn" onClick={stopCamera}>Ferma fotocamera</button>}
      {busy && <p role="status">Operazione in corso…</p>}
      {error && <p role="alert">{error}</p>}
      {product && <form key={`${code}-${origin}`} onSubmit={save}>
        <p className="form-help">{origin === "local" ? "Prodotto nel catalogo locale." : origin === "off" ? "Dati da Open Food Facts: verifica prima di confermare." : "Prodotto non trovato: registra come nuovo."}</p>
        {(origin === "off" || product.source === "barcode_off") && <a href={`https://world.openfoodfacts.org/product/${code}`} target="_blank" rel="noreferrer">Open Food Facts · ODbL / DbCL</a>}
        <label>Nome prodotto<input name="name" required maxLength={200} defaultValue={product.name} readOnly={origin === "local"} /></label>
        <label>Marca<input name="brand" maxLength={200} defaultValue={product.brand ?? ""} readOnly={origin === "local"} /></label>
        <label>Kcal per 100 g<input name="kcal" type="number" required min="0" max="10000" step="1" defaultValue={product.kcalPer100g ?? ""} readOnly={origin === "local"} /></label>
        <div className="form-columns">{([ ["protein", "Proteine", product.proteinPer100g], ["fat", "Grassi", product.fatPer100g], ["carbs", "Carboidrati", product.carbsPer100g] ] as const).map(([key, label, value]) => <label key={key}>{label} per 100 g<input name={key} type="number" min="0" max="100" step="0.01" defaultValue={value ?? ""} readOnly={origin === "local"} /></label>)}</div>
        <label>Grammi registrati<input name="grams" type="number" required min="0.01" max="100000" step="0.01" defaultValue="100" /></label>
        <label>Pasto<select name="slot" defaultValue="Snack"><option value="Breakfast">Colazione</option><option value="Lunch">Pranzo</option><option value="Snack">Spuntino</option><option value="Dinner">Cena</option></select></label>
        <p className="form-help">Nutrienti per 100 g; calorie del diario proporzionali ai grammi. I campi facoltativi vuoti restano sconosciuti.</p>
        <button type="submit" className="primary-btn" disabled={busy}>Registra nel diario</button>
      </form>}
    </dialog>
  </>;
}
