# Changelog

## 0.2.0 — 2026-10-14

- Inserimento alimenti in una pagina dedicata con tab Ricerca, Scansione ed
  Etichetta AI. Ricerca per nome su Open Food Facts, alimenti frequenti per pasto
  e gestione di porzioni personali, anche con quantità decimali.
- Etichetta AI con stato di disponibilità, guida alla foto dei valori
  nutrizionali e verifica dei dati prima del salvataggio.
- Profilo con tab Profilo, Obiettivo, Nutrienti e Sicurezza; menu account,
  nome visualizzato, foto privata, cambio password e cancellazione con conferma.
- Obiettivo temporale facoltativo per perdita di peso, limiti al deficit e
  suggerimento di una data alternativa. Scadenza conclusa o peso raggiunto
  riportano il target calcolato al mantenimento.
- Obiettivi macro automatici o personalizzati, percentuali delle calorie,
  kcal e grammi. Diario e dashboard mostrano target e copertura dei dati.
- Pulsanti export JSON/CSV con icone e colori neon.
- Correzioni al controllo Origin di autenticazione e API dietro reverse proxy.
- Archivi sorgente da Git blob, controllo LF e regressione del checkout
  Windows: entrypoint e input del container Linux preservati. Il packaging
  disabilita esplicitamente la conversione CRLF di Git per entrambi i formati.

Migrazioni aggiunte dalla 0.1.0: `0006_food_portions` e
`0007_goal_profile_account`. Backup del database prima dell’aggiornamento;
conservare segreti, nome del progetto Compose e volume DB dell’istanza.

PR incluse: #44, #45, #46 e #47. Le integrazioni con servizi salute sono ancora
in studio su un branch separato e non fanno parte di questa versione.

## 0.1.0 — 2026-10-08

Prima release: diario e nutrienti, UI cyberpunk, PWA, scansione barcode e AI,
Norish per utente, nuclei familiari, condivisione pasti, export JSON/CSV e token
personali. Migrazioni fino a `0005_households_meal_sharing`.
