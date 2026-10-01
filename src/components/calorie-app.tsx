"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { CalendarView, DashboardView, DiaryView } from "@/components/calorie-views";
import { SyncNotice, type SyncState } from "@/components/sync-notice";
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
  useEffect(() => { queueMicrotask(() => setDate(localDateKey())); }, []);
  useEffect(() => {
    if (!date) return;
    const controller = new AbortController();
    queueMicrotask(() => { setLoading(true); setFeed(null); setError(null); });
    fetch(`/api/v1/diary?month=${date.slice(0, 7)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) throw new Error("Accedi per visualizzare il tuo diario.");
        if (!response.ok) throw new Error("Impossibile caricare i pasti. Riprova.");
        return response.json() as Promise<Feed>;
      })
      .then((data) => { if (!controller.signal.aborted) setFeed(data); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Impossibile caricare i pasti."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [date]);
  const entries = feed?.entries ?? [];
  return <div className="app-shell">
    <aside className="sidebar"><Link href="/dashboard" className="brand" aria-label="Syncloric, vai alla dashboard"><span className="brand-icon">S<span>↗</span></span><span>SYN<span className="brand-accent">CLORIC</span><small>CALORIE / IN FOCUS</small></span></Link><div className="side-divider" /><span className="side-label">ESPLORA</span><nav className="side-nav" aria-label="Navigazione principale">{navigation.map((item) => <Link key={item.id} href={item.href} aria-current={view === item.id ? "page" : undefined} className={`nav-link ${view === item.id ? "active" : ""}`}><span aria-hidden="true">{item.symbol}</span>{item.label}{view === item.id && <i aria-hidden="true" />}</Link>)}</nav><div className="side-bottom"><span className="side-label">IL TUO SPAZIO</span><p>Una panoramica semplice di quello che registri. Nessun giudizio, solo dati.</p><div className="side-build">SYNC / LIVE <span>●</span> V.01</div></div></aside>
    <div className="app-main"><header className="topbar"><div className="topbar-path"><span>SYNCLORIC</span><span aria-hidden="true">/</span><strong>{navigation.find((item) => item.id === view)?.label.toUpperCase()}</strong></div><div className="topbar-right"><Link className="auth-switch" href="/settings">Impostazioni</Link><LogoutButton /></div></header>
      <main className="content"><div className="date-toolbar"><div><span className="section-kicker">GIORNO SELEZIONATO</span><strong>{date ? formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "Oggi"}</strong></div><div className="date-actions"><button type="button" aria-label="Giorno precedente" disabled={!date} onClick={() => setDate(shiftDate(date, -1))}>←</button><button type="button" onClick={() => setDate(localDateKey())}>Oggi</button><button type="button" aria-label="Giorno successivo" disabled={!date} onClick={() => setDate(shiftDate(date, 1))}>→</button><label className="date-picker">Data <input type="date" aria-label="Seleziona data" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label></div></div>
      {loading && <p role="status">Caricamento pasti…</p>}
      {error && <p role="alert">{error} {error.startsWith("Accedi") && <Link href="/login">Vai al login</Link>}</p>}
      {feed && <><SyncNotice sync={feed.sync} />
        {view === "dashboard" && <DashboardView entries={entries} date={date} target={feed.target} />}
        {view === "diary" && <DiaryView entries={entries} date={date} />}
        {view === "calendar" && <CalendarView entries={entries} date={date} onSelect={setDate} />}
      </>}
      </main><footer className="app-footer">SYNCLORIC <span>DIARIO CALORIE · DATI PERSONALI</span></footer></div>
      <nav className="mobile-nav" aria-label="Navigazione mobile">{navigation.map((item) => <Link key={item.id} href={item.href} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><span aria-hidden="true">{item.symbol}</span>{item.label}</Link>)}</nav>
  </div>;
}
