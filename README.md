# Syncloric

Webapp self-hosted per il conteggio calorie (stile Yazio), integrata con le API di
[norish.coagenti.it](https://norish.coagenti.it) per importare in automatico i pasti
segnati sul calendario e le kcal associate.

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

## Integrazione con norish

La connessione a `norish.coagenti.it` avviene tramite API key. L'API key va
sempre fornita tramite variabile d'ambiente o secret del deploy —
**mai committata nel repository**. Il `.gitignore` esclude i file `.env*`
(ad eccezione di `.env.example`): nessun valore reale finisce nel repo.

## Sviluppo

- Architettura e decisioni di stack: `docs/ARCHITECTURE.md`
- Il codice arriva tramite branch e pull request, senza merge diretti su main