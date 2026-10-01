# Barcode e catalogo locale (v1)

Nel Diario, **Scansiona** apre un dialog nativo. L'input numerico (8–14 cifre,
zeri iniziali preservati) è sempre disponibile. **Usa fotocamera** utilizza
BarcodeDetector nativo, senza polyfill: richiede browser compatibile, contesto
sicuro HTTPS e consenso. In caso di indisponibilità/permesso negato resta
l'input manuale. I frame vengono analizzati sul dispositivo: nessuna foto è
inviata al server. Chiusura, annullamento e unmount fermano le tracce camera.
La scansione AI facoltativa è un flusso separato nel form nuovo prodotto:
[foto, invio al provider e conferma assistiva](AI-LABEL.md). Non cambia la
privacy dello scanner barcode; la foto etichetta viene inviata solo su richiesta.

## API autenticata e dati

- `GET /api/v1/barcode?code=...`: catalogo condiviso `foods.barcode` prima di
  ogni lookup esterno. Risposta `{origin: local|off|unknown, food}`; 404 OFF
  o status 0 diventano `unknown` e un form vuoto, non un errore utente.
- Solo il backend contatta l'origine costante
  `https://world.openfoodfacts.org/api/v2/product/{barcode}.json` via GET;
  nessuna chiave/configurazione. Timeout 10 s per tentativo, un retry per
  rete/timeout/429/5xx, inizi delle richieste distanziati di almeno 1 s per
  processo. Non è un rate-limit distribuito multi-replica.
- Cache memoria 24 h per esiti positivi e sconosciuti; dopo conferma i dati
  positivi sono conservati in `foods`, senza ulteriori richieste upstream
  per quel codice. Nessun prodotto viene registrato senza conferma utente.
- `POST /api/v1/barcode`: JSON con barcode, name, brand opzionale,
  kcalPer100g, macro opzionali, grams, date (YYYY-MM-DD) e slot
  (`Breakfast|Lunch|Snack|Dinner`). Sessione obbligatoria; Content-Type JSON
  e Origin, se presente, devono essere validi. Il reverse proxy deve
  preservare l'origine pubblica. Risposta 201 `{id}` della voce.
- Il catalogo è condiviso, il diario è sempre dell'utente autenticato.
  Un barcode già registrato non viene sovrascritto; si usa la nutrizione del
  catalogo. Inserimento food e voce sono atomici; l'indice univoco parziale
  impedisce duplicati anche con richieste concorrenti.
- Food con dati OFF: `source=barcode_off`; altro: `source=manual`.
  La provenienza è risolta dal server, mai accettata dal client. Le voci del
  diario hanno sempre `source=manual`. Kcal totali arrotondate:
  `kcalPer100g × grams / 100`; macro snapshot proporzionali. Null significa
  sconosciuto, distinto da zero. Errori UI sanitizzati, risposte no-store.

## Migrazione

`barcode` esiste già nella migration iniziale. `0002_barcode_partial.sql`
converte l'indice in UNIQUE WHERE barcode IS NOT NULL senza cambiare i cibi.
SQL e migrator sono riapplicabili; il test esegue due volte la migration.

## Licenza e verifica

Dati nutrizionali da [Open Food Facts](https://world.openfoodfacts.org/),
banca dati [ODbL](https://world.openfoodfacts.org/terms-of-use), contenuti
individuali DbCL e immagini CC BY-SA ([condizioni riuso](https://world.openfoodfacts.org/data)). L'interfaccia mostra attribuzione
con link al prodotto. Nessuna immagine viene importata. Rispettare le licenze
applicabili in eventuali esportazioni/redistribuzioni del catalogo.

Test OFF con fixture JSON archiviata e fetch mockato, integration PGlite
con le migration reali e browser Chromium con componente/API reali e provider
mockato. Il confine sessione nel browser harness è iniettato solo nei test;
non è un collaudo login reale. La camera hardware non è verificabile in CI.

```sh
pnpm test:unit
pnpm test:integration
pnpm test:settings-browser
pnpm typecheck
pnpm lint
pnpm build
```

## Trasparenza AI e contributo umano

Codice, test e documentazione di questa feature sono generati con assistenza
AI (Hermes). Il flusso barcode non usa AI sui dati alimentari. Contributo umano:
brief dell'operatore, decisioni vincolanti del Technical Lead su provider,
stack e contratto, linee grafiche del Marketing Lead e autorizzazione del
modello. Review tecnica/grafica e approvazione al rilascio restano ai referenti
umani; non vengono dichiarate effettuate dall'implementazione. I dati non
costituiscono consigli nutrizionali.
