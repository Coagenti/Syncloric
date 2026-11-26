# Changelog

## 0.2.2 — 2026-11-26

- Menu account con due nuove pagine: **Temi** (`/themes`) e **Lingua**
  (`/language`). Quattro temi scuri (Cyberpunk predefinito, Arasaka Red,
  Synthwave, Terminal) con anteprima della palette e funzionamento da tastiera
  e lettore di schermo; le preferenze sono per utente e restano nel profilo.
- Skin HUD Cyberpunk più dettagliata: cornici smussate e nine-slice, tacche,
  linguette, pulsanti intagliati, barre segmentate, mirino dell'indicatore live,
  icona in esagono. Le decorazioni non intercettano i click e rispettano
  «Riduci animazioni»; gli altri temi restano invariati.
- Diario per pasto in una pagina dedicata (`/diary/meal`): macro e
  micronutrienti disponibili della sola data e del solo pasto, zero noto
  distinto dal dato sconosciuto, modifica ed eliminazione con conferma delle
  voci manuali e duplicazione verso un'altra data o pasto
  (`POST /api/v1/diary/{id}/duplicate`).
- Il filtro marca della ricerca alimenti funziona anche con nomi di più parole.
- Endpoint di stato con versione, commit e digest reali dell'immagine, al posto
  dei valori fissi; immagine Docker costruita una volta in CI e pubblicata su
  GHCR (il deploy usa il digest).
- Aggiornamenti di dipendenze: `next` 16.4.6 (chiude la vulnerabilità che
  faceva fallire `next build` con `SecurityFatalError` sulla 16.4.3),
  `typescript` 6.0.3, `react`/`react-dom` 19.3.1, `better-auth` 1.7.27,
  `drizzle-orm` 0.45.4, `@tanstack/react-query` 5.108.4, `tailwindcss` e
  `@tailwindcss/postcss` 4.3.5, `vitest` 5.1.1, `zod` 4.6.7, `pino` 10.4.0,
  `@heroui/react` 3.2.8, `@playwright/test` 1.65.1, `@electric-sql/pglite`
  0.6.0, `dotenv` 18.0.10, `@types/node` 22.20.5, con la migrazione dei tipi a
  `typescript` 6 già inclusa. Override mirati `esbuild` 0.28.2 e `minimatch`
  11.0.1 chiudono due alert Dependabot. Action GitHub pinnate per SHA
  aggiornate (`checkout` 7.0.1, `setup-node` 7.1.0, `upload-artifact` 7.0.2,
  `pnpm/action-setup` 6.1.1).
- Policy degli aggiornamenti in `docs/adr/0011-dependabot-policy.md`: il gruppo
  `minor-and-patch` è il canale unico, le major si valutano una per una. Due
  `ignore` motivati in `.github/dependabot.yml`: major di `@types/node` (i tipi
  seguono il runtime, Node 22.20.0 in `.nvmrc` e `Dockerfile`) e major di
  `postgres` (drizzle 0.45.4 è scritto per la v3 e nessun test esercita il
  driver: l'integrazione gira su PGlite).
- Progetto open source: licenza AGPL-3.0-or-later, `SECURITY.md`,
  `CONTRIBUTING.md`, `CODEOWNERS`, guida di deploy generica in `docs/DEPLOY.md`,
  README in inglese, italiano e spagnolo.

Una sola nuova migrazione rispetto alla 0.2.1: `0008_user_ui_preferences`
(tabella delle preferenze UI per utente, additiva). Per chi aggiorna dalla 0.1.0
restano necessarie anche `0006_food_portions` e `0007_goal_profile_account`.
Le migrazioni sono applicate automaticamente all'avvio del container.

PR incluse: #10, #11, #12, #13, #14, #15, #16, #20, #22, #23, #24 e #51.
Nessun alert Dependabot aperto dopo l'aggiornamento.

## 0.2.1 — 2026-10-19

- Swipe su mobile tra Oggi, Diario, Calendario e Impostazioni, senza interferire
  con scroll, campi, tab, finestre aperte e gesti dai bordi dello schermo.
- Le card dei pasti in Oggi aprono l’inserimento con data e pasto selezionati,
  mantenendo la grafica e senza aggiungere pulsanti.
- Riepilogo mobile in una sola card: bilancio energetico e macro, totale
  dell’obiettivo e kcal rimanenti o in eccesso dentro il cerchio. Rimosso il
  blocco obiettivo separato; la modifica resta nel profilo. Desktop invariato.
- Macro compatti con barre e grammature; vitamine, minerali e avvertenze sui
  dati parziali raccolti nella sezione collassabile Dettagli.
- Il riepilogo dei nutrienti del giorno resta in Oggi; nel Diario sono
  conservati i dettagli nutrizionali delle singole voci.

Nessuna nuova migrazione rispetto alla 0.2.0. Per chi aggiorna dalla 0.1.0
restano necessarie le migrazioni `0006_food_portions` e
`0007_goal_profile_account`, eseguite automaticamente all’avvio del container.

PR inclusa: #49.

## 0.2.0 — 2026-10-14

- Inserimento alimenti in una pagina dedicata con tab Ricerca, Scansione ed
  Etichetta AI. Ricerca per nome su Open Food Facts, alimenti frequenti per pasto
  e gestione di porzioni personali, anche con quantità decimali.
- Etichetta AI con stato di disponibilità, guida alla foto dei valori
  nutrizionali e verifica dei dati prima del salvataggio.
- Profilo con tab Profilo, Obiettivo, Nutrienti e Sicurezza; menu account,
  nome visualizzato, foto privata, cambio password e cancellazione con conferma.
- Obiettivo temporale facoltativo per perdita di peso, limiti al deficit e
  suggerimento di una data alternativa. Scadenza conclusa o peso raggiunto
  riportano il target calcolato al mantenimento.
- Obiettivi macro automatici o personalizzati, percentuali delle calorie,
  kcal e grammi. Diario e dashboard mostrano target e copertura dei dati.
- Pulsanti export JSON/CSV con icone e colori neon.
- Correzioni al controllo Origin di autenticazione e API dietro reverse proxy.
- Archivi sorgente da Git blob, controllo LF e regressione del checkout
  Windows: entrypoint e input del container Linux preservati. Il packaging
  disabilita esplicitamente la conversione CRLF di Git per entrambi i formati.

Migrazioni aggiunte dalla 0.1.0: `0006_food_portions` e
`0007_goal_profile_account`. Backup del database prima dell’aggiornamento;
conservare segreti, nome del progetto Compose e volume DB dell’istanza.

PR incluse: #44, #45, #46 e #47. Le integrazioni con servizi salute sono ancora
in studio su un branch separato e non fanno parte di questa versione.

## 0.1.0 — 2026-10-08

Prima release: diario e nutrienti, UI cyberpunk, PWA, scansione barcode e AI,
Norish per utente, nuclei familiari, condivisione pasti, export JSON/CSV e token
personali. Migrazioni fino a `0005_households_meal_sharing`.
