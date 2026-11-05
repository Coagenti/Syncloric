# DEPLOY — Syncloric

Documento di contratto per build, rilascio e aggiornamento degli ambienti.
**Questo file è pensato per stare nel repo** (e quindi per essere pubblicabile): contiene
procedure, contratti e criteri di verifica, **non** indirizzi, credenziali o dettagli della
rete interna. Il dettaglio operativo sito-specifico (host, IP, percorsi, credenziali) va tenuto
**fuori dal repository**, in un runbook locale ignorato da git: ognuno documenta la propria
infrastruttura nel modo che preferisce, questo file resta la parte condivisibile.

Ultima verifica dei fatti riportati: 2026-11-05.

---

## 1. Stato del sistema (fotografia)

| Voce | Valore |
|---|---|
| `main` | `d43a65e62` — merge PR #51 (2026-11-05 05:44Z) |
| CI su quel commit | `CI` + `Docker deployment` entrambe **success** |
| Tag/release | `v0.2.1` → `baffcb286` (19/10). **Nessun tag per `main` corrente** |
| `version` in `package.json` su main | `0.2.1` (non cambia al merge: **non identifica `main`**) |
| Immagine in produzione | `syncloric:v0.2.1-baffcb28-lf` (id `c5fa18a22a51`) |
| Gap produzione → `main` | **3 commit, 156 file** di cui `drizzle/0008_user_ui_preferences.sql` |
| Migrazioni applicate in prod | 8 (la 0008 è **pendente**) |

Conseguenza da leggere subito: **la produzione è indietro rispetto a `main`** e il prossimo
deploy **non è più "image-only"** — contiene una migrazione di schema, quindi non si torna
indietro cambiando solo l'immagine (§ 5.6).

---

## 2. Ruoli degli ambienti

| Ruolo | Cosa ci gira | Regola |
|---|---|---|
| **dev** | sandbox del profilo developer: gate (lint, typecheck, unit, integration, e2e), prove UI | spento salvo uso; nessun segreto di produzione |
| **test / pre-prod** | l'**artefatto identico** che andrà in produzione (stesso digest) + smoke reale + prova di migrazione su dump sanitizzato | spento salvo uso; nessun segreto di produzione |
| **prod** | app + database reali, dietro reverse proxy pubblico | unico con `onboot=1`, backup periodici, deploy solo da artefatto firmato dalla CI |

Regola d'oro: **prod riceve un digest, non dei file.** Nessun `docker save`/`tar` verso prod.

---

## 3. Catena attuale (manuale, per riferimento)

Il deploy di `v0.2.1` (2026-10-19) è stato eseguito a mano in 7 fasi, ~45 minuti:

1. apertura di regole firewall temporanee per raggiungere i container via SSH (chiuse a fine deploy);
2. upload del tarball di release (asset GitHub) sull'host di build, verifica `sha256`, estrazione;
3. `docker compose build app` sull'host di build (2 vCPU / 2 GB → ~3 min, richiede `--webpack`);
4. `docker save | gzip` → ~95 MB, `sha256` verificato;
5. trasferimento in due hop (build host → host agente → prod) con `sha256` verificato a ogni hop;
6. cutover: tag di rollback, `pg_dump`, `compose stop` (**ferma anche il db**), nuova release dir,
   `.env` copiato con `sed` della sola `SYNCLORIC_IMAGE`, `up -d`;
7. verifica: `image-id == id del tag`, `package.json` nel container, health, conteggio migrazioni,
   smoke interno + E2E pubblico, cleanup.

Downtime misurato: **1 m 48 s**. Rollback mai necessario.

Questa catena va **sostituita**: il build non è nel punto in cui è verificabile, l'artefatto
viaggia fuori da un canale verificabile, e lo stesso host di build è anche l'ambiente di test.

---

## 4. Problemi noti (elenco di lavoro)

| # | Problema | Impatto |
|---|---|---|
| 1 | la CI **non produce immagini**: `docker.yml` impacchetta i sorgenti e fa smoke del tarball | non esiste artefatto verificabile all'origine |
| 2 | nessuna registry: trasporto con `docker save` + `scp` | provenienza e integrità dipendono da un operatore |
| 3 | prod non è un checkout git; le release dir sono alberi di sorgenti estratti | drift tra ciò che si legge e ciò che gira |
| 4 | `docker-compose.deploy.yml` (log rotation + passthrough env) **non è nel repo**, esiste solo sull'host di prod | un rebuild pulito lo perde silenziosamente |
| 5 | la release dir corrente è un `cp -a` della precedente: i **sorgenti** dentro sono della versione vecchia | confusione in ogni intervento; compose/entrypoint verificati identici per hash |
| 6 | `/api/health` restituisce `version: "0.1.0"` **hardcoded** | dall'esterno non si può dire che versione gira |
| 7 | `compose stop` ferma anche il db, che va riavviato nell'intervallo di cutover | finestra di downtime e ordine fragile |
| 8 | host di build = ambiente di test (2 GB), lasciato acceso per il deploy | build lenta/fragile e catena non isolata |
| 9 | `package.json` non cambia sul merge: la versione non distingue due build di `main` | impossibile dedurre "prod == main" dalla versione |

---

## 5. Pipeline target: `main` come unica sorgente di verità

### 5.1 Principi

1. **Build una volta, in CI**, sullo stesso commit che è `main`. Nessuna seconda build in produzione.
2. **L'identità dell'artefatto è il digest** (`image@sha256:…`), non il nome né la versione.
3. **Prod fa solo `pull`** del digest. Nessun file trasferito, nessun runner nella rete di produzione.
4. **Migrazioni come gate esplicito**, non come effetto collaterale del boot.
5. **Rollback automatico** se il gate di salute fallisce, entro la stessa esecuzione.

### 5.2 Cosa gira in CI

`pull_request`: gate invariati (lint, typecheck, unit, integration, browser regression, packaging smoke).
`push` su `main`: gli stessi gate + **build dell'immagine** + push su registry con due tag:

```
ghcr.io/<org>/syncloric:sha-<short-sha>
ghcr.io/<org>/syncloric:main        # solo per comodità, il deploy usa il digest
```

Contratto minimo del job di build:

- `docker build` con lo stesso `docker/Dockerfile` del repo, `--build-arg SYNCLORIC_COMMIT=<sha>`;
- nessun segreto in `ARG`/`ENV` di build (il `.dockerignore` già esclude `**/.env*`);
- publish del **digest** come output del job (`docker inspect --format '{{index .RepoDigests 0}}'`);
- artefatti Actions: solo sorgenti. **L'immagine non è un artefatto scaricabile**, va in registry.

### 5.3 Deploy sugli host

Uno script versionato (`deploy/syncloric-deploy.sh`) con questo contratto:

```
syncloric-deploy.sh --image <registry>/syncloric@sha256:<digest> [--expect-commit <sha>] [--dry-run]
```

Fasi, con uscita non zero su qualunque fallimento:

1. **preflight** — docker attivo, spazio libero sufficiente, `.env` presente e completo
   (confronto dei *nomi* delle chiavi attese, mai dei valori), registry raggiungibile;
2. **snapshot** — tag di rollback dell'immagine corrente, `pg_dump` in `/opt/backups/<ts>/`,
   registrazione dell'id immagine attuale;
3. **pull** per digest (solo il servizio app);
4. **up** con `--no-deps app`: il database **non viene mai fermato**;
5. **gate salute** — health entro un timeout breve, conteggio migrazioni atteso, log senza errori;
6. **verify** — `image-id == digest`, `SYNCLORIC_COMMIT == --expect-commit`, versione da health;
7. **esito** — log in `/var/log/syncloric/deploy-<ts>.log`; su fallimento rollback (§ 5.6) ed exit 1.

Il trigger non deve richiedere accesso entrante alla rete di produzione: due opzioni accettabili
sono (a) `workflow_dispatch` che chiama l'host via un canale di management ristretto,
(b) un agente che fa polling di "qual è il digest corrente di `main`" e applica.
Una sola opzione **non** è accettabile: un self-hosted runner nella rete di produzione.

### 5.4 Identità e verificabilità della versione

- `SYNCLORIC_COMMIT` iniettato come build-arg e restituito da `/api/health` insieme al digest;
- `/api/health` **non deve** contenere versioni hardcoded (fix al punto 4.6);
- criterio di allineamento verificabile dall'esterno:
  `health.commit == git rev-parse main && health.digest == digest pubblicato dalla CI`.

### 5.5 Migrazioni e finestra di downtime

Le migrazioni girano al boot (`src/instrumentation.ts`). Poiché non sono automaticamente
reversibili, il deploy che ne contiene una segue un percorso diverso:

1. backup del DB **prima** del pull (già in fase 2);
2. applicazione della nuova immagine con `--no-deps app`;
3. gate: numero di migrazioni atteso **e** query di sanità sulle tabelle toccate;
4. se il gate fallisce: **il rollback dell'immagine non basta** — serve restore del dump
   (o una migrazione "down" versionata). Il deploy deve dichiarare quale dei due percorsi è
   disponibile *prima* di partire.

### 5.6 Rollback

| Livello | Cosa ripristina | Quando è sufficiente |
|---|---|---|
| **R3 — image-only** | solo il binario, con lo stesso DB | deploy senza migrazioni |
| **R1 — applicativo** | immagine + dump del DB pre-deploy | deploy con migrazioni |
| **R2 — host** | intero container (snapshot di virtualizzazione) | incidente non applicativo |

### 5.7 Adozione in 4 passi

| Passo | Cosa | Criterio di uscita |
|---|---|---|
| **S1** | build immagine in CI + push su registry, **senza** toccare il deploy | il digest compare come output del job e l'immagine parte in locale |
| **S2** | aggiungere `docker-compose.deploy.yml` al repo e distribuire la release dir dall'artefatto | lo sha dei tre file di deploy coincide con quello in uso oggi |
| **S3** | `deploy.sh` + deploy automatico su **test** | due deploy consecutivi idempotenti, rollback provato per finta |
| **S4** | deploy su **prod** con approvazione umana (Environment con reviewer) | un deploy reale con migrazione 0008 e rollback R1 provato a vuoto |

---

## 6. Ambienti dev/test con un repo pubblico

Se il repo diventa pubblico, il codice smette di essere il bene da proteggere: i container non
custodiscono più il software. Restano utili per due cose e solo quelle:

1. **provare il percorso di upgrade** (migrazione su un dump sanitizzato della produzione);
2. **essere il pre-prod dell'artefatto esatto** che andrà in produzione (stesso digest).

Conseguenze operative:

- **dev** diventa effimero (acceso on-demand, spento dopo la card) o viene dismesso: con un repo
  pubblico i minuti di CI sono gratuiti e illimitati, quindi i gate non hanno motivo di girare
  su un container dedicato;
- **test** smette di essere host di build (oggi produce l'immagine di produzione: 2 GB, `--webpack`
  obbligatorio, artefatto trasferito a mano) e diventa consumatore di digest;
- il codice che gira su dev/test va considerato **non fidato**: nessuna credenziale di produzione,
  nessuna chiave SSH che apra prod, database con dati non reali;
- i segreti di ambiente vanno **separati per ambiente**: in particolare nessuna chiave condivisa
  tra test e prod (chiave API upstream, chiavi AI con quota dedicata), e chiave di accesso
  distinta per prod.

---

## 7. Cosa fare prima del prossimo deploy

1. `main` contiene la migrazione `0008`: il prossimo rilascio richiede backup + gate (§ 5.5).
2. Chiudere i punti 4.3–4.5 (release dir allineata all'artefatto, `docker-compose.deploy.yml` nel repo).
3. Applicare il fix 4.6 (`/api/health` con commit e digest) **prima** di automatizzare, altrimenti
   non esiste una verifica esterna dell'allineamento.
4. Eseguire almeno un deploy con la catena nuova su test **prima** di toccare prod.

---

## 8. Riferimenti

- Catena eseguita per `v0.2.1`: report e script di deploy nel workspace operativo interno.
- Smoke e verifica post-deploy: report interno `REPORT_SMOKE_v021`.
- Hardening pre-apertura del repo: documento interno dedicato.
