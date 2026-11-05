"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { UiIcon } from "@/components/ui-icon";
import { NutritionFields } from "@/components/nutrition-fields";
import { nutrientSpecs, normalizeNutrition, scaleNutrition, type NutrientKey } from "@/lib/nutrition";
import { decimalAmount, parseFoodAmount, portionTotalGrams } from "@/lib/food-portions";
import { foodEntryError, type EntryFood, type EntryRecipe } from "@/lib/food-entry";
import { slotLabels, type Slot } from "@/lib/diary";
import { PortionEditor, parsePortionDrafts, portionDrafts } from "./portion-editor";

export function FoodDetail({ food, recipe, date, slot, ai = false, onBack, onSaved }: {
  food?: EntryFood; recipe?: EntryRecipe; date: string; slot: Slot; ai?: boolean;
  onBack: () => void; onSaved: (name: string) => void;
}) {
  const { tr, formatNumber } = useI18n();
  const number = (value: number) => formatNumber(value, { maximumFractionDigits: 2 });
  const [name, setName] = useState(food?.name ?? recipe?.name ?? "");
  const [brand, setBrand] = useState(food?.brand ?? "");
  const [barcode, setBarcode] = useState(food?.barcode ?? "");
  const [kcal, setKcal] = useState(food?.kcalPer100g?.toString() ?? "");
  const [nutrients, setNutrients] = useState<Partial<Record<NutrientKey, string | number>>>(food?.nutrientsPer100g ?? {});
  const [drafts, setDrafts] = useState(() => portionDrafts(food?.portions ?? []));
  const [unit, setUnit] = useState(food?.portions[0]?.id ?? "grams");
  const [quantity, setQuantity] = useState(String(recipe ? 1 : food?.portions[0]?.defaultQuantity ?? 100));
  const [editing, setEditing] = useState(!food?.id && !recipe);
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const [confirmed, setConfirmed] = useState(false); const [savedPreferences, setSavedPreferences] = useState("");
  const heading = useRef<HTMLHeadingElement>(null); const request = useRef<AbortController | null>(null);
  useEffect(() => { heading.current?.focus(); window.scrollTo({ top: 0 }); return () => request.current?.abort(); }, []);
  const parsedPortions = parsePortionDrafts(drafts);
  const portions = parsedPortions.success ? parsedPortions.data : [];
  const portion = portions.find(v => v.id === unit);
  const amount = parseFoodAmount(quantity);
  const grams = unit === "grams" ? amount : portion ? portionTotalGrams(portion.grams, amount) : NaN;
  const factor = recipe ? amount : grams / 100;
  const valid = decimalAmount.safeParse(recipe ? amount : grams).success && (unit === "grams" || !!recipe || portion && amount <= 10000);
  const energy = recipe ? recipe.kcalPerServing : kcal === "" ? null : Number(kcal);
  const total = valid && energy !== null && Number.isFinite(energy) ? Math.round(energy * factor) : null;
  const totals = scaleNutrition(recipe?.nutrientsPerServing ?? normalizeNutrition(nutrients), valid ? factor : 0);
  const validBarcode = !barcode.trim() || /^\d{8,14}$/.test(barcode.trim());

  async function persistPreferences() {
    if (!food?.id || saving) return;
    if (!parsedPortions.success) { setError(tr("Completa le porzioni con nome, peso e quantità positivi (massimo due decimali).")); return; }
    if (!validBarcode) { setError(tr("Il codice a barre deve contenere da 8 a 14 cifre, oppure essere vuoto.")); return; }
    setSaving(true); setError(""); setSavedPreferences("");
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch(`/api/v1/foods/${food.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portions, ...(food.canEdit ? { product: { name: name.trim(), brand: brand.trim() || null, barcode: barcode.trim() || null, kcalPer100g: Number(kcal), nutrientsPer100g: normalizeNutrition(nutrients) } } : {}) }), signal: controller.signal });
      if (!response.ok) { const data = await response.json().catch(() => null); setError(tr(response.status === 409 && data?.error ? data.error : foodEntryError(response.status))); return; }
      setEditing(false); setSavedPreferences(tr("Alimento e porzioni salvati."));
    } catch { if (!controller.signal.aborted) setError(tr("Connessione non disponibile. Le modifiche sono conservate.")); }
    finally { if (!controller.signal.aborted) setSaving(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving) return;
    if (!validBarcode) { setEditing(true); setError(tr("Il codice a barre deve contenere da 8 a 14 cifre, oppure essere vuoto.")); return; }
    if (!valid || !parsedPortions.success) { setError(tr("Controlla quantità e porzioni. Sono accettati decimali, per esempio 1,5.")); return; }
    if (!recipe && (!name.trim() || kcal === "" || !Number.isFinite(Number(kcal)))) { setEditing(true); setError(tr("Indica il nome e le kcal per 100 g dell’alimento.")); return; }
    if (ai && !confirmed) { setError(tr("Verifica i valori proposti dall’AI prima di aggiungerli.")); return; }
    if (food?.id && editing) { setError(tr("Salva le modifiche all’alimento prima di aggiungerlo al diario.")); return; }
    setSaving(true); setError(""); const controller = new AbortController(); request.current = controller;
    try {
      const portionSnapshot = portion ? { label: portion.label, grams: portion.grams, quantity: amount } : null;
      const payload = recipe ? { entryType: "recipe", recipeId: recipe.id, servings: amount, date, slot }
        : food?.id ? { entryType: "food", foodId: food.id, quantityGrams: grams, portion: portionSnapshot, portions, date, slot }
          : { name: name.trim(), brand: brand.trim() || null, barcode: barcode.trim() || null, kcalPer100g: Number(kcal), nutrientsPer100g: normalizeNutrition(nutrients), portions, quantityGrams: grams, portion: portionSnapshot, date, slot };
      const response = await fetch(recipe || food?.id ? "/api/v1/diary" : "/api/v1/foods", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
      if (!response.ok) { setError(tr(foodEntryError(response.status))); return; }
      const saved = await response.json().catch(() => null);
      onSaved(saved?.food?.name ?? name);
    } catch { if (!controller.signal.aborted) setError(tr("Connessione al salvataggio interrotta. Verifica il diario prima di riprovare, per evitare duplicati.")); }
    finally { if (!controller.signal.aborted) setSaving(false); }
  }

  return <section className="food-detail" aria-labelledby="food-detail-title">
    <button type="button" className="entry-back" disabled={saving} onClick={onBack}><UiIcon name="left" />{tr("Torna alla selezione")}</button>
    <div className="food-product-heading"><div className="food-monogram" aria-hidden="true">{(name || "AL").slice(0, 2).toUpperCase()}</div><div><span className="section-kicker">{recipe ? tr("RICETTA") : tr("ALIMENTO")} / {tr(slotLabels[slot]).toUpperCase()}</span><h2 ref={heading} id="food-detail-title" tabIndex={-1}>{name || tr("Nuovo alimento")}</h2><p>{brand || (recipe ? tr("Dal tuo catalogo ricette") : tr("Marca non indicata"))}</p></div></div>
    <form onSubmit={submit}><fieldset disabled={saving}>
      {editing && !recipe && <section className="food-edit-card" aria-label={tr("Modifica alimento e porzioni")}>
        {(!food?.id || food.canEdit) && <><h3>{tr("Dati alimento")}</h3><div className="form-columns"><label>{tr("Nome alimento")}<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label><label>{tr("Marca")}<input maxLength={200} value={brand} onChange={e => setBrand(e.target.value)} /></label><label>{tr("Codice a barre (facoltativo)")}<input type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{8,14}" maxLength={14} value={barcode} aria-describedby="food-barcode-help" onChange={e => setBarcode(e.target.value)} /></label></div><p id="food-barcode-help" className="form-help">{tr("Da 8 a 14 cifre. Salvalo per ritrovare l’alimento con la scansione; se proposto dall’AI, verifica che corrisponda alla confezione.")}</p><label>{tr("Kcal per 100 g")}<input required type="number" min="0" max="10000" step="1" value={kcal} onChange={e => setKcal(e.target.value)} /></label><NutritionFields values={nutrients} basis="per 100 g" onChange={(key, value) => setNutrients(v => ({ ...v, [key]: value }))} /></>}
        <h3>{tr("Le mie porzioni")}</h3><PortionEditor values={drafts} onChange={values => { setDrafts(values); if (unit !== "grams" && !values.some(v => v.id === unit)) { setUnit("grams"); setQuantity(valid ? String(grams) : "100"); } }} />
        {food?.id && <button type="button" className="secondary-btn" onClick={() => void persistPreferences()}>{tr("Salva modifiche alimento")}</button>}
      </section>}
      <div className="food-detail-grid"><div className="food-detail-main">
        <div className="food-energy-readout"><span>{tr("ENERGIA DELLA QUANTITÀ")}</span><strong>{total === null ? "—" : number(total)}<small>kcal</small></strong><p>{recipe ? tr("{0} porzioni", { "0": quantity }) : valid ? `${number(grams)} g${portion ? ` · ${quantity} × ${portion.label}` : ""}` : tr("Imposta la quantità")}</p></div>
        <div className="food-macro-readout">{(["carbs", "protein", "fat"] as const).map(key => <div key={key}><strong>{totals[key] == null ? "—" : number(totals[key])}<small>g</small></strong><span>{tr(nutrientSpecs.find(s => s.key === key)!.label)}</span></div>)}</div>
        <details className="food-nutrient-list"><summary>{tr("Tutti i nutrienti della quantità")}</summary><dl>{nutrientSpecs.map(spec => <div key={spec.key}><dt>{tr(spec.label)}</dt><dd>{totals[spec.key] == null ? "—" : `${number(totals[spec.key]!)} ${spec.unit}`}</dd></div>)}</dl><p className="form-help">{tr("— indica un valore non disponibile.")}</p></details>
        {barcode && <p className="food-barcode"><UiIcon name="scan" />{barcode}</p>}
        {food?.source === "barcode_off" && food.barcode && barcode.trim() === food.barcode && <p className="food-attribution"><a href={`https://world.openfoodfacts.org/product/${food.barcode}`} target="_blank" rel="noreferrer">Open Food Facts · ODbL / DbCL</a>{tr(" · Verifica i valori sull’etichetta.")}</p>}
      </div><div className="food-quantity-card">
        <span className="section-kicker">{tr("LA TUA QUANTITÀ")}</span>
        <div className="food-quantity-fields"><label>{recipe ? tr("Numero di porzioni") : unit === "grams" ? tr("Quantità in grammi") : tr("Quantità di porzioni")}<input required inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} aria-describedby="portion-equivalence" /></label>
        {!recipe && <label>{tr("Unità")}<select aria-label={tr("Unità")} value={unit} onChange={e => { const next = portions.find(v => v.id === e.target.value); setUnit(e.target.value); setQuantity(String(next?.defaultQuantity ?? (valid ? grams : 100))); }}><option value="grams">{tr("Grammi (g)")}</option>{drafts.map(v => <option key={v.id} value={v.id}>{v.label || tr("Porzione")} ({v.grams || "—"} g)</option>)}</select></label>}</div>
        <p id="portion-equivalence" className="portion-equivalence">{recipe ? tr("Le calorie si adattano al numero di porzioni.") : portion ? `1 ${portion.label} = ${number(portion.grams)} g · ${valid ? tr("{0} porzioni = {1} g", { "0": quantity, "1": number(grams) }) : tr("Controlla la quantità")}` : tr("Puoi usare i grammi o una delle tue porzioni.")}</p>
        {food?.id && !recipe && <button type="button" className="entry-text-action" onClick={() => setEditing(v => !v)}><UiIcon name="pencil" />{editing ? tr("Chiudi modifica") : tr("Modifica alimento e porzioni")}</button>}
        {ai && <label className="ai-confirmation"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{tr("Ho verificato i valori proposti dall’AI")}</label>}
        {error && <p role="alert" className="entry-error">{tr(error)} {error.includes(tr("Autenticazione")) && <a href="/login" target="_blank" rel="noreferrer">{tr("Accedi")}</a>}</p>}
        {savedPreferences && <p role="status">{tr(savedPreferences)}</p>}
        <button type="submit" className="primary-btn food-save" disabled={saving || ai && !confirmed}>{saving ? tr("Salvataggio…") : tr("Aggiungi a {0}", { "0": tr(slotLabels[slot]) })}<UiIcon name="plus" /></button>
      </div></div>

    </fieldset></form>
  </section>;
}
