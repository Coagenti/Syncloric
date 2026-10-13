"use client";
import { UiIcon } from "@/components/ui-icon";
import { foodPortionsSchema, parseFoodAmount, newPortionId, type FoodPortion } from "@/lib/food-portions";
export type PortionDraft = { id: string; label: string; grams: string; defaultQuantity: string };
export function portionDrafts(values: FoodPortion[]): PortionDraft[] { return values.map(v => ({ ...v, grams: String(v.grams), defaultQuantity: String(v.defaultQuantity) })); }
export function parsePortionDrafts(values: PortionDraft[]) {
  return foodPortionsSchema.safeParse(values.map(v => ({ ...v, grams: parseFoodAmount(v.grams), defaultQuantity: parseFoodAmount(v.defaultQuantity) })));
}
export function PortionEditor({ values, onChange }: { values: PortionDraft[]; onChange: (values: PortionDraft[]) => void }) {
  const update = (id: string, key: keyof PortionDraft, value: string) => onChange(values.map(v => v.id === id ? { ...v, [key]: value } : v));
  return <div className="portion-editor">
    <p className="form-help">Dai un nome e un peso a ogni unità. Esempio: Biscotto 6 g, Pacchetto 50 g. Le porzioni salvate sono personali.</p>
    {values.map((v, index) => <div className="portion-definition" key={v.id}>
      <label>Nome porzione {index + 1}<input maxLength={60} required value={v.label} placeholder="Biscotto" onChange={e => update(v.id, "label", e.target.value)} /></label>
      <label>Peso porzione {index + 1} (g)<input required inputMode="decimal" value={v.grams} placeholder="6" onChange={e => update(v.id, "grams", e.target.value)} /></label>
      <label>Quantità predefinita {index + 1}<input required inputMode="decimal" value={v.defaultQuantity} onChange={e => update(v.id, "defaultQuantity", e.target.value)} /></label>
      <button type="button" className="neon-action danger" aria-label={`Elimina porzione ${index + 1}`} onClick={() => onChange(values.filter(row => row.id !== v.id))}><UiIcon name="trash" /></button>
    </div>)}
    <button type="button" className="secondary-btn" disabled={values.length >= 20} onClick={() => onChange([...values, { id: newPortionId(), label: "", grams: "", defaultQuantity: "1" }])}><UiIcon name="plus" />Nuova porzione</button>
  </div>;
}
