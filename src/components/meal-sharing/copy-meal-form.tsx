"use client";
import { useId, useRef, useState } from "react";
import { slotLabels, slots, type Slot } from "@/lib/diary";
import type { SharedMeal } from "@/lib/meal-sharing";
import { NutrientDetails } from "@/components/nutrition-summary";
import { postJson } from "./common";
export function CopyMealForm({ meal, source, initialDate, initialSlot, onCopied, onBusy }: {
  meal: SharedMeal; source: { via: "household"; memberId: string } | { via: "link"; token: string };
  initialDate: string; initialSlot?: Slot; onCopied: (date: string, count: number) => void; onBusy?: (busy: boolean) => void;
}) {
  const id = useId(); const inFlight = useRef(false);
  const [selected, setSelected] = useState(() => meal.entries.map(e => e.id));
  const [date, setDate] = useState(initialDate); const [slot, setSlot] = useState(initialSlot ?? meal.slot);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [copied, setCopied] = useState(false);
  async function copy() {
    if (inFlight.current || copied) return; inFlight.current = true; setBusy(true); onBusy?.(true); setError("");
    try {
      const data = await postJson("/api/v1/meals/copy", { ...source, ...(source.via === "household" ? { date: meal.date, slot: meal.slot } : {}), entryIds: selected, targetDate: date, targetSlot: slot });
      setCopied(true); onCopied(data.date, data.count);
    } catch (error) { setError(error instanceof Error ? error.message : "Copia non verificata. Controlla il diario prima di riprovare."); }
    finally { inFlight.current = false; setBusy(false); onBusy?.(false); }
  }
  return <form onSubmit={e => { e.preventDefault(); void copy(); }} aria-busy={busy}>
    <fieldset disabled={busy || copied}><legend className="section-kicker">VOCI DA COPIARE</legend><div className="share-selection-actions"><button type="button" className="text-btn" onClick={() => setSelected(meal.entries.map(e => e.id))}>Seleziona tutte</button><button type="button" className="text-btn" onClick={() => setSelected([])}>Deseleziona tutte</button></div>
      <ul className="shared-meal-entries">{meal.entries.map(entry => <li key={entry.id}><label className="share-entry-check"><input type="checkbox" checked={selected.includes(entry.id)} onChange={e => setSelected(current => e.target.checked ? [...current, entry.id] : current.filter(value => value !== entry.id))} /><span><strong>{entry.name}</strong><small>{entry.entryType === "food" ? `${entry.quantityGrams ?? "—"} g` : `${entry.servings ?? 1} porzioni`} · {entry.kcal === null ? "kcal non definite" : `${entry.kcal} kcal`}</small></span></label><NutrientDetails nutrients={entry.nutrients} /></li>)}</ul>
      <div className="form-columns"><label htmlFor={`${id}-date`}>Data di destinazione<input id={`${id}-date`} type="date" required value={date} onChange={e => setDate(e.target.value)} /></label><label htmlFor={`${id}-slot`}>Pasto di destinazione<select id={`${id}-slot`} value={slot} onChange={e => setSlot(e.target.value as Slot)}>{slots.map(s => <option key={s} value={s}>{slotLabels[s]}</option>)}</select></label></div>
      <p className="form-help">Le copie sono indipendenti e modificabili. Le voci originali restano nel diario di chi le ha registrate.</p><button className="primary-btn" type="submit" disabled={!selected.length}>{busy ? "Copia in corso…" : `Copia ${selected.length} ${selected.length === 1 ? "voce" : "voci"} nel mio diario`}</button>
    </fieldset>
    {error && <p role="alert">{error}{error === "Accedi per continuare." && <> <a href="/login" target="_blank" rel="noopener noreferrer">Accedi o crea un account</a><span className="form-help"> Dopo l’accesso torna qui e premi di nuovo Copia.</span></>}</p>}
    {copied && <p role="status">Pasto copiato. <a href="/diary">Apri il tuo diario</a></p>}
  </form>;
}
