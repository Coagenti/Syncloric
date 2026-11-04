"use client";

import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { NeonSwitch } from "@/components/neon-switch";
const endpoint = "/api/v1/settings/barcode";
const uncertainMessage = "Non è stato possibile verificare il salvataggio. Ricarica lo stato prima di riprovare.";
function enabledValue(body: unknown): boolean {
  if (!body || typeof body !== "object" || typeof (body as { enabled?: unknown }).enabled !== "boolean") throw new Error("Invalid response");
  return (body as { enabled: boolean }).enabled;
}

/** Independent form: pending writes never replace the user's current draft or focus. */
export function SettingsBarcodeCard() {
  const { tr } = useI18n();
  const [saved, setSaved] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mustReload, setMustReload] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadController.current = controller;
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("unavailable");
      const value = enabledValue(await response.json());
      if (!controller.signal.aborted) { setSaved(value); setEnabled(value); }
    }).catch(() => {
      if (!controller.signal.aborted) setError(tr("Impostazioni Barcode non disponibili. Richiede amministratore."));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); loadController.current?.abort(); saveController.current?.abort(); };
  }, [tr]);

  async function reload() {
    if (loading || busy.current) return;
    setLoading(true); setError(""); setFeedback("");
    const controller = new AbortController(); loadController.current = controller;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("unavailable");
      const value = enabledValue(await response.json());
      if (!controller.signal.aborted) {
        setSaved(value);
        if (saved === null) setEnabled(value);
        setMustReload(false); setFeedback(tr("Stato Barcode ricaricato."));
      }
    } catch { if (!controller.signal.aborted) setError(tr("Impossibile ricaricare lo stato Barcode. Riprova.")); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saved === null || busy.current || loading || mustReload) return;
    busy.current = true; setSaving(true); setFeedback(""); setError("");
    const controller = new AbortController(); saveController.current = controller;
    try {
      const response = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }), signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        setError(tr(response.status === 401 ? tr("Autenticazione richiesta. Accedi di nuovo.") : tr("Solo un amministratore può salvare Barcode.")));
        return;
      }
      if (!response.ok) throw new Error("unverified");
      const data: unknown = await response.json();
      const value = enabledValue(data);
      if ((data as { saved_ok?: unknown }).saved_ok !== true) throw new Error("unverified");
      if (!controller.signal.aborted) { setSaved(value); setFeedback(tr("Impostazioni Barcode salvate.")); }
    } catch {
      if (!controller.signal.aborted) { setMustReload(true); setError(tr(uncertainMessage)); }
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  return <section aria-labelledby="barcode-settings-title" className="editor-panel border border-cyber-border bg-cyber-surface max-w-2xl mt-6">
    <div className="settings-toggle-heading"><h2 id="barcode-settings-title" className="text-lg font-semibold">Barcode</h2>{saved !== null && <NeonSwitch label={tr("Ricerca prodotti su Open Food Facts")} checked={enabled} describedBy="barcode-settings-help" onChange={value => { setEnabled(value); setFeedback(""); }} />}</div>
    <p id="barcode-settings-help" className="form-help">{tr("Se disattivata, la ricerca su Open Food Facts non viene eseguita.")}</p>
    {saved !== null && <form onSubmit={save} aria-busy={saving}>
      {enabled !== saved && <p role="status" className="text-cyber-yellow">{tr("Modifiche non salvate")}</p>}
      <button type="submit" className="primary-btn" style={{ minHeight: 44 }} aria-disabled={saving || loading || mustReload}>{tr("Salva Barcode")}</button>
    </form>}
    {loading && <p role="status">{tr("Caricamento impostazioni Barcode…")}</p>}
    {saving && <p role="status">{tr("Salvataggio Barcode in corso…")}</p>}
    {feedback && <p role="status">{tr(feedback)}</p>}
    {error && <p role="alert">{tr(error)}</p>}
    {(mustReload || (saved === null && !loading)) && <button type="button" className="text-cyber-cyan" style={{ minHeight: 44 }} aria-disabled={loading || saving} onClick={() => { void reload(); }}>{tr("Ricarica stato Barcode")}</button>}
  </section>;
}
