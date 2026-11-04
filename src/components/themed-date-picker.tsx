"use client";

import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { CalendarDate, parseDate } from "@internationalized/date";
import { Button, Calendar, CalendarCell, CalendarGrid, CalendarGridBody, CalendarGridHeader, CalendarHeaderCell, Dialog, DialogTrigger, Heading, I18nProvider, Popover } from "react-aria-components";
import { UiIcon } from "@/components/ui-icon";
import { useI18n } from "@/components/ui-preferences-provider";
import { intlLocale } from "@/lib/ui-preferences";
import { localDateKey } from "@/lib/diary";

const minimum = new CalendarDate(1, 1, 1);
const maximum = new CalendarDate(9999, 12, 31);

/** Keep direct date entry, with an app-owned, keyboard-accessible calendar instead of the OS popup. */
export function ThemedDatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const { tr, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  let selected: CalendarDate | null = null;
  try { if (value) selected = parseDate(value); } catch { /* An invalid URL date must not crash the calendar. */ }
  function showCalendar(event: MouseEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    trigger.current?.focus({ preventScroll: true });
    setOpen(true);
  }
  function select(date: string) { onChange(date); setOpen(false); }
  return <I18nProvider locale={intlLocale(locale)}><DialogTrigger isOpen={open} onOpenChange={setOpen}>
    <div className="app-date-picker">
      <Button className="app-date-trigger" ref={trigger} aria-label={tr("Apri calendario")} isDisabled={!value}><UiIcon name="calendar" /></Button>
      <input type="date" aria-label={tr("Seleziona data")} aria-haspopup="dialog" aria-controls={open ? dialogId : undefined} disabled={!value} value={value}
        onChange={event => { if (event.target.value) onChange(event.target.value); }}
        onPointerDown={event => event.preventDefault()}
        onClick={showCalendar}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " " || event.key === "F4" || (event.altKey && event.key === "ArrowDown")) showCalendar(event); }} />
    </div>
    <Popover className="app-date-popover" placement="bottom start" offset={10} containerPadding={12}>
      <Dialog className="app-date-dialog" id={dialogId} aria-label={tr("Seleziona data")}>
        <Calendar className="app-date-calendar" value={selected} onChange={date => select(date.toString())} minValue={minimum} maxValue={maximum} firstDayOfWeek="mon" autoFocus>
          <header className="app-date-calendar-header">
            <Button slot="previous" className="app-date-month-button" aria-label={tr("Mese precedente")}><UiIcon name="left" /></Button>
            <Heading />
            <Button slot="next" className="app-date-month-button" aria-label={tr("Mese successivo")}><UiIcon name="right" /></Button>
          </header>
          <CalendarGrid weekdayStyle="short" className="app-date-grid">
            <CalendarGridHeader>{day => <CalendarHeaderCell>{day}</CalendarHeaderCell>}</CalendarGridHeader>
            <CalendarGridBody>{date => <CalendarCell className="app-date-cell" date={date} />}</CalendarGridBody>
          </CalendarGrid>
        </Calendar>
        <footer className="app-date-calendar-footer"><span><i aria-hidden="true" />{tr("Oggi")}</span><button type="button" className="app-date-today" onClick={() => select(localDateKey())}>{tr("Vai a oggi")}</button><button type="button" className="app-date-close" onClick={() => setOpen(false)}>{tr("Chiudi")}</button></footer>
      </Dialog>
    </Popover>
  </DialogTrigger></I18nProvider>;
}
