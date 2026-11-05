"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useState } from "react";
import type { Household, SharedMeal } from "@/lib/meal-sharing";
import { slotLabels, type Slot } from "@/lib/diary";
import { requestJson, SharingDialog } from "./common";
import { CopyMealForm } from "./copy-meal-form";
export function HouseholdMealsDialog({ date: initialDate, onClose, onCopied }: { date: string; onClose: () => void; onCopied: (date: string, count: number) => void }) {
  const { tr } = useI18n();
  const [household, setHousehold] = useState<Household | null>(null); const [memberId, setMemberId] = useState("");
  const [date, setDate] = useState(initialDate); const [meals, setMeals] = useState<SharedMeal[]>([]); const [slot, setSlot] = useState<Slot>("Lunch");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson("/api/v1/household", { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return; setHousehold(data.household);
      if (!data.household) { setLoading(false); return; }
      const household: Household = data.household; setMemberId(household.members.find(m => m.id !== household.currentUserId && !m.banned)?.id ?? household.currentUserId);
    }).catch(error => { if (!controller.signal.aborted) { setError(tr(error.message)); setLoading(false); } });
    return () => controller.abort();
  }, [tr]);
  useEffect(() => {
    if (!memberId || !date) return; const controller = new AbortController();
    void requestJson(`/api/v1/household/meals?memberId=${encodeURIComponent(memberId)}&date=${date}`, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setMeals(data.meals); setError(""); } })
      .catch(error => { if (!controller.signal.aborted) setError(tr(error.message)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [memberId, date, revision, tr]);
  const meal = meals.find(m => m.slot === slot);
  return <SharingDialog title={tr("Pasti del nucleo")} busy={busy} onClose={onClose}>
    {household && <><h3 className="household-name">{household.name}</h3><fieldset disabled={busy}><div className="form-columns"><label>{tr("Membro")}<select value={memberId} onChange={e => { setMeals([]); setLoading(true); setError(""); setMemberId(e.target.value); }}>{household.members.map(m => <option key={m.id} value={m.id} disabled={m.banned}>{m.username}{m.id === household.currentUserId ? tr(" (tu)") : ""}</option>)}</select></label><label>{tr("Data del pasto")}<input required type="date" value={date} onChange={e => { if (e.target.value) { setMeals([]); setLoading(true); setError(""); setDate(e.target.value); } }} /></label></div><label>{tr("Pasto")}<select value={slot} onChange={e => setSlot(e.target.value as Slot)}>{Object.entries(slotLabels).map(([value, label]) => <option key={value} value={value}>{tr(label)}</option>)}</select></label></fieldset></>}
    {loading && <p role="status">{tr("Caricamento pasti…")}</p>}{!loading && !household && !error && <p>{tr("Non fai ancora parte di un nucleo. ")}<a href="/settings#nucleo">{tr("Crealo o inserisci un codice in Impostazioni.")}</a></p>}
    {error && <p role="alert">{tr(error)} {household && <button className="text-btn" type="button" disabled={busy} onClick={() => { setLoading(true); setMeals([]); setRevision(v => v + 1); }}>{tr("Riprova")}</button>}</p>}
    {!loading && !error && meal && (meal.entries.length ? <CopyMealForm key={`${memberId}-${date}-${slot}-${revision}`} meal={meal} source={{ via: "household", memberId }} initialDate={initialDate} onCopied={onCopied} onBusy={setBusy} /> : <p className="empty-note">{tr("Nessuna voce in questo pasto.")}</p>)}
  </SharingDialog>;
}
