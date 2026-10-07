"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DiaryEntry } from "@/lib/diary";
import { UiIcon } from "./ui-icon";

export function DeleteEntryDialog({ entry, onClose, onDeleted }: { entry: DiaryEntry; onClose: () => void; onDeleted: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  useEffect(() => { dialog.current?.showModal(); cancel.current?.focus(); }, []);
  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setLogin(false);
    try {
      const response = await fetch(`/api/v1/diary/${entry.id}`, { method: "DELETE", credentials: "same-origin" });
      if (!response.ok) {
        setLogin(response.status === 401);
        setError(response.status === 401 ? "Accedi di nuovo per eliminare la voce." : response.status === 403 ? "Questa voce non può essere eliminata." : response.status === 404 ? "Voce non trovata. Aggiorna il diario." : "Eliminazione non riuscita. Riprova.");
        return;
      }
      onDeleted();
    } catch { setError("Eliminazione non verificata. Ricarica il diario prima di riprovare."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="editor-panel diary-editor delete-dialog" aria-labelledby="delete-entry-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="delete-emblem" aria-hidden="true"><UiIcon name="trash" /></div>
    <h2 id="delete-entry-title">Eliminare la voce?</h2>
    <p className="delete-entry-name">{entry.name}</p>
    <p className="form-help">Questa voce verrà rimossa dal tuo diario.</p>
    {error && <p role="alert">{error} {login && <Link href="/login">Vai al login</Link>}</p>}
    {busy && <p role="status">Eliminazione in corso…</p>}
    <div className="editor-actions"><button ref={cancel} type="button" className="secondary-btn" disabled={busy} onClick={onClose}>Annulla</button><button type="button" className="danger-btn" disabled={busy} onClick={() => { void remove(); }}><UiIcon name="trash" />Elimina voce</button></div>
  </dialog>;
}
