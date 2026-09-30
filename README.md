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
`NORISH_BASE_URL` è opzionale e senza default: se assente o vuota l'app parte
con Norish disabilitato e scheduler non avviato; un URL esplicitamente malformato
resta un errore. Con URL env valido avvia lo scheduler in-process (ADR-0004).

## Configurare l'URL Norish

Via preferita: un amministratore autenticato apre Impostazioni (`/settings`),
inserisce `https://norish.your.domain` nel campo Norish URL e preme Salva.
Il placeholder è `your norish url`: non è un valore di default. La GUI non
precompila il valore env. Il valore salvato è globale per istanza e persistente
nel DB, anche dopo ricaricamento o riavvio del database.

In alternativa, nel file `.env` (sviluppo) oppure `docker/.env` (Compose):

```dotenv
NORISH_BASE_URL=https://norish.your.domain
```

La configurazione risolve Impostazioni > .env > nessun URL. Salva con campo
vuoto o Cancella rimuove l'override e ripristina l'eventuale .env. Senza entrambe
le fonti, Norish risulta non configurato senza crash. Usare HTTPS e nessuno
slash finale sull'host; HTTP è ammesso solo su localhost per sviluppo.
La pagina è admin-only e non espone API key. Al cambio origine avvisa di
verificare le chiavi Norish, senza migrarle automaticamente.

Limite runtime attuale: il bootstrap avvia lo scheduler dalla sola env e il
client non legge ancora l'override DB. Persistenza GUI e precedenza del resolver
non dimostrano l'attivazione del sync tramite GUI: il collegamento runtime
rimane lavoro dell'integrazione. Dettagli e limiti in
[Configurazione runtime](docs/configuration.md) e
[Contratto Impostazioni](docs/NORISH-SETTINGS.md).

Health check: `GET /api/health` (app) e `GET /api/v1/health` (app + database,
pattern norish § 5.1).

## Test

```bash
pnpm test:unit          # vitest: config, client norish (fetch mockato), crypto
pnpm test:integration   # vitest + PGlite in-process (Postgres WASM) sulle stesse migrazioni
pnpm test               # entrambi
```

PGlite non richiede Docker: i test di integrazione girano su un Postgres WASM
in-process con le stesse migrazioni drizzle dell'app. Le suite Playwright
(`tests/e2e/`) sono previste per i flussi critici (money-path) nei task feature.

## Deploy self-hosted (Docker Compose)

Il template root `.env.example` è dedicato allo sviluppo; per il deploy usare
`docker/.env.example`, che contiene soltanto `NORISH_BASE_URL` (ADR-0007).

```bash
cp docker/.env.example docker/.env
# NORISH_BASE_URL è opzionale: valorizzarla con l'URL assoluto scelto
# oppure ometterla/lasciarla vuota per avviare senza Norish.
# Il deployer fornisce dal vault, in ambiente o nello stesso .env protetto:
# POSTGRES_PASSWORD, BETTER_AUTH_SECRET, ENCRYPTION_KEY.
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

## Sviluppo

- Architettura e decisioni di stack: `docs/ARCHITECTURE.md` (§ 3 struttura, § 4
  modello dati, § 5 integrazione norish, § 9 deployment)
- Il codice arriva tramite branch e pull request, senza merge diretti su main
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) e CI su ogni PR
  (`pnpm lint` → `pnpm typecheck` → `pnpm test:unit` → `pnpm test:integration` →
  `pnpm build`, § 8)