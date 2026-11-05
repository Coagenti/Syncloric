"use client";

import { useI18n } from "@/components/ui-preferences-provider";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DiaryEditor } from "@/components/diary-editor";
import { DeleteEntryDialog } from "@/components/delete-entry-dialog";
import { DuplicateEntryDialog } from "@/components/duplicate-entry-dialog";
import { MealDetailView } from "@/components/meal-detail";
import { DiaryLoading } from "@/components/diary-loading";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { ThemedDatePicker } from "@/components/themed-date-picker";
import { CalendarView, DashboardView, DiaryView } from "@/components/calorie-views";
import { SyncNotice, type SyncState } from "@/components/sync-notice";
import { foodEntryUrl } from "@/lib/food-entry";
import { HouseholdMealsDialog } from "@/components/meal-sharing/household-meals-dialog";
import { ShareMealDialog } from "@/components/meal-sharing/share-meal-dialog";
import { localDateKey, shiftDate, mealDetailUrl, slotLabels, type DiaryEntry, type Slot } from "@/lib/diary";

type View = "dashboard" | "diary" | "calendar" | "meal";
type Feed = { entries: DiaryEntry[]; sync: SyncState; target: number | null; macroGoals?: import("@/lib/goal-targets").MacroGoals | null };

/** Fetch a per-user month, never cache private diary data in the browser. */
export function CalorieApp({ view, initialSlot = "Lunch" }: { view: View; initialSlot?: Slot }) {
  const { tr, formatDay } = useI18n();
  const [date, setDate] = useState("");
  const month = date.slice(0, 7);
  const [loadedFeed, setLoadedFeed] = useState<{ month: string; data: Feed } | null>(null);
  // Gate immediately on the requested month: a previous response never labels a new month.
  const feed = loadedFeed?.month === month ? loadedFeed.data : null;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DiaryEntry | null | false>(false);
  const [deleting, setDeleting] = useState<DiaryEntry | null>(null);
  const [duplicating, setDuplicating] = useState<DiaryEntry | null>(null);
  const [duplicateDestination, setDuplicateDestination] = useState<string | null>(null);
  const [sharingSlot, setSharingSlot] = useState<Slot | null>(null);
  const [householdMeals, setHouseholdMeals] = useState(false);
  const sharingTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreSharingFocus = useRef(false);
  useEffect(() => {
    if (!sharingSlot && !householdMeals && restoreSharingFocus.current) {
      sharingTrigger.current?.focus(); restoreSharingFocus.current = false;
    }
  }, [sharingSlot, householdMeals]);
  const closeSharing = () => { restoreSharingFocus.current = true; setSharingSlot(null); setHouseholdMeals(false); };
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncState>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncLogin, setSyncLogin] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const syncTrigger = useRef<HTMLButtonElement | null>(null);
  const restoreSyncFocus = useRef(false);
  useEffect(() => {
    if (syncing) {
      const trackFocus = (event: FocusEvent) => {
        if (event.target !== document.body && event.target !== syncTrigger.current) restoreSyncFocus.current = false;
      };
      document.addEventListener("focusin", trackFocus);
      return () => document.removeEventListener("focusin", trackFocus);
    }
    // Restore only after React re-enables the trigger, never after a deliberate focus move.
    if (restoreSyncFocus.current && document.activeElement === document.body) syncTrigger.current?.focus();
    restoreSyncFocus.current = false;
  }, [syncing]);
  async function synchronize() {
    if (syncing) return;
    restoreSyncFocus.current = document.activeElement === syncTrigger.current;
    setSyncing(true); setSyncMessage(tr("Sincronizzazione in corso…")); setSyncLogin(false); setSyncFailed(false);
    try {
      const response = await fetch("/api/v1/sync", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.status === 401) { setSyncFailed(true); setSyncLogin(true); setSyncMessage(tr("Accedi per sincronizzare il tuo diario.")); return; }
      if (!response.ok) {
        setSyncFailed(true);
        const body = await response.json().catch(() => null);
        if (body?.code === "NORISH_KEY_REQUIRED") { setSyncMessage(tr("Configura la tua chiave Norish in Impostazioni.")); return; }
        setSyncMessage(tr(response.status === 503 && body?.error === "Sincronizzazione già in corso." ? tr("Sincronizzazione già in corso. Attendi e riprova.") : tr("Sincronizzazione non disponibile. Controlla le impostazioni o riprova più tardi.")));
        return;
      }
      const result = await response.json() as SyncState;
      if (!result || !["ok", "partial", "error"].includes(result.status)) throw new Error();
      setSyncResult(result); setSyncMessage(null); setRevision(value => value + 1);
    } catch { setSyncFailed(true); setSyncMessage(tr("Connessione non disponibile. Riprova la sincronizzazione.")); }
    finally { setSyncing(false); }
  }
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing === false && !deleting && !duplicating && !loading && restoreFocus.current) {
      const deletingId = trigger.current?.dataset.deleteId;
      const duplicateId = trigger.current?.dataset.duplicateId;
      const id = deletingId ?? duplicateId ?? trigger.current?.dataset.editId;
      const slot = trigger.current?.dataset.addSlot;
      const target = id ? document.querySelector<HTMLButtonElement>(`[data-${deletingId ? "delete" : duplicateId ? "duplicate" : "edit"}-id="${CSS.escape(id)}"]`) : slot ? document.querySelector<HTMLButtonElement>(`[data-add-slot="${slot}"]`) : trigger.current;
      const returnSlot = trigger.current?.dataset.returnSlot;
      (target ?? (returnSlot ? document.querySelector<HTMLButtonElement>(`[data-add-slot="${returnSlot}"]`) : null) ?? document.querySelector<HTMLButtonElement>("[data-add-slot]") ?? syncTrigger.current)?.focus();
      restoreFocus.current = false;
    }
  }, [editing, deleting, duplicating, loading, feed]);
  const closeEditor = () => { restoreFocus.current = true; setEditing(false); };
  const addEntry = (slot: Slot, button: HTMLButtonElement) => {
    trigger.current = button; window.location.assign(foodEntryUrl(date, slot));
  };
  useEffect(() => { const requested = new URLSearchParams(window.location.search).get("date"); queueMicrotask(() => setDate(requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(requested)) && new Date(requested).toISOString().slice(0, 10) === requested ? requested : localDateKey())); }, []);
  useEffect(() => {
    if (!month) return;
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setError(null); } });
    fetch(`/api/v1/diary?month=${month}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) { if (!controller.signal.aborted) setLoadedFeed(null); throw new Error(tr("Accedi per visualizzare il tuo diario.")); }
        if (!response.ok) throw new Error(tr("Impossibile caricare i pasti. Riprova."));
        return response.json().catch(() => { throw new Error(tr("Impossibile caricare i pasti. Riprova.")); }) as Promise<Feed>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setLoadedFeed({ month, data });
        if (data.sync) setSyncResult(current => {
          // Keep a newer on-demand result until the feed has caught up.
          if (current?.finishedAt && data.sync?.finishedAt && Date.parse(data.sync.finishedAt) < Date.parse(current.finishedAt)) return current;
          return null;
        });
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error && cause.message === tr("Accedi per visualizzare il tuo diario.") ? cause.message : tr("Impossibile caricare i pasti. Riprova.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [month, revision, tr]);
  const entries = feed?.entries ?? [];
  const effectiveSync = syncResult ?? feed?.sync ?? null;
  const selectedCount = entries.filter(entry => entry.date === date).length;
  const syncStatus = syncing ? "pending" : syncFailed || effectiveSync?.status === "error" ? "error" : effectiveSync?.status === "ok" ? "ok" : effectiveSync?.status === "partial" ? "partial" : "idle";
  const syncStatusLabel = { pending: tr("Sincronizzazione in corso"), error: tr("Ultima sincronizzazione fallita"), ok: tr("Sincronizzazione Norish: completata."), partial: tr("Ultima sincronizzazione parziale"), idle: tr("Non ancora sincronizzato") }[syncStatus];
  return <AppShell view={view === "meal" ? "diary" : view}>
      <div className="date-toolbar compact-date-toolbar"><div className="selected-date"><span className="section-kicker">{tr("GIORNO SELEZIONATO")}</span><strong>{date ? formatDay(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : tr("Oggi")}</strong></div><div className="date-actions"><div className="day-stepper"><button type="button" aria-label={tr("Giorno precedente")} disabled={!date} onClick={() => setDate(shiftDate(date, -1))}><UiIcon name="left" /></button><button type="button" onClick={() => setDate(localDateKey())}>{tr("Oggi")}</button><button type="button" aria-label={tr("Giorno successivo")} disabled={!date} onClick={() => setDate(shiftDate(date, 1))}><UiIcon name="right" /></button></div><ThemedDatePicker value={date} onChange={setDate} /><button type="button" className="toolbar-action sync-action" ref={syncTrigger} disabled={syncing} aria-describedby="sync-status" onClick={synchronize} title={syncStatusLabel}><UiIcon name="sync" className={syncing ? "is-syncing" : undefined} /><span className="sync-action-label">{syncing ? tr("Sincronizzazione…") : tr("Sincronizza ora")}</span><i className={`sync-dot ${syncStatus}`} aria-hidden="true" /></button><span id="sync-status" role="status" className="sr-only">{syncStatusLabel}</span></div></div>
      {view === "meal" && <a className="meal-back" href={`/diary?date=${encodeURIComponent(date)}`}><UiIcon name="left" />{tr("Torna al diario")}</a>}
      <div className="view-title page-heading"><h1>{{ dashboard: tr("Riepilogo del giorno"), diary: tr("Diario"), calendar: tr("Calendario"), meal: tr(slotLabels[initialSlot]) }[view]}<span className="title-punctuation">.</span></h1>{view === "diary" && <div className="diary-title-actions"><span className="muted-caption">{selectedCount} {selectedCount === 1 ? tr("voce") : tr("voci")}</span><button type="button" className="toolbar-action" aria-label={tr("Pasti del nucleo")} title={tr("Pasti del nucleo")} disabled={!date} onClick={event => { sharingTrigger.current = event.currentTarget; setSharingSlot(null); setHouseholdMeals(true); }}><UiIcon name="family" /><span className="family-action-label">{tr("Nucleo")}</span></button><a className="toolbar-action scan-action" href={foodEntryUrl(date, "Snack", "scansione")}><UiIcon name="scan" />{tr("Scansiona")}</a></div>}</div>
      {(syncMessage || effectiveSync?.status === "error" || effectiveSync?.status === "partial") && <SyncNotice sync={effectiveSync} message={syncMessage} />}
      {syncLogin && <Link href="/login">{tr("Vai al login")}</Link>}
      {feedback && <p role="status">{tr(feedback)} {duplicateDestination && <a href={duplicateDestination}>{tr("Apri il pasto di destinazione")}</a>}</p>}
      {sharingSlot && <ShareMealDialog date={date} slot={sharingSlot} onClose={closeSharing} />}
      {householdMeals && <HouseholdMealsDialog date={date} onClose={closeSharing} onCopied={(copiedDate, count) => { setDate(copiedDate); setRevision(v => v + 1); setFeedback(tr("{0} {1} nel tuo diario.", { "0": count, "1": tr(count === 1 ? "voce copiata" : "voci copiate") })); closeSharing(); }} />}
      {editing !== false && <DiaryEditor entry={editing} date={date} onClose={closeEditor} onSaved={savedDate => { setLoading(true); setDate(savedDate); setRevision(value => value + 1); setFeedback(tr("Voce salvata.")); closeEditor(); }} />}
      {deleting && <DeleteEntryDialog entry={deleting} onClose={() => { restoreFocus.current = true; setDeleting(null); }} onDeleted={() => { setLoading(true); setRevision(value => value + 1); setFeedback(tr("Voce eliminata.")); restoreFocus.current = true; setDeleting(null); }} />}
      {duplicating && <DuplicateEntryDialog entry={duplicating} onClose={() => { restoreFocus.current = true; setDuplicating(null); }} onDuplicated={(destinationDate, destinationSlot) => { setRevision(value => value + 1); setFeedback(tr("Voce duplicata.")); setDuplicateDestination(destinationDate !== date || destinationSlot !== initialSlot ? mealDetailUrl(destinationDate, destinationSlot) : null); restoreFocus.current = true; setDuplicating(null); }} />}
      {!feed && !error && <DiaryLoading view={view === "meal" ? "diary" : view} />}
      {loading && feed && <span className="feed-refresh" role="status">{tr("Aggiornamento pasti…")}</span>}
      {error && <p role="alert">{tr(error)} {error.startsWith(tr("Accedi")) && <Link href="/login">{tr("Vai al login")}</Link>}</p>}
      {feed && <div className="feed-content" aria-busy={loading}>
        {view === "dashboard" && <DashboardView showTitle={false} entries={entries} date={date} target={feed.target} macroGoals={feed.macroGoals} />}
        {view === "diary" && <DiaryView showTitle={false} entries={entries} date={date} target={feed.target} onAdd={addEntry} />}
        {view === "meal" && <MealDetailView entries={entries} date={date} slot={initialSlot} onAdd={addEntry} onShare={(slot, button) => { sharingTrigger.current = button; setSharingSlot(slot); }} onEdit={(entry, button) => { trigger.current = button; setFeedback(null); setDuplicateDestination(null); setEditing(entry); }} onDelete={(entry, button) => { trigger.current = button; setFeedback(null); setDuplicateDestination(null); setDeleting(entry); }} onDuplicate={(entry, button) => { trigger.current = button; setFeedback(null); setDuplicateDestination(null); setDuplicating(entry); }} />}
        {view === "calendar" && <CalendarView showTitle={false} entries={entries} date={date} onSelect={setDate} />}
      </div>}
  </AppShell>;
}
