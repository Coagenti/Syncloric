# Syncloric v1 — Validation checklist (task t_e415b4c4)

Executed 2026-09-30 by the Technical Lead. All evidence produced by real tool
execution (local runtimes, GitHub Actions, LXC CT106/CT107 on pve2). Repo state
at validation: `main` = `a12a87ae2bec` (merge of PR #7 → #8 → #10, in that order).

## 1. Code review delle PR (#7 config loader, #8 readonly client, #10 packaging)

| Controllo | Esito |
| --- | --- |
| ADR-0007 su PR #7: nessun default per `NORISH_BASE_URL`, fail-fast che nomina la variabile e ADR-0007, URL assoluto con regex authority (`https:example.invalid` e forme abbreviate rifiutate), `.trim()`, valore mai stampato in diagnostica | PASS |
| ADR-0007 su configurazione deploy (PR #10): `docker/.env.example` con la sola `NORISH_BASE_URL`; segreti esiguti dal compose con `${VAR:?...}`; assert smoke CI su 4 variabili obbligatorie, missing+empty → errore Compose nominando la variabile | PASS |
| ADR-0006 su PR #8: rifiuto metodi non-GET pre-transport (`method !== "GET"`, case-sensitive), rifiuto path fuori `/api/v1/`, traversal, separatori percent-encoded incl. nesting (`%252e`), backslash, control chars, dot segments; doppio controllo origin+prefix su URL risolto; `redirect: "manual"` (mai seguito, nemmeno same-origin); `searchRecipes()` POST deprecato e sempre rigettato | PASS |
| GET funziona: GET `/api/v1/recipes?limit=2` inviato all'origine iniettata col path completo | PASS |
| Base URL solo iniettata; nessun host cablato in `docker/`, Dockerfile, compose, `.env.example` (test offline `test_packaging.py` verifica `docker/.env.example` hostless e minimale) | PASS |
| Nessun default o valore sensibile nel repo: secret scan del reviewer sull'head di PR #8 (0 match); `.dockerignore` esclude `**/.env*`, `**/secrets`, `*.key/pem/p12/pfx` | PASS |

## 2. Verifica locale per PR (head esatto)

| PR | Lint | Typecheck | Unit | Integration | Altri |
| --- | --- | --- | --- | --- | --- |
| #7 (3467f2dc) | exit 0 | exit 0 | 28/28 | 7/7 | bootstrap probe (TL, senza mock del loader): fail-fast 6/6 — missing/empty/blank/malformed/ftp → `register()` rigetta nominando `NORISH_BASE_URL`+`ADR-0007` con DB e scheduler MAI toccati; env valida → migrate+scheduler eseguiti |
| #8 (b06cb2b) | exit 0 | exit 0 | 48/48 | 1 timeout hook PGlite su 1/7 (limite 120s hook; sulla stessa macchina la stessa suite passa 7/7 in 18s una volta terminata la contesa di build — flaky da carico; CI GitHub verde sullo stesso head) | 28-case path/origin bypass probe del reviewer: zero escape |
| #10 (5eb20a09) | exit 0 | exit 0 | 48/48 | 7/7 | packaging contract 3/3 (template minimale+hostless, `.dockerignore`) |

## 3. CI GitHub

- PR heads: `ci` success su #7, #8, #10 esatti head; `docker-smoke` success su #10 (run 36686071833 / 36686071798: una build, due `.env` con base URL diverse, identità immagine, env iniettata, non-root, health, rifiuto missing/empty; nessuna chiamata upstream).
- Post-merge su `main` `a12a87ae`: workflow `ci` = success; workflow `Docker deployment` = success.
- Sequencing merge: #7 → #8 → #10 con merge commit `9448973a` → `be995e50` → `a12a87ae`; verificato con `git ls-remote` dopo ogni merge.

## 4. Multi-istanza (stessa immagine, due deployment) — reale su CT106 (pve2)

Comando: build una volta, poi due compose project (tl-a / tl-b) con `.env` separati,
stesso `SYNCLORIC_IMAGE=syncloric:tla12a87` (digest `sha256:2c95f0f58806…`), port 3101 / 3102.

- Entrambi i container app + 2 db postgres: stato `healthy`.
- `IMAGE-IDENTITY: PASS` — `docker inspect` `.Image` identico per tl-a e tl-b (§ 9.4: cambiare deployment = cambiare solo `NORISH_BASE_URL`).
- `NORISH_BASE_URL` iniettata e lette in runtime: A=`https://norish.coagenti.it`, B=`https://norish-failover.coagenti.it`; l'env visto da `docker exec` conferma le due variabili distinte.
- `NORISH_API_KEY`: settata solo in A (preservata dall'entrypoint), assente come valore non-vuoto in B (semantica vuoto=assente verificata via `docker exec env`, nessun valore stampato).
- Utente container: `nextjs` (non-root) su entrambe le istanze.
- Health app: `{"status":"ok","service":"syncloric","version":"0.1.0"}` dentro A e B.

## 5. Read-only end-to-end (istanza reale)

- `GET /api/v1/planned-recipes/week` inoltrato dal container tl-a contro l'upstream configurato `norish.coagenti.it` **con la chiave iniettata dalla sua env**: HTTP **200** (payload 639 B). La pipeline bootstrap→config→client→upstream funziona end-to-end.
- Rifiuto non-GET senza network: coperto dal contratto client § unit (13 varianti metodo rifiutate con zero chiamate transport; 14+ casi path rifiutati pre-transport) — verificato in unit e dal probe bypass del reviewer. Il client non produce alcuna chiamata non-GET per costruzione.
- Nota: la guardia client ha `NORISH_BASE_URL` per-process (cached); la verifica runtime del rifiuto non-GET contro l'istanza live non è riproducibile da QA esterno perché l'app non espone alcun endpoint che generi richieste non-GET (ADR-0006: nessun POST nel client) — assenza di superficie = conformità per design, testata dal contratto unit.

## 6. Fail-fast end-to-end (immagine reale su Docker 29.8.1)

- Immagine con env incompleta → bootstrap `loadEnvConfig()` throw: log in-container
  `Configurazione d'ambiente non valida — l'app non parte (fail fast, ADR-0007, § 5.0): - ENCRYPTION_KEY …` (osservato con fixture 96-hex errata e confermato poi con 64-hex).
- Missing / empty / malformed `NORISH_BASE_URL` (con restanti segreti validi): bootstrap logga l'errore hook nominando `NORISH_BASE_URL` e `ADR-0007` (probe `docker run` con timeout 20s: log catturato, processo non esce — Next 16 logga l'errore dell'hook e resta idle).
- A deployment level il fail-fast è: container mai healthy → `docker compose up --wait` esce non-zero (osservato direttamente con la env invalida). CI smoke aggiuntivo: compose `config` rifiuta missing/empty sulle 4 variabili con la variabile nominata (8 casi).
- Bootstrap probe locale (unit, reale `register()` con mock solo su effetti esterni): missing/empty/blank/malformed/ftp → rejects con `NORISH_BASE_URL`+`ADR-0007`, `migrateLatest`/`startScheduler` **mai** chiamati; build (`phase-production-build`) salta il bootstrap senza errori.

## 7. Ambiente e note

- CT107 (syncloric-test) non ha potuto compilare la build in-container: LXC 2 GB con lo stack di sistema attivo — turbopack (`next build` in-container root, 868 MB RSS) progredisce quasi per niente (29s CPU in 5 minuti) e il buffer cache non recupera in tempo. La build è stata eseguita su CT106 (idle, stesso 2 GB: compila in 4.2 min quando non contendendo memoria) e l'immagine trasferita a CT107 via `docker save|load`.
- **Consegnato a sistemisti**: su CT107 l'immagine validata è persistita come `syncloric:system-rollback` (rollback immediato del deploy di sistema, se necessario); lo stack di sistema (docker-app-1/docker-db-1) resta healthy e con il suo `.env` root:docker 640 intatto.
- Pulizia: progetti compose disposable rimossi (volumi inclusi) su entrambi i CT; immagine runtime e tarball temporanei rimossi; probe container orfani rimossi. CT106 di nuovo idle; CT107 torna in stato pre-validation con soltanto l'aggiunta dell'immagine di rollback.
- Nota flakiness: integration suite PGlite su host locale può superare il timeout hook 120s sotto carico (visto su PR #8 run locale; stessa suite 7/7 in 18s post-merge) — da tenere presente per i retry di validazione locale, non è un difetto del codice.

## 8. Esiti chiusi al merge

- Review PR #9 (UI): eseguita da sistemista_interno round 2 (head 29eadf9c, REQUEST-CHANGES su 1 punto residuo → fix su card t_c90846f6). La validation conferma che il merge di #9 resta nel lane UI (base = main post-#7/#8; non bloccante per v1 packaging).
- PR #11 (a11y): review round 1 TL = changes_requested (verdetto nella card t_2990760d), fuori dal perimetro di questa validation.

**Verdict**: v1 Syncloric validata end-to-end (config fail-fast, read-only GET-only, packaging multi-istanza, CI verde) — PR approve e mergiate su main; nessun difetto bloccante residuo. Follow-up infra (CT107 sotto-provisionato per build container: servono più RAM o build fuori-CT per il futuro deploy) lasciato a sistemista_interno.