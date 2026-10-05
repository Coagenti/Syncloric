import type { CSSProperties } from "react";
import { UiIcon } from "@/components/ui-icon";
import { dailySummary, formatDate, monthDays, slotLabels, slots, type DiaryEntry, type Slot } from "@/lib/diary";

const number = (value: number) => new Intl.NumberFormat("it-IT", { useGrouping: "always" }).format(value);
const sourceLabel = (entry: DiaryEntry) => entry.source === "norish_sync" ? "Da norish" : "Manuale";

export function DashboardView({ entries, date, target }: { entries: DiaryEntry[]; date: string; target: number | null }) {
  const summary = dailySummary(entries, date, target);
  const progress = target === null || target <= 0 ? 0 : Math.min(summary.consumed / target, 1) * 100;
  return <div className="view-stack">
    <div className="eyebrow"><span className="signal-dot" /> PANORAMICA / {date}</div>
    <div className="view-title"><div><h1>Riepilogo del giorno<span className="title-punctuation">.</span></h1><p>Un giorno alla volta, tutto sotto controllo.</p></div><span className="view-index">01 / 03</span></div>
    <section className="energy-card" aria-label="Bilancio energetico">
      <div className="energy-header"><span className="section-kicker">BILANCIO ENERGETICO</span><span className="energy-tag"><span className="signal-dot" /> DIARIO / LIVE</span></div>
      <div className="energy-console">
        <div className="energy-gauge" style={{ "--gauge-offset": 100 - progress } as CSSProperties}>
          <svg className="gauge-art" viewBox="0 0 320 320" fill="none" aria-hidden="true">
            <circle className="gauge-orbit" cx="160" cy="160" r="153" strokeWidth="1" strokeDasharray="2 10" />
            <circle className="gauge-track" cx="160" cy="160" r="136" strokeWidth="9" />
            <circle className="gauge-fill" cx="160" cy="160" r="136" strokeWidth="9" strokeLinecap="round" pathLength="100" strokeDasharray="100" transform="rotate(-90 160 160)" />
            <circle className="gauge-inner" cx="160" cy="160" r="119" strokeWidth="1" />
            <path className="gauge-flame" d="M166 63c7 40 44 46 44 79 0 30-22 48-50 48-31 0-50-21-50-47 0-23 16-35 23-48 0 23 11 27 16 28 8-17 20-28 17-60Z" />
            <path className="gauge-crosshair" d="M160 11v15 M160 294v15 M11 160h15 M294 160h15" />
          </svg>
          <div className="energy-readout"><span className="section-kicker">ENERGIA REGISTRATA</span><div className="energy-number">{number(summary.consumed)}</div><span className="energy-unit">kcal</span><span className="energy-date">{formatDate(date, { day: "numeric", month: "long" })}</span></div>
        </div>
        <div className="energy-details"><span className="energy-caption">IL TUO OBIETTIVO QUOTIDIANO</span>
          <div className="energy-target">{target === null ? "Da configurare" : <>{number(target)} <small>kcal</small></>}</div>
          <div className="energy-rule" role="img" aria-label={target === null ? "Obiettivo non configurato" : `${number(summary.consumed)} di ${number(target)} kcal registrate`}><span style={{ width: `${progress}%` }} /></div>
          <div className="energy-foot">{target === null ? <span>Obiettivo non configurato · riepilogo informativo</span> : <><span>{Math.round(summary.consumed / target * 100)}% registrato</span><span>{summary.remaining !== null && summary.remaining >= 0 ? `${number(summary.remaining)} kcal di differenza` : "Obiettivo raggiunto"}</span></>}</div>
          <a className="goal-action" href="/profile">{target === null ? "Configura obiettivo" : "Modifica obiettivo"}<UiIcon name="right" /></a>
          {summary.unknownCount > 0 && <p className="data-note">{summary.unknownCount} {summary.unknownCount === 1 ? "voce senza kcal definite" : "voci senza kcal definite"}: non incluse nel totale.</p>}
        </div>
      </div>
    </section>
    <section aria-labelledby="meals-title"><div className="section-heading"><div><span className="section-kicker">IL TUO DIARIO</span><h2 id="meals-title">I quattro pasti</h2></div><span className="muted-caption">{summary.count} {summary.count === 1 ? "voce registrata" : "voci registrate"}</span></div><div className="meal-grid">{slots.map((slot, index) => {
      const slotEntries = entries.filter((entry) => entry.date === date && entry.slot === slot);
      return <article className="meal-card" key={slot}><div className="meal-top"><span className="meal-index">0{index + 1}</span><span className="meal-mark" aria-hidden="true">{["◔", "◉", "✦", "☾"][index]}</span></div><h3>{slotLabels[slot]}</h3><p>{slotEntries.length ? slotEntries.map((entry) => entry.name).join(" · ") : "Nessuna voce"}</p><div className="meal-bottom"><strong>{number(summary.bySlot[slot])} <small>kcal note</small></strong><span>{slotEntries.length} {slotEntries.length === 1 ? "voce" : "voci"}</span></div></article>;
    })}</div></section>
    <p className="data-note">I totali sono solo un riepilogo dei dati registrati, non una raccomandazione nutrizionale.</p>
  </div>;
}

export function DiaryView({ entries, date, onEdit, onAdd }: { entries: DiaryEntry[]; date: string; onEdit?: (entry: DiaryEntry, trigger: HTMLButtonElement) => void; onAdd?: (slot: Slot, trigger: HTMLButtonElement) => void }) {
  const today = entries.filter((entry) => entry.date === date);
  return <div className="view-stack"><div className="eyebrow"><span className="signal-dot" /> REGISTRO / {date}</div><div className="view-title"><div><h1>Diario<span className="title-punctuation">.</span></h1><p>Ogni pasto, al suo posto.</p></div><span className="view-index">02 / 03</span></div>
    <div className="diary-banner"><span className="section-kicker">DATA SELEZIONATA</span><strong>{formatDate(date)}</strong><span>{today.length} {today.length === 1 ? "voce" : "voci"}</span></div>
    {today.length === 0 && <p className="empty-note">Nessuna voce per questa data.</p>}
    <div className="diary-groups">{slots.map((slot, index) => {
      const group = today.filter((entry) => entry.slot === slot);
      return <section className="diary-group" key={slot} aria-label={slotLabels[slot]}><div className="diary-group-head"><div><span className="meal-index">0{index + 1} / PASTO</span><h2>{slotLabels[slot]}</h2></div>{onAdd && <button type="button" className="meal-add" data-add-slot={slot} aria-label={`Aggiungi alimento a ${slotLabels[slot]}`} onClick={event => onAdd(slot, event.currentTarget)}><UiIcon name="plus" /></button>}</div>
        {group.length ? group.map((entry) => <article key={entry.id} className="entry-row"><div className="entry-icon" aria-hidden="true">{entry.entryType === "recipe" ? "✳" : "◈"}</div><div className="entry-main"><strong>{entry.name}</strong><span>{entry.entryType === "recipe" ? `${entry.servings ?? 1} ${(entry.servings ?? 1) === 1 ? "porzione" : "porzioni"}` : `${entry.quantityGrams ?? 0} g`} <span aria-hidden="true">·</span> <span className={entry.source === "norish_sync" ? "origin imported" : "origin"}>{sourceLabel(entry)}</span>{entry.norishDeleted && " · Rimossa su norish"}</span></div><div className="entry-energy">{entry.kcal === null ? <span>kcal non definite</span> : <><strong>{number(entry.kcal)}</strong><span>kcal</span></>}</div>{entry.source === "manual" && onEdit && <button type="button" className="edit-action" data-edit-id={entry.id} onClick={event => onEdit(entry, event.currentTarget)}>Modifica</button>}</article>) : <p className="empty-slot">Nessuna voce in questo pasto.</p>}
      </section>;
    })}</div>
  </div>;
}

export function CalendarView({ entries, date, onSelect }: { entries: DiaryEntry[]; date: string; onSelect: (date: string) => void }) {
  const days = monthDays(date), month = date.slice(0, 7);
  return <div className="view-stack"><div className="eyebrow"><span className="signal-dot" /> ARCHIVIO / CALENDARIO</div><div className="view-title"><div><h1>Calendario<span className="title-punctuation">.</span></h1><p>Una vista ampia sui tuoi pasti.</p></div><span className="view-index">03 / 03</span></div>
    <section className="calendar-panel" aria-label="Calendario pasti"><div className="calendar-heading"><div><span className="section-kicker">MESE SELEZIONATO</span><h2>{formatDate(date, { month: "long", year: "numeric" })}</h2></div><span className="calendar-key"><i /> Pasti importati</span></div>
      <div className="calendar-grid">{["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => <span key={day} className="weekday">{day}</span>)}{days.map((day) => {
        const imports = entries.filter((entry) => entry.date === day && entry.source === "norish_sync");
        return <button key={day} type="button" onClick={() => onSelect(day)} className={`calendar-day ${day.slice(0, 7) !== month ? "outside" : ""} ${date === day ? "selected" : ""}`} aria-label={`${formatDate(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${imports.length} pasti importati${date === day ? ", selezionato" : ""}`} aria-pressed={date === day}><span>{Number(day.slice(-2))}</span>{imports.length > 0 && <small><i aria-hidden="true" /> {imports.length} norish</small>}</button>;
      })}</div>
    </section><section className="calendar-list" aria-label="Pasti importati nella data selezionata"><div className="section-heading"><div><span className="section-kicker">DETTAGLIO DEL GIORNO</span><h2>{formatDate(date)}</h2></div></div>{entries.filter((entry) => entry.date === date && entry.source === "norish_sync").map((entry) => <article className="calendar-import" key={entry.id}><span>{slotLabels[entry.slot]}</span><strong>{entry.name}</strong><span>{entry.kcal === null ? "kcal non definite" : `${number(entry.kcal)} kcal`}</span><span className="origin imported">Da norish</span></article>)}{!entries.some((entry) => entry.date === date && entry.source === "norish_sync") && <p className="empty-note">Nessun pasto importato per questa data.</p>}</section>
  </div>;
}
