# Contributing

Grazie per l'interesse. Il progetto segue un flusso pull-request: nessun push diretto su `main`.

## Flusso

1. Apri una issue che descriva il problema o la proposta (le modifiche di sostanza partono da lì).
2. `git switch -c <tipo>/<argomento>` dal `main` aggiornato.
3. Sviluppa con test: la regressione che dimostra il bug o il contratto atteso va scritta prima
   del fix.
4. Commit in [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`,
   `docs:`, `chore:`), con `git commit -s` (DCO, vedi sotto).
5. Apri la PR: i check `CI` e `Docker deployment` devono essere verdi.

## Cosa gira in CI

`pnpm lint` → `pnpm typecheck` → `pnpm test:unit` → `pnpm test:integration` →
`pnpm exec next build --webpack` → regressione browser (`pnpm test:settings-browser`).
`Docker deployment` verifica inoltre il contratto di packaging e lo smoke dell'archivio di
release. Una PR che rompe questi gate non viene mergiata.

## Regole per i contributi

- **Niente segreti** nel repository, nei test, nei workflow o nei log: la CI usa solo valori
  fittizi. Le chiavi reali vivono nell'ambiente di deployment.
- **Niente `pull_request_target`** nei workflow e nessuna esecuzione di codice di PR con segreti
  disponibili.
- Le action dei workflow si aggiungono **pinnate per SHA** (non per tag mobile).
- Le migrazioni (`drizzle/`) sono versionate: una PR che cambia lo schema include la migrazione
  generata e il test che la copre.

## Licenza dei contributi

Il progetto è distribuito sotto **AGPL-3.0-or-later** (vedi `LICENSE`).

Inviando un contributo dichiari che:

1. ne hai il diritto (è tuo o hai l'autorizzazione a licenziarlo);
2. accetti che sia distribuito sotto `AGPL-3.0-or-later`, e
3. concedi a Coagenti il diritto **non esclusivo, irrevocabile e mondiale** di distribuire lo
   stesso contributo anche sotto altre licenze, incluse licenze commerciali.

Il punto 3 serve a mantenere possibile la doppia licenza (AGPL per la community, licenza
commerciale per chi non può rispettarla). Se non sei d'accordo, non inviare il contributo:
apri invece una issue con la proposta.

## Sviluppo locale

Requisiti, variabili d'ambiente e comandi in `README.md`; architettura e decisioni in
`docs/ARCHITECTURE.md`; build, deploy e rollback in `docs/DEPLOY.md`.
