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

## Amministrazione

Il pannello `/settings` presenta Norish, AI, Barcode e Utenti con salvataggi
indipendenti e conferme esplicite. Configurazioni non segrete in `admin_settings`,
chiavi API inseribili da UI e cifrate in DB; nessun provider AI implicito. Restano sempre almeno
un amministratore attivo e un audit delle modifiche (incluse le API Better Auth
native). Impersonation disabilitata. Contratti, precedenza, migrazione e limiti:
[`docs/ADMINISTRATION.md`](docs/ADMINISTRATION.md).

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

Il cambio tra accesso e registrazione porta subito il focus allo username già
presente nel form, senza callback differite che possano sottrarre il focus alla
password mentre si digita. Il test Chromium `tests/e2e/auth.spec.ts` ritarda
esplicitamente un frame e verifica che un successivo focus sulla password sia
preservato, oltre ai flussi reali Better Auth/PGlite di login e registrazione.
Riprodurre con `pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/auth.spec.ts`.

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
dal database, senza cookie cache di autorizzazione. Se il bootstrap del primo
admin fallisce temporaneamente dopo la registrazione, il suo login lo ritenta:
non è necessario registrare un altro account.

Impostazioni è raggiungibile da tutti gli utenti autenticati. Ogni utente può
salvare, sostituire e rimuovere la propria chiave API Norish nella scheda «Il tuo
account Norish». URL Norish, provider/chiavi AI, barcode e utenti restano admin-only.
Un errore auth del sync rimanda alla chiave personale, senza modifiche automatiche.
I segreti sono cifrati sul server e non vengono mai restituiti alle pagine.
Contratto e passaggio dalle vecchie chiavi env: [ADR-0010](docs/adr/0010-user-integrations-ui-credentials.md).

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

## Obiettivo calorico personale

Apri `/profile` dalla CTA «Configura obiettivo» in dashboard. Inserisci sesso per
il calcolo, altezza, peso, anno di nascita, attività e obiettivo (perdita peso,
mantenimento o massa). La preview è calcolata sul server e non salva i dati.
Scegli Calcolato oppure Manuale; in quest'ultimo caso inserisci un numero positivo
di kcal. «Salva profilo» persiste i dati soltanto per il tuo utente. Puoi cambiare
fonte senza creare un secondo profilo; dashboard e feed usano il target selezionato.
Senza profilo il riepilogo non mostra kcal di differenza. I numeri sono informativi,
non prescrizioni nutrizionali. Nessuna nuova variabile d'ambiente o migrazione.
Formula, limiti, API e contributi AI/umani: [ADR-0009](docs/adr/0009-calorie-target.md).

## Interfaccia diario (dati reali)

`/dashboard`, `/diary` e `/calendar` leggono `GET /api/v1/diary?month=YYYY-MM`:
la query richiede una sessione Better Auth valida (401 senza cookie) e filtra
`diary_entries` e l'ultima run di sync per l'utente corrente. Non espone chiavi né
messaggi upstream grezzi; la risposta è `private, no-store`. La data «Oggi» è
quella locale del browser; il selettore carica il mese della data scelta. Kcal
Norish sono per porzione, moltiplicate per le porzioni locali per la vista;
le voci senza kcal non entrano nel totale. L'obiettivo viene dal profilo, se presente.

La UI non usa più localStorage o dati dimostrativi. Le API autenticate
`POST /api/v1/diary` ([contratto](docs/DIARY-WRITES.md)), `PATCH` e
`DELETE /api/v1/diary/:id` ([contratto](docs/DIARY-MUTATE.md)) gestiscono le
voci manuali nel feed. I dialog reali aggiungono food inline/catalogo o ricette
con porzioni, e modificano le sole voci manuali; «Sincronizza ora» invoca
`POST /api/v1/sync`. Catalogo locale e prove browser: [DIARY-UI](docs/DIARY-UI.md).
Il Diario offre anche **Scansiona** per il barcode: codice manuale sempre
disponibile, camera nativa dove supportata, ricerca locale-first + Open Food
Facts e conferma prodotto/grammi con scrittura reale nel diario. Nel form nuovo
prodotto è disponibile la scansione AI facoltativa con preview e conferma,
senza salvataggio automatico. Contratto, licenze, privacy, limiti camera e test
in [Barcode](docs/BARCODE.md) e [AI etichetta](docs/AI-LABEL.md). Le voci importate
(`norish_sync`) restano di proprietà del sync: qualsiasi PATCH o DELETE su di
esse risponde 403 con messaggio dedicato. Se l'ultima run fallisce per
autenticazione, la dashboard
mostra l'origine configurata e invita a verificare la propria chiave personale
in Impostazioni; non cambia o cancella
credenziali. L'avviso non è `hostChanged`.

La prova browser auth usa Chromium reale, componenti di produzione, handler
Better Auth reali e PGlite migrato. L’harness HTTP adatta solo headers/redirect
Next: verifica registrazione, cookie persistente, logout/relogin, guard pagine
e Impostazioni non-admin. Non contatta API esterne e non simula sessioni.

L'interfaccia grafica è stata generata con assistenza AI; integrazione e test sono
stati implementati dall'agente sviluppatore. Contributo umano verificato: brief
utente e autorizzazione operatore sul modello. I profili Technical Lead e Marketing
Lead forniscono decisioni e review agentiche; la supervisione umana finale resta
richiesta prima del rilascio. I dati non sono consigli nutrizionali.

## Integrazione Norish: riconciliazione v2

Contratto pinnato a Norish v0.24.0-beta: sync week + today riconcilia l'intera
settimana lunedì–domenica, backfill month l'intero mese, con boundary inclusivi
ancorati alle date del payload (week preferisce l'item /today). Nessuna estensione
all'oggi locale: il fuso del server upstream può essere diverso da Syncloric.
Solo le voci `norish_sync` dell'utente nella partizione vengono marcate come
rimosse, mai cancellate fisicamente; ritorno dell'item = restore.

Con payload vuoto il default è zero marche. Per autorizzare il marchio a vuoto,
configurare `NORISH_UPSTREAM_TZ` nell'ambiente con il fuso effettivamente verificato
del server Norish (UTC per l'istanza Coagenti, non un default). È env-only, senza
campo GUI, risolto a ogni tick/CLI; valori invalidi sono ignorati con warning.
Solo fetch completo abilita le marche: today fallito non-auth = partial senza
marchio; 401/403 = error reason auth; errore totale = nessuna marca.
Date precedenti alla settimana/mese corrente sono fuori orizzonte (sweep v3 fuori
scope). Test HTTP mockati, nessuna chiamata reale o write upstream. Dettagli in
[ARCHITECTURE § 5.4](docs/ARCHITECTURE.md#54-progettazione-della-sincronizzazione).

Provenienza di questo delta v2: codice, test e documentazione generati con
assistenza AI (Hermes); contributo umano: requisiti e decisioni D1–D6 del
Technical Lead, inclusa l'autorizzazione al percorso lista vuota in sync.ts.
Review e merge finale del TL non sono dichiarati già effettuati.

## Scansione etichetta con AI

Un admin sceglie esplicitamente il provider globale in Impostazioni > Scansione
etichetta con AI e abilita la funzione. Senza provider o con ai.enabled=false,
la scansione resta disabilitata; il form manuale funziona comunque.
L'admin inserisce la chiave OpenAI/Anthropic da Impostazioni > AI: salvata cifrata
in DB, ha precedenza sull'eventuale chiave env legacy. La GUI mostra solo lo stato
e un campo vuoto per sostituirla, mai il valore salvato. Ollama non richiede
chiavi, usa OLLAMA_BASE_URL (default http://localhost:11434). In Compose localhost
è il container app: configurare un indirizzo Ollama raggiungibile da lì.
Modelli vision default: gpt-4.1-mini, claude-haiku-4-5-20251001, llama3.2-vision;
SYNCLORIC_AI_MODEL permette un override compatibile con il provider selezionato.

Nel form nuovo prodotto: foto/upload JPEG/PNG/WebP (5 MB), preview locale,
Scansiona etichetta, verifica/modifica, Registra nel diario. La selezione della
foto non la invia: occorre premere il pulsante. La UI dichiara il destinatario;
OpenAI e Anthropic ricevono la foto nel cloud, Ollama sul server configurato.
Syncloric non salva/logga le foto; la conservazione lato provider dipende dalle
sue politiche. Non includere dati personali. AI assistiva, non consigli dietetici:
una lettura errata non deve essere confermata. Nessun test/CI chiama AI reale.
Dettagli, privacy, API e smoke opt-in in [AI-LABEL.md](docs/AI-LABEL.md);
variabili e disabilitazione in [configuration.md](docs/configuration.md).

## Test

```bash
pnpm test:unit          # vitest: config, client norish (fetch mockato), crypto
pnpm test:integration   # vitest + PGlite in-process (Postgres WASM) sulle stesse migrazioni
pnpm test               # entrambi
pnpm build              # prerequisito per i test browser
pnpm test:settings-browser  # Chromium reale + componenti/API/PGlite, upstream mockati
pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/auth.spec.ts # auth reale, file isolato
```

PGlite non richiede Docker: i test di integrazione girano su un Postgres WASM
in-process con le stesse migrazioni drizzle dell'app. Gli harness Chromium
(`tests/e2e/`, driver vitest) verificano componenti e API reali con PGlite:
settings, feed Norish, barcode manuale e auth (sessioni Better Auth reali);
la sessione admin è iniettata solo nel confine test, provider HTTP mockati.
Non sono una prova della camera hardware. Installare Chromium Playwright
(`pnpm exec playwright install chromium`) prima se non è già disponibile.

## Deploy self-hosted (Docker Compose)

Il template root `.env.example` è dedicato allo sviluppo; per il deploy usare
`docker/.env.example`, che contiene `NORISH_BASE_URL`, `NORISH_UPSTREAM_TZ`
(fuso upstream, D2 v2) e `BETTER_AUTH_URL`.
Dietro Docker/reverse proxy impostare `BETTER_AUTH_URL` all’origine pubblica
HTTPS effettivamente aperta nel browser (schema, dominio ed eventuale porta,
senza percorso `/api`). Auth e tutte le scritture API usano questo stesso valore;
non inserire l’indirizzo interno del container. Nessun dominio o IP è incorporato
nell’immagine. Vedi [Origine pubblica e reverse proxy](docs/configuration.md#origine-pubblica-e-reverse-proxy).

```bash
cp docker/.env.example docker/.env
# NORISH_BASE_URL è opzionale: valorizzarla con l'URL assoluto scelto
# oppure ometterla/lasciarla vuota per avviare senza Norish.
# Il deployer fornisce dal vault, in ambiente o nello stesso .env protetto:
# POSTGRES_PASSWORD, BETTER_AUTH_SECRET e ENCRYPTION_KEY.
# Ogni utente salva la propria chiave Norish da UI; l'admin salva le chiavi AI.
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

La connessione all'istanza Norish avviene esclusivamente con la chiave personale
dell'utente, salvata dalla UI e cifrata con AES-256-GCM. `NORISH_API_KEY` non è
più usata, neppure per il primo account. Le chiavi personali già cifrate restano
compatibili. Non committare chiavi o file runtime; conservare `ENCRYPTION_KEY`
insieme ai backup del database per poter leggere le credenziali cifrate.

Per il trigger manuale, applicare prima `pnpm db:migrate` e poi
`pnpm sync:norish --user <uuid> [--period week|month]` con `DATABASE_URL`,
`BETTER_AUTH_SECRET` ed `ENCRYPTION_KEY` dall'env sicuro, dopo aver configurato
la chiave personale in Impostazioni. Il comando usa l'URL GUI > env della run;
`month` è il backfill esplicito, `week` è l'incrementale (settimana server +
oggi). Non passare chiavi in argv. Scheduler e trigger manuale usano la stessa
risoluzione per utente; lo scheduler salta account sospesi o senza chiave. Le run
sono auditabili in `norish_sync_runs` (`status`, `reason='auth'` su 401/403),
senza modifiche automatiche alle credenziali.

## Limiti noti del flusso utente (t_ee2705d5, per la review)

- **Verifica credenziali:** il salvataggio valida il formato e cifra la chiave;
  non contatta Norish o i provider AI. La validità viene verificata al primo
  sync/scan richiesto, senza chiamate automatiche al salvataggio.
- **Login/registrazione:** il backend Better Auth e `/api/auth` esistono, ma la
  pagina `/login` e il bootstrap del primo admin sono scope della feature auth:
  l'invito al login della UI resta finché quella pagina non viene consegnata.
- **Inserimento/modifica manuale:** POST autenticato disponibile
  ([contratto](docs/DIARY-WRITES.md)), con voci manuali nel feed; PATCH e DELETE
  autenticati solo-manual disponibili ([contratto](docs/DIARY-MUTATE.md)) con
  `norish_sync` protetto (403); dialog UI e sync on-demand disponibili
  ([uso e verifica](docs/DIARY-UI.md)), senza salvataggi simulati. Il collaudo
  integrato login→API→feed/UI resta nella QA dedicata.

## Sviluppo

- Architettura e decisioni di stack: `docs/ARCHITECTURE.md` (§ 3 struttura, § 4
  modello dati, § 5 integrazione norish, § 9 deployment)
- Il codice arriva tramite branch e pull request, senza merge diretti su main
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`) e CI su ogni PR
  (`pnpm lint` → `pnpm typecheck` → `pnpm test:unit` → `pnpm test:integration` →
  `pnpm build`, § 8)
