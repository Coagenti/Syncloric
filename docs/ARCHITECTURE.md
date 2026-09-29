# Syncloric — Architettura & Stack Tecnico

> Webapp self-hosted per il conteggio calorie (stile Yazio), mobile-first, integrata
> con le API di norish.coagenti.it per l'import automatico dei pasti del calendario
> e delle kcal associate.
>
> Stato: v1.0 — documento di fondazione, committato prima del codebase init.
> Autore: Technical Lead · Data: 2026-09-29 · Repo: `Coagenti/Syncloric`
>
> Fixture dell'API upstream verificate il 2026-09-29 e archiviate in
> `docs/norish-api/` (OpenAPI live + ricetta di esempio): usale come base per i
> contract test del client.

---

## 1. Scopo e vincoli di design

Syncloric fa da **diario calorie** per singoli utenti di un'istanza self-hosted, e
importa automaticamente i pasti già pianificati su **norish** in modo che
l'utente non debba ricominciare ogni giorno il tracking da zero.

Vincoli che modellano l'architettura:

| Vincolo | Conseguenza di design |
| --- | --- |
| Self-hosted su Docker Compose, nuclei piccoli di utenti (decine, non migliaia) | Monolite modulare, 2 container (app + PostgreSQL), nessuna orchestrazione complessa |
| Nessun sendmail configurato | Registrazione con username+password senza verifica email (Better Auth) |
| Multi-user reale ma a nuclei piccoli | Auth multiutente per singolo, nessun tenancy complesso; ogni utente collega la propria chiave API norish |
| Mobile-first, dashboard cyberpunk (palette Cyberpunk 2077) | Next.js + Tailwind CSS v4 mobile-first, design token dedicati |
| Integrazione con l'istanza norish via API key | Client REST su contratto verificato (vedi § 5), chiavi per-utente cifrate |
| Grafica: GPT-6-SOL a Ultra HIGH effort (vincolo del brief) | La UI non è in scope di questo documento: vedi § 9.1 |
| Segreti: nessuna chiave nel repo | Tutte le credenziali via variabili d'ambiente / segreti Compose |

**Nota AGPL**: norish è rilasciato in AGPL-3.0. Syncloric **non forka il codice di
norish**: lo consuma esclusivamente via API REST remoto, quindi non deriva obbligo
copyleft su Syncloric. Se in futuro si copiassero porzioni di codice dai pacchetti
`norish-*`, Syncloric diverrebbe a tutti gli effetti AGPL-3.0 — decisione da ADR dedicata.

---

## 2. Stack tecnico scelto (ADR-0001)

| Livello | Scelta | Motivazione |
| --- | --- | --- |
| Runtime | **Node.js 22 + TypeScript (strict)** | Stesso standard dell'ecosistema norish; un solo linguaggio su tutto lo stack; TS strict evita le regressioni più costose |
| Framework | **Next.js 16 (App Router) monolitico** | Frontend e backend API nello stesso processo: deploy Compose a 2 container totali; React 19 per la UI; API route handlers per il backend |
| UI | **Tailwind CSS v4 + HeroUI v3 + TanStack Query 5** | Coerenza con lo stack norish (il team conosce gli stessi tool); Tailwind per il theming cyberpunk; TanStack Query per cache e stato server |
| ORM/DB | **PostgreSQL 17 + Drizzle ORM** (drizzle-kit per le migrazioni) | JSONB per gli snapshot d'import, vincoli e indici dichiarati in TS, migrazioni versionate; stesso combo di norish |
| Auth | **Better Auth (username+password senza email)** | Stessa libreria di norish; plugin `username`, session cookie httpOnly; plugin `admin` per i ruoli; nessuna dipendenza da SMTP |
| AI (fornitore configurabile) | OpenAI / Anthropic / Ollama tramite un unico modulo `ai/runtime` | Stessa filosofia di norish (ADR-0015): un unico modulo che parla col modello, prompt amministrabili, nessun provider hard-coded nel feature code |
| Test | Vitest (unit+integration) + Playwright (e2e) | Standard TS; vitest per il client norish con fetch mockato; Playwright per il flusso import → dashboard |
| CI | GitHub Actions | Lint + typecheck + test + build su ogni PR; main protetto |
| Scheduler | node-cron in-process | Sync ogni 30 min per utente; Redis/BullMQ NON in v1 (vedi ADR-0004) |

### Alternative valutate e scartate

- **SQLite al posto di PostgreSQL.** Deploy più leggero (1 container), ma: JSONB assente
  (snapshot import come TEXT non interrogabile), concorrenza di scrittura peggiore per lo
  scheduler che gira insieme all'app, e disallineamento con l'ecosistema norish. Scartato:
  il costo di un secondo container Compose è minimo rispetto al beneficio.
- **Frontend separato (React/Vite SPA) + backend Fastify/NestJS.** Separazione pulita ma
  raddoppia build, test, e pipeline per una webapp di piccole dimensioni; il team avrebbe
  due CI da mantenere. Un monolite Next.js modulare (con la business logic in
  `src/server/**`, non nei componenti) copre la stessa separazione logica a costo zero.
  Trigger di revisione (revisit): se Syncloric dovesse avere un secondo client nativo
  (es. app Expo), separare l'API diventa giustificato.
- **Redis + BullMQ per lo scheduling.** Giustificato con code pesanti (batch AI), oggi
  sovradimensionato per un sync che tocca 1-2 endpoint ogni 30 min. node-cron in-process
  con lock advisory su Postgres (audit in `norish_sync_runs`, § 4.6) è sufficiente
  a nuclei piccoli.
  Revisit: oltre ~50 utenti con sync attivo, o se entra l'elaborazione batch AI.
- **Supabase/Firebase come BaaS.** Contraddice il requisito self-hosted puro.

---

## 3. Struttura del progetto

```
syncloric/
├── README.md                      # avvio rapido, deploy, variabili d'ambiente
├── docs/
│   ├── ARCHITECTURE.md            # questo documento
│   └── adr/                       # decisioni evolutive future (ADR-000X separati)
├── docker/
│   ├── Dockerfile                 # multi-stage: deps → build → runner (node:22-slim)
│   └── docker-compose.yml         # app + postgres + volumi + healthcheck
├── src/
│   ├── app/                       # Next.js App Router (UI, mobile-first)
│   │   ├── (auth)/login/ | (auth)/register/
│   │   ├── (app)/dashboard/       # anello kcal, macro per pasto
│   │   ├── (app)/diary/           # registro pasti per data + modifica manuale
│   │   ├── (app)/calendar/        # vista calendario (giorni + pasti importati)
│   │   ├── (app)/foods/           # DB cibi: ricerca, barcode, nuovo cibo
│   │   ├── (app)/settings/        # profilo, obiettivo, chiave norish personale
│   │   ├── (app)/admin/           # pannello amministrazione (solo role=admin)
│   │   └── api/
│   │       ├── auth/[...all]/     # Better Auth route handler
│   │       └── v1/                # API REST di Syncloric (stesso pattern di norish!)
│   ├── server/                    # backend: nessun import di UI qui dentro
│   │   ├── db/
│   │   │   ├── schema.ts          # modello dati (§ 4)
│   │   │   ├── migrate.ts         # runner drizzle-kit
│   │   │   └── repositories/      # query isolate (pattern norish: niente query nei router)
│   │   ├── services/
│   │   │   ├── norish/            # client API + sync engine (§ 5)
│   │   │   ├── ai/                # runtime AI provider-agnostic (ADR-0003)
│   │   │   ├── foods/             # lookup barcode OPEN FOOD FACTS + creazione cibi
│   │   │   └── calorie-target/    # calcolo obiettivo calorico (§ 4.3)
│   │   └── config/                # env parsing (zod), settings admin caricati a cache
│   ├── components/                # componenti UI (ui/, charts/, forms/)
│   └── lib/                       # utility pure condivise (date, validazione)
├── tests/
│   ├── unit/                      # vitest: client norish con fetch mockato
│   ├── integration/               # vitest + Postgres di test (docker compose test)
│   └── e2e/                       # Playwright: import → dashboard
└── .github/workflows/ci.yml       # lint, typecheck, test, build
```

Regole di confine:

1. I componenti UI non accedono mai direttamente al DB: passano dai route handler
   `/api/v1/**` o dai services server-side (Server Actions) — il confine è il modulo.
2. L'accesso al DB passa sempre dai repositories (stesso pattern di norish).
3. `services/ai/` è l'unico modulo che parla con un provider di modelli (ADR-0003).
4. Niente segreti nel repo: `.env.example` documenta, `.env` è git-ignored.

---

## 4. Modello dati minimo

Sintesi drizzle-style; i tipi esatti evolvono nello scheletro. `uuid` PK ovunque,
timestamp `created_at/updated_at` standard tralasciati per brevità.

### 4.1 Utenti e auth (libreria Better Auth: tabelle standard)

```
users            id, username (unique), email (non verificata, display only), name,
                 role ('user' | 'admin'), created_at
sessions/accounts  (standard Better Auth, session cookie httpOnly)
```

Il primo utente registrato su un'istanza vuota diventa `role='admin'` (bootstrap
dell'amministrazione, senza canali email). Gli admin possono promuovere/demotionare
ruoli dal pannello admin.

### 4.2 Profilo e obiettivo calorico

```
profiles         user_id FK UNIQUE,
                 sex ('f'|'m'), height_cm, weight_kg, birth_year,
                 activity_level ('sedentary'|'light'|'moderate'|'active'|'very_active'),
                 goal ('lose'|'maintain'|'gain'),
                 target_source ('manual'|'calculated'),
                 manual_target_kcal INTEGER NULL,          -- usato se target_source='manual'
                 calculated_target_kcal INTEGER NULL,       -- cache del calcolo (§ 4.3)
                 recalculated_at TIMESTAMP NULL
```

### 4.3 Calcolo del target calorico (formula documentata)

1. **BMR** con Mifflin-St Jeor: `10*kg + 6.25*cm − 5*età + 5 (m) / −161 (f)`
2. **TDEE** = BMR × fattore attività (1.2 / 1.375 / 1.55 / 1.725 / 1.9)
3. **Per obiettivo**: `lose` → TDEE − 500 kcal al giorno (con perdita stimata ~0.5
   kg/settimana), `maintain` → TDEE, `gain` → TDEE + 300 kcal.
4. **Clamp di sicurezza**: minimo 1 200 kcal (f) / 1 500 kcal (m), calcolato a livello di
   service e mostrato all'utente con la spiegazione del calcolo.
5. L'utente può sovrascrivere qualsiasi valore con `target_source='manual'`.

### 4.4 Cibi e ricette

```
foods            id, name, brand NULL, barcode NULL UNIQUE (quando noto),
                 kcal_per_100g INTEGER, protein_per_100g NUMERIC NULL,
                 fat_per_100g NUMERIC NULL, carbs_per_100g NUMERIC NULL,
                 serving_grams INTEGER NULL, serving_label TEXT NULL,
                 source ('manual'|'barcode_off'|'ai_label'),
                 source_payload JSONB NULL,       -- es. risposta OPEN FOOD FACTS
                 created_by FK users NULL          -- NULL = seed globale dell'istanza
```

Convenzioni: nutrienti **per 100 g/ml** (convenzione etichette UE), quantità
dell'ingestione calcolata proporzionale. Con nuclei piccoli, i cibi sono condivisi
nell'istanza (visible-by-default) con `created_by` per la provenienza — semplice e
utile: un cibo scannerizzato da uno serve a tutti.

```
recipes          id, norish_recipe_id UUID UNIQUE NULL,   -- mirror di una ricetta norish
                 name, servings INTEGER,
                 kcal_per_serving INTEGER NULL,            -- calories dal payload norish
                 protein_per_serving TEXT NULL,            -- nota: norish serializza i macro
                 fat_per_serving TEXT NULL,                -- come stringhe decimali
                 carbs_per_serving TEXT NULL,
                 snapshot JSONB,                           -- payload GET /recipes/{id} completo
                 fetched_at TIMESTAMP
```

Le ricette norish vengono **mirrorate localmente** (snapshot): lo storico del diario
non deve rompersi se una ricetta cambia o viene cancellata su norish, e la dashboard
resta interrogabile con una query locale.

### 4.5 Diario (la tabella centrale)

```
diary_entries    id, user_id FK,
                 date DATE,                                -- giorno del diario
                 slot ENUM('Breakfast','Lunch','Dinner','Snack'),  -- 4 pasti, mapping norish
                 entry_type ENUM('food','recipe'),
                 food_id FK foods NULL,                    -- se entry_type='food'
                 recipe_id FK recipes NULL,                -- se entry_type='recipe'
                 quantity_grams NUMERIC NULL,              -- per food
                 servings NUMERIC NULL,                    -- per recipe
                 kcal INTEGER, protein NUMERIC NULL, fat NUMERIC NULL, carbs NUMERIC NULL,
                     -- macro SNAPSHOTTATI al momento dell'aggiunta: cambi futuri al cibo
                     -- o alla ricetta non riscrivono la storia
                 source ENUM('manual','barcode','ai_label','norish_sync'),
                 norish_item_id UUID NULL UNIQUE,          -- idempotenza sync (§ 5.4)
                 norish_deleted BOOLEAN NOT NULL DEFAULT false,  -- item non più presente su norish (§ 5.4)
                 created_at, updated_at
```

Indici: `(user_id, date)`, unique parziale `(user_id, date, slot, norish_item_id)`,
`foods.barcode`.

### 4.6 Stato sync e configurazione admin

```
norish_sync_runs id, user_id FK, started_at, finished_at NULL,
                 status ('ok'|'error'|'partial'), items_upserted INTEGER,
                 error_message TEXT NULL

admin_settings   key TEXT PK, value JSONB          -- singleton:
                 # ai.provider ('openai'|'anthropic'|'ollama'), ai.model,
                 # ai.base_url_ollama, ai.api_key (cifrata, vedi § 6),
                 # barcode.lookup_source ('openfoodfacts')
```

---

## 5. Integrazione con norish.coagenti.it

### 5.1 Contratto verificato (giorno della scrittura: 2026-09-29)

Le seguenti informazioni **non sono ipotesi**: provengono dal codice sorgente
upstream di norish (`github.com/norish-recipes/norish`, AGPL-3.0, v0.24.0-beta come
da bundle servito dall'istanza) e da una verifica live con la chiave reale.

- **Base URL**: `https://norish.coagenti.it/api/v1` (fetch handler tRPC→OpenAPI su
  Router `openApiRouter`).
- **Auth**: header `x-api-key` con il valore della chiave (alternativa equivalente:
  `Authorization` con schema Bearer e la stessa chiave); plugin `apiKey` di Better
  Auth con `enableSessionForAPIKeys: true`. Le chiavi si generano da norish in
  *User Settings → API Keys*, una per utente.
- **Rate limit server-side**: 500 richieste/ora per chiave; **nessun header di rate
  limit esposto** nelle risposte (verificato live) → il client applica throttling
  difensivo (§ 5.5).
- **Health** (no auth): `GET /api/v1/health` → 200 JSON.

Operazioni REST montate su `/api/v1` (dal documento OpenAPI live, archiviato nella
repo come `docs/norish-api/openapi-live-2026-09-29.json`):

| Metodo | Path | Operazione | Note per Syncloric |
| --- | --- | --- | --- |
| GET | `/planned-recipes/today` | pasti di oggi | **core sync** |
| GET | `/planned-recipes/week` | settimana corrente (server-side) | **core sync** |
| GET | `/planned-recipes/month` | mese corrente | backfill |
| POST | `/planned-recipes` | crea item pianificato | v1: **non usato** (Syncloric è read-only verso norish) |
| DELETE | `/planned-recipes/{itemId}` | elimina item | non usato in v1 |
| POST | `/recipes/search` | ricerca ricette `{limit 1-200 (def 50), search?, searchFields?, cursor}` | ricerca ricette da Syncloric |
| GET | `/recipes/{id}` | ricetta completa | mirror snapshot (§ 4.4) |
| POST | `/recipes/import/url` · `/recipes/import/paste` | import ricetta da URL/testo | v2 (feature import) |
| GET/POST/PATCH/DELETE | `/groceries**`, `/stores**` | spesa e negozi | v2 (lista della spesa) |

### 5.2 Payload dei pasti (schema live `plannedRecipeListItem`)

```jsonc
GET /api/v1/planned-recipes/{today|week|month}
→ 200 [ {
    "id": "uuid",              <- norish_item_id: chiave d'idempotenza
    "date": "string",          <- data chiave del calendario (formato dataKey upstream: YYYY-MM-DD, fuso del server norish)
    "slot": "Breakfast|Lunch|Dinner|Snack",   <- mapping diretto ai 4 pasti Syncloric
    "sortOrder": int,
    "recipeId": "uuid",
    "version": int,
    "recipeName": "string|null",
    "recipeImage": "string|null",
    "servings": int|null,      <- porzioni pianificate per l'item
    "calories": int|null       <- kcal per porzione della ricetta (semantica verificata sui dati reali: Sachertorte 458 kcal/porzione su servings=8)
} ]
```

Se l'item non ha `calories` (ricette senza dati nutrizionali), Syncloric importa la
voce con kcal NULL e mostra "kcal non definite" invece di inventare un numero.

### 5.3 Dettaglio ricetta (`GET /recipes/{id}`) — mirror

Campi rilevanti: `servings` (intero), `calories` (intero, **kcal per porzione**),
`fat`/`carbs`/`protein` (**stringhe decimali** tipo `"27.40"`, nullable — parsing
`parseFloat` con fallback a NULL), `systemUsed` ('metric'|'us'),
`recipeIngredients[{ingredientName, amount, unit, systemUsed}]`, `steps[]`.
L'intero payload viene salvato in `recipes.snapshot` (JSONB).

### 5.4 Progettazione della sincronizzazione

- **Frequenza**: ogni 30 minuti per utente con chiave configurata (node-cron in-process,
  un job per run, serializzato su Postgres con advisory lock per utente — niente
  Redis). Trigger manuale: bottone "Sincronizza ora" in settings e in dashboard.
- **Finestra**: sync incrementale su rolling 7 giorni (today+week); backfill manuale
  con range month alla prima connessione della chiave.
- **Idempotenza**: ogni item upstream con `id` → upsert su `diary_entries.norish_item_id`
  UNIQUE. Se l'item esiste già: aggiorna `date`, `slot`, `servings`, kcal solo se
  cambiati (no-touch se l'utente ha modificato manualmente la voce: flag
  `source='norish_sync'` si preserva; edit manuale su voce sincronizzata = l'utente
  diventa owner della voce e il sync smette di toccarla).
- **Eliminazioni upstream**: in v1 il sync NON elimina voci (evitiamo di cancellare
  pasti per un glitch dell'API); vinto il compromesso: voci sync orfane (non più nel
  payload) vengono marcate `norish_deleted=true` (colonna addizionale) e mostrate con
  icona "rimossa su norish", rimovibili in massa. Revisit se fastidioso.
- **Multi-utente**: ogni utente configura la **propria** chiave norish (la casa su
  norish è per-user/household). Nel settings utente: input chiave → validate con una
  chiamata reale `GET /planned-recipes/today` → salvataggio cifrato (§ 6).
  La chiave dell'istanza coagenti fornita nel brief va in `NORISH_API_KEY` (env):
  è chiave di bootstrap/demo per l'istanza, mai committata nel repo.

### 5.5 Gestione errori e retry (matrice)

| Condizione | Risposta tipica | Comportamento del client Syncloric |
| --- | --- | --- |
| Credenziali mancanti/invalidi | `401` + envelope `{message, code:'UNAUTHORIZED', data:{path}}` (verificato live, con e senza chiave valida) | stop + stato utente `norish_key_invalid`, la sync non riparte finché l'utente non re-inserisce la chiave; nessun retry (inutile) |
| Ricetta/item inesistente | `404` envelope `NOT_FOUND` (verificato live) | item skippato con log; il batch continua |
| Throttling | atteso `429` (rate limit 500/h, header non esposti) | backoff esponenziale 2s→4s→8s→16s→30s, max 3 retry, poi la sync riprende nel ciclo dopo |
| Degradata | `503 SERVICE_UNAVAILABLE` (schema errore upstream dedicato: "API up ma database/parservice down") | stesso backoff; contatore nel run (`status='partial'`) |
| Conflict/dati | `409 CONFLICT`, `412 PRECONDITION_FAILED` (es. import video senza AI abilitata) | log + surface all'utente in UI (non usato in v1 sync read-only) |
| Rete/timeout | timeout 10 s per richiesta | retry come 429; circuit breaker: 3 sync consecutive fallite → pausa 30 min (stato dedotto da `norish_sync_runs`) |
| Tutto ok | `200` con array (eventualmente `[]`, verificato live) | upsert completi, run `status='ok'` |

Ogni run scrive una riga in `norish_sync_runs` (audit + diagnostics). Log con messaggi
chiari e strutturati (livello, user_id, run_id, fase), mai il valore della chiave.

---

## 6. Sicurezza e segreti

1. **Segreti**: mai nel repo. `.env.example` elenca tutte le variabili; `docker-compose.yml`
   legge da `.env`. Segreti obbligatori: `DATABASE_URL`, `BETTER_AUTH_SECRET`,
   `ENCRYPTION_KEY`, `NORISH_API_KEY` (opzionale, bootstrap dell'istanza coagenti).
2. **Chiavi API norish per-utente**: cifrate a riposo con AES-256-GCM (chiave
   = `ENCRYPTION_KEY`), mai loggate, mai spedite al client dopo il salvataggio,
   testate al momento dell'inserimento con una validazione live.
3. **Sessioni**: cookie Better Auth httpOnly + sameSite lax; password hashing
   scrypt (default Better Auth). Rate limit login nativo della libreria.
4. **Admin**: ruoli Better Auth (`role='admin'`) gate sulle rotte `(app)/admin/**`;
   azioni admin (provider AI, segreti AI) solo da lì.
5. **AI key del provider** (OpenAI/Anthropic): cifrata come le norish key, configurata
   dal pannello admin (globale per l'istanza, come in norish).
6. **Barcode/openfoodfacts**: solo lookup server-side (la UI non parla direttamente
   con l'esterno), caching della risposta (evita rate-limit del servizio pubblico).

---

## 7. Funzionalità v1 (scope concordato dalla scomposizione)

| Feature | Dettaglio design | Task board |
| --- | --- | --- |
| Import pasti norish | § 5.4: scheduler + trigger manuale + mirror ricette | `t_849137b2` |
| Diario e dashboard | anello kcal vs obiettivo, macro per pasto, registro per data | `t_5b35c0e3` · `t_ee2705d5` |
| Vista calendario | import visualizzato per giorno | `t_5b35c0e3` |
| Obiettivo calorico | manuale o calcolato (§ 4.3) | settings |
| Multi-user | registrazioni/login senza email, profilo individuale | `t_3899c9f8` |
| Pannello admin | provider AI, segreti, ruoli | v1.1 (post-scheletro) |
| Barcode scan | camera → OPEN FOOD FACTS → fallback "crea cibo" | v1.1 |
| AI scan etichetta | camera → provider configurato → bozza cibo (§ ADR-0003) | v1.1 |
| Ricette norish in pasti | ricerca `POST /recipes/search` → aggiunta a pasto | v1.1 |

Il barcode/AI scan sono richiesti dal brief originario ma non assegnati a un task
di questa ondata: restano nel design della piattaforma (ADR incluse) e si schedulano
dopo l'E2E `t_ee2705d5`.

---

## 8. Convenzioni di lavoro (branch, PR, test)

- **Branch**: `main` protetto (no push diretti, no force push, PR obbligatoria
  con review del Technical Lead o un maintainer designato). Branching:
  `feat/<id-card>-<slug>`, `fix/<id-card>-<slug>`, `chore/<slug>`.
- **PR**: descrizione con cosa/perché, screenshot per le UI, checklist
  (test aggiunti? segreti toccati? schema DB migrato?)
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`) per generare
  changelog e history leggibile.
- **CI** (GitHub Actions, file `ci.yml`): su ogni PR →
  `pnpm lint` → `pnpm typecheck` → `pnpm test:unit` → `pnpm test:integration`
  (Postgres di test a container) → `pnpm build`
- **Gates di merge**: tutti verdi. Nessun "retry until green": test flaky = quarantine
  immediata + fix.
- **Test pyramid** (target): maggioranza di unit test (services, client norish con HTTP
  mockato, calcolo target calorico, parsing macro), integration limitati alle aree
  critiche (upsert sync con Postgres reale, login/auth, API handlers), e2e Playwright
  solo sui flussi critici (money-path): import norish → dashboard, login/registrazione,
  aggiunta manuale di un cibo.

---

## 9. Decisioni aperte e rischi tracciati

### 9.1 Vincoli in ingresso dal brief, non in scope di questo documento

- **UI cyberpunk / GPT-6-SOL**: il brief richiede la parte grafica realizzata con
  GPT-6-SOL a Ultra HIGH effort (vincolo esplicito, con procedura di block se il
  provider non fosse raggiungibile). L'ARCHITECTURE fornisce la base (tema token Tailwind,
  mobile-first, layout mobile-first); la realizzazione grafica è un task dedicato.
- **Collaborator KorinBlack**: invito in corso (verificato 2026-09-29, permessi write) —
  non dipende da questo documento.

### 9.2 Rischi tecnici tracciati

| Rischio | Mitigazione |
| --- | --- |
| Semantica `date` upstream (fuso server norish) | nel sync si tratta `date` come chiave stringa YYYY-MM-DD, senza ricalcolare fusi; test del client documentato |
| `calories` di item con servings > 1 | semantica "per porzione" verificata su dati reali; test unit con fixture `docs/norish-api/recipe-sample-sachertorte.json` |
| Rate limit opaco (no header) | throttling difensivo + backoff + circuit breaker (§ 5.5) |
| Ricette senza kcal | import con kcal NULL, UI esplicita ("kcal non definite") |
| Fornitore AI raggiungibile | admin può cambiare provider/config senza redeploy (settings DB) |
| norish upstream può cambiare il contratto (app beta, push settimanali) | la repo upstream è pubblica: il client Syncloric ha test di contratto che leggono l'OpenAPI live e li confrontano a una fixture salvata (contract test leggero) |

---

## 10. Riassunto delle decisioni (ADR inline)

| ADR | Decisione | Conseguenze accettate | Revisit quando |
| --- | --- | --- | --- |
| 0001 | Monolite Next.js 16 (App Router) full-stack su Node 22/TS | UI+API in un processo: deploy semplice, ma build unica più lenta | serve un secondo client (app nativa) o il build supera 10 min |
| 0002 | PostgreSQL 17 + Drizzle (non SQLite) | 2 container, ma JSONB + concorrenza + allineamento ecosistema | se l'istanza tipica si riduce a 1-2 utenti senza import AI |
| 0003 | AI via unico modulo `services/ai/runtime` (provider OpenAI/Anthropic/Ollama configurabile da admin) | più layer di una chiamata diretta, ma provider swappable e prompt governati | se solo un provider resterà mai configurato su tutte le istanze |
| 0004 | Scheduler in-process (node-cron) + advisory lock, no Redis in v1 | limiti con many-user/batch AI, ma zero dipendenze extra | >50 utenti sync attivi o job AI batch |
| 0005 | Mirror locale delle ricette norish con snapshot JSONB (+ kcal snapshot nel diario) | duplicazione dati (storia stabile, query locali) | se norish garantisse storia immutabile |
| 0006 | Sync read-only + idempotenza per `norish_item_id` + no-autodelete (voci orfane marcate) | voci orfane restano visibili finché non rimosse a mano | feedback utenti |