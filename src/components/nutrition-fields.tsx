"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { nutrientSpecs, type NutrientKey } from "@/lib/nutrition";
export function NutritionFields({ values, basis, readOnly = false, prefix = "nutrient-", onChange }: { values: Partial<Record<NutrientKey, number | string>>; basis: string; readOnly?: boolean; prefix?: string; onChange?: (key: NutrientKey, value: string) => void }) {
  const { tr } = useI18n();
  const field = (spec: typeof nutrientSpecs[number]) => <label key={spec.key}>{tr(spec.label)}{spec.unit !== "g" ? ` (${spec.unit})` : ""} {tr(basis)}<input name={`${prefix}${spec.key}`} type="number" min="0" step="any" max={basis === "per 100 g" ? spec.unit === "g" ? 100 : spec.unit === "mg" ? 100000 : 100000000 : 1e12} readOnly={readOnly} value={onChange || readOnly ? values[spec.key] ?? "" : undefined} defaultValue={onChange || readOnly ? undefined : values[spec.key] ?? ""} onChange={onChange ? event => onChange(spec.key, event.target.value) : undefined} /></label>;
  return <div className="nutrition-fields"><div className="macro-fields">{nutrientSpecs.filter(s => s.group === "macro").map(field)}</div>
    <details className="extra-nutrients"><summary>{tr("Fibre, zuccheri, vitamine e minerali")}</summary><p className="form-help">{tr("Unità indicate per ogni campo; lascia vuoti i valori sconosciuti. ")}{basis === "per 100 g" ? tr("Tutti i valori si riferiscono a 100 g.") : tr("Valori totali della quantità registrata.")}</p><div className="micro-fields">{nutrientSpecs.filter(s => s.group !== "macro").map(field)}</div></details>
  </div>;
}
