"use client";

import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { LabelScan } from "./label-scan";
import { UiIcon } from "./ui-icon";
import { createBarcodeReader } from "@/lib/barcode-reader";
import { NutritionFields } from "@/components/nutrition-fields";
import { normalizeNutrition, nutrientSpecs, type Nutrition } from "@/lib/nutrition";

type Product = { name: string; brand: string | null; kcalPer100g: number | null; proteinPer100g: number | string | null; fatPer100g: number | string | null; carbsPer100g: number | string | null; nutrientsPer100g?: Nutrition; source?: string };
type Detector = { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorClass = new (options: { formats: string[] }) => Detector;

/** Camera decoding stays local; lookup and persistence use the authenticated API. */
export function BarcodeEntry({ date, onSaved, compact = false }: { date: string; onSaved: () => void; compact?: boolean }) {
  const { tr } = useI18n();
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
  const [aiBusy, setAiBusy] = useState(false);
  const [aiApplied, setAiApplied] = useState(false);
  const [aiConfirmed, setAiConfirmed] = useState(false);
  const productForm = useRef<HTMLFormElement>(null);
  const request = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const pendingFocus = useRef<{ action: "lookup" | "save"; from: Element | null; moved: boolean } | null>(null);

  // Wait for React to re-enable the controls before restoring focus. A deliberate
  // move during the request owns focus, even if that control later loses it.
  useEffect(() => {
    if (busy || !pendingFocus.current) return;
    const pending = pendingFocus.current; pendingFocus.current = null;
    if (!dialog.current?.open || pending.moved || (document.activeElement !== document.body && document.activeElement !== pending.from)) return;
    const target = error ? feedback.current : pending.action === "lookup" ? productForm.current?.querySelector<HTMLInputElement>('input[name="name"]') : null;
    target?.focus();
  }, [busy, error]);

  function stopCamera() {
    cameraRun.current++;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera(false);
  }
  function close() {
    pendingFocus.current = null;
    request.current?.abort(); stopCamera(); dialog.current?.close(); setBusy(false); setAiBusy(false); setProduct(null); setAiApplied(false); setAiConfirmed(false); trigger.current?.focus();
  }
  useEffect(() => () => {
    request.current?.abort(); cameraRun.current++; stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  async function lookup(barcode: string) {
    if (busy || aiBusy) return;
    pendingFocus.current = { action: "lookup", from: document.activeElement, moved: false };
    stopCamera(); setCode(barcode); setBusy(true); setError(""); setProduct(null); setAiApplied(false); setAiConfirmed(false);
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch(`/api/v1/barcode?code=${encodeURIComponent(barcode)}`, { signal: controller.signal, cache: "no-store" });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setOrigin("lookup-error"); setProduct({ name: "", brand: null, kcalPer100g: null, proteinPer100g: null, fatPer100g: null, carbsPer100g: null });
        setError(tr(response.status === 401 ? tr("Accedi per registrare un prodotto.") : response.status === 400 ? tr("Codice non valido: usa da 8 a 14 cifre e riprova la ricerca.") : tr("Ricerca non disponibile. Riprova Cerca prodotto o compila il prodotto manualmente."))); return;
      }
      const data = await response.json() as { origin: string; food: Product | null };
      if (controller.signal.aborted) return;
      setOrigin(data.origin); setProduct(data.food ?? { name: "", brand: null, kcalPer100g: null, proteinPer100g: null, fatPer100g: null, carbsPer100g: null });
    } catch { if (!controller.signal.aborted) {
      setOrigin("lookup-error"); setProduct({ name: "", brand: null, kcalPer100g: null, proteinPer100g: null, fatPer100g: null, carbsPer100g: null });
      setError(tr("Connessione alla ricerca non riuscita. Riprova Cerca prodotto o compila il prodotto manualmente."));
    } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  async function startCamera() {
    const NativeDetector = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    if (!window.isSecureContext) { setError(tr("La fotocamera richiede HTTPS. Apri Syncloric tramite HTTPS oppure inserisci il codice manualmente.")); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError(tr("Fotocamera non disponibile in questo browser: inserisci il codice manualmente.")); return; }
    stopCamera(); const run = cameraRun.current; setError("");
    try {
      const detector = await createBarcodeReader(NativeDetector);
      if (run !== cameraRun.current || !dialog.current?.open) return;
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
    } catch { if (run === cameraRun.current) { stopCamera(); setError(tr("Fotocamera non disponibile o permesso negato: usa il codice manuale.")); } }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || aiBusy || (aiApplied && !aiConfirmed)) return;
    // Invalidate pending detection/permission before sharing the POST controller.
    stopCamera();
    const values = new FormData(event.currentTarget);
    const nutrient = (key: string) => values.get(key) === "" ? null : Number(values.get(key));
    pendingFocus.current = { action: "save", from: document.activeElement, moved: false };
    setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/v1/barcode", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ barcode: code, name: values.get("name"), brand: values.get("brand"), kcalPer100g: Number(values.get("kcal")), proteinPer100g: nutrient("protein"), fatPer100g: nutrient("fat"), carbsPer100g: nutrient("carbs"), nutrientsPer100g: Object.fromEntries(nutrientSpecs.map(spec => [spec.key, nutrient(spec.key)])), grams: Number(values.get("grams")), date, slot: values.get("slot") }) });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setError(tr(response.status === 401 ? tr("Accedi per registrare un prodotto.") : response.status === 400 || response.status === 422 ? tr("Controlla i valori: nome obbligatorio, kcal intere da 0 a 10000, nutrienti da 0 a 100 e grammi da 0,01 a 100000 (massimo due decimali). Poi riprova Registra nel diario.") : response.status === 403 ? tr("Salvataggio non consentito. Riapri la pagina e riprova.") : tr("Servizio di salvataggio non disponibile. I valori sono conservati: riprova Registra nel diario."))); return;
      }
      close(); onSaved();
    } catch { if (!controller.signal.aborted) setError(tr("Connessione al salvataggio non riuscita. I valori sono conservati: verifica il diario prima di riprovare Registra nel diario, per evitare duplicati.")); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <>
    <button ref={trigger} className={compact ? "toolbar-action scan-action" : "primary-cta"} type="button" onClick={() => { setCode(""); setProduct(null); setOrigin(""); setError(""); setAiApplied(false); setAiConfirmed(false); dialog.current?.showModal(); }}><UiIcon name="scan" />{tr("Scansiona")}</button>
    <dialog ref={dialog} className="editor-panel barcode-dialog" aria-labelledby="barcode-title" onFocusCapture={() => { if (busy && pendingFocus.current) pendingFocus.current.moved = true; }} onCancel={event => { event.preventDefault(); close(); }}>
      <div className="editor-heading"><h2 id="barcode-title">{tr("Registra un prodotto")}</h2><button className="close-editor" type="button" aria-label={tr("Chiudi scanner")} onClick={close}>×</button></div>
      <p className="form-help">{tr("Inserisci il codice o usa la fotocamera. Lo scanner barcode non invia foto; la scansione AI dell’etichetta è separata e facoltativa.")}</p>
      <form onSubmit={event => { event.preventDefault(); void lookup(code); }}>
        <label>{tr("Codice a barre")}<input autoFocus inputMode="numeric" pattern="[0-9]{8,14}" required value={code} onChange={event => { setCode(event.target.value); setProduct(null); setAiApplied(false); setAiConfirmed(false); }} disabled={busy || aiBusy} /></label>
        <button className="secondary-btn" disabled={busy || aiBusy} type="submit">{tr("Cerca prodotto")}</button>
        <button className="secondary-btn" disabled={busy || aiBusy} type="button" onClick={() => void startCamera()}>{tr("Usa fotocamera")}</button>
      </form>
      <video ref={video} hidden={!camera} muted playsInline style={{ width: "100%" }} aria-label={tr("Anteprima scanner")} />
      {camera && <button type="button" className="secondary-btn" onClick={stopCamera}>{tr("Ferma fotocamera")}</button>}
      {busy && <p role="status">{tr("Operazione in corso…")}</p>}
      {error && <p ref={feedback} role="alert" tabIndex={-1}>{tr(error)}</p>}
      {product && <form ref={productForm} key={`${code}-${origin}`} onSubmit={save}>
        <fieldset disabled={busy || aiBusy}>
        <p className="form-help">{origin === "local" ? tr("Prodotto nel catalogo locale.") : origin === "off" ? tr("Dati da Open Food Facts: verifica prima di confermare.") : origin === "lookup-error" ? tr("Ricerca non conclusa: puoi registrare il prodotto manualmente.") : tr("Prodotto non trovato: registra come nuovo.")}</p>
        {(origin === "off" || product.source === "barcode_off") && <a href={`https://world.openfoodfacts.org/product/${code}`} target="_blank" rel="noreferrer">Open Food Facts · ODbL / DbCL</a>}
        {origin !== "local" && <LabelScan onBusy={value => { if (value) stopCamera(); setAiBusy(value); }} onExtract={label => {
          stopCamera();
          setAiApplied(true); setAiConfirmed(false);
          const values = { name: label.name, brand: label.brand ?? "", kcal: Math.round(label.per100g.kcal), protein: Math.round(label.per100g.protein * 100) / 100, fat: Math.round(label.per100g.fat * 100) / 100, carbs: Math.round(label.per100g.carbs * 100) / 100 };
          for (const [key, value] of Object.entries(values)) {
            const input = productForm.current?.elements.namedItem(key);
            if (input instanceof HTMLInputElement) input.value = String(value);
          }
          for (const spec of nutrientSpecs) {
            const input = productForm.current?.elements.namedItem(spec.key);
            if (input instanceof HTMLInputElement) input.value = label.per100g[spec.key] == null ? "" : String(label.per100g[spec.key]);
          }
        }} />}
        <label>{tr("Nome prodotto")}<input name="name" required maxLength={200} defaultValue={product.name} readOnly={origin === "local"} /></label>
        <label>{tr("Marca")}<input name="brand" maxLength={200} defaultValue={product.brand ?? ""} readOnly={origin === "local"} /></label>
        <label>{tr("Kcal per 100 g")}<input name="kcal" type="number" required min="0" max="10000" step="1" defaultValue={product.kcalPer100g ?? ""} readOnly={origin === "local"} /></label>
        <NutritionFields prefix="" basis="per 100 g" readOnly={origin === "local"} values={normalizeNutrition(product.nutrientsPer100g, { protein: product.proteinPer100g, fat: product.fatPer100g, carbs: product.carbsPer100g })} />
        <label>{tr("Grammi registrati")}<input name="grams" type="number" required min="0.01" max="100000" step="0.01" defaultValue="100" /></label>
        <label>{tr("Pasto")}<select name="slot" defaultValue="Snack"><option value="Breakfast">{tr("Colazione")}</option><option value="Lunch">{tr("Pranzo")}</option><option value="Snack">{tr("Spuntino")}</option><option value="Dinner">{tr("Cena")}</option></select></label>
        <p className="form-help">{tr("Nutrienti per 100 g; calorie del diario proporzionali ai grammi. I campi facoltativi vuoti restano sconosciuti.")}</p>
        {aiApplied && <label className="ai-confirmation"><input type="checkbox" checked={aiConfirmed} onChange={event => setAiConfirmed(event.target.checked)} />{tr("Ho verificato i valori proposti dall’AI")}</label>}
        <button type="submit" className="primary-btn" disabled={busy || aiBusy || (aiApplied && !aiConfirmed)}>{tr("Registra nel diario")}</button>
        </fieldset>
      </form>}
    </dialog>
  </>;
}
