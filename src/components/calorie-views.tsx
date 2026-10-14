import type { MacroGoals } from "@/lib/goal-targets";
import { useId, type CSSProperties } from "react";
import { UiIcon } from "@/components/ui-icon";
import { EnergyRippleFilter } from "@/components/energy-ripple-filter";
import { NutritionSummary, NutrientDetails, entryNutrition } from "@/components/nutrition-summary";
import { dailySummary, formatDate, monthDays, slotLabels, slots, type DiaryEntry, type Slot } from "@/lib/diary";

const number = (value: number) => new Intl.NumberFormat("it-IT", { useGrouping: "always" }).format(value);
const sourceLabel = (entry: DiaryEntry) => entry.copiedMeal ? "Pasto copiato" : entry.source === "norish_sync" ? "Da norish" : "Manuale";

export function DashboardView({ entries, date, target, macroGoals, showTitle = true }: { entries: DiaryEntry[]; date: string; target: number | null; macroGoals?: MacroGoals | null; showTitle?: boolean }) {
  const fillMaskId = useId();
  const summary = dailySummary(entries, date, target);
  const progress = target === null || target <= 0 ? 0 : Math.min(summary.consumed / target, 1) * 100;
  const excess = summary.remaining !== null && summary.remaining < 0;
  return <div className="view-stack">
    {showTitle && <div className="view-title"><div><h1>Riepilogo del giorno<span className="title-punctuation">.</span></h1></div></div>}
    <section className={`energy-card ${excess ? "is-over-target" : summary.remaining !== null && summary.remaining > 0 ? "is-under-target" : ""}`} aria-label="Bilancio energetico" style={{ "--energy-ripple": `url(#${fillMaskId}-ripple)` } as CSSProperties}>
      <EnergyRippleFilter id={`${fillMaskId}-ripple`} />
      <div className="energy-header"><span className="section-kicker">BILANCIO ENERGETICO</span><span className="energy-tag"><span className="signal-dot" /> DIARIO / LIVE</span></div>
      <div className="energy-console">
        <div className="energy-gauge" style={{ "--gauge-offset": 100 - progress } as CSSProperties}>
          <svg className="gauge-art" viewBox="0 0 320 320" fill="none" aria-hidden="true">
            <defs><mask id={fillMaskId}><circle cx="160" cy="160" r="136" stroke="white" strokeWidth="12" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - progress} transform="rotate(-90 160 160)" /></mask></defs>
            <circle className="gauge-orbit" cx="160" cy="160" r="153" strokeWidth="1" strokeDasharray="2 10" />
            <circle className="gauge-track" cx="160" cy="160" r="136" strokeWidth="9" />
            <circle className="gauge-fill" cx="160" cy="160" r="136" strokeWidth="9" strokeLinecap="round" pathLength="100" strokeDasharray="100" transform="rotate(-90 160 160)" />
            <g mask={`url(#${fillMaskId})`}>
              <circle className="gauge-wave" cx="160" cy="160" r="136" strokeWidth="9" strokeLinecap="round" pathLength="100" strokeDasharray="12 88" transform="rotate(-90 160 160)" />
              <circle className="gauge-glitch" cx="160" cy="160" r="136" strokeWidth="5" pathLength="100" strokeDasharray="18 3 7 5" />
            </g>
            <circle className="gauge-inner" cx="160" cy="160" r="119" strokeWidth="1" />
            <path className="gauge-flame" d="M166 63c7 40 44 46 44 79 0 30-22 48-50 48-31 0-50-21-50-47 0-23 16-35 23-48 0 23 11 27 16 28 8-17 20-28 17-60Z" />
            <path className="gauge-crosshair" d="M160 11v15 M160 294v15 M11 160h15 M294 160h15" />
          </svg>
          <div className="energy-readout"><span className="section-kicker">ENERGIA REGISTRATA</span><div className="energy-number">{number(summary.consumed)}</div><span className="energy-unit">kcal</span>{summary.remaining !== null && <div className="energy-balance"><span>{excess ? "In eccesso" : "Rimanenti"}</span><strong>{number(Math.abs(summary.remaining))} <small>kcal</small></strong></div>}</div>
        </div>
        <div className="energy-details"><span className="energy-caption">IL TUO OBIETTIVO QUOTIDIANO</span>
          <div className="energy-target">{target === null ? "Da configurare" : <>{number(target)} <small>kcal</small></>}</div>
          <div className="energy-rule" role="img" aria-label={target === null ? "Obiettivo non configurato" : `${number(summary.consumed)} di ${number(target)} kcal registrate`}><span style={{ width: `${progress}%` }} /></div>
          <div className="energy-foot">{target === null ? <span>Obiettivo non configurato · riepilogo informativo</span> : <><span>{Math.round(summary.consumed / target * 100)}% registrato</span><span>{excess ? "Obiettivo superato" : summary.remaining === 0 ? "Obiettivo raggiunto" : "Bilancio del giorno"}</span></>}</div>
          <a className="goal-action" href="/profile#obiettivo">{target === null ? "Configura obiettivo" : "Modifica obiettivo"}<UiIcon name="right" /></a>
          {summary.unknownCount > 0 && <p className="data-note">{summary.unknownCount} {summary.unknownCount === 1 ? "voce senza kcal definite" : "voci senza kcal definite"}: non incluse nel totale.</p>}
        </div>
      </div>
    </section>
    <NutritionSummary goals={macroGoals} entries={entries.filter(entry => entry.date === date)} />
    <section aria-labelledby="meals-title"><div className="section-heading"><div><span className="section-kicker">IL TUO DIARIO</span><h2 id="meals-title">I quattro pasti</h2></div><span className="muted-caption">{summary.count} {summary.count === 1 ? "voce registrata" : "voci registrate"}</span></div><div className="meal-grid">{slots.map((slot, index) => {
      const slotEntries = entries.filter((entry) => entry.date === date && entry.slot === slot);
      return <article className="meal-card" key={slot}><div className="meal-top"><span className="meal-index">0{index + 1}</span><span className="meal-mark" aria-hidden="true">{["◔", "◉", "✦", "☾"][index]}</span></div><h3>{slotLabels[slot]}</h3><p>{slotEntries.length ? slotEntries.map((entry) => entry.name).join(" · ") : "Nessuna voce"}</p><div className="meal-bottom"><strong>{number(summary.bySlot[slot])} <small>kcal note</small></strong><span>{slotEntries.length} {slotEntries.length === 1 ? "voce" : "voci"}</span></div></article>;
    })}</div></section>

    <p className="data-note">I totali sono solo un riepilogo dei dati registrati, non una raccomandazione nutrizionale.</p>
  </div>;
}

export function DiaryView({ entries, date, target = null, macroGoals, showTitle = true, onEdit, onAdd, onDelete, onShare }: { entries: DiaryEntry[]; date: string; target?: number | null; macroGoals?: MacroGoals | null; showTitle?: boolean; onEdit?: (entry: DiaryEntry, trigger: HTMLButtonElement) => void; onAdd?: (slot: Slot, trigger: HTMLButtonElement) => void; onDelete?: (entry: DiaryEntry, trigger: HTMLButtonElement) => void; onShare?: (slot: Slot, trigger: HTMLButtonElement) => void }) {
  const rippleId = useId();
  const today = entries.filter((entry) => entry.date === date);
  const summary = dailySummary(entries, date, target);
  const excess = summary.remaining !== null && summary.remaining < 0;
  const progress = target && target > 0 ? Math.min(summary.consumed / target, 1) * 100 : 0;
  return <div className="view-stack">{showTitle && <div className="view-title"><div><h1>Diario<span className="title-punctuation">.</span></h1></div><span className="muted-caption">{today.length} {today.length === 1 ? "voce" : "voci"}</span></div>}
    <section className={`diary-balance ${excess ? "is-over-target" : summary.remaining !== null && summary.remaining > 0 ? "is-under-target" : ""}`} aria-label="Bilancio energetico" style={{ "--energy-ripple": `url(#${rippleId}-ripple)` } as CSSProperties}><EnergyRippleFilter id={`${rippleId}-ripple`} /><div><span className="section-kicker">BILANCIO ENERGETICO</span><strong>{number(summary.consumed)} <small>kcal {target !== null && <>/ {number(target)}</>}</small></strong></div>{summary.remaining !== null ? <div className="energy-balance"><span>{excess ? "In eccesso" : "Rimanenti"}</span><strong>{number(Math.abs(summary.remaining))} <small>kcal</small></strong></div> : <a className="goal-action" href="/profile#obiettivo">Configura obiettivo<UiIcon name="right" /></a>}<div className="energy-rule" role="img" aria-label={target === null ? "Obiettivo non configurato" : `${number(summary.consumed)} di ${number(target)} kcal registrate`}><span style={{ width: `${progress}%` }} /></div>{summary.unknownCount > 0 && <p className="data-note">{summary.unknownCount} {summary.unknownCount === 1 ? "voce senza kcal definite" : "voci senza kcal definite"}: non incluse nel totale.</p>}</section>
    <NutritionSummary goals={macroGoals} entries={today} />
    {today.length === 0 && <p className="empty-note">Nessuna voce per questa data.</p>}
    <div className="diary-groups">{slots.map((slot, index) => {
      const group = today.filter((entry) => entry.slot === slot);
      return <section className="diary-group" key={slot} aria-label={slotLabels[slot]}><div className="diary-group-head"><div><span className="meal-index">0{index + 1} / PASTO</span><h2>{slotLabels[slot]}</h2></div><div className="meal-head-actions">{onShare && group.length > 0 && <button type="button" className="neon-action" aria-label={`Condividi ${slotLabels[slot]} tramite link`} title="Condividi tramite link · 2 ore" onClick={event => onShare(slot, event.currentTarget)}><UiIcon name="share" /></button>}{onAdd && <button type="button" className="meal-add" data-add-slot={slot} aria-label={`Aggiungi alimento a ${slotLabels[slot]}`} onClick={event => onAdd(slot, event.currentTarget)}><UiIcon name="plus" /></button>}</div></div>
        {group.length ? group.map((entry) => <article key={entry.id} className="entry-row"><div className="entry-icon" aria-hidden="true">{entry.entryType === "recipe" ? "✳" : "◈"}</div><div className="entry-main"><strong id={`entry-name-${entry.id}`}>{entry.name}</strong><span>{entry.entryType === "recipe" ? `${entry.servings ?? 1} ${(entry.servings ?? 1) === 1 ? "porzione" : "porzioni"}` : entry.portion ? `${number(entry.portion.quantity)} × ${entry.portion.label} (${number(entry.quantityGrams ?? 0)} g)` : `${entry.quantityGrams ?? 0} g`} <span aria-hidden="true">·</span> <span className={entry.source === "norish_sync" ? "origin imported" : "origin"}>{sourceLabel(entry)}</span>{entry.norishDeleted && " · Rimossa su norish"}</span><NutrientDetails nutrients={entryNutrition(entry)} /></div><div className="entry-energy">{entry.kcal === null ? <span>kcal non definite</span> : <><strong>{number(entry.kcal)}</strong><span>kcal</span></>}</div>{entry.source === "manual" && <div className="entry-controls">{onEdit && <button type="button" className="neon-action edit-action" data-edit-id={entry.id} data-return-slot={entry.slot} aria-label="Modifica" aria-describedby={`entry-name-${entry.id}`} title={`Modifica ${entry.name}`} onClick={event => onEdit(entry, event.currentTarget)}><UiIcon name="pencil" /></button>}{onDelete && <button type="button" className="neon-action delete-action" data-delete-id={entry.id} data-return-slot={entry.slot} aria-label="Elimina" aria-describedby={`entry-name-${entry.id}`} title={`Elimina ${entry.name}`} onClick={event => onDelete(entry, event.currentTarget)}><UiIcon name="trash" /></button>}</div>}</article>) : <p className="empty-slot">Nessuna voce in questo pasto.</p>}
      </section>;
    })}</div>
  </div>;
}

export function CalendarView({ entries, date, onSelect, showTitle = true }: { entries: DiaryEntry[]; date: string; onSelect: (date: string) => void; showTitle?: boolean }) {
  const days = monthDays(date), month = date.slice(0, 7);
  return <div className="view-stack">{showTitle && <div className="view-title"><div><h1>Calendario<span className="title-punctuation">.</span></h1></div></div>}
    <section className="calendar-panel" aria-label="Calendario pasti"><div className="calendar-heading"><div><span className="section-kicker">MESE SELEZIONATO</span><h2>{formatDate(date, { month: "long", year: "numeric" })}</h2></div><span className="calendar-key"><i /> Pasti importati</span></div>
      <div className="calendar-grid">{["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => <span key={day} className="weekday">{day}</span>)}{days.map((day) => {
        const imports = entries.filter((entry) => entry.date === day && entry.source === "norish_sync");
        return <button key={day} type="button" onClick={() => onSelect(day)} className={`calendar-day ${day.slice(0, 7) !== month ? "outside" : ""} ${date === day ? "selected" : ""}`} aria-label={`${formatDate(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${imports.length} pasti importati${date === day ? ", selezionato" : ""}`} aria-pressed={date === day}><span>{Number(day.slice(-2))}</span>{imports.length > 0 && <small><i aria-hidden="true" /> {imports.length} norish</small>}</button>;
      })}</div>
    </section><section className="calendar-list" aria-label="Pasti importati nella data selezionata"><div className="section-heading"><div><span className="section-kicker">DETTAGLIO DEL GIORNO</span><h2>{formatDate(date)}</h2></div></div>{entries.filter((entry) => entry.date === date && entry.source === "norish_sync").map((entry) => <article className="calendar-import" key={entry.id}><span>{slotLabels[entry.slot]}</span><strong>{entry.name}</strong><span>{entry.kcal === null ? "kcal non definite" : `${number(entry.kcal)} kcal`}</span><span className="origin imported">Da norish</span></article>)}{!entries.some((entry) => entry.date === date && entry.source === "norish_sync") && <p className="empty-note">Nessun pasto importato per questa data.</p>}</section>
  </div>;
}
