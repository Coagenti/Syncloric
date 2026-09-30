# Configurazione runtime

## URL Norish: Impostazioni (via preferita) oppure .env

Non esiste alcun URL di default. Un amministratore autenticato può aprire
Impostazioni (`/settings`), inserire l'URL HTTPS completo della propria
istanza nel campo Norish URL e premere Salva.
Il placeholder `your norish url` è soltanto un suggerimento: non è un valore
precompilato né un indirizzo valido da salvare. Il valore è globale per istanza
ed è persistito nel database in `admin_settings['norish.base_url']`;
ricaricare la pagina o riaprire il database non lo cancella.

In alternativa, impostare nel file `.env` di sviluppo:

Assegnare a `NORISH_BASE_URL` l'origine HTTPS reale (senza slash finale).
Nessun host di esempio è un valore di default.

Next.js carica il file nel proprio ambiente. Nei deploy Compose usare
`docker/.env` con `--env-file` (vedi README). Non è necessario ricostruire
l'immagine. Il loader applicativo valida l'ambiente ricevuto, non legge il
file direttamente. La shell esportata ha precedenza sul file Compose.

La risoluzione della configurazione usa:

1. URL valido salvato da Impostazioni (override DB passato al resolver);
2. `NORISH_BASE_URL` dall'ambiente;
3. nessun URL (`source: unset`, `enabled: false`).

Salvare il campo vuoto o premere Cancella elimina l'override e ripristina
l'eventuale valore .env. Per non avere alcun URL, eliminare anche la variabile
oppure lasciarla vuota. Il campo GUI non mostra il valore env: mostra soltanto
la fonte `Configurato da: .env` o `Configurato da: Impostazioni`.
Senza entrambe le fonti, mostra `Norish non configurato` senza crash.

Usare HTTPS (HTTP solo su localhost per sviluppo), schema e authority
espliciti, senza slash finale sull'host radice. Gli spazi esterni sono rimossi.
Un valore env esplicitamente malformato resta un errore di bootstrap;
un input GUI invalido non modifica il DB. Nessuna verifica di raggiungibilità
è implicita nel salvataggio. Al cambio origine compare un avviso di verifica
delle chiavi Norish: nessuna migrazione automatica delle credenziali.
L'API key non si configura in questo campo e non è restituita dalla settings API.

## Bootstrap e limiti dell'integrazione

`register()` in `src/instrumentation.ts` valida `DATABASE_URL`,
`BETTER_AUTH_SECRET` ed `ENCRYPTION_KEY` prima di migrazioni e scheduler.
Queste variabili restano obbligatorie. La decisione utente/TL sulle card
`t_797de62f` e `t_2bd5557f` supera la precedente prescrizione ADR-0007 di
fail-fast sull'URL assente: `NORISH_BASE_URL` assente/vuota/spazi non impedisce
l'avvio; lo scheduler si avvia dopo il tentativo di migrazioni, ma ogni tick
salta il sync quando non c'è un URL effettivo. Se le migrazioni non sono
applicate, il tick esce con log senza run né egress.
Il template `docker/docker-compose.yml` è allineato: usa
`${NORISH_BASE_URL-}`, senza default e senza URL incorporati. Con `--env-file`
il valore assente o vuoto è passato come stringa vuota; `docker/entrypoint.sh`
rimuove la variabile vuota o composta solo da spazi prima del bootstrap.
Il loader resta responsabile della validazione: un URL esplicito malformato
non è normalizzato a unset e continua a impedire l'avvio. Non occorre inserire
un URL fittizio per avviare lo stack senza Norish. Le altre variabili obbligatorie
restano richieste da Compose e dal bootstrap.

Il tick legge `admin_settings['norish.base_url']` e risolve GUI > env > unset
prima di selezionare utenti o avviare run. Un URL GUI-only attiva il sync al
tick successivo (massimo 30 minuti); un cambio host cambia il target del tick
successivo; svuotare/cancellare disabilita in assenza di env. Un override
malformato viene ignorato in favore della env. Il runner riceve l'URL risolto:
il client non accede alle settings. Un 401/403 registra `status=error` e
`reason=auth`, senza retry o modifica delle credenziali; rete/5xx sono errori
generici. La UI può leggere l'ultima run lato server (l'avviso in pagina è
oggetto di una card separata).

L'ambiente è cached per processo: una modifica .env richiede riavvio del server;
con Compose usare `up -d --no-build`, non `restart` (conserva il vecchio env).
`resetEnvConfigCache()` è riservato ai test. Build e runtime non-Node non
eseguono il bootstrap; si può costruire l'immagine senza segreti di deployment.

## Test riproducibili

- `python3 tests/deploy/test_packaging.py`: contratto template senza default/URL
  incorporati ed entrypoint reale (assente, vuoto, spazi, esplicito preservato).
- `python3 tests/deploy/smoke.py` (Docker): config senza warning e stack healthy
  senza URL/con URL valido, cinque deployment sulla stessa immagine e log
  `Norish disabilitato` nei casi senza URL; nessuna API upstream reale.
- `pnpm test:unit`: vero file .env temporaneo tramite dotenv, URL presente,
  assente e vuoto, precedenza GUI e bootstrap sempre attivo con gating nel tick.
- `pnpm test:integration`: API admin-only, persistenza DB e rimozione override.
- `pnpm exec playwright install chromium` e `pnpm test:settings-browser`:
  componente React reale, handler HTTP reali, PGlite su disco; salvataggio,
  riapertura DB, reload, GUI > env, fallback e stato unset senza errori browser.

Il browser harness inietta una sessione admin: non copre il login Better Auth,
la pagina Next completa o il sync. Non effettua chiamate all'upstream.
Dettagli API: [NORISH-SETTINGS.md](NORISH-SETTINGS.md).

## Provenienza

Test e aggiornamenti documentali generati con assistenza AI (Hermes).
Contributo umano documentato: requisiti utente e decisioni del Technical Lead
su autorizzazione, persistenza e contratto API. Review e merge finale umano
non sono dichiarati già effettuati.
