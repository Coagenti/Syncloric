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

All'avvio il bootstrap (`src/instrumentation.ts`) valida l'env (**fail fast**:
senza `NORISH_BASE_URL`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`
l'app non parte) e avvia lo scheduler in-process (sync norish ogni 30 minuti,
ADR-0004).

Health check: `GET /api/health` (app) e `GET /api/v1/health` (app + database,
pattern norish § 5.1).

## Interfaccia diario (demo locale)

Apri `/dashboard` (oppure `/`, che reindirizza alla dashboard), `/diary` e
`/calendar`. Le tre viste sono mobile-first: totale kcal note e riepilogo dei
quattro pasti, registro giornaliero con aggiunta/modifica manuale, calendario
con i pasti marcati come importati. Seleziona il 29 settembre 2026 per vedere
il set completo di dati dimostrativi; altri giorni contengono esempi limitati o
nessuna voce. L'obiettivo calorico resta non configurato: non sono mostrate
kcal residue finché il profilo reale non fornisce un target.

**Questa UI non è ancora connessa all'API/DB:** dati importati e manuali sono mock,
nessun pulsante esegue una sincronizzazione con norish. Le modifiche manuali si
salvano esclusivamente nel `localStorage` di questo browser (`syncloric-demo-diary-v1`),
non sono multiutente né sincronizzate: possono andare perse cancellando i dati del
browser. Non usare la demo come diario affidabile. L'integrazione reale e la
protezione dei dati tramite sessione sono demandate al task `t_ee2705d5`.

L'interfaccia grafica e i testi di demo sono stati generati con assistenza AI;
la revisione umana del Technical Lead e del Marketing Lead è prevista prima del
rilascio. I dati di esempio non rappresentano consigli nutrizionali.

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

```bash
cd docker/
cat > .env <<'EOF'
POSTGRES_PASSWORD=<password-db>
BETTER_AUTH_SECRET=<openssl rand -base64 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
NORISH_BASE_URL=https://norish.coagenti.it
EOF
docker compose up -d --build
```

L'immagine è Next standalone su `node:22-slim` (§ 3): al bootstrap applica le
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