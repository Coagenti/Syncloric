# Errori e focus del profilo

Il salvataggio di `/profile` conserva i valori del form quando fallisce e permette di riprovare. Durante la richiesta i campi e il pulsante sono disabilitati; un guard impedisce invii duplicati.

Dopo la risposta e il commit React che riabilita i controlli:
- con errori di validazione (422), il focus va al primo campo invalido nell'ordine del DOM; il messaggio italiano è associato tramite `aria-describedby`;
- con successo, errore server o rete, si ripristina il controllo da cui è stato inviato il form se il focus è rimasto sul BODY. Non si sottrae il focus a un altro controllo scelto dall'utente mentre attendeva.

I vincoli sono quelli del server, senza cambiare formula o intervalli: sesso f/m, altezza intera positiva entro int32, peso positivo fino a 999,9 con un decimale, anno intero fra anno corrente−100 e anno corrente−10, attività e obiettivo selezionati, target manuale intero positivo entro int32. La stima fuori intervallo è segnalata separatamente. Una risposta 401 richiede nuovo accesso; 5xx indica indisponibilità temporanea, non dati errati; l'errore di connessione invita a verificare la rete e riprovare. Le risposte di errore non JSON non sono interpretate come errori dei campi.

Regressioni: `tests/unit/profile-errors.test.ts` verifica i messaggi server; `tests/e2e/profile.spec.ts` usa Chromium, componenti React, handler HTTP e PGlite reali, con sessione iniettata solo nel test. Verifica Enter su Salva, risposta sospesa, focus del primo invalido e Tab successivo, successo, 503 non JSON, rete interrotta e retry con valori preservati. Le risposte 503/rete sono simulate nel browser, non guasti di produzione. Le evidenze visuali opt-in utilizzano CSS PostCSS compilato reale e larghezze 320/390.

Contributo AI: codice, test e documentazione realizzati con assistenza Hermes AI. Contributo umano documentato: specifiche e decisioni vincolanti del Technical Lead e requisiti della review Marketing; approvazioni tecniche e grafiche finali sono affidate ai rispettivi gate e non dichiarate già effettuate. Nessun accesso o deploy in produzione.
