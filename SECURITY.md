# Security Policy

## Come segnalare una vulnerabilità

**Non aprire una issue pubblica.** Usa il canale privato di GitHub:

> Repository → **Security** → **Report a vulnerability** (GitHub Security Advisories)

Il canale arriva direttamente ai maintainer ed è il modo più rapido per gestire la disclosure.

Se non puoi usare GitHub, apri una issue con il solo testo "security: richiesta canale privato"
senza dettagli tecnici: ti risponderemo con un canale riservato.

## Ambito

In ambito:

- autenticazione e gestione di sessione, controllo dell'origine sulle scritture API;
- isolamento dei dati tra utenti e nuclei familiari (household), autorizzazioni admin;
- gestione e cifratura delle credenziali inserite da UI (chiavi provider AI, chiavi upstream);
- injection (SQL/HTML/SSRF) nelle rotte API e nelle integrazioni upstream;
- esposizione di segreti in log, messaggi di errore, artefatti di build.

Fuori ambito: risultati di scanner automatici senza prova di impatto, Denial of Service
volumetrici, vulnerabilità in dipendenze senza percorso di sfruttamento dimostrabile,
configurazioni di deployment non documentate in `docs/DEPLOY.md`.

## Versioni supportate

Solo l'ultima release pubblicata e `main` ricevono correzioni di sicurezza. I deployment
self-hosted sono responsabilità di chi li gestisce (aggiornamento, backup, raggiungibilità
del database, TLS).

## Cosa aspettarti

- presa in carico entro 5 giorni lavorativi;
- valutazione e piano di correzione comunicati nel canale privato;
- credito nella advisory se lo desideri;
- nessun programma di bug bounty: non ci sono premi economici.

## Pratiche per chi fa self-hosting

- genera `ENCRYPTION_KEY` e `BETTER_AUTH_SECRET` distinti per ogni ambiente e non riutilizzarli
  tra produzione e ambienti di test;
- esponi l'app solo dietro un reverse proxy con TLS e mantieni `BETTER_AUTH_URL` coerente
  con l'origine pubblica;
- non riutilizzare chiavi API di produzione in ambienti dove girano build o codice di terzi;
- applica le migrazioni con un backup del database disponibile (vedi `docs/DEPLOY.md`).
