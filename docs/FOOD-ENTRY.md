# Inserimento alimenti e porzioni

Il pulsante **+** di ogni pasto apre `/diary/add?date=YYYY-MM-DD&slot=Lunch`.
La pagina mantiene data e pasto, si apre sulla tab **Ricerca** senza attivare
la tastiera e offre **Scansione** e **Etichetta AI**. Le tab supportano frecce,
Home/End e link tramite fragment. La scheda prodotto è una vista della pagina;
Indietro del browser torna alla selezione. **Fine** torna al diario della data.

## Ricerca e abitudini

- La ricerca per nome usa il servizio ufficiale
  [Search-a-licious](https://openfoodfacts.github.io/search-a-licious/users/ref-openapi/)
  di Open Food Facts, con lingua italiana/inglese, 20 risultati per pagina e
  selezione **Italia / Tutti i paesi**. Il filtro Italia indica il mercato di
  vendita, non l'origine del prodotto.
- Le richieste partono dopo 900 ms senza digitazione. Una nuova query annulla
  la precedente; i dati del catalogo locale restano utilizzabili quando OFF
  è indisponibile. Dati OFF attribuiti ODbL/DbCL, nutrienti assenti sconosciuti.
- Cache pubblica sul server: 10 minuti, massimo 200 query. Richieste uguali
  concorrenti condividono il risultato. Limite conservativo di 10 ricerche nuove
  al minuto per processo; in caso di attesa la UI riprova una volta la query
  ancora corrente. Su più repliche serve un limite condiviso al proxy.
- Lo switch admin Open Food Facts controlla anche la ricerca per nome. Nessuna
  credenziale né cronologia alimentare viene inviata: solo query e mercato.
- A campo vuoto compaiono i **più usati** del pasto corrente: conteggio delle
  voci dell'utente, ordine per frequenza e uso recente. Nessun dato di altri
  utenti o pasti contribuisce alla classifica. Le voci Norish rimosse sono escluse.
  Eliminare una voce la rimuove anche dal conteggio; non esiste un secondo log
  permanente delle abitudini. Le ricette del catalogo sono nella sezione dedicata.

## Scheda alimento e porzioni

La scheda mostra energia e nutrienti della quantità selezionata. Si possono
usare grammi oppure unità salvate, ad esempio **Biscotto = 6 g** e
**Pacchetto = 50 g**, ciascuna con quantità predefinita. All'apertura viene
selezionata la prima porzione disponibile. **1,5 biscotti** corrisponde a **9 g**;
il peso di un biscotto resta 6 g. Virgola e punto sono accettati per i decimali.
I grammi totali sono arrotondati a due decimali, le kcal all'intero più vicino.

**Modifica alimento e porzioni** consente di salvare le definizioni personali
senza aggiungere una voce al diario. Nome, marca e valori per 100 g del catalogo
sono modificabili dal creatore dell'alimento. Gli altri utenti possono sempre
modificare le proprie porzioni. Le nuove definizioni iniziali sono disponibili
come base nel catalogo; gli override in `food_preferences` sono per utente.
Rimuovere tutte le porzioni personali mantiene una preferenza vuota e usa grammi.

Un nuovo prodotto viene salvato atomicamente con la voce e le preferenze. Se
esiste già il barcode, si usa il prodotto esistente senza sovrascriverne i dati.
Non vengono effettuate scritture su Open Food Facts. Una risposta di rete persa
richiede di controllare il diario prima di ritentare, perché l'API non usa ancora
chiavi d'idempotenza per le registrazioni manuali.

Ogni voce conserva nome della porzione, peso e quantità come snapshot: modificare
le definizioni non cambia i pasti passati. Il dialog di modifica del diario può
usare la porzione registrata o quelle attuali. Cambiare a grammi e salvarli
cancella lo snapshot di unità ormai non applicabile. Export JSON/CSV e copie di
pasti mantengono le informazioni delle porzioni. I pasti copiati restano indipendenti.

## Scansione e AI

Il barcode usa il reader nativo o ZXing; i frame restano sul dispositivo.
Fotocamera fermata alla lettura, al cambio tab, all'uscita e quando la pagina
diventa nascosta. Fotocamera negata o HTTP non sicuro lasciano disponibile il
codice manuale. HTTPS attendibile è necessario fuori da localhost.

La tab AI riusa la configurazione admin: selezione e preview locali, invio solo
premendo **Scansiona etichetta**, destinatario dichiarato e verifica obbligatoria
prima del salvataggio. Nessuna chiamata AI viene fatta aprendo le tab o scegliendo
una foto. Il parser e i provider restano quelli già configurati nell'istanza.
Il riquadro riprende lo scanner e spiega di fotografare la tabella nutrizionale
con kcal, nutrienti e unità leggibili. Il LED indica la disponibilità del servizio
AI: verde se configurato e abilitato, rosso se disattivato o non disponibile;
durante la verifica iniziale resta neutro.

## API e migrazione

| Endpoint | Funzione |
| --- | --- |
| `GET /api/v1/foods/search?query=...&country=it&page=1` | Ricerca locale e OFF |
| `GET /api/v1/foods/frequent?slot=Breakfast` | Più usati del proprio pasto |
| `GET /api/v1/foods/:id` | Scheda e porzioni personali |
| `PATCH /api/v1/foods/:id` | `portions` e `product` opzionale, riservato al creatore |
| `POST /api/v1/foods` | Nuovo alimento + preferenze + voce del diario |
| `POST /api/v1/diary` | Alimento esistente o ricetta; alimenti con `portion`/`portions` opzionali |
| `PATCH /api/v1/diary/:id` | Quantità e `portion` opzionale per le voci manuali |

Le nuove API richiedono una sessione attiva; ban verificato nel DB. Scritture con
Origin uguale all'origine pubblica configurata, body limitato a 16 KiB e schema
rigoroso; risposte private/no-store. Max 20 porzioni per alimento, pesi/quantità
positivi con due decimali; quantità di unità max 10.000 e grammi max 999.999,99.
I campi `userId` e `source` non sono accettati dalle nuove API.

Migrazione **0006_food_portions**: definizioni JSON del catalogo, preferenze per
utente e snapshot del diario. Le vecchie `serving_grams`/`serving_label` restano
leggibili come singola porzione; nessun valore passato viene ricalcolato.
