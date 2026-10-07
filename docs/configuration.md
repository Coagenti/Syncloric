# Configurazione runtime

## Origine pubblica e reverse proxy

Impostare `BETTER_AUTH_URL` all’origine pubblica di Syncloric visibile nel browser,
ad esempio `https://calorie.example.com`. Il valore appartiene all’ambiente del
deployment; non è un default. Comprende schema, dominio ed eventuale porta, senza
credenziali, percorso, query o fragment. Lo slash finale viene normalizzato.
Usare HTTPS in produzione; HTTP è supportato per sviluppo e istanze senza TLS.

Compose inoltra la variabile al container a runtime: la stessa immagine funziona
su domini differenti senza rebuild. Dopo aver modificato l’ambiente, ricreare il
container con `up -d --no-build` (un semplice `restart` conserva il vecchio env).
Il reverse proxy deve preservare cookie e header Origin e instradare `/api/`
verso l’app. Il TLS può terminare al proxy: l’URL backend può rimanere HTTP.

Better Auth riceve questo valore come `baseURL`; i controlli sulle scritture
diario, sync, profilo, barcode, AI e impostazioni confrontano Origin con la
stessa origine pubblica. Il confronto precedente con `request.url` poteva
confrontare il dominio HTTPS del browser con l’URL HTTP interno di Next e
produrre 403. Non servono IP interni, wildcard o disattivazione dei controlli CSRF.
Host, Forwarded e X-Forwarded-* ricevuti non concedono fiducia ad altre origini.
Cambiare schema, dominio o porta nel browser richiede aggiornare questa variabile;
le altre origini sono rifiutate anche se coincidono con l’URL backend.

Assente/vuota: per accesso diretto, le API usano l’origine di `request.url` e
Better Auth mantiene il suo comportamento nativo. Dietro un proxy occorre
configurare il valore pubblico. Un valore esplicito malformato impedisce l’avvio.
I client non-browser possono omettere Origin sulle API che già lo consentivano;
un fetch dichiarato cross-site è rifiutato. Il profilo continua a richiedere Origin.
Riferimenti: [configurazione Better Auth](https://better-auth.com/docs/installation)
e [controlli di sicurezza](https://better-auth.com/docs/reference/security).

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

| Variabile Norish | Fonte / default | Semantica |
| --- | --- | --- |
| `NORISH_BASE_URL` | GUI > env > unset, nessun default | Origine upstream; unset disabilita il tick |
| Chiave Norish personale | UI autenticata, cifrata in DB | Ogni utente configura la propria chiave; `NORISH_API_KEY` legacy ignorata |
| `NORISH_UPSTREAM_TZ` | Solo env, opzionale, nessun default | Fuso verificato del server upstream, es. UTC; invalido ignorato con warning |

`NORISH_UPSTREAM_TZ` non è una setting GUI e non modifica la precedenza dell'URL.
È risolta e iniettata nel runner a ogni tick e dal comando `pnpm sync:norish`,
senza dipendenze aggiuntive (Node full-ICU, `Intl.DateTimeFormat`). Il client non
legge la configurazione. Ometterla/vuota = payload vuoto non autorevole e zero
marche; valore invalido = stessa semantica, con warning che non stampa l'input.
Valorizzarla solo dopo aver verificato il fuso reale del SERVER upstream; UTC è
stato verificato dal TL per Coagenti, ma non è un default applicativo.

La riconciliazione v2 (Norish v0.24.0-beta) usa week lun–dom o month 1–fine mese
inclusivi. Payload non vuoto: anchor /today, altrimenti minima data (month sempre
minima data); nessun orologio locale. Payload 200 vuoto + TZ valida: T nel fuso
upstream autorizza la partizione calendario; fetch parziale/fallito non marca
mai. Solo user/source sync nella partizione, senza churn sulle voci già marcate.
L'orizzonte non copre date anteriori alla partizione corrente (eventuale sweep v3).
Vedi [ARCHITECTURE § 5.4](ARCHITECTURE.md#54-progettazione-della-sincronizzazione).

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

## AI etichetta: configurazione globale

| Configurazione | Fonte | Default / comportamento |
| --- | --- | --- |
| `ai.provider` | admin_settings via GUI | null: AI disabilitata; scelta esplicita openai/anthropic/ollama |
| `ai.enabled` | admin_settings via GUI | false/assente: disabilitata |
| Chiave OpenAI | UI admin cifrata > `OPENAI_API_KEY` env | richiesta per OpenAI; env solo fallback legacy |
| Chiave Anthropic | UI admin cifrata > `ANTHROPIC_API_KEY` env | richiesta per Anthropic; env solo fallback legacy |
| `OLLAMA_BASE_URL` | env, non segreta | http://localhost:11434; HTTP(S), nessuna credenziale/query/fragment |
| `SYNCLORIC_AI_MODEL` | env, non segreta | override del modello vision; vuota/assente usa default per provider |

Nessun AI_PROVIDER env: il provider è scelto dall'admin, non inferito da chiavi
presenti. GUI globale persistente, riletta ad ogni richiesta (nessun riavvio).
Le chiavi cloud della UI sono salvate cifrate in `admin_settings`; le API
restituiscono soltanto stato e fonte, senza plaintext o ciphertext. Rimuovere
una chiave UI ripristina l'eventuale fallback env; un override cifrato non
utilizzabile non ricade silenziosamente sull'env. Variabili opzionali vuote/spazi sono assenti. In
sviluppo Next legge .env; in Compose aggiungerle a docker/.env (gitignored):
il template inoltra le quattro env senza valori di default incorporati.
Dopo cambio env ricreare il container con up -d --no-build, non restart.
Il default Ollama è applicativo e non abilita automaticamente la feature;
localhost in Docker è il container app, non l'host. L'URL Ollama è controllato
esclusivamente dall'operatore tramite env, mai da un parametro HTTP utente.

Modelli predefiniti: gpt-4.1-mini, claude-haiku-4-5-20251001, llama3.2-vision.
Scegliere un modello multimodale compatibile con il protocollo del provider;
nessun costo è hard-coded e nessuna chiamata reale avviene nei test.
Disabilitare dalla GUI (ai.enabled=false) per impedire nuove estrazioni; una
richiesta già inviata non può essere ritirata dal provider.

Privacy: solo il pulsante Scansiona etichetta invia la foto al provider scelto.
OpenAI/Anthropic sono cloud; Ollama riceve comunque la foto sul server env
configurato, che l'operatore deve mantenere self-hosted se desidera egress locale.
Syncloric non conserva/logga le foto né i payload AI. Il provider può conservarli
secondo le sue politiche. File JPEG/PNG/WebP fino a 5 MB, no SVG/HEIC; crop solo
etichetta, nessun dato personale. Preview locale e conferma/edit obbligatori.
Dettagli e limiti in [AI-LABEL.md](AI-LABEL.md).

## Provenienza

Test e aggiornamenti documentali generati con assistenza AI (Hermes).
Contributo umano documentato: requisiti utente e decisioni del Technical Lead
su autorizzazione, persistenza e contratto API. Review e merge finale umano
non sono dichiarati già effettuati.
