# ADR-0010: credenziali Norish personali e credenziali AI amministrative da UI

Data: 2026-10-05. Decisione richiesta dall'utente per la revisione di architettura.

## Decisione

Ogni account Syncloric, incluso il primo amministratore, usa esclusivamente la
propria chiave Norish. L'URL Norish rimane globale (GUI admin > env > unset).
La chiave globale `NORISH_API_KEY` è ignorata e non viene copiata ad alcun utente.
Scheduler, trigger HTTP e CLI condividono la stessa risoluzione della chiave;
lo scheduler seleziona soltanto utenti non sospesi con credenziale personale.
Feed, diary writes, lock, circuit breaker e run restano limitati all'utente.

Provider, abilitazione e chiavi OpenAI/Anthropic sono invece globali all'istanza,
configurabili soltanto da un amministratore. Le chiavi da UI hanno precedenza
sulle env legacy `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`; rimuovere l'override UI
ripristina l'eventuale env, come dichiarato nella pagina. Un override cifrato
non leggibile rende la scansione non disponibile e non ricade sull'env.
Ollama non richiede una chiave cloud. Nessun provider viene abilitato implicitamente.

## Persistenza e confini

Riutilizziamo `admin_settings`: `norish.key.<session-user-id>` per Norish,
`ai.key.openai` e `ai.key.anthropic` per AI. Il valore è soltanto `{ciphertext}`,
AES-256-GCM con IV casuale e master `ENCRYPTION_KEY` dell'istanza. Questo conserva
le chiavi Norish già cifrate senza migrazione o ricifratura. La denominazione
della tabella non concede accesso amministrativo ai campi personali: ogni endpoint
costruisce il proprio namespace dalla sessione; input con userId non è accettato.

- `/api/v1/settings/norish-key`: GET/PUT/DELETE autenticati, sempre sulla propria
  chiave. PUT `{apiKey}`; GET e risposte di scrittura espongono soltanto
  `{configured, stored, urlConfigured}`. Rimuovere la chiave non elimina il diario.
- `/api/v1/settings/ai-key`: GET/PUT/DELETE admin-only. PUT `{provider, apiKey}`;
  DELETE `{provider}`, provider solo openai/anthropic. Risposte con stato/fonte,
  mai valori delle chiavi. Provider e chiavi sono letti con un solo SELECT per
  costruire la connessione usata da un'estrazione; il consenso al provider resta
  verificato prima di inviare la foto.
- Scritture: controllo dell'origine pubblica condiviso (Origin richiesto), JSON
  bounded a 8 KiB, chiave ASCII stampabile fino a 4096 caratteri, schema strict.
  Risposte `private, no-store`, errori sanitizzati, audit con attore/target/stato
  dell'operazione senza plaintext né ciphertext.
- Campo UI password vuoto, mai precompilato; salvataggio esplicito, valore locale
  svuotato dopo conferma. Nessun localStorage o restituzione della chiave salvata.
  Lo stato GET iniziale non può sovrascrivere una successiva risposta di salvataggio.

Il salvataggio non contatta Norish o provider AI: verifica formato e persistenza,
non la validità remota. I controlli reali avvengono al sync o scan richiesto.
I segreti infrastrutturali (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`)
restano nell'ambiente. DB e master devono essere conservati insieme nei backup;
questa revisione non aggiunge un flusso di rotazione della master key.

## Passaggio da deployment precedenti

Rimuovere l'uso di `NORISH_API_KEY`; il primo account deve inserire la propria
chiave da UI come gli altri. Le credenziali personali già cifrate restano valide.
Le env AI possono essere mantenute come fallback, oppure rimosse dopo aver
salvato le chiavi dalla UI e ricreato il container. La rimozione UI non modifica
l'ambiente del processo. Nessuna cancellazione automatica di credenziali o diario
in caso di errore di autenticazione. Il cambio dell'URL Norish continua a richiedere
la verifica delle chiavi da parte degli utenti.

Questa decisione supera i precedenti vincoli «chiave Norish globale/demo» e
«chiavi AI esclusivamente nell'ambiente» nelle specifiche storiche. Il bootstrap
del primo amministratore e gli altri invarianti amministrativi restano invariati.

## Verifica

PGlite con migrazioni reali: isolamento CRUD, nessun fallback del primo account,
selezione delle chiavi nel sync/scheduler, account sospesi saltati, ACL admin AI,
precedenza UI/env, cifratura e assenza di segreti in risposte e audit, input e
origini invalidi. Chromium con componenti/API reali: persistenza, rotazione,
rimozione, campi mai precompilati, UI utente/admin e reflow 320/390/1440 px.
Norish e AI sono simulati ai confini HTTP; nessuna chiamata reale a provider.
