"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { nutrientSpecs, normalizeNutrition, nutritionTotals, type Nutrition } from "@/lib/nutrition";
import type { DiaryEntry } from "@/lib/diary";
import type { MacroGoals } from "@/lib/goal-targets";
const totalsNote = "Somma dei valori disponibili: i nutrienti mancanti restano sconosciuti, quindi i totali possono essere parziali.";
export function NutrientDetails({ nutrients }: { nutrients: Nutrition }) {
  const { tr, formatNumber } = useI18n();
  const format = (value: number) => formatNumber(value, { maximumFractionDigits: value > 0 && value < .001 ? 6 : 3 });
  const known = nutrientSpecs.filter(spec => nutrients[spec.key] !== undefined);
  if (!known.length) return null;
  return <details className="entry-nutrients"><summary>{tr("Nutrienti registrati")}</summary><dl className="nutrient-list">{known.map(spec => <div key={spec.key}><dt>{tr(spec.label)}</dt><dd>{format(nutrients[spec.key]!)} {spec.unit}</dd></div>)}</dl></details>;
}
export function entryNutrition(entry: DiaryEntry) { return normalizeNutrition(entry.nutrients, { protein: entry.protein, fat: entry.fat, carbs: entry.carbs }); }
export function NutritionSummary({ entries, goals, mobileNote }: { entries: DiaryEntry[]; goals?: MacroGoals | null; mobileNote?: string | null }) {
  const { tr, formatNumber } = useI18n();
  const format = (value: number) => formatNumber(value, { maximumFractionDigits: value > 0 && value < .001 ? 6 : 3 });
  const compactGrams = (value: number) => value > 0 && value < .05 ? `<${formatNumber(.1)}` : formatNumber(value, { maximumFractionDigits: 1 });
  const totals = nutritionTotals(entries);
  const others = totals.filter(t => t.group !== "macro" && t.value !== null);
  const incomplete = totals.filter(t => t.group === "macro" && t.known > 0 && t.known < t.count);
  return <section className="nutrition-summary" aria-label={tr("Nutrienti del giorno")}><div className="section-heading"><h2>{tr("Nutrienti del giorno")}</h2><a className="goal-action" href="/profile#nutrienti">{tr("Obiettivi macro")}<UiGoalArrow /></a></div><div className="macro-summary">{totals.filter(t => t.group === "macro").map(t => {
    const key = t.key as keyof MacroGoals["grams"]; const target = goals?.grams[key]; const percent = target && t.value !== null ? Math.round(t.value / target * 100) : null;
    return <article key={t.key} className={`macro-card macro-${t.key}`}>
      <span>{tr(t.label)}</span>
      <strong className="macro-amount-full">{t.value === null ? "—" : format(t.value)} <small>{t.unit}</small></strong>
      <strong className="macro-amount-compact">{t.value === null ? "—" : compactGrams(t.value)}<small>{target === undefined ? " g" : ` / ${compactGrams(target)} g`}</small></strong>
      {t.known > 0 && t.known < t.count && <small className="macro-partial">{tr("Parziale")}</small>}
      {target !== undefined && <span className="macro-target">{tr("Obiettivo ")}{format(target)} g · {goals!.percentages[key]}{tr("% kcal")}</span>}
      <div className={`macro-progress${target === undefined ? " macro-progress-unset" : ""}`} role="img" aria-label={target === undefined ? tr("{0}: obiettivo non configurato", { "0": tr(t.label) }) : percent === null ? tr("{0}: dati non disponibili", { "0": tr(t.label) }) : tr("{0}: {1}% dell’obiettivo, totale {2}", { "0": tr(t.label), "1": percent, "2": t.known < t.count ? tr("parziale") : tr("registrato") })}><i style={{ width: `${Math.min(100, percent ?? 0)}%` }} /></div>
      {target !== undefined && <small className="macro-progress-label">{percent === null ? "—" : tr("{0}% dell’obiettivo{1}", { "0": percent, "1": t.known < t.count ? tr(" · parziale") : "" })}</small>}
      <small className="macro-coverage">{t.count === 0 ? tr("Nessuna voce") : tr("{0}/{1} voci con dati", { "0": t.known, "1": t.count })}</small>
    </article>;
  })}</div>
    <details className="extra-nutrients"><summary><span className="nutrition-details-full">{tr("Altri nutrienti · vitamine e minerali")}</span><span className="nutrition-details-compact">{tr("Dettagli")}</span></summary>{incomplete.length > 0 && <ul className="macro-completeness">{incomplete.map(t => <li key={t.key}>{tr("{0}: {1}/{2} voci con dati", { "0": tr(t.label), "1": t.known, "2": t.count })}</li>)}</ul>}{others.length ? <dl className="nutrient-list">{others.map(t => <div key={t.key}><dt>{tr(t.label)}<small>{t.known}/{t.count}{tr(" voci con dati")}</small></dt><dd>{format(t.value!)} {t.unit}</dd></div>)}</dl> : <p className="form-help">{tr("Nessun altro nutriente registrato per questo giorno.")}</p>}
      <div className="nutrition-mobile-notes">{mobileNote && <p className="data-note">{tr(mobileNote)}</p>}<p className="data-note">{tr(totalsNote)}</p></div>
    </details>
    <p className="data-note nutrition-totals-note">{tr(totalsNote)}</p>
  </section>;
}
function UiGoalArrow() { return <span aria-hidden="true">↗</span>; }
