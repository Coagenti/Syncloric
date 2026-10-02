# Sync Norish on-demand

`POST /api/v1/sync` sincronizza la settimana Norish esclusivamente per l'utente
identificato dalla sessione Better Auth. Non accetta userId, URL, chiavi o periodo
dal body: il body non viene interpretato. La UI può inviare `{}`.

## Contratto UI

Inviare cookie di sessione e `Content-Type: application/json`. Se `Origin` è
presente deve coincidere esattamente con l'origine della richiesta. I client
non-browser possono ometterlo. Il reverse proxy deve preservare l'origine
pubblica della richiesta; non introdurre bypass tramite header forniti dal client.
Tutte le risposte sono `Cache-Control: private, no-store`.

Una run terminata risponde HTTP 200, anche se Norish ha rifiutato le credenziali:

```json
{
  "status": "ok",
  "reason": null,
  "origin": null,
  "finishedAt": "2026-10-02T00:00:00.000Z"
}
```

L'esempio è illustrativo, non un risultato ottenuto da un upstream reale.
`status` è `ok`, `partial` oppure `error`. `reason` è `auth` solo per errori
Norish HTTP 401/403 (anche nella causa del runner), altrimenti null. Solo per
`auth`, `origin` contiene l'origine Norish risolta, senza path, chiavi o dettagli
upstream. La proiezione è la stessa di `GET /api/v1/diary?...` nel campo `sync`.
La UI usa `SyncNotice` e rilegge il feed dopo il completamento.

Altre risposte sono `{ "error": "messaggio italiano controllato" }`:

- 401: sessione assente (prima di qualunque guard o accesso DB).
- 403: Origin diverso, inclusa origine opaca `null`.
- 400: Content-Type diverso da application/json.
- 503: stesso utente già in sync, oppure sync non disponibile (URL/chiave
  mancanti, chiave inutilizzabile, DB/config non disponibili).

Il messaggio del 503 busy è `Sincronizzazione già in corso.`. Busy e configurazione
non disponibile non creano run fittizie e non cambiano l'ultimo esito del feed.
Una run iniziata salva l'esito in `norish_sync_runs`; gli errori persistiti sono
messaggi controllati, mai testo upstream o segreti. Un guasto della transazione
può rispondere 503 senza audit completato, poiché l'intera transazione rollbacka.

## Configurazione e confini

A ogni richiesta si risolve la configurazione esistente: URL GUI > env, fallback
previsto dal resolver; `NORISH_UPSTREAM_TZ` usa `norishUpstreamTimeZone()` (invalid
→ unset). Nessun nuovo resolver o schema. Le chiavi per-utente restano cifrate;
la chiave demo env è consentita esclusivamente al primo account, come nello
scheduler. Non viene distribuita agli altri utenti. Nessuna chiave viene modificata.

Il runner e il client Norish restano invariati: GET-only (ADR-0006), import/mirror,
porzioni locali, riconciliazione finestre, retry e rollback del runner esistenti.
Nessun POST/PUT/PATCH/DELETE verso Norish. Nessun backfill month o breaker schedulato
aggiunto al contratto manuale.

## Concorrenza

La transazione esterna acquisisce
`pg_try_advisory_xact_lock(hashtext(userId))`. Il namespace coincide con scheduler
e runner: se occupato restituisce 503 senza aspettare il completamento del sync.
Il runner annidato usa la stessa connessione/savepoint e può riacquisire il lock;
il lock della transazione esterna dura fino al commit/rollback, includendo audit.

Un Set per-utente, condiviso dalle istanze handler nel processo, rifiuta subito
le richieste duplicate prima di accedere al DB. È rilasciato in `finally` anche
su errore, ma non sostituisce il lock DB cross-worker. Non esiste un mutex globale:
utenti diversi possono procedere su connessioni diverse. `hashtext` mantiene la
compatibilità col namespace esistente; collisioni hash teoriche possono produrre
un busy conservativo fra utenti diversi. La disponibilità di connessioni nel
pool rimane un limite indipendente dal lock.

## Verifica e provenienza

Test PGlite file-isolati con client HTTP mockato: GUI>env, GET-only, esiti/audit/feed,
401/403 upstream sanitizzati, isolamento chiavi e dati, busy stesso utente,
reconciliation timezone. Guard/sessione e wiring route sono test unitari.
Parallelismo runner di utenti diversi è verificato via dipendenze iniettabili:
PGlite ha una sola connessione e non prova contesa multi-connessione PostgreSQL.
Il ramo busy cross-worker è simulato con `acquireLock=false`; l'SQL reale di
acquisizione è esercitato nel percorso PGlite. Nessuna chiamata reale upstream,
nessun test con segreti o su produzione.

Codice, test e documentazione generati con assistenza AI (Hermes gpt-6.1-sol).
Contributo umano: requisiti, scelte di contratto e autorizzazione alla ripresa su
main/strategia lock del Technical Lead e dell'operatore. Review e merge umani/TL
restano richiesti; non sono dichiarati eseguiti dall'autore AI. Disclosure per
trasparenza ai sensi dell'art. 50 AI Act e L. 132/2025.
