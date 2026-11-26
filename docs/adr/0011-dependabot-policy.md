# ADR-0011: gestione degli aggiornamenti Dependabot

Data: 2026-11-26. Decisione del technical-lead nella card di gestione delle PR Dependabot
(richiesta dell'operatore, 26/11/2026).

## Decisione

- **Il gruppo `minor-and-patch` (npm) è il canale unico per patch e minor.** Una PR, un run
  CI. Le PR singole superate dal gruppo si chiudono con un commento che dice quale PR le
  contiene: non si mergiano due volte le stesse dipendenze.
- **Patch/minor e action: merge dopo verifica reale.** `pnpm install --frozen-lockfile`,
  `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`,
  `next build --webpack` verdi in locale *e* CI verde sull'ultimo commit della PR
  (`ci` + `docker-smoke`; la policy strict richiede il branch allineato a `main`, quindi
  si riallinea con `@dependabot rebase` prima di mergiare).
- **Le major si valutano una per una** rispetto al codice reale, non al titolo della PR:
  breaking change letti nel pacchetto installato, poi build e test verdi. "Compila" non è
  una prova: se il percorso toccato non è coperto dai test, la major si chiude e si motiva.
- **Le action restano pinnate per SHA**: l'aggiornamento cambia SHA e commento di versione,
  nient'altro; il resto del workflow non si tocca.
- **Nessun force-push su `main`, nessun bypass del ruleset `main-protection`.** Il merge
  dei commit Dependabot usa `--rebase` per conservare autore e messaggio del bot.

## Eccezioni attive (`ignore` mirati in `.github/dependabot.yml`)

- **`@types/node` major** — i tipi seguono il runtime, non l'ultima major pubblicata. Node in
  produzione e in CI è **22.20.0** (`.nvmrc`, `docker/Dockerfile`), `engines` dichiara
  `>=22 <25`. Si alza la major dei tipi solo insieme al runtime, nella stessa modifica.
- **`postgres` major (≥ 4)** — `postgres.js` 4.0.0 (29/10/2026) è una riscrittura: la
  tipizzazione dei parametri lato client è sostituita dall'inferenza del server
  (`infer: false` di default), `sql.array()` è rimosso, il modello di timeout e di pool è
  nuovo. `drizzle-orm` 0.45.4 è l'ultima stable e il suo driver `postgres-js` è scritto per
  la v3. Nel repo **nessun test esercita il driver**: l'integrazione gira su PGlite, quindi
  una CI verde non direbbe nulla sul comportamento reale delle query.
  Condizione per riaprire: una release di `drizzle-orm` dichiaratamente compatibile con
  `postgres` 4 **e** un test di integrazione che passa dal driver `postgres-js` vero.

## Rovescio della scelta

Ignorare una major vuol dire restare su una linea che non riceve più feature e, prima o poi,
nemmeno i fix: il debito si paga dopo, con gli interessi. È accettabile finché la linea in uso
(3.4.x) riceve correzioni di sicurezza; alla prima CVE che tocca solo la major nuova, l'ignore
si toglie e si fa la migrazione con la rete di test — che va costruita *prima*, non durante.

## Gestione continuativa

Le ondate si gestiscono con la stessa procedura, senza intervento umano sui casi previsti:
patch/minor e action con la verifica sopra, major sempre valutate da un profilo tecnico. Il
limite `open-pull-requests-limit: 5` rende le PR un treno: si merge il gruppo per primo, poi
le singole rimaste, poi si chiudono le superate. L'auto-merge di GitHub resta spento finché
non esiste un controllo automatico equivalente alla verifica locale (build + test + driver DB).
