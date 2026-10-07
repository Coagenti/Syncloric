"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DiaryEditor } from "@/components/diary-editor";
import { DeleteEntryDialog } from "@/components/delete-entry-dialog";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { CalendarView, DashboardView, DiaryView } from "@/components/calorie-views";
import { SyncNotice, type SyncState } from "@/components/sync-notice";
import { BarcodeEntry } from "@/components/barcode-entry";
import { formatDate, localDateKey, shiftDate, type DiaryEntry, type Slot } from "@/lib/diary";

type View = "dashboard" | "diary" | "calendar";
type Feed = { entries: DiaryEntry[]; sync: SyncState; target: number | null };

/** Fetch a per-user month, never cache private diary data in the browser. */
export function CalorieApp({ view }: { view: View }) {
  const [date, setDate] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DiaryEntry | null | false>(false);
  const [deleting, setDeleting] = useState<DiaryEntry | null>(null);
  const [initialSlot, setInitialSlot] = useState<Slot>("Lunch");
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
    setSyncing(true); setSyncMessage("Sincronizzazione in corso…"); setSyncLogin(false); setSyncFailed(false);
    try {
      const response = await fetch("/api/v1/sync", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.status === 401) { setSyncFailed(true); setSyncLogin(true); setSyncMessage("Accedi per sincronizzare il tuo diario."); return; }
      if (!response.ok) {
        setSyncFailed(true);
        const body = await response.json().catch(() => null);
        if (body?.code === "NORISH_KEY_REQUIRED") { setSyncMessage("Configura la tua chiave Norish in Impostazioni."); return; }
        setSyncMessage(response.status === 503 && body?.error === "Sincronizzazione già in corso." ? "Sincronizzazione già in corso. Attendi e riprova." : "Sincronizzazione non disponibile. Controlla le impostazioni o riprova più tardi.");
        return;
      }
      const result = await response.json() as SyncState;
      if (!result || !["ok", "partial", "error"].includes(result.status)) throw new Error();
      setSyncResult(result); setSyncMessage(null); setRevision(value => value + 1);
    } catch { setSyncFailed(true); setSyncMessage("Connessione non disponibile. Riprova la sincronizzazione."); }
    finally { setSyncing(false); }
  }
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing === false && !deleting && !loading && restoreFocus.current) {
      const deletingId = trigger.current?.dataset.deleteId;
      const id = deletingId ?? trigger.current?.dataset.editId;
      const slot = trigger.current?.dataset.addSlot;
      const target = id ? document.querySelector<HTMLButtonElement>(`[data-${deletingId ? "delete" : "edit"}-id="${CSS.escape(id)}"]`) : slot ? document.querySelector<HTMLButtonElement>(`[data-add-slot="${slot}"]`) : trigger.current;
      const returnSlot = trigger.current?.dataset.returnSlot;
      (target ?? (returnSlot ? document.querySelector<HTMLButtonElement>(`[data-add-slot="${returnSlot}"]`) : null) ?? document.querySelector<HTMLButtonElement>("[data-add-slot]") ?? syncTrigger.current)?.focus();
      restoreFocus.current = false;
    }
  }, [editing, deleting, loading, feed]);
  const closeEditor = () => { restoreFocus.current = true; setEditing(false); };
  const addEntry = (slot: Slot, button: HTMLButtonElement) => {
    trigger.current = button; setInitialSlot(slot); setFeedback(null); setEditing(null);
  };
  useEffect(() => { queueMicrotask(() => setDate(localDateKey())); }, []);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    queueMicrotask(() => { setLoading(true); setFeed(null); setError(null); });
    fetch(`/api/v1/diary?month=${date.slice(0, 7)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) throw new Error("Accedi per visualizzare il tuo diario.");
        if (!response.ok) throw new Error("Impossibile caricare i pasti. Riprova.");
        return response.json().catch(() => { throw new Error("Impossibile caricare i pasti. Riprova."); }) as Promise<Feed>;
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setFeed(data);
        if (data.sync) setSyncResult(current => {
          // Keep a newer on-demand result until the feed has caught up.
          if (current?.finishedAt && data.sync?.finishedAt && Date.parse(data.sync.finishedAt) < Date.parse(current.finishedAt)) return current;
          return null;
        });
      })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error && cause.message === "Accedi per visualizzare il tuo diario." ? cause.message : "Impossibile caricare i pasti. Riprova."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date, revision]);
  const entries = feed?.entries ?? [];
  const effectiveSync = syncResult ?? feed?.sync ?? null;
  const selectedCount = entries.filter(entry => entry.date === date).length;
  const syncStatus = syncing ? "pending" : syncFailed || effectiveSync?.status === "error" ? "error" : effectiveSync?.status === "ok" ? "ok" : effectiveSync?.status === "partial" ? "partial" : "idle";
  const syncStatusLabel = { pending: "Sincronizzazione in corso", error: "Ultima sincronizzazione fallita", ok: "Sincronizzazione Norish: completata.", partial: "Ultima sincronizzazione parziale", idle: "Non ancora sincronizzato" }[syncStatus];
  return <AppShell view={view}>
      <div className="date-toolbar compact-date-toolbar"><div className="selected-date"><span className="section-kicker">GIORNO SELEZIONATO</span><strong>{date ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Oggi"}</strong></div><div className="date-actions"><div className="day-stepper"><button type="button" aria-label="Giorno precedente" disabled={!date} onClick={() => setDate(shiftDate(date, -1))}><UiIcon name="left" /></button><button type="button" onClick={() => setDate(localDateKey())}>Oggi</button><button type="button" aria-label="Giorno successivo" disabled={!date} onClick={() => setDate(shiftDate(date, 1))}><UiIcon name="right" /></button></div><label className="app-date-picker"><UiIcon name="calendar" /><span className="sr-only">Data</span><input type="date" aria-label="Seleziona data" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label><button type="button" className="toolbar-action sync-action" ref={syncTrigger} disabled={syncing} aria-describedby="sync-status" onClick={synchronize} title={syncStatusLabel}><UiIcon name="sync" className={syncing ? "is-syncing" : undefined} /><span className="sync-action-label">{syncing ? "Sincronizzazione…" : "Sincronizza ora"}</span><i className={`sync-dot ${syncStatus}`} aria-hidden="true" /></button><span id="sync-status" role="status" className="sr-only">{syncStatusLabel}</span></div></div>
      <div className="view-title page-heading"><h1>{{ dashboard: "Riepilogo del giorno", diary: "Diario", calendar: "Calendario" }[view]}<span className="title-punctuation">.</span></h1>{view === "diary" && <div className="diary-title-actions"><span className="muted-caption">{selectedCount} {selectedCount === 1 ? "voce" : "voci"}</span><BarcodeEntry compact date={date} onSaved={() => setRevision(value => value + 1)} /></div>}</div>
      {(syncMessage || effectiveSync?.status === "error" || effectiveSync?.status === "partial") && <SyncNotice sync={effectiveSync} message={syncMessage} />}
      {syncLogin && <Link href="/login">Vai al login</Link>}
      {feedback && <p role="status">{feedback}</p>}
      {editing !== false && <DiaryEditor entry={editing} initialSlot={initialSlot} date={date} onClose={closeEditor} onSaved={savedDate => { setLoading(true); setDate(savedDate); setRevision(value => value + 1); setFeedback("Voce salvata."); closeEditor(); }} />}
      {deleting && <DeleteEntryDialog entry={deleting} onClose={() => { restoreFocus.current = true; setDeleting(null); }} onDeleted={() => { setLoading(true); setRevision(value => value + 1); setFeedback("Voce eliminata."); restoreFocus.current = true; setDeleting(null); }} />}
      {loading && <p role="status">Caricamento pasti…</p>}
      {error && <p role="alert">{error} {error.startsWith("Accedi") && <Link href="/login">Vai al login</Link>}</p>}
      {feed && <>
        {view === "dashboard" && <DashboardView showTitle={false} entries={entries} date={date} target={feed.target} />}
        {view === "diary" && <DiaryView showTitle={false} entries={entries} date={date} target={feed.target} onAdd={addEntry} onEdit={(entry, button) => { trigger.current = button; setFeedback(null); setEditing(entry); }} onDelete={(entry, button) => { trigger.current = button; setFeedback(null); setDeleting(entry); }} />}
        {view === "calendar" && <CalendarView showTitle={false} entries={entries} date={date} onSelect={setDate} />}
      </>}
  </AppShell>;
}
