"use client";
import { useI18n } from "@/components/ui-preferences-provider";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { UiIcon } from "@/components/ui-icon";
import { LabelScan } from "@/components/label-scan";
import { normalizeNutrition } from "@/lib/nutrition";
import { legacyFoodPortions, newPortionId } from "@/lib/food-portions";
import { entryTabs, foodEntryError, type EntryTab, type EntryFood, type EntryRecipe } from "@/lib/food-entry";
import { localDateKey, slotLabels, slots, type Slot } from "@/lib/diary";
import { FoodDetail } from "./food-detail";
import { BarcodeScanner } from "./barcode-scanner";

const tabNames = { ricerca: "Ricerca", scansione: "Scansione", etichetta: "Etichetta AI" };
const tabIcons = { ricerca: "search", scansione: "scan", etichetta: "camera" } as const;
const emptyFood: EntryFood = { name: "", brand: null, kcalPer100g: null, nutrientsPer100g: {}, portions: [] };
type SearchResult = { local: EntryFood[]; foods: EntryFood[]; hasMore: boolean; error?: string; disabled?: boolean; retryAfter?: number };
function FoodList({ values, label, busy, onChoose }: { values: EntryFood[]; label: string; busy: boolean; onChoose: (value: EntryFood, trigger: HTMLButtonElement) => void }) {
  const { tr } = useI18n();
  return <ul className="entry-food-list" aria-label={label}>{values.map((value, index) => <li key={value.id ?? value.barcode ?? index}><div className="entry-food-info"><strong>{value.name}</strong><span>{value.brand || tr("Marca non indicata")}</span></div><div className="entry-food-kcal"><strong>{value.kcalPer100g ?? "—"}</strong><span>kcal / 100 g</span></div><button type="button" className="food-square-add" disabled={busy} aria-label={tr("Scegli {0}", { "0": value.name })} onClick={event => onChoose(value, event.currentTarget)}><UiIcon name="plus" /></button></li>)}</ul>;
}
export function FoodEntryView({ initialDate = "", initialSlot = "Lunch" }: { initialDate?: string; initialSlot?: Slot }) {
  const { tr, formatDay, locale } = useI18n();
  const [date, setDate] = useState(initialDate); const [slot, setSlot] = useState<Slot>(initialSlot); const [tab, setTab] = useState<EntryTab>("ricerca");
  const [food, setFood] = useState<EntryFood | null>(null); const [recipe, setRecipe] = useState<EntryRecipe | null>(null); const [ai, setAi] = useState(false);
  const [query, setQuery] = useState(""); const [brandFilter, setBrandFilter] = useState(""); const [page, setPage] = useState(1);
  const [results, setResults] = useState<SearchResult | null>(null); const [frequent, setFrequent] = useState<EntryFood[]>([]); const [recipes, setRecipes] = useState<EntryRecipe[]>([]);
  const [searching, setSearching] = useState(false); const [busy, setBusy] = useState(false); const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState(""); const [habitError, setHabitError] = useState(""); const [feedback, setFeedback] = useState(""); const [revision, setRevision] = useState(0); const [retry, setRetry] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]); const request = useRef<AbortController | null>(null); const selectedTrigger = useRef<HTMLButtonElement | null>(null); const restoreFocus = useRef(false);
  const detailHistory = useRef(false);
  useEffect(() => { if ((food || recipe) && !detailHistory.current) { window.history.pushState(window.history.state, "", "#prodotto"); detailHistory.current = true; } }, [food, recipe]);
  useEffect(() => {
    const sync = () => { const hash = window.location.hash.slice(1); const next = entryTabs.includes(hash as EntryTab) ? hash as EntryTab : "ricerca"; detailHistory.current = false; restoreFocus.current = true; setTab(next); setFood(null); setRecipe(null); setAiBusy(false); setBusy(false); request.current?.abort(); };
    queueMicrotask(() => { sync(); if (!initialDate) setDate(localDateKey()); }); window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("hashchange", sync); request.current?.abort(); };
  }, [initialDate]);
  useEffect(() => {
    if (!food && !recipe && restoreFocus.current) { (selectedTrigger.current?.isConnected ? selectedTrigger.current : tabs.current[entryTabs.indexOf(tab)])?.focus(); restoreFocus.current = false; }
  }, [food, recipe, tab]);
  useEffect(() => {
    const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) { setHabitError(""); setFrequent([]); } });
    void fetch(`/api/v1/foods/frequent?slot=${slot}`, { cache: "no-store", signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); const data = await response.json(); if (!controller.signal.aborted) setFrequent(data.foods); }).catch(() => { if (!controller.signal.aborted) setHabitError(tr("Non riesco a caricare i più usati. Riprova.")); });
    return () => controller.abort();
  }, [slot, revision, tr]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/diary/catalog", { cache: "no-store", signal: controller.signal }).then(async r => { if (!r.ok) return; const data = await r.json(); if (!controller.signal.aborted) setRecipes(data.recipes); }).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (tab !== "ricerca" || food || recipe || query.trim().length < 2 && brandFilter.trim().length < 2) { queueMicrotask(() => { if (!controller.signal.aborted) { setSearching(false); setResults(null); } }); return () => controller.abort(); }
    queueMicrotask(() => { if (!controller.signal.aborted) { setSearching(true); setResults(null); } });
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    async function search() {
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetch(`/api/v1/foods/search?${new URLSearchParams({ query: query.trim(), brand: brandFilter.trim(), locale, page: String(page) })}`, { cache: "no-store", signal: controller.signal });
          const data = await response.json(); if (controller.signal.aborted) return;
          if (response.status === 429 && attempt === 0 && typeof data.retryAfter === "number") {
            setResults({ ...data, error: undefined });
            await new Promise<void>(resolve => { retryTimer = setTimeout(resolve, Math.min(60, Math.max(1, data.retryAfter)) * 1000); controller.signal.addEventListener("abort", () => resolve(), { once: true }); });
            if (controller.signal.aborted) return; continue;
          }
          setResults(response.ok ? data : { ...data, error: response.status === 429 ? tr("Attendi qualche secondo e riprova la ricerca.") : tr("Ricerca Open Food Facts non disponibile. Puoi usare il catalogo locale.") }); if (response.status === 401) setError(tr("Autenticazione richiesta. Accedi per cercare alimenti.")); break;
        }
      } catch { if (!controller.signal.aborted) setResults({ local: [], foods: [], hasMore: false, error: tr("Ricerca non disponibile. Riprova o usa l’inserimento manuale.") }); }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }
    const timer = setTimeout(() => {
      void search();
    }, 900);
    return () => { clearTimeout(timer); clearTimeout(retryTimer); controller.abort(); };
  }, [query, tab, food, recipe, brandFilter, page, retry, locale, tr]);
  function changeTab(next: EntryTab) { if (busy || aiBusy) return; request.current?.abort(); setTab(next); setError(""); window.history.replaceState(window.history.state, "", `#${next}`); }
  async function chooseFood(value: EntryFood, trigger?: HTMLButtonElement) {
    if (busy) return; selectedTrigger.current = trigger ?? null; setError(""); setAi(false);
    if (!value.id && !value.barcode) { setFood(value); return; }
    const controller = new AbortController(); request.current?.abort(); request.current = controller; setBusy(true);
    try {
      const response = await fetch(value.id ? `/api/v1/foods/${value.id}` : `/api/v1/barcode?code=${value.barcode}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json(); if (!response.ok) { setError(tr(foodEntryError(response.status))); return; }
      if (controller.signal.aborted) return;
      if (value.id) { setFood(data.food); return; }
      if (data.origin === "local") {
        const details = await fetch(`/api/v1/foods/${data.food.id}`, { cache: "no-store", signal: controller.signal });
        if (!details.ok) throw new Error(); const known = await details.json(); if (!controller.signal.aborted) setFood(known.food);
      } else {
        const source = data.food ?? value;
        setFood({ ...value, ...source, barcode: value.barcode, nutrientsPer100g: normalizeNutrition(source.nutrientsPer100g, { protein: source.proteinPer100g, fat: source.fatPer100g, carbs: source.carbsPer100g }), portions: source.portions ?? legacyFoodPortions(source), source: data.origin === "off" ? "barcode_off" : "manual" });
      }
    } catch { if (!controller.signal.aborted) setError(tr("Prodotto non disponibile. Riprova oppure inseriscilo manualmente.")); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  function back() { if (detailHistory.current) { detailHistory.current = false; window.history.back(); } setFood(null); setRecipe(null); setAi(false); restoreFocus.current = true; }
  function updateContext(nextDate: string, nextSlot: Slot) { setDate(nextDate); setSlot(nextSlot); window.history.replaceState(window.history.state, "", `/diary/add?${new URLSearchParams({ date: nextDate, slot: nextSlot })}${window.location.hash}`); }
  return <AppShell view="diary"><div className="food-entry-page">
    <header className="entry-page-header"><a href={`/diary?date=${date}`} className="entry-back" aria-label={tr("Torna al diario")}><UiIcon name="left" /><span>{tr("Diario")}</span></a><div><span className="section-kicker">{tr("AGGIUNGI AL PASTO")}</span><h1>{tr(slotLabels[slot])}<span className="title-punctuation">.</span></h1></div><div className="entry-context"><label><span className="sr-only">{tr("Pasto")}</span><select aria-label={tr("Pasto")} disabled={!!food || !!recipe || busy || aiBusy} value={slot} onChange={e => updateContext(date, e.target.value as Slot)}>{slots.map(s => <option key={s} value={s}>{tr(slotLabels[s])}</option>)}</select></label><label><span className="sr-only">{tr("Data inserimento")}</span><input aria-label={tr("Data inserimento")} type="date" required disabled={busy || aiBusy} value={date} onChange={e => { if (e.target.value) updateContext(e.target.value, slot); }} /></label></div></header>
    {!food && !recipe && <><div className="entry-tabs" role="tablist" aria-label={tr("Metodo di inserimento")}>{entryTabs.map((value, index) => <button ref={el => { tabs.current[index] = el; }} role="tab" type="button" id={`entry-tab-${value}`} aria-selected={tab === value} aria-controls={`entry-panel-${value}`} tabIndex={tab === value ? 0 : -1} disabled={busy || aiBusy} key={value} onClick={() => changeTab(value)} onKeyDown={event => { let next: number | undefined; if (event.key === "ArrowRight") next = (index + 1) % 3; if (event.key === "ArrowLeft") next = (index + 2) % 3; if (event.key === "Home") next = 0; if (event.key === "End") next = 2; if (next !== undefined) { event.preventDefault(); changeTab(entryTabs[next]); tabs.current[next]?.focus(); } }}><UiIcon name={tabIcons[value]} />{tr(tabNames[value])}</button>)}</div>
    <div role="tabpanel" id={`entry-panel-${tab}`} aria-labelledby={`entry-tab-${tab}`} tabIndex={0} className="entry-tab-panel">
      {feedback && <p className="entry-success" role="status">{tr(feedback)}</p>}
      {busy && <p role="status" className="entry-busy">{tr("Caricamento prodotto…")}</p>}
      {error && <p role="alert" className="entry-error">{tr(error)}{error.includes(tr("Autenticazione")) && <a href="/login" target="_blank" rel="noreferrer">{tr("Accedi")}</a>}</p>}
      {tab === "ricerca" && <><div className="entry-search-bar"><label><span className="sr-only">{tr("Cerca alimento per nome")}</span><UiIcon name="search" /><input type="search" value={query} maxLength={100} placeholder={tr("Cerca alimento per nome")} aria-label={tr("Cerca alimento per nome")} onChange={e => { setQuery(e.target.value); setPage(1); setError(""); }} /></label><label className="entry-brand"><span className="sr-only">{tr("Filtra per marca")}</span><UiIcon name="tag" /><input type="search" aria-label={tr("Filtra per marca")} placeholder={tr("Marca (facoltativa)")} maxLength={100} value={brandFilter} onChange={e => { setBrandFilter(e.target.value); setPage(1); setError(""); }} /></label></div>
        {query.trim().length >= 2 || brandFilter.trim().length >= 2 ? <section aria-label={tr("Risultati ricerca")}><div className="entry-section-heading"><h2>{tr("Risultati ricerca")}</h2>{searching && <span role="status">{tr("Ricerca…")}</span>}</div>{results && <>
          {!!results.local?.length && <><h3 className="entry-list-label">{tr("Nel tuo catalogo")}</h3><FoodList values={results.local} label={tr("Catalogo locale")} busy={busy} onChoose={chooseFood} /></>}
          {!!results.foods?.length && <><h3 className="entry-list-label">Open Food Facts</h3><FoodList values={results.foods.filter(v => !results.local?.some(l => l.barcode === v.barcode))} label={tr("Risultati Open Food Facts")} busy={busy} onChoose={chooseFood} /></>}
          {results.error && <p role="alert" className="entry-error">{results.error}<button className="entry-text-action" type="button" onClick={() => setRetry(v => v + 1)}>{tr("Riprova")}</button></p>}
          {results.disabled && <p className="form-help">{tr("La ricerca Open Food Facts è disabilitata dall’amministratore. Puoi usare il catalogo locale.")}</p>}
          {!results.error && !results.disabled && !results.local?.length && !results.foods?.length && <p className="entry-empty">{tr("Nessun alimento trovato. Prova un altro nome o modifica il filtro marca.")}</p>}
          <div className="entry-pagination">{page > 1 && <button className="secondary-btn" type="button" onClick={() => setPage(v => v - 1)}>{tr("Precedenti")}</button>}{results.hasMore && <button className="secondary-btn" type="button" onClick={() => setPage(v => v + 1)}>{tr("Altri risultati")}<UiIcon name="right" /></button>}</div>
        </>}</section> : <section aria-label={tr("Alimenti più usati")}><div className="entry-section-heading"><h2>{tr("I tuoi più usati")}</h2><span>{tr(slotLabels[slot])}</span></div><p className="form-help">{tr("Gli alimenti che registri più spesso in questo pasto.")}</p>{habitError ? <p role="alert">{tr(habitError)}<button type="button" className="entry-text-action" onClick={() => setRevision(v => v + 1)}>{tr("Riprova")}</button></p> : frequent.length ? <FoodList values={frequent} label={tr("Più usati in questo pasto")} busy={busy} onChoose={chooseFood} /> : <p className="entry-empty">{tr("Le tue abitudini partono da qui. Gli alimenti aggiunti a ")}{tr(slotLabels[slot]).toLowerCase()}{tr(" compariranno in questa lista.")}</p>}</section>}
        <div className="entry-search-footer"><button type="button" className="entry-text-action" onClick={event => { selectedTrigger.current = event.currentTarget; setAi(false); setFood({ ...emptyFood, name: query.trim(), brand: brandFilter.trim() || null }); }}><UiIcon name="pencil" />{tr("Inserisci un alimento manualmente")}</button><a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">{tr("Dati Open Food Facts · ODbL / DbCL")}</a></div>
        {!!recipes.length && <details className="entry-recipes"><summary>{tr("Le tue ricette")}</summary><ul className="entry-food-list">{recipes.map(value => <li key={value.id}><div className="entry-food-info"><strong>{value.name}</strong><span>{tr("Ricetta · per porzione")}</span></div><div className="entry-food-kcal"><strong>{value.kcalPerServing ?? "—"}</strong><span>kcal</span></div><button type="button" className="food-square-add" aria-label={tr("Scegli {0}", { "0": value.name })} onClick={e => { selectedTrigger.current = e.currentTarget; setRecipe(value); }}><UiIcon name="plus" /></button></li>)}</ul></details>}
      </>}
      {tab === "scansione" && <><BarcodeScanner busy={busy} onCode={code => void chooseFood({ ...emptyFood, barcode: code })} /><button type="button" className="entry-text-action" disabled={busy} onClick={() => { setAi(false); setFood(emptyFood); }}>{tr("Inserisci manualmente")}<UiIcon name="pencil" /></button></>}
      {tab === "etichetta" && <div className="label-view"><LabelScan variant="view" onBusy={setAiBusy} onExtract={label => { setAi(true); setFood({ ...emptyFood, name: label.name, brand: label.brand ?? null, barcode: label.barcode ?? null, kcalPer100g: Math.round(label.per100g.kcal), nutrientsPer100g: normalizeNutrition(label.per100g), portions: label.servingSize ? [{ id: newPortionId(), label: tr("Porzione"), grams: label.servingSize, defaultQuantity: 1 }] : [] }); }} /><button type="button" className="entry-text-action" disabled={aiBusy} onClick={() => { setAi(false); setFood(emptyFood); }}><UiIcon name="pencil" />{tr("Compila manualmente")}</button></div>}
    </div></>}
    {(food || recipe) && <FoodDetail food={food ?? undefined} recipe={recipe ?? undefined} date={date} slot={slot} ai={ai} onBack={back} onSaved={name => { setFeedback(tr("{0} aggiunto a {1}.", { "0": name, "1": tr(slotLabels[slot]).toLowerCase() })); setRevision(v => v + 1); setQuery(""); setBrandFilter(""); back(); }} />}
    <div className="entry-page-foot"><span>{date ? formatDay(date, { day: "numeric", month: "long" }) : ""} · {tr(slotLabels[slot])}</span><a href={`/diary?date=${date}`} className="secondary-btn">{tr("Fine")}<UiIcon name="right" /></a></div>
  </div></AppShell>;
}
