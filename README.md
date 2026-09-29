# Syncloric

Webapp self-hosted per il conteggio calorie (stile Yazio), integrata con le API di
norish per importare in automatico i pasti segnati sul calendario e le kcal associate.

Dashboard moderna in stile cyberpunk (palette Cyberpunk 2077), mobile-first.

## Stato del progetto

Repo appena inizializzata. L'architettura e lo stack tecnico (frontend, backend,
database, distribuzione Docker) sono definiti in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
La struttura completa delle cartelle (`src/`,
test, CI, Dockerfile, docker-compose) viene creata a valere su quel documento.

## Funzionalità previste

- Tracking dei pasti (colazione, pranzo, spuntino, cena) con registrazione di
  ingredienti o ricette (le ricette risiedono su norish)
- Scan barcode: ricerca tra cibi/ingredienti già in database, con registrazione
  manuale dei nuovi (come Yazio)
- Scan etichetta con AI per inserimento rapido dei nuovi prodotti
  (provider configurabili: OpenAI / Anthropic / Ollama)
- Import automatico dal calendario di norish via API key: i pasti e le kcal
  del giorno arrivano già popolati
- Target calorico: impostazione manuale oppure calcolo in base all'obiettivo
  (perdita peso, mantenimento, aumento massa) e ai dati dell'utente
- Multi-utente con registrazione e login sicuri (self-hosted, senza reliance
  su un server di invio email)
- Pannello di amministrazione per le configurazioni globali
  (es. provider AI, come su norish)

## Istanze / Ambienti

- **Istanza di test corrente:** [norish.coagenti.it](https://norish.coagenti.it)
  è utilizzabile **solo in lettura: è vietato creare, modificare o cancellare dati
  su norish**, anche durante test, demo o collaudi. L'import legge i dati upstream
  e li salva in Syncloric; non autorizza scritture su norish.
- **Configurabilità e pubblicazione futura:** Syncloric è progettato per essere
  configurabile e pubblicabile su altre istanze self-hosted in futuro, senza
  dipendere dall'host di test. L'URL dell'istanza norish deve poter essere impostato
  dall'utente finale o da chi effettua il deploy, senza modificare il codice,
  tramite variabili d'ambiente o file di configurazione (`NORISH_BASE_URL`).
- **Stato attuale:** la configurazione dell'endpoint è **pianificata, non ancora
  implementata** in questo repository. Modalità operative e superficie completa
  (inclusi i segreti correlati) saranno documentate con l'implementazione; il
  riferimento per le decisioni è
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (§ 5.0 e § 9, ADR-0007). Non è
  quindi disponibile oggi una procedura di deploy funzionante.

Le fixture in `docs/norish-api/` sono snapshot del contratto osservato sull'istanza
di test in sola lettura (vietato modificarne i dati), non una configurazione di
deploy né un endpoint da fissare nel codice. I test che richiedono scritture
devono usare mock, fixture o ambienti separati autorizzati, mai l'istanza di test
corrente.

## Integrazione con norish

La connessione all'istanza norish configurata è prevista tramite API key. L'API key va
sempre fornita tramite variabile d'ambiente o secret del deploy —
**mai committata nel repository**. Il `.gitignore` esclude i file `.env*`
(ad eccezione di `.env.example`): nessun valore reale finisce nel repo.

## Sviluppo

- Architettura e decisioni di stack: `docs/ARCHITECTURE.md`
- Il codice arriva tramite branch e pull request, senza merge diretti su main