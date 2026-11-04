"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/ui-preferences-provider";
import { UiIcon } from "@/components/ui-icon";
import { slots, slotLabels, type DiaryEntry, type Slot } from "@/lib/diary";

export function DuplicateEntryDialog({ entry, onClose, onDuplicated }: { entry: DiaryEntry; onClose: () => void; onDuplicated: (date: string, slot: Slot) => void }) {
  const { tr } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null), inFlight = useRef(false);
  const [date, setDate] = useState(entry.date), [slot, setSlot] = useState<Slot>(entry.slot);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setLogin(false);
    try {
      const response = await fetch(`/api/v1/diary/${entry.id}/duplicate`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, slot }) });
      if (!response.ok) {
        setLogin(response.status === 401);
        setError(tr(response.status === 401 ? "Accedi per duplicare la voce." : response.status === 404 ? "Voce non trovata. Aggiorna il diario." : "Duplicazione non riuscita. Riprova."));
        return;
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !("date" in result) || result.date !== date || !("slot" in result) || result.slot !== slot) throw new Error("Unconfirmed duplicate");
      onDuplicated(date, slot);
    } catch { setError(tr("Duplicazione non verificata. Controlla il diario prima di riprovare.")); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="editor-panel diary-editor duplicate-dialog" aria-labelledby="duplicate-entry-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="editor-heading"><h2 id="duplicate-entry-title">{tr("Duplica voce")}</h2><button type="button" className="close-editor" aria-label={tr("Chiudi")} disabled={busy} onClick={onClose}>×</button></div>
    <p className="duplicate-name">{entry.name}</p>
    <p className="form-help">{tr("La copia mantiene quantità e nutrienti. Potrai modificarla senza cambiare l’originale.")}</p>
    <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy}>
      <label>{tr("Data di destinazione")}<input type="date" required value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>{tr("Pasto di destinazione")}<select value={slot} onChange={event => setSlot(event.target.value as Slot)}>{slots.map(value => <option key={value} value={value}>{tr(slotLabels[value])}</option>)}</select></label>
      <div className="editor-actions"><button type="button" className="secondary-btn" autoFocus onClick={onClose}>{tr("Annulla")}</button><button type="submit" className="primary-btn"><UiIcon name="copy" />{busy ? tr("Duplicazione…") : tr("Duplica voce")}</button></div>
    </fieldset></form>
    {error && <p role="alert">{error} {login && <a href="/login">{tr("Vai al login")}</a>}</p>}
  </dialog>;
}
