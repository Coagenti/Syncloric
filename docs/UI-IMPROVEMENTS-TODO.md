# Todo UI/UX — ripresa del 3 novembre 2026

Branch: `codex/search-brand-preferences`. Il branch contiene anche ricerca per
marca, barcode facoltativo, temi e localizzazione IT/EN già verificati, ancora
senza commit. Preservare questo lavoro. L'utente ha autorizzato l'implementazione
delle priorità della revisione, con una todo aggiornata per la ripresa.

## Stato

- [x] **Font e icone per gli altri temi — richiesta del 4 novembre.**
  Cyberpunk: Chakra Petch + Barlow, glyph HUD segmentati.
  Synthwave: Orbitron + Space Grotesk, glyph curvi e accenti magenta.
  Terminal: IBM Plex Mono, glyph ortogonali da console.
  Implementati 24 WOFF2 locali con licenze e 25 icone per tema (75 nuove).
  Tipi, lint e build passati; 14 test browser e 66 controlli su schermate
  IT/EN a 320–1440 px passati. Verificati font effettivamente caricati,
  cambio tema e un solo set di icone visibile. Nessun overflow o errore JS.
  Tutte le 18 immagini finali dell'ispettore aperte e controllate;
  nessun FAIL con le eccezioni di marchio dichiarate. Report completo:
  `test-results/theme-identities/RESULT.md`.
  Conservare Arasaka Red, completato e verificato; nessun commit richiesto.

- [x] **Arasaka Red.** Quarto tema con palette nero/rosso/bianco,
  geometrie giapponesi e aspetto corporate. Include font locali Rajdhani e
  Zen Kaku Gothic New e 25 icone SVG originali. Persistenza e preview verificate.

- [x] **Calendario tematizzato nel selettore data.** Tendina dell'app con
  palette del tema, cornice HUD per Cyberpunk, tastiera e chiusura accessibile.
  Implementato e verificato nei tre temi e nelle due lingue, anche su mobile.

- [x] **Cyberpunk HUD — richiesta con riferimento grafico.** Cornici tecniche,
  pulsanti angolari, navigazione e indicatori più incisivi, animazioni leggere
  compatibili con Riduci animazioni. Skin riservata a Cyberpunk; verificati
  dashboard, diario, dettagli, inserimento, profilo e impostazioni su mobile
  e desktop, mantenendo invariati gli altri temi. Completato e in preview.

- [x] **Richiesta successiva — diario per pasto.** Card compatte con kcal e
  macro, pagina `/diary/meal` con micronutrienti e alimenti, azioni di
  modifica/eliminazione e duplicazione con destinazione. Implementazione
  completata e verificata. Documentazione in `docs/MEAL-DETAILS.md`.

- [x] **1 — Alta: inserimento manuale.** Campi prodotto prima di riepilogo,
  quantità e conferma; nessun focus automatico sull'input. Conservare AI,
  barcode, porzioni e modifica degli alimenti esistenti.
- [x] **2 — Alta: macro parziali.** Indicatore visibile anche nel riepilogo mobile,
  dettagli sulla copertura; zero resta noto, assente resta sconosciuto.
- [x] **3 — Media: dashboard.** Comprimere intestazioni e riepilogo, anticipare
  i pasti. Conservare cruscotto circolare, animazioni e card cliccabili senza +.
- [x] **4 — Media: tablet.** Navigazione compatta prima di 768 px; filtri adattabili
  alla larghezza disponibile; mantenere utilizzabili swipe, tab e moduli.
- [x] **5 — Media: leggibilità.** Aumentare etichette, unità e grammature utili,
  recuperando spazio da padding e ripetizioni.
- [x] **6 — Media: temi.** Token coerenti su profilo, scanner, inserimento,
  menu e impostazioni; colori semantici e dei nutrienti stabili.
- [x] **7 — Media: calendario.** Mostrare anche manuali e copie, con un filtro
  Norish facoltativo e riepilogo coerente col diario.
- [x] **8 — Media: caricamento.** Cambio giorno immediato nel mese già caricato;
  skeleton al cambio mese, dati mantenuti durante refresh dello stesso mese;
  nessun dato vecchio sotto una data nuova.
- [x] **Verifica finale.** Lint, tipi, test pertinenti, build e prova visuale
  390/768/1440 (anche 320 per i cambiamenti compatti); aggiornare preview 8096.

## Verifiche e ripresa

Revisione originale: `test-results/taste-review/REVIEW.md`. Screenshot prima,
misure e script di sola lettura in `test-results/taste-review/` (ignorati da Git).
La preview è isolata con dati dimostrativi: `http://127.0.0.1:8096/dashboard`.
Server: `node test-results/start-search-preferences-preview.mjs`;
`--refresh` aggiorna solo gli asset client. Riavviare il server solo quando
cambia il backend usato dalla preview, verificando il processo prima di fermarlo.
Per modifiche CSS eseguire prima la build: la preview legge il CSS compilato
da `.next/static`, quindi aggiornare gli asset con `--refresh`.

Comandi Windows (PowerShell senza profilo, terminazioni LF):

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src tests scripts *.ts *.mjs
node node_modules/next/dist/bin/next build --webpack
$env:DIARY_VISUAL_CSS='1'
node node_modules/vitest/vitest.mjs run --config vitest.e2e.config.ts --maxWorkers=2
```

Eseguire build, lint e tipi in sequenza: la cache incrementale locale aveva
bloccato i controlli. Non cancellare altri dati/container, non applicare lo stash
delle integrazioni salute. Nessuna PR o merge è stata richiesta per questa fase.

## Diario di lavoro

- Todo creata prima delle modifiche. Prossima azione: priorità 1 e 2, con test
  browser sul percorso manuale e sui dati nutrizionali incompleti.

- Priorità 1 e 2 implementate: prodotto prima della quantità/conferma; nessun toggle che nasconda i campi del nuovo alimento; indicatore Parziale e copertura nei dettagli. Verifiche: 6 browser di regressione passati (2 visuali rimandati alla build), più 2 nuovi test su ordine, zero e dati mancanti. Log: `test-results/ui-priorities-phase1.log` e `ui-priorities-phase2.log`.
- In corso: priorità 3–6 (layout, tablet, leggibilità e token), poi calendario e caricamento.

- Implementate anche le priorità 3–8, ancora da validare visivamente: dashboard su due colonne desktop e cruscotto compatto su mobile/tablet, sidebar ripiegata fino a 1024, etichette più leggibili, token dei temi, calendario con tutte le fonti e filtro Norish, feed per mese con skeleton e refresh senza cancellare i dati. Aggiunti test comportamentali per calendario e caricamento. Tipi già passati dopo le modifiche strutturali. Prossimo passo: leggere i log `ui-priorities-behaviour.log`, eseguire i nuovi test, lint/build in sequenza, aggiornare preview e confrontare screenshot prima/dopo.

- **Completamento:** tutte le otto priorità sono implementate e verificate. Rifiniti il testo nel cerchio e le righe del calendario mobile; a 320 px la data resta intera su una riga dedicata con sync accanto. Nessun overflow a 320/390/768/1024/1025/1440 px. Primo pasto a y=690 invece di 1173 sul desktop, y=665 invece di 804 sul mobile e 1431 sul tablet (misure senza banner dimostrativo). Nome alimento manuale a y=459 invece di 1146 sul mobile.
- **Check finali:** ESLint, tipi e build di produzione passati; 332 unit test e 89 browser test passati. Dopo l'ultimo aggiustamento CSS per 320 px sono ripassati i 10 browser test di navigazione, contrasto, preferenze e nuove priorità. `git diff --check` pulito; file modificati normalizzati a LF per Linux. Log: `ui-priorities-lint.log`, `ui-priorities-build.log`, `ui-priorities-unit-final.log`, `ui-priorities-browser-final.log`, `ui-priorities-narrow-final.log` in `test-results/`.
- **Confronto visuale:** `test-results/taste-after/RESULT.md`, 27 schermate di audit, otto ulteriori controlli su schermi stretti/breakpoint e sei immagini dell'ispettore della skill, tutte e sei aperte e controllate. Eccezioni esplicite al metro stilistico per il marchio cyberpunk e per il banner dimostrativo; restano due avvisi documentati, senza blocchi funzionali. Rifinite anche le righe macro fra 1025 e 1279 px; ultima build e controlli a 1025/1279/1280 passati, senza overflow.
- **Punto di ripresa:** preview 8096 aggiornata, tutte le modifiche ancora senza commit sul branch indicato. Nessun lavoro residuo fra le otto priorità; prossimo passo dell'utente: revisione della preview ed eventuale richiesta di commit/PR. Il diario sopra conserva anche i passaggi intermedi, superati da questo completamento.

- **Diario per pasto completato:** riepiloghi cliccabili, due colonne da 1280 px, pagina autenticata `/diary/meal` con micronutrienti e alimenti, azioni di modifica/eliminazione e duplicazione con data/pasto di destinazione. Copia indipendente anche per Norish, con totali delle ricette scalati una sola volta; nessuna modifica alla fonte del sync. Quantità piccole distinte dallo zero e dati mancanti mai inventati.
- **Verifiche del nuovo flusso:** 334 unit, 283 integrazione e 92 browser passati; tre browser delle nuove viste ripassati dopo le rifiniture. Lint e build Next passati. Nella preview reale provati duplicazione, dimezzamento quantità con ricalcolo, eliminazione e mantenimento della fonte. Copia di prova rimossa. Report e immagini: `test-results/meal-detail/RESULT.md`; log `meal-detail-unit.log`, `meal-detail-integration-full.log`, `meal-detail-browser-final.log`, `meal-detail-browser-visual-final.log`, `meal-detail-build.log`, `meal-detail-lint.log`.
- **Preview finale:** `http://127.0.0.1:8096/diary?date=2026-11-03`; toccare una card per i dettagli. Accesso dimostrativo automatico anche dopo riavvio. Tutto ancora senza commit sul branch corrente; non sono state aperte PR o effettuati merge in questa fase.
- **Fix temi della navigazione:** rimossi i colori fissi che sovrascrivevano header e gradiente della sidebar; superfici, bordi, separatori e sfondo della voce attiva seguono la palette. Build e tre test browser esistenti delle preferenze passati; sei schermate dei tre temi a 1440/390 px controllate, senza overflow o errori JS. Preview 8096 aggiornata. Evidenze: `test-results/theme-shell/` e log `theme-shell-build.log`, `theme-shell-browser.log`.
- **Cyberpunk HUD completato:** cornici SVG angolari, pulsanti smussati, barre segmentate, navigazione tecnica e animazioni leggere di header/sidebar. Skin in `src/app/cyberpunk-hud.css`; menu e contenuti restano utilizzabili senza ritagli. Riduci animazioni disattiva i nuovi effetti. Synthwave e Terminal conservano il proprio aspetto.
- **Verifiche HUD:** lint e build di produzione passati; 92 browser test, 9 mirati ripassati e 4 unit di localizzazione. Controlli su 30 schermate a 320/390/768/1440 px senza overflow o errori JS. Ispettore della skill su dashboard e temi: nessun FAIL con le eccezioni di marchio dichiarate; restano gli avvisi sui microtesti. Tutte le 12 immagini finali dell'ispettore aperte e controllate. Evidenze: `test-results/hud/RESULT.md`; log `hud-build.log`, `hud-lint.log`, `hud-browser.log`, `hud-browser-final.log`, `hud-localization.log`. Preview 8096 aggiornata; modifiche ancora senza commit.
- **Fix angoli HUD:** lo sfondo rettangolare sporgeva oltre la cornice smussata. Ora la superficie dipinta segue tutti e quattro i tagli, anche per selezione, hover ed eccesso; sui fieldset parte dalla stessa origine della cornice. Il contenitore dei due pannelli desktop resta trasparente. Nessun ritaglio dei contenuti o dei menu. Build passata, tre browser test passati e uno saltato dalla suite, otto stati controllati sui pixel dei quattro angoli a 1440/390 px, 30 schermate senza overflow o errori JS. Ispettore dashboard a 1440/768/390: nessun FAIL con le eccezioni di marchio, sei immagini finali aperte. Evidenze: `test-results/hud-corners/`, `test-results/hud-corners-inspect/`, log `hud-corners-build.log` e `hud-corners-browser.log`. Preview 8096 aggiornata, nessun commit.
- **4 novembre — calendario tematizzato completato:** tendina React Aria accessibile, palette dei tre temi e cornice HUD per Cyberpunk. Selezione con tocco/tastiera, mesi, anni bisestili, ritorno a oggi, Escape e clic esterno con ripristino del focus. Conservata la digitazione diretta della data. Build, tipi e lint passati; 17 browser test con CSS di produzione (otto file) e quattro unit di localizzazione passati. Quindici schermate del popup in IT/EN e nei tre temi, comprese 320/390/768/1440 e 640×360: tutte aperte, nessun overflow o errore JS. Sei immagini finali dell'ispettore della pagina aperte; nessun FAIL con le eccezioni di marchio, avviso sui microtesti preesistente. Report `test-results/date-picker/RESULT.md`; log `date-picker-build.log`, `date-picker-lint.log`, `date-picker-types.log`, `date-picker-regression.log`, `date-picker-localization.log`. Preview riavviata e aggiornata su 8096 (sessione exec 88903). Nessun commit o PR richiesto.

- **4 novembre — Arasaka Red completato:** quarto tema con nero/rosso/bianco, pannelli corporate e motivo solare. Header, sidebar, datepicker, calendario e moduli coerenti. Font locali Rajdhani e Zen Kaku Gothic New (90 KB, licenze incluse) e 25 icone SVG originali selezionate dal tema. Il cruscotto bianco diventa rosso in eccesso; colori dei nutrienti stabili. Build, tipi e lint passati; 4 unit, 8 integrazioni e 14 browser finali passati. Caricamento effettivo dei font e attivazione delle icone verificati in Chromium. 25 schermate/misure a 320/390/768/1025/1440 e nelle due lingue senza overflow o errori JS. Sei immagini finali dell'ispettore aperte: nessun FAIL con eccezioni di marchio, avvisi documentati nel report. Evidenze `test-results/arasaka/RESULT.md`, `arasaka-inspect/` e log `arasaka-*.log`. Preview 8096 con Arasaka Red selezionato nell'account dimostrativo, sessione exec 37297. Tutto senza commit sul branch corrente.

- **4–5 novembre — identità degli altri temi completate:** Cyberpunk usa Chakra Petch/Barlow e icone HUD segmentate; Synthwave Orbitron/Space Grotesk e tratti curvi; Terminal IBM Plex Mono e glyph da console. Aggiunti 75 SVG originali e 24 WOFF2 locali (380.412 byte), con licenze OFL, fonti e hash. Il cambio tema seleziona subito font e icone anche al primo rendering, senza CDN. Arasaka Red mantiene la propria identità.
- **Verifiche delle identità:** tipi, lint e build passati; 14 test browser con CSS di produzione in sei file, inclusi tutti i quattro temi e le due lingue. 66 schermate/controlli a 320/390/768/1440 senza overflow o errori JS. Rifiniti i valori secondari del cruscotto Synthwave e la navigazione Terminal a 320 px; test aggiunto sulla distanza delle etichette. Tutte le 18 immagini finali dell'ispettore aperte: zero FAIL con le eccezioni di marchio; avvisi su microtesti, font del solo banner demo e spazi nei pannelli spiegati nel report. Evidenze `test-results/theme-identities/RESULT.md`, `checks.json`, `inspect-*/`; log `theme-identities-types.log`, `theme-identities-lint.log`, `theme-identities-build.log`, `theme-identities-browser.log`.
- **Punto di ripresa aggiornato:** nessun lavoro residuo nella richiesta font/icone. Preview su 8096; per gli screenshot isolati il parametro della sola preview `inspectTheme` evita interferenze con il tema scelto dall'utente, senza salvare preferenze. Il 5 novembre l'utente ha richiesto commit e push di tutto il lavoro completato su `codex/search-brand-preferences`. Nessuna PR o merge richiesti in questa consegna.
