import { nutrientSpecs, normalizeNutrition, nutritionTotals, type Nutrition } from "@/lib/nutrition";
import type { DiaryEntry } from "@/lib/diary";
import type { MacroGoals } from "@/lib/goal-targets";
const format = (value: number) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: value > 0 && value < .001 ? 6 : 3 }).format(value);
export function NutrientDetails({ nutrients }: { nutrients: Nutrition }) {
  const known = nutrientSpecs.filter(spec => nutrients[spec.key] !== undefined);
  if (!known.length) return null;
  return <details className="entry-nutrients"><summary>Nutrienti registrati</summary><dl className="nutrient-list">{known.map(spec => <div key={spec.key}><dt>{spec.label}</dt><dd>{format(nutrients[spec.key]!)} {spec.unit}</dd></div>)}</dl></details>;
}
export function entryNutrition(entry: DiaryEntry) { return normalizeNutrition(entry.nutrients, { protein: entry.protein, fat: entry.fat, carbs: entry.carbs }); }
export function NutritionSummary({ entries, goals }: { entries: DiaryEntry[]; goals?: MacroGoals | null }) {
  const totals = nutritionTotals(entries);
  const others = totals.filter(t => t.group !== "macro" && t.value !== null);
  return <section className="nutrition-summary" aria-label="Nutrienti del giorno"><div className="section-heading"><h2>Nutrienti del giorno</h2><a className="goal-action" href="/profile#nutrienti">Obiettivi macro<UiGoalArrow /></a></div><div className="macro-summary">{totals.filter(t => t.group === "macro").map(t => {
    const key = t.key as keyof MacroGoals["grams"]; const target = goals?.grams[key]; const percent = target && t.value !== null ? Math.round(t.value / target * 100) : null;
    return <article key={t.key} className={`macro-card macro-${t.key}`}><span>{t.label}</span><strong>{t.value === null ? "—" : format(t.value)} <small>{t.unit}</small></strong>{target !== undefined && <><span className="macro-target">Obiettivo {format(target)} g · {goals!.percentages[key]}% kcal</span><div className="macro-progress" role="img" aria-label={percent === null ? `${t.label}: dati non disponibili` : `${t.label}: ${percent}% dell’obiettivo, totale ${t.known < t.count ? "parziale" : "registrato"}`}><i style={{ width: `${Math.min(100, percent ?? 0)}%` }} /></div><small>{percent === null ? "—" : `${percent}% dell’obiettivo${t.known < t.count ? " · parziale" : ""}`}</small></>}<small>{t.count === 0 ? "Nessuna voce" : `${t.known}/${t.count} voci con dati`}</small></article>;
  })}</div>
    <details className="extra-nutrients"><summary>Altri nutrienti · vitamine e minerali</summary>{others.length ? <dl className="nutrient-list">{others.map(t => <div key={t.key}><dt>{t.label}<small>{t.known}/{t.count} voci con dati</small></dt><dd>{format(t.value!)} {t.unit}</dd></div>)}</dl> : <p className="form-help">Nessun altro nutriente registrato per questo giorno.</p>}</details>
    <p className="data-note">Somma dei valori disponibili: i nutrienti mancanti restano sconosciuti, quindi i totali possono essere parziali.</p>
  </section>;
}
function UiGoalArrow() { return <span aria-hidden="true">↗</span>; }
