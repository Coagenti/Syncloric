"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import type { MacroGoals } from "@/lib/goal-targets";
import { useId, useState, type CSSProperties } from "react";
import { UiIcon } from "@/components/ui-icon";
import { EnergyRippleFilter } from "@/components/energy-ripple-filter";
import { NutritionSummary } from "@/components/nutrition-summary";
import { dailySummary, monthDays, slotLabels, slots, mealDetailUrl, type DiaryEntry } from "@/lib/diary";
import { foodEntryUrl } from "@/lib/food-entry";

import { MealMacros, type MealActions } from "@/components/meal-detail";
const sourceLabel = (entry: DiaryEntry) => entry.copiedMeal ? "Pasto copiato" : entry.source === "norish_sync" ? "Da norish" : "Manuale";

export function DashboardView({ entries, date, target, macroGoals, showTitle = true }: { entries: DiaryEntry[]; date: string; target: number | null; macroGoals?: MacroGoals | null; showTitle?: boolean }) {
  const { tr, formatNumber } = useI18n();
  const number = (value: number) => formatNumber(value, { useGrouping: "always" });
  const fillMaskId = useId();
  const summary = dailySummary(entries, date, target);
  const progress = target === null || target <= 0 ? 0 : Math.min(summary.consumed / target, 1) * 100;
  const excess = summary.remaining !== null && summary.remaining < 0;
  const missingCalories = summary.unknownCount > 0 ? tr("{0} {1}: non incluse nel totale.", { "0": summary.unknownCount, "1": summary.unknownCount === 1 ? tr("voce senza kcal definite") : tr("voci senza kcal definite") }) : null;
  return <div className="view-stack">
    {showTitle && <div className="view-title"><div><h1>{tr("Riepilogo del giorno")}<span className="title-punctuation">.</span></h1></div></div>}
    <div className={`daily-overview${excess ? " is-over-target" : ""}`}>
    <section className={`energy-card ${excess ? "is-over-target" : summary.remaining !== null && summary.remaining > 0 ? "is-under-target" : ""}`} aria-label={tr("Bilancio energetico")} style={{ "--energy-ripple": `url(#${fillMaskId}-ripple)` } as CSSProperties}>
      <EnergyRippleFilter id={`${fillMaskId}-ripple`} />
      <div className="energy-header"><span className="section-kicker">{tr("BILANCIO ENERGETICO")}</span><span className="energy-tag"><span className="signal-dot" />{tr(" DIARIO / LIVE")}</span></div>
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
          <div className="energy-readout"><span className="section-kicker">{tr("Registrate")}</span><div className="energy-number">{number(summary.consumed)}</div><span className="energy-unit">kcal</span>
            <div className="energy-comparison">
              <div className="energy-total"><span>{tr("Totali")}</span><strong>{target === null ? "—" : number(target)} <small>kcal</small></strong></div>
              <span className="energy-comparison-divider" aria-hidden="true">/</span>
              <div className={`energy-balance${summary.remaining === null ? " energy-balance-unset" : ""}`}><span>{excess ? tr("In eccesso") : tr("Rimanenti")}</span><strong>{summary.remaining === null ? "—" : number(Math.abs(summary.remaining))} <small>kcal</small></strong></div>
            </div>
            {target === null && <span className="energy-unconfigured">{tr("Obiettivo non configurato")}</span>}
          </div>
        </div>
        <div className="energy-details"><span className="energy-caption">{tr("IL TUO OBIETTIVO QUOTIDIANO")}</span>
          <div className="energy-target">{target === null ? tr("Da configurare") : <>{number(target)} <small>kcal</small></>}</div>
          <div className="energy-rule" role="img" aria-label={target === null ? tr("Obiettivo non configurato") : tr("{0} di {1} kcal registrate", { "0": number(summary.consumed), "1": number(target) })}><span style={{ width: `${progress}%` }} /></div>
          <div className="energy-foot">{target === null ? <span>{tr("Obiettivo non configurato · riepilogo informativo")}</span> : <><span>{Math.round(summary.consumed / target * 100)}{tr("% registrato")}</span><span>{excess ? tr("Obiettivo superato") : summary.remaining === 0 ? tr("Obiettivo raggiunto") : tr("Bilancio del giorno")}</span></>}</div>
          <a className="goal-action" href="/profile#obiettivo">{target === null ? tr("Configura obiettivo") : tr("Modifica obiettivo")}<UiIcon name="right" /></a>
          {missingCalories && <p className="data-note">{missingCalories}</p>}
        </div>
      </div>
    </section>
    <NutritionSummary goals={macroGoals} entries={entries.filter(entry => entry.date === date)} mobileNote={missingCalories} />
    </div>
    <section aria-labelledby="meals-title"><div className="section-heading"><div><span className="section-kicker">{tr("IL TUO DIARIO")}</span><h2 id="meals-title">{tr("I quattro pasti")}</h2></div><span className="muted-caption">{summary.count} {summary.count === 1 ? tr("voce registrata") : tr("voci registrate")}</span></div><div className="meal-grid">{slots.map((slot, index) => {
      const slotEntries = entries.filter((entry) => entry.date === date && entry.slot === slot);
      return <a className="meal-card" key={slot} href={foodEntryUrl(date, slot)} aria-label={tr("Aggiungi alimenti a {0}", { "0": tr(slotLabels[slot]) })}><div className="meal-top"><span className="meal-index">0{index + 1}</span><span className="meal-mark" aria-hidden="true">{["◔", "◉", "✦", "☾"][index]}</span></div><h3>{tr(slotLabels[slot])}</h3><p>{slotEntries.length ? slotEntries.map((entry) => entry.name).join(" · ") : tr("Nessuna voce")}</p><div className="meal-bottom"><strong>{number(summary.bySlot[slot])} <small>{tr("kcal note")}</small></strong><span>{slotEntries.length} {slotEntries.length === 1 ? tr("voce") : tr("voci")}</span></div></a>;
    })}</div></section>

    <p className="data-note">{tr("I totali sono solo un riepilogo dei dati registrati, non una raccomandazione nutrizionale.")}</p>
  </div>;
}

export function DiaryView({ entries, date, target = null, showTitle = true, onAdd }: { entries: DiaryEntry[]; date: string; target?: number | null; showTitle?: boolean } & MealActions) {
  const { tr, formatNumber } = useI18n();
  const number = (value: number) => formatNumber(value, { useGrouping: "always" });
  const rippleId = useId();
  const summary = dailySummary(entries, date, target);
  const excess = summary.remaining !== null && summary.remaining < 0;
  const progress = target && target > 0 ? Math.min(summary.consumed / target, 1) * 100 : 0;
  return <div className="view-stack">{showTitle && <div className="view-title"><h1>{tr("Diario")}<span className="title-punctuation">.</span></h1></div>}
    <section className={`diary-balance ${excess ? "is-over-target" : summary.remaining !== null && summary.remaining > 0 ? "is-under-target" : ""}`} aria-label={tr("Bilancio energetico")} style={{ "--energy-ripple": `url(#${rippleId}-ripple)` } as CSSProperties}><EnergyRippleFilter id={`${rippleId}-ripple`} /><div><span className="section-kicker">{tr("BILANCIO ENERGETICO")}</span><strong>{number(summary.consumed)} <small>kcal {target !== null && <>/ {number(target)}</>}</small></strong></div>{summary.remaining !== null ? <div className="energy-balance"><span>{excess ? tr("In eccesso") : tr("Rimanenti")}</span><strong>{number(Math.abs(summary.remaining))} <small>kcal</small></strong></div> : <a className="goal-action" href="/profile#obiettivo">{tr("Configura obiettivo")}<UiIcon name="right" /></a>}<div className="energy-rule" role="img" aria-label={target === null ? tr("Obiettivo non configurato") : tr("{0} di {1} kcal registrate", { "0": number(summary.consumed), "1": number(target) })}><span style={{ width: `${progress}%` }} /></div>{summary.unknownCount > 0 && <p className="data-note">{summary.unknownCount} {summary.unknownCount === 1 ? tr("voce senza kcal definite") : tr("voci senza kcal definite")}{tr(": non incluse nel totale.")}</p>}</section>
    <div className="diary-groups compact-meals">{slots.map(slot => {
      const group = entries.filter(entry => entry.date === date && entry.slot === slot);
      const known = group.filter(entry => entry.kcal !== null), kcal = known.reduce((sum, entry) => sum + entry.kcal!, 0);
      return <section className="diary-group diary-meal" key={slot} aria-label={tr(slotLabels[slot])}>
        <a className="diary-meal-link" href={mealDetailUrl(date, slot)} aria-label={tr("Apri {0}", { "0": tr(slotLabels[slot]) })}>
          <div className="diary-meal-heading"><h2>{tr(slotLabels[slot])}</h2><div className="meal-energy"><strong>{group.length && !known.length ? "—" : number(kcal)}</strong> <span>kcal</span>{known.length < group.length && <small className="meal-partial">{tr("Parziale")}</small>}</div><UiIcon name="right" /></div>
          <MealMacros entries={group} />
        </a>
        {onAdd && <button type="button" className="meal-add" data-add-slot={slot} aria-label={tr("Aggiungi alimento a {0}", { "0": tr(slotLabels[slot]) })} onClick={event => onAdd(slot, event.currentTarget)}><UiIcon name="plus" /></button>}
      </section>;
    })}</div>
  </div>;
}

export function CalendarView({ entries, date, onSelect, showTitle = true }: { entries: DiaryEntry[]; date: string; onSelect: (date: string) => void; showTitle?: boolean }) {
  const { tr, formatNumber, formatDay } = useI18n();
  const [source, setSource] = useState("all");
  const number = (value: number) => formatNumber(value, { useGrouping: "always" });
  const visible = entries.filter(entry => source === "all" || entry.source === "norish_sync");
  const selected = visible.filter(entry => entry.date === date);
  const summary = dailySummary(visible, date, null);
  const days = monthDays(date), month = date.slice(0, 7);
  return <div className="view-stack">
    {showTitle && <div className="view-title"><h1>{tr("Calendario")}<span className="title-punctuation">.</span></h1></div>}
    <section className="calendar-panel" aria-label={tr("Calendario pasti")}>
      <div className="calendar-heading"><div><span className="section-kicker">{tr("MESE SELEZIONATO")}</span><h2>{formatDay(date, { month: "long", year: "numeric" })}</h2></div>
        <label className="calendar-filter">{tr("Mostra")}<select aria-label={tr("Filtra pasti nel calendario")} value={source} onChange={event => setSource(event.target.value)}><option value="all">{tr("Tutte le registrazioni")}</option><option value="norish">{tr("Solo Norish")}</option></select></label>
      </div>
      <div className="calendar-grid">{[tr("Lun"), tr("Mar"), tr("Mer"), tr("Gio"), tr("Ven"), tr("Sab"), tr("Dom")].map(day => <span key={day} className="weekday">{day}</span>)}{days.map(day => {
        const recorded = visible.filter(entry => entry.date === day);
        return <button key={day} type="button" onClick={() => onSelect(day)} className={["calendar-day", day.slice(0, 7) !== month ? "outside" : "", date === day ? "selected" : ""].join(" ")} aria-label={tr("{0}, {1} voci registrate{2}", { "0": formatDay(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" }), "1": recorded.length, "2": date === day ? tr(", selezionato") : "" })} aria-pressed={date === day}>
          <span>{Number(day.slice(-2))}</span>{recorded.length > 0 && <small className="calendar-count"><i aria-hidden="true" />{recorded.length}<span className="calendar-count-label"> {source === "norish" ? "norish" : recorded.length === 1 ? tr("voce") : tr("voci")}</span></small>}
        </button>;
      })}</div>
    </section>
    <section className="calendar-list" aria-label={tr("Pasti nella data selezionata")}>
      <div className="section-heading"><h2>{formatDay(date)}</h2>{selected.length > 0 && <span className="calendar-day-summary">{number(summary.consumed)} {tr("kcal note")} · {selected.length} {selected.length === 1 ? tr("voce") : tr("voci")}</span>}</div>
      {summary.unknownCount > 0 && <p className="data-note">{tr("{0} {1} senza kcal: totale parziale.", { "0": summary.unknownCount, "1": tr(summary.unknownCount === 1 ? "voce" : "voci") })}</p>}
      {selected.map(entry => <article className="calendar-import" key={entry.id}><span>{tr(slotLabels[entry.slot])}</span><strong>{entry.name}</strong><span>{entry.kcal === null ? tr("kcal non definite") : number(entry.kcal) + " kcal"}</span><span className={entry.source === "norish_sync" ? "origin imported" : "origin"}>{tr(sourceLabel(entry))}</span></article>)}
      {!selected.length && <p className="empty-note">{source === "norish" ? tr("Nessun pasto importato per questa data.") : tr("Nessuna voce per questa data.")}</p>}
    </section>
  </div>;
}
