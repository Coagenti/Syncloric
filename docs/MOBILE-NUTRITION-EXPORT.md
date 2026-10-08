# Mobile, nutrienti ed export personale

## Installazione e fotocamera

Syncloric include un manifest PWA, icone 192/512 px (anche maskable) e icona Apple.
Da Impostazioni > Generali > Syncloric sul telefono è possibile aprire il prompt di
installazione quando disponibile, oppure seguire le indicazioni del browser.
Su iPhone si usa Condividi > Aggiungi alla schermata Home; su Android il menu
Installa app / Aggiungi a schermata Home.

In produzione serve **HTTPS con un certificato attendibile**. Cambiare `http`
in `https` nell'indirizzo non configura TLS: il reverse proxy deve terminare
HTTPS e `BETTER_AUTH_URL` deve contenere l'origin pubblico completo. Nessun IP
LAN è incluso nella configurazione di produzione.

`localhost` e loopback sono ammessi per sviluppo. Un device Android collegato
via ADB può usare `adb reverse tcp:8091 tcp:8091` e aprire
`http://localhost:8091`. Su HTTP LAN la UI indica il requisito HTTPS per camera
e installazione.

Il barcode viene decodificato **sul dispositivo**: prima con `BarcodeDetector`,
poi con ZXing se l'API nativa manca o non supporta i formati. La fotocamera si
ferma a lettura completata, chiusura del dialog, salvataggio o smontaggio della
pagina. La foto dell'etichetta AI è un flusso separato, con invio esplicito al
provider scelto dall'admin e verifica dei valori prima del salvataggio.

Il service worker conserva solo `/offline.html`, una pagina pubblica che invita
a riconnettersi. Non conserva HTML autenticato, API, export o dati del diario.
Il diario richiede connessione; installazione non significa sincronizzazione
offline. L'aggiornamento del service worker segue il ciclo del browser, senza
forzare ricaricamenti o sostituire una pagina aperta durante la compilazione.

## Nutrienti

La migrazione `0004_nutrition_and_export_tokens` aggiunge JSONB tipizzati per
alimenti (`nutrients_per_100g`), ricette (`nutrients_per_serving`) e voci del diario
(`nutrients`). Le vecchie colonne macro restano compatibili; la lettura usa
il JSON quando presente e le colonne precedenti come fallback.

Sono registrabili proteine, carboidrati, grassi, saturi, zuccheri, fibre, sale,
colesterolo, vitamine A/D/E/K/C e gruppo B, e minerali. Il registro completo di
campi e unità si trova in `src/lib/nutrition.ts`.

- Macro, saturi, zuccheri, fibre e sale: g.
- Colesterolo e la maggior parte dei minerali/vitamine idrosolubili: mg.
- A/D/K/B7/B9/B12, iodio e selenio: µg.

Gli alimenti usano valori per 100 g. L'inserimento manuale nel diario usa i
totali della quantità; il catalogo e il barcode applicano grammi/100. Le ricette
manuali usano totali delle porzioni; Norish conserva valori per porzione e
li moltiplica per le porzioni locali **una sola volta** in lettura/export.
La sincronizzazione non sovrascrive le porzioni locali e resta idempotente.

I nutrienti sono snapshot: una successiva modifica al catalogo non riscrive
le voci già registrate. Le variazioni di quantità ridimensionano lo snapshot
della voce; per ricette manuali le porzioni ricalcolano dai dati della ricetta.
Vitamine e minerali sono acquisiti da Open Food Facts o da etichette leggibili,
oppure inseriti manualmente. Norish fornisce i macro previsti dal suo contratto;
i micronutrienti mancanti restano sconosciuti.

I valori OFF `*_100g` sono normalizzati in grammi e convertiti nelle unità
del registro, senza usare `*_unit` del contributore. L'AI riceve le unità del
registro e non deve inferire quantità da IU, percentuali giornaliere o ingredienti.
Campo assente/null = sconosciuto; zero esplicito = noto. I riepiloghi mostrano
copertura (voci con dati / voci totali), perché le somme possono essere parziali.

## Download e API

Tutti gli utenti autenticati possono esportare da Impostazioni > I miei dati.

`GET /api/v1/export?format=json|csv&from=YYYY-MM-DD&to=YYYY-MM-DD`

I filtri sono facoltativi; le date sono inclusive. JSON include versione,
timestamp, identità, unità, profilo, alimenti creati dall'utente e voci del
diario con valori totali. CSV contiene una riga per voce del diario, con unità
nei nomi delle colonne e valori sconosciuti vuoti. Le formule nei campi testuali
CSV sono neutralizzate; il file è UTF-8 con BOM.

Le risposte vengono prodotte in stream con query da 500 righe e cursore
data/id, senza caricare l'intero diario in memoria. Export in sola lettura,
`Cache-Control: private, no-store`; password, sessioni, chiavi Norish/AI, token,
audit globali e payload upstream grezzi sono esclusi. Durante un export lungo
è preferibile attendere la fine prima di modificare le date delle voci.

L'endpoint accetta la sessione del browser oppure l'header
`Authorization: Bearer <token>`. Non accetta token o userId nell'URL: il
proprietario deriva sempre dall'autenticazione. Un Bearer errato non ricade
sulla sessione del browser. Il token vale **solo per questo endpoint**.

## Token personali

`/api/v1/settings/export-tokens` richiede la sessione dell'utente:

- GET: metadati dei propri token.
- POST JSON `{ "label": "Il mio script", "expiresInDays": 90 }`: crea il token,
  restituendolo una sola volta. Durate consentite 30/90/365 giorni; default 90.
- DELETE `?id=<uuid>`: revoca un proprio token.

La creazione/revoca verifica Origin. Sono consentiti al massimo 20 token per
utente, con creazione serializzata nel DB. Il segreto ha 256 bit casuali; nel
DB resta soltanto SHA-256. La lista non restituisce segreti o hash. Revoca,
scadenza o sospensione dell'utente impediscono nuove richieste. La lettura
verifica lo stato dell'utente nel DB e aggiorna la data di ultimo utilizzo.
Usare HTTPS nelle integrazioni da altri dispositivi.

Riferimenti: [PWA installabili (MDN)](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable),
[camera e secure context (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia),
[ZXing browser](https://github.com/zxing-js/browser),
[unità OFF](https://openfoodfacts.github.io/openfoodfacts-server/dev/ref-perl-pod/ProductOpener/Nutrition.html).
