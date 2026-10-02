# API diario: aggiornamento ed eliminazione v1 (solo voci manual)

`PATCH /api/v1/diary/:id` e `DELETE /api/v1/diary/:id` completano la scrittura
del diario. Richiedono la sessione Better Auth (cookie, come POST): senza
sessione entrambi rispondono 401 prima di toccare il DB. Il PATCH richiede
`Content-Type: application/json` (anche con charset). Come per la creazione,
nessuna richiesta verso Norish e nessun errore upstream grezzo.

## Ambito e protezione del sync

I due verbi operano SOLO su voci `source='manual'` dell'utente della sessione
(`UPDATE ... WHERE id = :id AND user_id = :user_id`):

- voce di altro utente, voce inesistente o id malformato → 404
  `{ "error": "Voce non trovata." }` — nessuna differenziazione che riveli
  l'esistenza della voce;
- voce `norish_sync` → 403
  `{ "error": "Le voci importate sono gestite dalla sincronizzazione Norish e non possono essere modificate o eliminate." }`
  — le voci importate restano di proprietà del sync, nessuna trasformazione in
  manuale in questa versione;
- voce `barcode`/`ai_label` → 403
  `{ "error": "Puoi modificare o eliminare solo le voci manuali." }` (ambito v1,
  prassi pronta per l'estensione);
- il guard scatta dentro la transazione, prima di qualunque scrittura: la riga
  resta intatta.

## PATCH — campi editabili

```json
{"quantityGrams":125,"kcal":99,"slot":"Snack","date":"2026-09-30"}
```

Payload parziale (`{} → 400`: almeno un campo). Campi accettati:

- comuni: `date` (`YYYY-MM-DD` reale), `slot` (Breakfast, Lunch, Dinner, Snack);
- entryType `food`: `quantityGrams` (positiva, max 999999.99, max due decimali)
  e `kcal` (intero 0..2147483647). Se si cambia `quantityGrams` senza `kcal`, le
  kcal totali si ricalcolano dal catalogo: `round(food.kcalPer100g * grams / 100)`;
  con `kcal` esplicita vale il totale fornito (stessa semantica del POST).
- entryType `recipe`: `servings` (stessa validazione di quantity) con ricalcolo
  `kcal = round(recipe.kcalPerServing * servings)`; se il mirror non ha kcal il
  valore resta `null`. Combinazioni incompatibili col tipo (grammi su ricetta,
  porzioni su alimento, kcal esplicita su ricetta) → 400 con messaggio dedicato.

Campi immutabili rifiutati con 400: `userId`, `source`, `entryType`, `foodId`,
`recipeId`, `norishItemId` (`.strict()`) — mai sovrascritti silenziosamente.
Risposta 200: `{ "entry": { ... } }` con la riga aggiornata; 500 sanitizzato
`{ "error": "Non è stato possibile aggiornare la voce. Riprova." }`.

## DELETE

Nessun body. Esito 200 `{ "ok": true }` dopo l'eliminazione; le stesse regole
404/403 del PATCH. La voce sparisce subito dal feed GET del suo utente.

## Verifica e limiti

TDD file-isolato su PGlite con migrazioni reali, `hookTimeout=600000`
(`tests/integration/diary-mutate.test.ts`, 29 test): patch/delete su voce creata
via POST, patch recipe con kcal ricalcolate, rifiuto sorgenti non manuali,
401/404/400, campi immutabili, id malformati, nessuna mutazione sui rifiuti.

```sh
pnpm exec vitest run --config vitest.integration.config.ts tests/integration/diary-mutate.test.ts --hookTimeout=600000
```

Limite v1: non si possono cambiare food/ricetta di una voce né trasformare una
voce importata in manuale; UI e sync on-demand appartengono alle card successive.

Codice, test e documentazione generati con assistenza AI dall'agente sviluppatore.
Le specifiche sono fornite dal Technical Lead; la revisione umana della PR resta
necessaria prima del rilascio (non dichiarata già eseguita).