"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DiaryEditor } from "@/components/diary-editor";
import { LogoutButton } from "@/components/auth/logout-button";
import { CalendarView, DashboardView, DiaryView } from "@/components/calorie-views";
import { SyncNotice, type SyncState } from "@/components/sync-notice";
import { BarcodeEntry } from "@/components/barcode-entry";
import { formatDate, localDateKey, shiftDate, type DiaryEntry } from "@/lib/diary";

type View = "dashboard" | "diary" | "calendar";
type Feed = { entries: DiaryEntry[]; sync: SyncState; target: number | null };
const navigation: { id: View; label: string; href: string; symbol: string }[] = [
  { id: "dashboard", label: "Oggi", href: "/dashboard", symbol: "◫" },
  { id: "diary", label: "Diario", href: "/diary", symbol: "≡" },
  { id: "calendar", label: "Calendario", href: "/calendar", symbol: "▦" },
];

/** Fetch a per-user month, never cache private diary data in the browser. */
export function CalorieApp({ view }: { view: View }) {
  const [date, setDate] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<DiaryEntry | null | false>(false);
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncState>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncLogin, setSyncLogin] = useState(false);
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
    setSyncing(true); setSyncMessage("Sincronizzazione in corso…"); setSyncLogin(false);
    try {
      const response = await fetch("/api/v1/sync", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (response.status === 401) { setSyncLogin(true); setSyncMessage("Accedi per sincronizzare il tuo diario."); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setSyncMessage(response.status === 503 && body?.error === "Sincronizzazione già in corso." ? "Sincronizzazione già in corso. Attendi e riprova." : "Sincronizzazione non disponibile. Controlla le impostazioni o riprova più tardi.");
        return;
      }
      const result = await response.json() as SyncState;
      if (!result || !["ok", "partial", "error"].includes(result.status)) throw new Error();
      setSyncResult(result); setSyncMessage(null); setRevision(value => value + 1);
    } catch { setSyncMessage("Connessione non disponibile. Riprova la sincronizzazione."); }
    finally { setSyncing(false); }
  }
  const trigger = useRef<HTMLButtonElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (editing === false && !loading && restoreFocus.current) {
      const id = trigger.current?.dataset.editId;
      const target = id ? document.querySelector<HTMLButtonElement>(`[data-edit-id="${CSS.escape(id)}"]`) : trigger.current;
      (target ?? document.querySelector<HTMLButtonElement>("[data-add-entry]"))?.focus();
      restoreFocus.current = false;
    }
  }, [editing, loading, feed]);
  const closeEditor = () => { restoreFocus.current = true; setEditing(false); };
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
  return <div className="app-shell">
    <aside className="sidebar"><Link href="/dashboard" className="brand" aria-label="Syncloric, vai alla dashboard"><span className="brand-icon">S<span>↗</span></span><span>SYN<span className="brand-accent">CLORIC</span><small>CALORIE / IN FOCUS</small></span></Link><div className="side-divider" /><span className="side-label">ESPLORA</span><nav className="side-nav" aria-label="Navigazione principale">{navigation.map((item) => <Link key={item.id} href={item.href} aria-current={view === item.id ? "page" : undefined} className={`nav-link ${view === item.id ? "active" : ""}`}><span aria-hidden="true">{item.symbol}</span>{item.label}{view === item.id && <i aria-hidden="true" />}</Link>)}</nav><div className="side-bottom"><span className="side-label">IL TUO SPAZIO</span><p>Una panoramica semplice di quello che registri. Nessun giudizio, solo dati.</p><div className="side-build">SYNC / LIVE <span>●</span> V.01</div></div></aside>
    <div className="app-main"><header className="topbar"><div className="topbar-path"><span>SYNCLORIC</span><span aria-hidden="true">/</span><strong>{navigation.find((item) => item.id === view)?.label.toUpperCase()}</strong></div><div className="topbar-right"><Link className="auth-switch" href="/settings">Impostazioni</Link><LogoutButton /></div></header>
      <main className="content"><div className="date-toolbar"><div><span className="section-kicker">GIORNO SELEZIONATO</span><strong>{date ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Oggi"}</strong></div><div className="date-actions"><button type="button" aria-label="Giorno precedente" disabled={!date} onClick={() => setDate(shiftDate(date, -1))}>←</button><button type="button" onClick={() => setDate(localDateKey())}>Oggi</button><button type="button" aria-label="Giorno successivo" disabled={!date} onClick={() => setDate(shiftDate(date, 1))}>→</button><label className="date-picker">Data <input type="date" aria-label="Seleziona data" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label></div></div>
      <button type="button" className="primary-btn" data-add-entry disabled={!date} onClick={event => { trigger.current = event.currentTarget; setFeedback(null); setEditing(null); }}>Aggiungi voce</button>
      <button type="button" className="secondary-btn" ref={syncTrigger} disabled={syncing} onClick={synchronize}>{syncing ? "Sincronizzazione…" : "Sincronizza ora"}</button>
      <SyncNotice sync={syncResult ?? feed?.sync ?? null} message={syncMessage} />
      {syncLogin && <Link href="/login">Vai al login</Link>}
      {feedback && <p role="status">{feedback}</p>}
      {editing !== false && <DiaryEditor entry={editing} date={date} onClose={closeEditor} onSaved={savedDate => { setLoading(true); setDate(savedDate); setRevision(value => value + 1); setFeedback("Voce salvata."); closeEditor(); }} />}
      {view === "diary" && <BarcodeEntry date={date} onSaved={() => setRevision(value => value + 1)} />}
      {loading && <p role="status">Caricamento pasti…</p>}
      {error && <p role="alert">{error} {error.startsWith("Accedi") && <Link href="/login">Vai al login</Link>}</p>}
      {feed && <>
        {view === "dashboard" && <DashboardView entries={entries} date={date} target={feed.target} />}
        {view === "diary" && <DiaryView entries={entries} date={date} onEdit={(entry, button) => { trigger.current = button; setFeedback(null); setEditing(entry); }} />}
        {view === "calendar" && <CalendarView entries={entries} date={date} onSelect={setDate} />}
      </>}
      </main><footer className="app-footer">SYNCLORIC <span>DIARIO CALORIE · DATI PERSONALI</span></footer></div>
      <nav className="mobile-nav" aria-label="Navigazione mobile">{navigation.map((item) => <Link key={item.id} href={item.href} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><span aria-hidden="true">{item.symbol}</span>{item.label}</Link>)}</nav>
  </div>;
}
