"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { UiIcon } from "@/components/ui-icon";
import { NutrientDetails, entryNutrition } from "@/components/nutrition-summary";
import { nutritionTotals } from "@/lib/nutrition";
import { slotLabels, type DiaryEntry, type Slot } from "@/lib/diary";
import { foodEntryUrl } from "@/lib/food-entry";

const sourceLabel = (entry: DiaryEntry) => entry.copiedMeal ? "Pasto copiato" : entry.source === "norish_sync" ? "Da norish" : "Manuale";
type EntryAction = (entry: DiaryEntry, trigger: HTMLButtonElement) => void;
export type MealActions = { onEdit?: EntryAction; onDelete?: EntryAction; onDuplicate?: EntryAction; onAdd?: (slot: Slot, trigger: HTMLButtonElement) => void; onShare?: (slot: Slot, trigger: HTMLButtonElement) => void };

export function MealMacros({ entries }: { entries: DiaryEntry[] }) {
  const { tr, formatNumber } = useI18n();
  const grams = (value: number) => value > 0 && value < .05 ? "<" + formatNumber(.1) : formatNumber(value, { maximumFractionDigits: 1 });
  return <dl className="meal-macros">{nutritionTotals(entries).filter(t => t.group === "macro").map(t => <div className={"meal-macro meal-macro-" + t.key} key={t.key}>
    <dt>{tr(t.label)}</dt><dd>{!entries.length ? "0" : t.value === null ? "—" : grams(t.value)} <small>g</small></dd>
    {t.known > 0 && t.known < t.count && <small className="meal-partial">{tr("Parziale")}</small>}
  </div>)}</dl>;
}

export function MealDetailView({ entries, date, slot, onEdit, onDelete, onDuplicate, onAdd, onShare }: { entries: DiaryEntry[]; date: string; slot: Slot } & MealActions) {
  const { tr, formatNumber } = useI18n();
  const number = (value: number) => formatNumber(value, { useGrouping: "always", maximumFractionDigits: 2 });
  const group = entries.filter(entry => entry.date === date && entry.slot === slot);
  const knownEnergy = group.filter(entry => entry.kcal !== null), energy = knownEnergy.reduce((sum, entry) => sum + entry.kcal!, 0);
  const micros = nutritionTotals(group).filter(t => t.group !== "macro" && t.value !== null);
  return <div className="meal-detail view-stack">
    <section className="meal-nutrition" aria-label={tr("Valori nutrizionali del pasto")}>
      <div className="meal-nutrition-head"><h2>{tr("Totali del pasto")}</h2><div className="meal-energy"><strong>{group.length && !knownEnergy.length ? "—" : number(energy)}</strong> <span>kcal</span>{knownEnergy.length < group.length && <small className="meal-partial">{tr("Parziale")}</small>}</div></div>
      <MealMacros entries={group} />
      <details className="meal-micronutrients" open><summary>{tr("Micronutrienti e altri valori")}</summary>
        {micros.length ? <dl className="nutrient-list">{micros.map(t => <div key={t.key}><dt>{tr(t.label)}{t.known < t.count && <small>{tr("{0}/{1} voci con dati", { "0": t.known, "1": t.count })}</small>}</dt><dd>{formatNumber(t.value!, { maximumFractionDigits: t.value! > 0 && t.value! < .001 ? 6 : 3 })} {t.unit}</dd></div>)}</dl> : <p className="form-help">{tr("Nessun altro nutriente registrato per questo pasto.")}</p>}
        <p className="data-note">{tr("Somma dei valori disponibili: i nutrienti mancanti restano sconosciuti, quindi i totali possono essere parziali.")}</p>
      </details>
    </section>
    <section className="diary-group meal-foods" aria-label={tr("Alimenti del pasto")}>
      <div className="diary-group-head"><h2>{tr("Alimenti del pasto")}</h2><div className="meal-head-actions">
        {onShare && group.length > 0 && <button type="button" className="neon-action" aria-label={tr("Condividi {0} tramite link", { "0": tr(slotLabels[slot]) })} title={tr("Condividi tramite link · 2 ore")} onClick={event => onShare(slot, event.currentTarget)}><UiIcon name="share" /></button>}
        {onAdd ? <button type="button" className="meal-add" data-add-slot={slot} aria-label={tr("Aggiungi alimento a {0}", { "0": tr(slotLabels[slot]) })} onClick={event => onAdd(slot, event.currentTarget)}><UiIcon name="plus" /></button> : <a className="meal-add" href={foodEntryUrl(date, slot)} aria-label={tr("Aggiungi alimento a {0}", { "0": tr(slotLabels[slot]) })}><UiIcon name="plus" /></a>}
      </div></div>
      {group.length ? group.map((entry) => <article key={entry.id} className="entry-row"><div className="entry-icon" aria-hidden="true">{entry.entryType === "recipe" ? "✳" : "◈"}</div><div className="entry-main"><strong id={`entry-name-${entry.id}`}>{entry.name}</strong><span>{entry.entryType === "recipe" ? `${number(entry.servings ?? 1)} ${(entry.servings ?? 1) === 1 ? tr("porzione") : tr("porzioni")}` : entry.portion ? `${number(entry.portion.quantity)} × ${entry.portion.label} (${number(entry.quantityGrams ?? 0)} g)` : `${number(entry.quantityGrams ?? 0)} g`} <span aria-hidden="true">·</span> <span className={entry.source === "norish_sync" ? "origin imported" : "origin"}>{tr(sourceLabel(entry))}</span>{entry.norishDeleted && tr(" · Rimossa su norish")}</span><NutrientDetails nutrients={entryNutrition(entry)} /></div><div className="entry-energy">{entry.kcal === null ? <span>{tr("kcal non definite")}</span> : <><strong>{number(entry.kcal)}</strong><span>kcal</span></>}</div><div className="entry-controls">{entry.source === "manual" && onEdit && <button type="button" className="neon-action edit-action" data-edit-id={entry.id} data-return-slot={entry.slot} aria-label={tr("Modifica")} aria-describedby={`entry-name-${entry.id}`} title={tr("Modifica {0}", { "0": entry.name })} onClick={event => onEdit(entry, event.currentTarget)}><UiIcon name="pencil" /></button>}{entry.source === "manual" && onDelete && <button type="button" className="neon-action delete-action" data-delete-id={entry.id} data-return-slot={entry.slot} aria-label={tr("Elimina")} aria-describedby={`entry-name-${entry.id}`} title={tr("Elimina {0}", { "0": entry.name })} onClick={event => onDelete(entry, event.currentTarget)}><UiIcon name="trash" /></button>}{onDuplicate && <button type="button" className="neon-action duplicate-action" data-duplicate-id={entry.id} aria-label={tr("Duplica")} aria-describedby={`entry-name-${entry.id}`} title={tr("Duplica {0}", { "0": entry.name })} onClick={event => onDuplicate(entry, event.currentTarget)}><UiIcon name="copy" /></button>}</div></article>) : <p className="empty-slot">{tr("Nessuna voce in questo pasto.")}</p>}
    </section>
  </div>;
}
