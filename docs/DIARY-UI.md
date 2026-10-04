# Diario: azioni reali e catalogo locale

## Integrazione auth/profile e barcode (PR32)

La topbar mantiene il link Impostazioni e il LogoutButton autenticato; il
riepilogo mantiene l'obiettivo dal feed e il link Configura/Modifica obiettivo
verso `/profile`. Nel Diario, Scansiona (barcode/AI) convive con Aggiungi voce,
Modifica e Sincronizza ora. Gli errori auth Norish mantengono il messaggio della
configurazione globale: rivolgersi all'amministratore, non riassociare una chiave
personale.

Regressione di preservazione: `tests/e2e/diary-auth-integration.spec.ts`, con
Chromium e componente reale, API feed mockata. Eseguire con
`pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/diary-*.spec.ts --maxWorkers=1`.
Questa prova non sostituisce la QA login → handler reali → UI (`t_fc8b952f`).
Il fix Marketing del focus sync (`t_270aaf31`) resta separato: l'integrazione
non ne dichiara la risoluzione. Generazione AI: Hermes; contributo umano:
contratto di preservazione e priorità TL, requirements Marketing già definiti.

## Uso

Da Diario (anche Dashboard/Calendario per aggiunta e sync), «Aggiungi voce» apre
un dialog con tipo Alimento/Ricetta, pasto e data. I pasti sono Colazione, Pranzo,
Cena, Spuntino; gli enum API restano Breakfast/Lunch/Dinner/Snack.

- Alimento: digitare il nome cerca nel catalogo locale con debounce250ms e abort
  della ricerca precedente. I suggerimenti sono pulsanti utilizzabili da tastiera.
  Selezione catalogo: inserire grammi; le kcal totali sono calcolate dalla quantità
  e non sono modificabili. Inserimento manuale: nome, grammi e kcal TOTALI della
  quantità inserita (non kcal/100g). Catalogo vuoto/non disponibile non impedisce
  l’inserimento manuale.
- Ricetta: lista locale mirror Norish caricata all’apertura, numero di porzioni
  anche frazionario (max2decimali). Kcal null mostrate «—», senza bloccare il POST.
- «Salva voce»: POST JSON autenticato, poi rilettura del feed del mese/data salvata.
  La stessa proiezione alimenta il Diario e la Dashboard; niente localStorage/demo.
- «Modifica»: solo source manual; nome/tipo/riferimenti immutabili, grammi/kcal
  totali oppure porzioni editabili, insieme a pasto/data. PATCH atomico ricetta:
  kcal ricalcolate quando servings è presente anche con date/slot. Niente edit per
  norish_sync/barcode/ai_label. Food PATCH: kcal esplicita preservata; campo vuoto
  omette kcal e consente il ricalcolo da catalogo (non significa zero).
- Errori inline italiani e retry:400 invita a controllare i dati; alimento/ricetta
  non trovati hanno messaggio azionabile. Solo questi messaggi server noti vengono
  riprodotti; mai body/exception tecnici grezzi.401 offre il link login già vigente.
  Nessun successo prima di risposta2xx. Un errore di rilettura dopo salvataggio è
  mostrato separatamente dal successo della scrittura, senza POST duplicato.
- «Sincronizza ora»: POST /api/v1/sync con {}, JSON e sessione; una richiesta in
  volo disabilita il pulsante. Esito ok/partial/error/auth tramite SyncNotice;
 503 busy distinto («Sincronizzazione già in corso»), nessuna run fittizia o falso
  successo. Dopo200 si rilegge il feed. Gli altri503 suggeriscono impostazioni/retry.

Dialog nativo con focus ciclico, Escape/Chiudi/Annulla e ripristino al trigger
anche dopo salvataggio asincrono/modifica con cambio slot. Durante il salvataggio
non si può chiudere il dialog né inviare di nuovo. Palette/token esistenti
invariati, CSS solo scoped `.diary-editor`/`.food-suggestions`, scroll verticale
se necessario e nessun overflow orizzontale.

## GET /api/v1/diary/catalog

Read-only, session guard prima di DB/validazione; nessuna chiamata Norish.
GET non richiede Content-Type (come GET feed); la risposta è JSON. I verbi write
mantengono i loro guard Origin/JSON esistenti, senza nuova infrastruttura.

`?query=Ri&limit=20`: query case-insensitive PREFIX del nome food, `%`, `_` e
backslash letterali escaped. Assente/vuota: prime righe per nome ASC/id ASC.
Limit intero1..50, default20. Foods condivisi dell’istanza, nessun filtro createdBy
né source. Ricette complete, senza filtro/query/limit, nome ASC/id ASC.

Shape200 (nomi vincolanti):

```ts
{
  foods: Array<{ id: string; name: string; brand: string | null;
    kcalPer100g: number; servingGrams: number | null;
    servingLabel: string | null; source: string }>;
  recipes: Array<{ id: string; name: string; servings: number;
    kcalPerServing: number | null }>;
}
```

401 `{error:"Autenticazione richiesta."}`,400 limit non valido
`{error:"Limite non valido."}`,500 sanitizzato; tutte private,no-store.
GET diary aggiunge `foodId`/`recipeId` UUID o null (nessuna altra nuova proiezione).

## Prove riproducibili

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run --config vitest.config.ts --maxWorkers=1 --testTimeout=60000
# PGlite file-isolato, ripetere per ogni file integration:
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/diary-catalog.test.ts --maxWorkers=1 --hookTimeout=600000 --testTimeout=60000
pnpm exec next build --webpack
pnpm exec vitest run --config vitest.e2e.config.ts --maxWorkers=1
# Prova opt-in con CSS compilato reale + screenshot/rapporti:
DIARY_VISUAL_CSS=1 DIARY_EVIDENCE_DIR=../diary-ui-evidence pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/diary-visual.spec.ts --maxWorkers=1
```

Catalogo/recipe PATCH/proiezione: test reali PGlite con migrazioni. UI: Chromium
reale + bundle dei componenti autentici; API interamente mockate, nessuna chiamata
upstream reale né credenziali. I file diary-actions/catalog/errors/sync/focus
coprono inline food, food locale, ricetta/porzioni e null kcal, aggiornamento
Dashboard, edit manuale/import protetto,400/401/rete/server/JSON grezzo,
debounce/abort e focus (4chiusure × aggiungi/modifica). `diary-visual` usa CSS
build a320/390/1440, verifica reflow/centratura, contrastoAA e focus visibile.
Il test visuale è skip esplicito senza DIARY_VISUAL_CSS; non viene dichiarato
eseguito nel comando standard. La QA integrata login→API reali→feed/UI e runner
mockato è la card downstream t_fc8b952f, non simulata da questa prova UI.

## Provenienza / review

Codice, test e documentazione generati con assistenza AI (Hermes gpt-6.1-sol).
Contributo umano: requisiti e decisioni contrattuali del Technical Lead,
autorizzazione dell’operatore all’equivalenza del modello; requirements grafici
confermati dal Marketing Lead. Review TL e Marketing sulla delivery ancora
richieste prima del rilascio, non dichiarate già eseguite. Disclosure ai sensi
dell’art.50 AI Act e L.132/2025. Nessun merge autonomo, accesso produzione o
scrittura verso Norish.
