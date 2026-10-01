# Norish URL: pagina Impostazioni

Solo un amministratore autenticato può leggere o modificare la configurazione via
`/api/v1/settings/norish-url`. `/settings` richiede una sessione, ma risponde anche
agli utenti standard con «Richiede amministratore», senza valori o input di modifica.
URL e chiave API sono globali per l’istanza: nessuna chiave personale da riassociare
(decisione TL card t_ded2dd56).

Il campo `Norish URL` non precompila il valore da ambiente e usa il placeholder
`your norish url`. Incolla un URL completo HTTPS senza slash finale (HTTP ammesso
solo su localhost per sviluppo), poi premi Salva. Un input non valido restituisce
un messaggio comprensibile senza modificare il valore persistente.

Il valore salvato in `admin_settings['norish.base_url']` sopravvive al riavvio.
La precedenza è Impostazioni > `NORISH_BASE_URL` da ambiente > nessun URL.
Salvare il campo vuoto oppure premere Cancella elimina l'override: l'eventuale
valore da `.env` torna effettivo. Non c'è un URL di default.

Salva e Cancella mostrano conferma e aggiornano l'indicazione della fonte. Se
cambia l'origine effettiva (protocollo + host + porta), compare
`URL aggiornato: verifica le tue chiavi Norish`. La credenziale globale NON
viene migrata o cancellata. L'API key non è mai inclusa nei payload della pagina
né dell'API. In caso di errore auth, SyncNotice rimanda tutti a Impostazioni:
l’utente standard chiede all’amministratore di verificare la configurazione;
solo il responsabile del server aggiorna il segreto nell’ambiente.

## Contratto HTTP

GET 200: `{saved: string|null, status: {enabled, source, urlPresent, apiKeyPresent}}`.
PUT `{url: string}` e DELETE: payload GET più `saved_ok: true` e `hostChanged`.
401 per sessione assente, 403 per ruolo diverso da `admin`, 400 JSON malformato,
422 input non valido. PUT vuoto equivale a DELETE. Nessuna migrazione DB nuova.

## Verifiche riproducibili

- `pnpm typecheck`
- `pnpm exec eslint . --max-warnings=0`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm exec playwright install chromium` (una volta in locale)
- `pnpm test:settings-browser`
- `pnpm build` (nel worktree usare `pnpm exec next build --webpack`)

Il test browser usa Chromium, il componente React reale, gli handler HTTP reali
con sessione admin iniettata e PGlite su disco. Verifica validazione, salvataggio,
avviso, chiusura/riapertura DB, ricaricamento, cancellazione e fallback env.
Non simula le risposte API. Il login Better Auth e l'hosting Next non sono parte
del browser harness: i controlli di autorizzazione pagina/API sono testati
separatamente. Nessuna chiamata a Norish live o a sistemi di produzione.
La card downstream t_c525eeb7 completa documentazione README e verifica integrata.

## Provenienza

Implementazione e test generati con assistenza AI (Hermes). Contributo umano
registrato: requisiti utente e decisioni di autorizzazione/API/persistenza del
Technical Lead. La review e l'eventuale merge umano restano da svolgere; non
vengono dichiarati già avvenuti.
