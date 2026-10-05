# API diario: creazione manuale v1

`POST /api/v1/diary` richiede la sessione Better Auth (cookie, come GET).
Scrive esclusivamente nel DB locale: nessuna richiesta Norish. Richiede
`Content-Type: application/json` (anche con charset). Se un browser invia `Origin`,
deve coincidere esattamente con l'origine della richiesta; un'origine diversa
(o `null`) è rifiutata con 403. Client non-browser possono omettere Origin,
ma devono comunque usare JSON. Il reverse proxy deve preservare l'origine
pubblica nelle richieste inoltrate. L'utente viene
dalla sessione e `source` è sempre `manual`; campi extra `userId`, `source`,
`norishItemId` sono ignorati, mai applicati.

## Richiesta JSON

Campi comuni: `date` (data reale `YYYY-MM-DD`), `slot` (Breakfast, Lunch,
Dinner, Snack), `entryType` (food, recipe).

Alimento già nel catalogo condiviso locale:

```json
{"date":"2026-10-01","slot":"Lunch","entryType":"food","foodId":"aaaaaaaa-1111-4111-8111-111111111111","quantityGrams":150}
```

`foodId` deve esistere. `quantityGrams` è obbligatoria; kcal della voce =
`round(food.kcalPer100g * quantityGrams / 100)`. Se è presente `foodId`, il
catalogo è la fonte delle kcal: eventuali nome/kcal non ne sovrascrivono i dati.

Alimento nuovo:

```json
{"date":"2026-10-01","slot":"Snack","entryType":"food","name":"Yogurt","quantityGrams":125,"kcal":80}
```

`name` non vuoto (spazi ai bordi rimossi), `quantityGrams` e `kcal` sono
obbligatori. `kcal` indica il TOTALE per la quantità consumata, non per 100 g.
Si crea un food manuale nel catalogo condiviso, con `createdBy` dalla sessione
ed energia normalizzata `round(kcal * 100 / quantityGrams)`. La voce conserva
le kcal totali fornite, senza deriva dovuta all'arrotondamento del catalogo.
Food e voce sono inseriti nella stessa transazione: nessun food orfano in caso
di fallimento. Non viene deduplicato automaticamente per nome.

Ricetta del mirror locale:

```json
{"date":"2026-10-01","slot":"Dinner","entryType":"recipe","recipeId":"bbbbbbbb-1111-4111-8111-111111111111","servings":1.5}
```

`recipeId` deve esistere e `servings` è obbligatorio. Kcal della voce =
`round(recipe.kcalPerServing * servings)`; se il mirror non ha kcal, resta
`null` (non zero). Non si divide per il numero di porzioni della ricetta.
Quantità/porzioni: numeri positivi, max 999999.99, max due decimali per rispettare
`numeric(8,2)` senza arrotondamenti silenziosi. Kcal: intero da 0 a 2147483647;
anche valori derivati fuori dal range DB producono 400 prima di inserire dati.

## Risposte

- 201: `{ "entry": { ... } }`, riga creata con UUID, `userId`, `source: "manual"`,
  kcal totali e riferimenti locali. Come in Drizzle, `quantityGrams`/`servings`
  nella risposta POST sono stringhe decimali o null.
- 401: `{ "error": "Autenticazione richiesta." }`, prima del parsing e del DB.
- 400: `{ "error": "..." }`, messaggio leggibile in italiano per JSON invalido,
  data/slot/tipo/campi invalidi o alimento/ricetta non trovato.
- 500: `{ "error": "Non è stato possibile salvare la voce. Riprova." }`, nessun
  dettaglio DB/auth/upstream grezzo nella risposta.

`GET /api/v1/diary?month=YYYY-MM` restituisce subito la voce, solo al suo utente;
la proiezione GET converte quantità/porzioni in numeri. Le kcal dei record
manuali sono già totali. Per compatibilità col sync esistente, SOLO le voci
`norish_sync` di tipo recipe hanno uno snapshot DB kcal per porzione, che il
feed moltiplica per `servings`. Nessuna migrazione o modifica al runner sync.

## Verifica e limiti

TDD con PGlite sulle migrazioni reali, senza API reali: food per ID, food inline,
recipe con porzioni frazionarie, null kcal, isolamento utenti, guard 401,
validazione 400, riferimenti mancanti, overflow, rollback transazionale e
visibilità in GET. Test unit verificano errori sanitizzati e wiring route.

```sh
pnpm test:unit
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/diary-create.test.ts --hookTimeout=600000
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/diary-feed.test.ts --hookTimeout=600000
```

In sandbox i file integration si verificano singolarmente per evitare i timeout
PGlite cross-file noti; CI mantiene la suite normale. La UI di aggiunta/modifica
e sync on-demand sono documentati in `docs/DIARY-UI.md`; PATCH/DELETE sono descritti in
`docs/DIARY-MUTATE.md`.

## Aggiornamento ed eliminazione (v1, solo voci manual)

`PATCH /api/v1/diary/:id` e `DELETE /api/v1/diary/:id` seguono lo stesso
pattern della creazione: sessione Better Auth obbligatoria (401 prima del
parsing e del DB), `Content-Type: application/json` per il PATCH, messaggi
d'errore in italiano, nessun dettaglio grezzo. Entrambi sono scoped
per-utente: una voce inesistente, un id malformato o una voce di un altro
utente rispondono tutti 404 `{ "error": "Voce non trovata." }` senza
rivelarne l'esistenza.

`docs/DIARY-MUTATE.md` descrive payload, ricalcolo kcal e protezione del sync.

Codice, test e documentazione generati con assistenza AI dall'agente sviluppatore.
Le specifiche e la semantica kcal sono fornite dal Technical Lead; la revisione
umana della PR resta necessaria prima del rilascio (non dichiarata già eseguita).
