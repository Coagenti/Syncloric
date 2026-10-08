"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { slotLabels, slots, type Slot, type DiaryEntry } from "@/lib/diary";
import { NutritionFields } from "@/components/nutrition-fields";
import { normalizeNutrition, scaleNutrition, type Nutrition, type NutrientKey } from "@/lib/nutrition";

export function DiaryEditor({ date: initialDate, entry, initialSlot = "Lunch", onClose, onSaved }: {
  date: string; entry: DiaryEntry | null; initialSlot?: Slot; onClose: () => void; onSaved: (date: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const restoreSaveFocus = useRef(false);
  const [date, setDate] = useState(entry?.date ?? initialDate);
  const [slot, setSlot] = useState<Slot>(entry?.slot ?? initialSlot);
  const [name, setName] = useState(entry?.name ?? "");
  const [grams, setGrams] = useState(entry?.quantityGrams?.toString() ?? "");
  const lastValidGrams = useRef(Number(entry?.quantityGrams ?? 0));
  const [kcal, setKcal] = useState(entry?.kcal?.toString() ?? "");
  const [nutrients, setNutrients] = useState<Partial<Record<NutrientKey, string | number>>>(() => normalizeNutrition(entry?.nutrients, { protein: entry?.protein, fat: entry?.fat, carbs: entry?.carbs }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [login, setLogin] = useState(false);
  const [type, setType] = useState(entry?.entryType ?? "food");
  const [recipeId, setRecipeId] = useState(entry?.recipeId ?? "");
  const [servings, setServings] = useState(entry?.servings?.toString() ?? "1");
  const [recipes, setRecipes] = useState<{ id: string; name: string; servings: number; kcalPerServing: number | null }[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [foods, setFoods] = useState<{ id: string; name: string; brand: string | null; kcalPer100g: number; nutrientsPer100g?: Nutrition; protein?: string | null; fat?: string | null; carbs?: string | null }[]>([]);
  const [selectedFood, setSelectedFood] = useState<(typeof foods)[number] | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const selectedRecipe = recipes.find(r => r.id === recipeId);
  const recipeTotal = entry?.copiedMeal ? entry.kcal === null ? null : Math.round(entry.kcal * Number(servings) / (entry.servings ?? 1)) : selectedRecipe?.kcalPerServing == null ? null : Math.round(selectedRecipe.kcalPerServing * Number(servings));
  function changeGrams(next: string) {
    const previous = lastValidGrams.current;
    if (!selectedFood && previous > 0 && Number(next) > 0) {
      const factor = Number(next) / previous;
      setNutrients(current => scaleNutrition(normalizeNutrition(current), factor));
      if (entry?.copiedMeal) setKcal(current => current === "" ? "" : String(Math.round(Number(current) * factor)));
    }
    if (Number(next) > 0) lastValidGrams.current = Number(next);
    setGrams(next);
  }
  useEffect(() => {
    if (!query.trim() || selectedFood || entry || type !== "food") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/v1/diary/catalog?query=${encodeURIComponent(query)}&limit=20`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
        .then(async response => { if (response.status === 401) { setLogin(true); throw new Error(); } if (!response.ok) throw new Error(); return response.json(); })
        .then(data => { if (!controller.signal.aborted) setFoods(data.foods); })
        .catch(() => { if (!controller.signal.aborted) setCatalogError("Ricerca non disponibile. Puoi inserire l’alimento manualmente o riprovare modificando il nome."); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, selectedFood, entry, type]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/diary/catalog", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (response.status === 401) { setLogin(true); throw new Error("Accedi per consultare il catalogo."); } if (!response.ok) throw new Error("Catalogo non disponibile. Puoi usare l’inserimento manuale o riaprire il dialog per riprovare."); return response.json(); })
      .then(data => { if (!controller.signal.aborted) setRecipes(data.recipes); })
      .catch(() => { if (!controller.signal.aborted) setCatalogError("Catalogo non disponibile. Puoi usare l’inserimento manuale o riaprire il dialog per riprovare."); });
    return () => controller.abort();
  }, []);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!saving && restoreSaveFocus.current) {
      if (document.activeElement === document.body) saveButton.current?.focus();
      restoreSaveFocus.current = false;
    }
  }, [saving]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null); setLogin(false);
    try {
      const payload = entry ? (type === "recipe" ? { date, slot, servings: Number(servings) } : { date, slot, quantityGrams: Number(grams), ...(kcal === "" ? {} : { kcal: Number(kcal) }) }) : (type === "recipe" ? { date, slot, entryType: "recipe", recipeId, servings: Number(servings) } : { date, slot, entryType: "food", quantityGrams: Number(grams), ...(selectedFood ? { foodId: selectedFood.id } : { name: name.trim(), kcal: Number(kcal) }) });
      if (type === "food" && !selectedFood) Object.assign(payload, { nutrients: normalizeNutrition(nutrients) });
      const response = await fetch(entry ? `/api/v1/diary/${entry.id}` : "/api/v1/diary", { method: entry ? "PATCH" : "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (response.status === 401) { setLogin(true); setError("Accedi per salvare nel tuo diario."); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const missing = body?.error === "Alimento non trovato." || body?.error === "Ricetta non trovata.";
        setError(response.status === 400 ? (missing ? `${body.error} Seleziona un’altra voce o usa l’inserimento manuale.` : "Controlla nome, quantità, porzioni, kcal, pasto e data e riprova.") : "Non è stato possibile salvare la voce. Riprova.");
        return;
      }
      onSaved(date);
    } catch { setError("Connessione non disponibile. Riprova a salvare."); }
    finally { restoreSaveFocus.current = true; setSaving(false); }
  }
  return <dialog ref={dialog} tabIndex={-1} className="editor-panel diary-editor" aria-labelledby="diary-editor-title" onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:enabled, input:enabled, select:enabled, a[href]')).filter(el => !el.closest('fieldset:disabled'));
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <div className="editor-heading"><h2 id="diary-editor-title">{entry ? "Modifica voce" : "Aggiungi voce"}</h2><button type="button" className="close-editor" aria-label="Chiudi" disabled={saving} onClick={onClose}>×</button></div>
    <p className="editor-disclaimer">Registra quello che desideri, senza giudizio.</p>
    <form onSubmit={submit}><fieldset disabled={saving}>
      <label>Tipo di voce<select disabled={!!entry} value={type} onChange={e => setType(e.target.value as "food" | "recipe")} autoFocus={!entry}><option value="food">Alimento</option><option value="recipe">Ricetta</option></select></label>
      {catalogError && <p role="alert">{catalogError} {login && <a href="/login">Vai al login</a>}</p>}
      {type === "recipe" ? <>
        {!entry && <label>Ricetta<select required value={recipeId} onChange={e => setRecipeId(e.target.value)}><option value="">Seleziona una ricetta</option>{recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
        {(entry || recipeId) && <p className="form-help selected-recipe" style={{ overflowWrap: "anywhere" }}>{entry?.name ?? recipes.find(r => r.id === recipeId)?.name}</p>}
        {!recipes.length && <p className="form-help">Nessuna ricetta disponibile. Puoi inserire un alimento manualmente.</p>}
        <label>Numero di porzioni<input required type="number" min="0.01" max="999999.99" step="0.01" value={servings} onChange={e => setServings(e.target.value)} /></label>
        <p className="form-help">Kcal totali: {recipeTotal === null ? "—" : recipeTotal}</p>
      </> : <>
      <label>Nome alimento<input readOnly={!!entry} required maxLength={200} value={name} aria-describedby="food-search-help" onChange={e => { setName(e.target.value); setQuery(e.target.value); setSelectedFood(null); setFoods([]); setSearching(false); setCatalogError(null); }} /></label>
      {!entry && <>
        <p className="form-help" id="food-search-help">Cerca nel catalogo locale oppure inserisci nome, grammi e kcal manualmente.</p>
        {searching && <p role="status">Ricerca alimenti…</p>}
        {!!foods.length && !selectedFood && <ul className="food-suggestions" aria-label="Alimenti del catalogo">{foods.map(food => <li key={food.id}><button type="button" className="secondary-btn" onClick={() => { setSelectedFood(food); setName(food.name); setFoods([]); setSearching(false); }}>{food.name}{food.brand ? ` (${food.brand})` : ""} · {food.kcalPer100g} kcal/100 g</button></li>)}</ul>}
        {query && !searching && !foods.length && !selectedFood && <p className="form-help">Puoi usare l’inserimento manuale se non trovi l’alimento.</p>}
        {selectedFood && <button type="button" className="secondary-btn" onClick={() => { setSelectedFood(null); setQuery(""); }}>Usa inserimento manuale</button>}
      </>}
      <label>Quantità in grammi<input required type="number" min="0.01" max="999999.99" step="0.01" value={grams} onChange={e => changeGrams(e.target.value)} /></label>
      <label>Kcal totali<input readOnly={!!selectedFood} required={!entry} type="number" min="0" max="2147483647" step="1" value={selectedFood ? (grams ? Math.round(selectedFood.kcalPer100g * Number(grams) / 100) : "") : kcal} onChange={e => setKcal(e.target.value)} /></label>
      <p className="form-help">Kcal totali della quantità inserita, non kcal per 100 g.</p><NutritionFields values={selectedFood ? scaleNutrition(normalizeNutrition(selectedFood.nutrientsPer100g, { protein: selectedFood.protein, fat: selectedFood.fat, carbs: selectedFood.carbs }), Number(grams) / 100) : nutrients} basis="totali" readOnly={!!selectedFood} onChange={selectedFood ? undefined : (key, value) => setNutrients(current => ({ ...current, [key]: value }))} /></>}
      <div className="form-columns"><label>Pasto<select value={slot} onChange={e => setSlot(e.target.value as Slot)}>{slots.map(s => <option key={s} value={s}>{slotLabels[s]}</option>)}</select></label><label>Data<input required type="date" value={date} onChange={e => setDate(e.target.value)} /></label></div>
      {error && <p role="alert">{error} {login && <a href="/login">Vai al login</a>}</p>}
      <div className="editor-actions"><button type="button" className="secondary-btn" onClick={onClose}>Annulla</button><button ref={saveButton} type="submit" className="primary-btn">{saving ? "Salvataggio…" : "Salva voce"}</button></div>
    </fieldset></form>
  </dialog>;
}
