"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarView, DashboardView, DiaryView } from "@/components/calorie-views";
import { addEntry, demoEntries, editEntry, formatDate, localDateKey, shiftDate, slotLabels, type DiaryEntry, type Slot } from "@/lib/diary";

type View = "dashboard" | "diary" | "calendar";
const storageKey = "syncloric-demo-diary-v1";
const demoDay = "2026-09-29";
const navigation: { id: View; label: string; href: string; symbol: string }[] = [
  { id: "dashboard", label: "Oggi", href: "/dashboard", symbol: "◫" },
  { id: "diary", label: "Diario", href: "/diary", symbol: "≡" },
  { id: "calendar", label: "Calendario", href: "/calendar", symbol: "▦" },
];

export function CalorieApp({ view }: { view: View }) {
  const [date, setDate] = useState(demoDay);
  const [entries, setEntries] = useState(demoEntries);
  const [editor, setEditor] = useState<{ slot: Slot; entry: DiaryEntry | null } | null>(null);
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Read after hydration so SSR and first client render have identical demo markup.
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        const saved = window.localStorage.getItem(storageKey);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.every((item) => item && typeof item === "object" && typeof item.id === "string" && typeof item.date === "string" && typeof item.name === "string")) setEntries(parsed as DiaryEntry[]);
        }
        if (view === "dashboard") setDate(localDateKey());
        else {
          const savedDay = window.localStorage.getItem(`${storageKey}-day`);
          setDate(savedDay && /^\d{4}-\d{2}-\d{2}$/.test(savedDay) ? savedDay : localDateKey());
        }
      } catch {
        // A blocked read must not prevent the dashboard from opening on today.
        setDate(localDateKey());
      }
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [view]);
  useEffect(() => {
    if (!loaded) return;
    try { window.localStorage.setItem(`${storageKey}-day`, date); }
    catch { /* date navigation remains in memory when storage is unavailable */ }
  }, [date, loaded]);
  useEffect(() => { if (editor) firstField.current?.focus(); }, [editor]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const quantity = Number(data.get("quantity"));
    const calories = Number(data.get("kcal"));
    if (!editor || !name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(calories) || calories < 0 || !Number.isInteger(calories)) {
      setNotice("Controlla nome, quantità e kcal: usa valori validi e non negativi."); return;
    }
    const kind = String(data.get("kind")) === "recipe" ? "recipe" : "food";
    const update = { name, date, slot: editor.slot, entryType: kind as "recipe" | "food", quantityGrams: kind === "food" ? quantity : null, servings: kind === "recipe" ? quantity : null, kcal: calories };
    const next = editor.entry ? editEntry(entries, editor.entry.id, update) : addEntry(entries, { ...update, id: crypto.randomUUID(), protein: null, fat: null, carbs: null, source: "manual", norishDeleted: false });
    setEntries(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setNotice("Modifiche salvate in questo browser (demo). Non inviate al server.");
    } catch {
      setNotice("Modifiche non salvate nel browser: restano visibili solo finché questa pagina è aperta. Riprova quando lo spazio di archiviazione è disponibile.");
    }
    setEditor(null);
  }

  return <div className="app-shell">
    <aside className="sidebar"><Link href="/dashboard" className="brand" aria-label="Syncloric, vai alla dashboard"><span className="brand-icon">S<span>↗</span></span><span>SYN<span className="brand-accent">CLORIC</span><small>CALORIE / IN FOCUS</small></span></Link><div className="side-divider" /><span className="side-label">ESPLORA</span><nav className="side-nav" aria-label="Navigazione principale">{navigation.map((item) => <Link key={item.id} href={item.href} aria-current={view === item.id ? "page" : undefined} className={`nav-link ${view === item.id ? "active" : ""}`}><span aria-hidden="true">{item.symbol}</span>{item.label}{view === item.id && <i aria-hidden="true" />}</Link>)}</nav><div className="side-bottom"><span className="side-label">IL TUO SPAZIO</span><p>Una panoramica semplice di quello che registri. Nessun giudizio, solo dati.</p><div className="side-build">SYNC / DEMO <span>●</span> V.01</div></div></aside>
    <div className="app-main"><header className="topbar"><div className="topbar-path"><span>SYNCLORIC</span><span aria-hidden="true">/</span><strong>{navigation.find((item) => item.id === view)?.label.toUpperCase()}</strong></div><div className="topbar-right"><span className="live-label"><i /> MODALITÀ DEMO</span><span className="avatar" aria-label="Profilo dimostrativo">S</span></div></header>
      <main className="content"><div className="demo-alert" role="note"><strong>DATI DIMOSTRATIVI</strong><span>Pasti di esempio. Le modifiche restano solo in questo browser; nessuna sincronizzazione o salvataggio remoto.</span></div><div className="date-toolbar"><div><span className="section-kicker">GIORNO SELEZIONATO</span><strong>{formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong></div><div className="date-actions"><button type="button" aria-label="Giorno precedente" onClick={() => setDate(shiftDate(date, -1))}>←</button><button type="button" onClick={() => setDate(localDateKey())}>Oggi</button><button type="button" aria-label="Giorno successivo" onClick={() => setDate(shiftDate(date, 1))}>→</button><label className="date-picker">Data <input type="date" aria-label="Seleziona data" value={date} onChange={(event) => { if (event.target.value) setDate(event.target.value); }} /></label></div></div>
      {view === "dashboard" && <DashboardView entries={entries} date={date} target={null} />}
      {view === "diary" && <DiaryView entries={entries} date={date} onAdd={(slot) => { setEditor({ slot, entry: null }); setNotice(""); }} onEdit={(entry) => { setEditor({ slot: entry.slot, entry }); setNotice(""); }} />}
      {view === "calendar" && <CalendarView entries={entries} date={date} onSelect={setDate} />}
      {view === "dashboard" && <Link href="/diary" className="primary-cta">+ Aggiungi voce <span aria-hidden="true">↗</span></Link>}
      {notice && <p className="status-note" role="status">{notice}</p>}
      {editor && <div className="editor-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}><section className="editor-panel" role="dialog" aria-modal="true" aria-labelledby="editor-title" onKeyDown={(event) => { if (event.key === "Escape") setEditor(null); if (event.key === "Tab") { const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input, select, button")); const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }}><div className="editor-heading"><div><span className="section-kicker">{date} / {slotLabels[editor.slot]}</span><h2 id="editor-title">{editor.entry ? "Modifica voce" : "Aggiungi voce"}</h2></div><button type="button" className="close-editor" aria-label="Chiudi" onClick={() => setEditor(null)}>×</button></div><p className="editor-disclaimer">{editor.entry?.source === "norish_sync" ? "Modificando una voce importata, questa diventa una voce manuale nella demo." : "Valori inseriti manualmente; nessuna verifica nutrizionale automatica."}</p><form onSubmit={save}><label>Nome del cibo o della ricetta<input ref={firstField} name="name" required maxLength={120} defaultValue={editor.entry?.name ?? ""} placeholder="Es. Insalata di ceci" /></label><label>Tipo<select name="kind" defaultValue={editor.entry?.entryType ?? "food"}><option value="food">Ingrediente / cibo (g)</option><option value="recipe">Ricetta (porzioni)</option></select></label><div className="form-columns"><label>Quantità (g o porzioni)<input name="quantity" type="number" min="0.01" step="0.01" required defaultValue={editor.entry?.quantityGrams ?? editor.entry?.servings ?? 100} /></label><label>Kcal totali<input name="kcal" type="number" min="0" step="1" required defaultValue={editor.entry?.kcal ?? ""} /></label></div><p className="form-help">Inserisci le kcal totali della quantità indicata. Zero è ammesso; lasciare il dato vuoto non lo è.</p><div className="editor-actions"><button type="button" className="secondary-btn" onClick={() => setEditor(null)}>Annulla</button><button type="submit" className="primary-btn">Salva voce ↗</button></div></form></section></div>}
      </main><footer className="app-footer">SYNCLORIC <span>DIARIO CALORIE · DEMO LOCALE</span></footer></div>
      <nav className="mobile-nav" aria-label="Navigazione mobile">{navigation.map((item) => <Link key={item.id} href={item.href} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><span aria-hidden="true">{item.symbol}</span>{item.label}</Link>)}</nav>
  </div>;
}
