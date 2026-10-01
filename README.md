# Syncloric

Webapp self-hosted per il conteggio calorie (stile Yazio), integrata con le API di
norish per importare in automatico i pasti segnati sul calendario e le kcal associate.

Dashboard moderna in stile cyberpunk (palette Cyberpunk 2077), mobile-first.

## Stato del progetto

Scheletro del codebase attivo (task `t_3899c9f8`): struttura `src/` (app shell,
server backend, servizi), schema DB con migrazioni versionate (Drizzle), auth
(Better Auth), Dockerfile/docker-compose per il self-hosting e pipeline CI minima
(lint + typecheck + test + build). L'architettura e lo stack tecnico sono definiti
in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Le feature v1 (diario,
dashboard, sync, admin) arrivano nei task dedicati a valere su questo scheletro.

## Requisiti

- Node.js 22 (vedi `.nvmrc`) e pnpm 10 (`corepack enable`)
- PostgreSQL 17 — in sviluppo locale via Docker Compose, oppure un'istanza reachabile
- Docker + Compose per il deploy self-hosted (§ 9)

## Avvio rapido (sviluppo locale)

```bash
corepack enable
pnpm install
cp .env.example .env      # riempi i valori segreti (vedi commenti nel file)
pnpm db:generate          # genera le migrazioni da src/server/db/schema.ts
pnpm db:migrate           # le applica al DATABASE_URL di .env
pnpm dev                  # http://localhost:3000
```

All'avvio il bootstrap (`src/instrumentation.ts`) valida l'env: senza
`DATABASE_URL`, `BETTER_AUTH_SECRET` o `ENCRYPTION_KEY` l'app non parte.
`NORISH_BASE_URL` è opzionale e senza default: l'app avvia lo scheduler
in-process (ADR-0004) dopo le migrazioni; ogni tick salta Norish se l'URL
effettivo non è configurato. Un URL env esplicitamente malformato resta un errore.

## Accessi e ruoli

Apri `/login` per accedere o creare un account con username e password (8–128
caratteri). Non serve SMTP e non viene chiesta un’email: Better Auth conserva un
indirizzo tecnico con username codificato in esadecimale nel dominio `users.invalid`, non un recapito per recupero password.
La registrazione è abilitata; questa versione non espone un interruttore per
chiuderla né un flusso di recupero password via email. Proteggi l’accesso iniziale
all’istanza finché il proprietario non ha creato il primo account.

Il primo utente dell’istanza diventa amministratore; gli altri sono utenti
standard. `/dashboard`, `/diary`, `/calendar` e `/settings` richiedono una sessione
server valida e redirigono a `/login` quando manca. `/login` resta raggiungibile
anche con sessione attiva. La sessione vive in cookie HTTP-only, non in
localStorage; Esci revoca la sessione server e torna al login. I ruoli sono letti
 dal database, senza cookie cache di autorizzazione.

Impostazioni è raggiungibile da tutti gli utenti autenticati: gli utenti standard
vedono «Richiede amministratore», senza valori sensibili o controlli di scrittura.
Le API di configurazione rimangono admin-only (403 per utenti standard). La
chiave Norish è globale per istanza: un errore auth rimanda all’amministratore,
non alla registrazione di una chiave personale. Il segreto si aggiorna solo
nell’ambiente server, mai nella pagina o nel repository.

## Configurare l'URL Norish

Via preferita: un amministratore autenticato apre Impostazioni (`/settings`),
inserisce l'URL HTTPS della propria istanza nel campo Norish URL e preme Salva.
Il placeholder è `your norish url`: non è un valore di default. La GUI non
precompila il valore env. Il valore salvato è globale per istanza e persistente
nel DB, anche dopo ricaricamento o riavvio del database.

In alternativa, nel file `.env` (sviluppo) oppure `docker/.env` (Compose):

Impostare `NORISH_BASE_URL` sull'origine HTTPS effettiva, senza slash finale;
non usare valori di esempio come default di deployment.

La configurazione risolve Impostazioni > .env > nessun URL. Salva con campo
vuoto o Cancella rimuove l'override e ripristina l'eventuale .env. Senza entrambe
le fonti, Norish risulta non configurato senza crash. Usare HTTPS e nessuno
slash finale sull'host; HTTP è ammesso solo su localhost per sviluppo.
La configurazione è modificabile solo dall’admin e non espone API key. Al cambio origine avvisa di
verificare le chiavi Norish, senza migrarle automaticamente.

Lo scheduler risolve GUI > env a ogni tick (ogni 30 minuti): salvare un URL
attiva il sync al tick successivo senza riavvio; cambiare host reindirizza il
successivo; cancellarlo disabilita il sync se non rimane l'env. Senza URL non
registra run né contatta l'upstream. Il client non legge le settings: riceve
l'URL effettivo dal runner. Compose passa URL assente/vuota senza default;
l'entrypoint elimina valori vuoti prima del bootstrap. Dettagli in
[Configurazione runtime](docs/configuration.md) e
[Contratto Impostazioni](docs/NORISH-SETTINGS.md).

Health check: `GET /api/health` (app) e `GET /api/v1/health` (app + database,
pattern norish § 5.1).

## Interfaccia diario (dati reali)

`/dashboard`, `/diary` e `/calendar` leggono `GET /api/v1/diary?month=YYYY-MM`:
la query richiede una sessione Better Auth valida (401 senza cookie) e filtra
`diary_entries` e l'ultima run di sync per l'utente corrente. Non espone chiavi né
messaggi upstream grezzi; la risposta è `private, no-store`. La data «Oggi» è
quella locale del browser; il selettore carica il mese della data scelta. Kcal
Norish sono per porzione, moltiplicate per le porzioni locali per la vista;
le voci senza kcal non entrano nel totale. L'obiettivo viene dal profilo, se presente.

La UI non usa più localStorage o dati dimostrativi. Non offre inserimento/modifica
finché manca un'API di scrittura autenticata: è un limite dichiarato, non un
salvataggio simulato. Se l'ultima run fallisce per autenticazione, la dashboard
mostra l'origine configurata e invita a chiedere all’amministratore di verificare
la chiave globale in Impostazioni; non cambia o cancella credenziali.
L'avviso non è `hostChanged`.

La prova browser auth usa Chromium reale, componenti di produzione, handler
Better Auth reali e PGlite migrato. L’harness HTTP adatta solo headers/redirect
Next: verifica registrazione, cookie persistente, logout/relogin, guard pagine
e Impostazioni non-admin. Non contatta API esterne e non simula sessioni.

L'interfaccia grafica è stata generata con assistenza AI; integrazione e test sono
stati implementati dall'agente sviluppatore. Revisione umana Technical Lead e
Marketing Lead prevista prima del rilascio. I dati non sono consigli nutrizionali.

## Test

```bash
pnpm test:unit          # vitest: config, client norish (fetch mockato), crypto
pnpm test:integration   # vitest + PGlite in-process (Postgres WASM) sulle stesse migrazioni
pnpm test               # entrambi
pnpm build              # prerequisito per i test browser
pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/auth.spec.ts # auth reale, file isolato
```

PGlite non richiede Docker: i test di integrazione girano su un Postgres WASM
in-process con le stesse migrazioni drizzle dell'app. Le suite Playwright
(`tests/e2e/`) verificano i flussi demo reali nel browser (add/edit, errori storage,
selezione date e calendario); usano valori fittizi e non chiamano norish.
Installare Chromium Playwright (`pnpm exec playwright install chromium`) prima
se non è già disponibile. I test E2E di integrazione reale arrivano nei task feature.

## Deploy self-hosted (Docker Compose)

Il template root `.env.example` è dedicato allo sviluppo; per il deploy usare
`docker/.env.example`, che contiene soltanto `NORISH_BASE_URL` (ADR-0007).

```bash
cp docker/.env.example docker/.env
# NORISH_BASE_URL è opzionale: valorizzarla con l'URL assoluto scelto
# oppure ometterla/lasciarla vuota per avviare senza Norish.
# Il deployer fornisce dal vault, in ambiente o nello stesso .env protetto:
# POSTGRES_PASSWORD, BETTER_AUTH_SECRET, ENCRYPTION_KEY e (per sync) NORISH_API_KEY.
# Non riportare il valore della chiave nel README, nei comandi o nei log.
# L'API key del brief originale è revocata: usare soltanto quella corrente dal vault.
chmod 600 docker/.env
export SYNCLORIC_IMAGE=syncloric:release-local
docker compose -f docker/docker-compose.yml --env-file docker/.env -p syncloric-a build app
docker compose -f docker/docker-compose.yml --env-file docker/.env -p syncloric-a up -d --no-build --wait
```

Non creare né conservare credenziali fuori dal vault: il file runtime è materiale
segreto fornito dal deployer, mai da committare. `POSTGRES_PASSWORD` deve essere
URL-safe (ad esempio esadecimale), perché Compose lo interpola nel `DATABASE_URL`
derivato; Better Auth richiede almeno 32 caratteri e `ENCRYPTION_KEY` 64 cifre hex.
Compose passa `NORISH_BASE_URL` senza default (`${NORISH_BASE_URL-}`).
Assente, vuota o composta solo da spazi: l'entrypoint la rimuove prima del
bootstrap, che segnala `Norish disabilitato`; il container può diventare healthy.
Un URL esplicito malformato resta un errore fail-fast del loader applicativo.
Segreti mancanti/vuoti causano un errore Compose con il nome della variabile;
la validazione applicativa rimane nel bootstrap. Non stampare `compose config`
nei log condivisi: contiene i segreti risolti. L'ambiente della shell ha precedenza
sul `.env`: rimuovere eventuali `NORISH_BASE_URL` esportate quando si cambia file.

Per una seconda istanza, preparare `docker/.env.second` dal template, impostare
il nuovo `NORISH_BASE_URL` e fornire dal vault segreti propri per la seconda
istanza. Riutilizzare lo stesso `SYNCLORIC_IMAGE`, senza rebuild:

```bash
APP_PORT=3001 docker compose -f docker/docker-compose.yml --env-file docker/.env.second -p syncloric-b up -d --no-build --wait
```

I project name separano reti e volumi DB. Cambiare upstream richiede soltanto
`NORISH_BASE_URL` e `up -d --no-build` (non `restart`, che conserva l'env precedente);
segreti, porta e nome progetto sono isolamento operativo, non parametri di build.
Per host diversi, trasferire l'immagine con `docker save`/`docker load` oppure
pubblicarla nel registry autorizzato e fissare `SYNCLORIC_IMAGE` al suo digest.
Non eseguire `down --volumes` su deployment con dati da preservare.

CI esegue `python3 tests/deploy/test_packaging.py` e `python3 tests/deploy/smoke.py`:
una build, cinque `.env` temporanei (URL assente, vuoto, soli spazi e due URL
validi), nessun warning di interpolazione, log `Norish disabilitato` senza URL,
identità immagine, ambiente runtime, utente non-root, health app/DB e rifiuto
dei segreti obbligatori assenti/vuoti. Lo smoke crea
e distrugge esclusivamente progetti CI temporanei, senza chiamare norish.
Il collaudo infrastrutturale e il deploy finale restano su pve2, a cura del
responsabile infrastruttura dopo consegna di `syncloric-test`; la CI non lo sostituisce.

L'immagine è Next standalone su `node:22.20.0-bookworm-slim` (§ 3): al bootstrap applica le
migrazioni e avvia lo scheduler. Un deployment Compose = un'istanza Syncloric
completa (§ 9.1), con il suo DB e i suoi segreti (`ENCRYPTION_KEY`/`BETTER_AUTH_SECRET`
unici per istanza — § 9.4). La base URL dell'istanza norish upstream è configurazione
di deployment (`NORISH_BASE_URL`, ADR-0007 — niente host cablati nel codice).

## Istanze / Ambienti

- **Istanza di test corrente:** [norish.coagenti.it](https://norish.coagenti.it)
  è utilizzabile **solo in lettura: è vietato creare, modificare o cancellare dati
  su norish**, anche durante test, demo o collaudi. L'import legge i dati upstream
  e li salva in Syncloric; non autorizza scritture su norish. Il client Syncloric
  espone soltanto `GET /api/v1/**` verso upstream (ADR-0006).
- **Configurabilità e pubblicazione futura:** Syncloric è progettato per essere
  configurabile e pubblicabile su altre istanze self-hosted in futuro, senza
  dipendere dall'host di test. L'URL dell'istanza norish si imposta con
  `NORISH_BASE_URL` (variabile d'ambiente o file di configurazione con gli stessi
  nomi-variabile, ADR-0007): nessun hostname è una costante del codebase.
- Le fixture in `docs/norish-api/` sono snapshot del contratto osservato
  sull'istanza di test in sola lettura, non una configurazione di deploy né un
  endpoint da fissare nel codice. I test che richiedono scritture usano mock,
  fixture o ambienti separati autorizzati, mai l'istanza di test corrente.

## Integrazione con norish

La connessione all'istanza norish configurata avviene via API key. L'API key va
sempre fornita tramite variabile d'ambiente (`NORISH_API_KEY`, bootstrap/demo
dell'istanza § 5.4) o come chiave per-utente salvata cifrata (AES-256-GCM, § 6.2) —
sempre **mai committata nel repository**. Il `.gitignore` esclude i file `.env*`
(ad eccezione di `.env.example`): nessun valore reale finisce nel repo.

Per il trigger manuale, applicare prima `pnpm db:migrate` e poi
`pnpm sync:norish --user <uuid> [--period week|month]` con `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` e `NORISH_API_KEY` dall'env sicuro
(oppure chiave cifrata per-utente). Il comando usa l'URL GUI > env della run;
`month` è il backfill esplicito, `week` è l'incrementale (settimana server +
oggi). Non passare chiavi in argv. Il primo account è il solo destinatario del
fallback demo `NORISH_API_KEY`; gli altri richiedono chiavi per-utente. Le run
sono auditabili in `norish_sync_runs` (`status`, `reason='auth'` su 401/403),
senza modifiche automatiche alle credenziali.

## Limiti noti del flusso utente (t_ee2705d5, per la review)

- **Riassociazione chiave utente:** l'avviso di errore auth invita alla pagina
  Impostazioni, ma l'unico flusso chiave attuale è la `NORISH_API_KEY` fallback
  demo del primo account (env/vault) e la pagina Impostazioni è admin-only con
  solo il campo URL. L'aggiornamento della chiave **per-utente** dall'interfaccia
  non esiste ancora: è il seguito richiesto al flusso auth (card dedicate).
- **Login/registrazione:** il backend Better Auth e `/api/auth` esistono, ma la
  pagina `/login` e il bootstrap del primo admin sono scope della feature auth:
  l'invito al login della UI resta finché quella pagina non viene consegnata.
- **Inserimento/modifica manuale:** disattivato nella UI finché non esiste
  un'endpoint di scrittura autenticato (i controlli demo sono rimossi, non
  simulati); il sync Norish resta l'unica fonte attiva di voci del diario.

## Sviluppo

- Architettura e decisioni di stack: `docs/ARCHITECTURE.md` (§ 3 struttura, § 4
  modello dati, § 5 integrazione norish, § 9 deployment)
- Il codice arriva tramite branch e pull request, senza merge diretti su main
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) e CI su ogni PR
  (`pnpm lint` → `pnpm typecheck` → `pnpm test:unit` → `pnpm test:integration` →
  `pnpm build`, § 8)