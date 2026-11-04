"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState, type ReactNode } from "react";

export async function requestJson(path: string, options?: RequestInit) {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 ? "Accedi per continuare." : data?.error ?? "Operazione non riuscita.");
  if (!data) throw new Error("Risposta non valida. Ricarica la pagina.");
  return data;
}
export const postJson = (path: string, data: unknown) => requestJson(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
export function Expiry({ at }: { at: string }) {
  const { tr } = useI18n();
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const interval = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(interval); }, []);
  const seconds = Math.max(0, Math.ceil((Date.parse(at) - clock) / 1000));
  return <span className="share-expiry">{seconds ? tr("Scade tra {0}:{1}", { "0": Math.floor(seconds / 60), "1": String(seconds % 60).padStart(2, "0") }) : tr("Scaduto")}</span>;
}
export function SharingDialog({ title, busy, onClose, children }: { title: string; busy?: boolean; onClose: () => void; children: ReactNode }) {
  const { tr } = useI18n();
  const ref = useRef<HTMLDialogElement>(null); const close = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.showModal(); close.current?.focus(); }, []);
  return <dialog ref={ref} className="editor-panel diary-editor sharing-dialog" aria-label={tr(title)} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="editor-heading"><h2>{tr(title)}</h2><button ref={close} className="close-editor" type="button" aria-label={tr("Chiudi")} disabled={busy} onClick={onClose}>×</button></div>{children}
  </dialog>;
}
