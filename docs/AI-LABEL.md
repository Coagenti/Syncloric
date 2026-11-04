# AI etichetta nutrizionale (assistiva)

## Flusso e privacy

Nel Diario > Scansiona > codice non presente (oppure dati OFF da verificare),
il form nuovo prodotto propone foto/camera mobile (`capture=environment`).
La selezione e l'anteprima restano nel browser; solo Scansiona etichetta invia
la foto. La UI dichiara il destinatario prima del click. OpenAI e Anthropic
ricevono le foto nel cloud; Ollama sul server configurato in env. Non promettiamo
che un provider non conservi i dati: verificarne le politiche. Syncloric non
persiste/logga immagini, risposte grezze o segreti. Ritagliare l'etichetta,
non includere persone o altri dati personali. JPEG/PNG/WebP max 5 MB; HEIC/SVG
non supportati, nessuna conversione implicita. Validazione MIME, base64 canonico,
firma del file, limite body prima della conversione; non è una decodifica completa.

La risposta compila nome, marca, kcal e tre macro per 100 g. L'utente deve
verificarli/modificarli e selezionare «Ho verificato i valori proposti dall’AI»,
non preselezionata, prima di premere Registra nel diario per creare cibo/voce tramite
l'API barcode preesistente; nessuna scrittura automatica dall'AI. Kcal arrotondate
all'intero secondo lo schema esistente; proteine, grassi e carboidrati sono
arrotondati a due decimali nel prefill (`step=0.01`) per consentire la conferma
con validazione nativa. Grammi registrati e pasto scelto restano invariati. Fibre/sale sono informazioni opzionali
mostrate e non salvate (il catalogo vigente non ha tali colonne); servingSize è
la porzione dichiarata, mostrata senza cambiare i grammi consumati. Campi richiesti
illeggibili non vengono inventati: errore e input manuale sempre disponibile.
Chiudere il dialog abortisce l'attesa client, non garantisce annullamento cloud.
Il submit (anche da tastiera) resta bloccato senza conferma dei risultati AI.
Ogni estrazione riuscita azzera la conferma, anche se i valori sono identici;
un nuovo prodotto/lookup o la chiusura azzera anche lo stato AI applicato.
Errori AI senza risultati applicati non impongono checkbox al flusso manuale.
Se restano risultati AI precedenti, il fallimento di un nuovo tentativo non
rimuove la conferma richiesta per quei valori. Editing, grammi e pasto restano disponibili.

## Config e API

Impostazioni admin: scelta esplicita openai/anthropic/ollama e checkbox abilita.
`ai.provider` e `ai.enabled` sono salvate atomicamente in admin_settings e lette
insieme con un solo SELECT (snapshot coerente). `OLLAMA_BASE_URL` è validata/usata
solo quando il provider è Ollama; un valore inutilizzato malformato non blocca il cloud.
Provider assente/invalido o enabled assente/false = disabled; non inferire da
chiavi presenti. GET/PUT settings non includono segreti (schema strict).
L'endpoint admin separato GET/PUT/DELETE `/api/v1/settings/ai-key` salva chiavi
cloud cifrate; PUT accetta `{provider: "openai"|"anthropic", apiKey: string}` e
DELETE `{provider}`. L'override UI precede l'env legacy e la rimozione ripristina
quel fallback. Configurazione e ciphertext sono letti nello stesso snapshot;
nessun valore della chiave è restituito al client o registrato nell'audit.
Cloud senza chiave = non pronto. Stato Ollama pronto significa configurato,
non già raggiungibile. Env e modelli in [configuration.md](configuration.md).

- GET/PUT `/api/v1/settings/ai`: sessione admin, 401/403 altrimenti. PUT JSON
  `{enabled:boolean,provider:"openai"|"anthropic"|"ollama"|null}`; true richiede
  provider non null. GET mostra solo presenza chiavi, mai il valore.
- GET `/api/v1/label-scan`: qualsiasi sessione, stato enabled/provider/ready/cloud.
- POST `/api/v1/label-scan`: sessione, JSON `{mime,base64,expectedProvider}` senza
  data-URL prefix. `expectedProvider` obbligatorio: `openai`/`anthropic`/`ollama`,
  copiato dal GET e dal destinatario dichiarato prima del click. È un'asserzione
  di consenso, non una scelta del provider: il server usa solo il provider globale.
  Se è cambiato: 409 `AI_PROVIDER_CHANGED`, nessuna estrazione/chiamata provider.
  La UI mantiene foto e valori del form, mostra fallback manuale e aggiorna lo
  stato/disclosure; un nuovo click esplicito è necessario, nessun retry automatico.
  Nessuna URL remota/chiave fornita dall'utente.
- Output `{label:{name,brand?,barcode?,per100g:{kcal,fat,carbs,protein,fiber?,salt?},servingSize?}}`.
  Zod strict, finite/nonnegative, macro<=100, kcal<=10000, nome obbligatorio.
  Rifiutati markdown, JSON malformato, campi sconosciuti e valori mancanti.
  `barcode` è facoltativo: solo 8–14 cifre interamente leggibili, conservate
  come testo per mantenere gli zeri iniziali. Un barcode malformato viene
  omesso senza scartare i valori nutrizionali validi. La nuova vista di
  inserimento propone il codice nel campo modificabile, prima della conferma.
- Errori strutturati: 400 input/asserzione assente o invalida, 401 sessione,
  403 ruolo/origine, 409 disabled/key (`AI_UNAVAILABLE`) o consenso obsoleto
  (`AI_PROVIDER_CHANGED`),
  429 estrazione già in corso per utente, 502 provider/JSON non conforme, 503 DB/auth.
  Nessun errore upstream grezzo. Tutte le risposte private,no-store.
- Write JSON + Origin guard prima del parsing/DB. Reverse proxy deve preservare
  l'origine pubblica, come per le altre API di scrittura.
- Richieste multimodali POST: OpenAI chat completions, Anthropic messages,
  Ollama chat. Prompt JSON-only, temperature 0, timeout 60s, risposta max64KiB,
  no redirect/retry (evitare doppio costo). Concorrenza una richiesta per utente
  per processo; non è un rate-limit distribuito tra repliche. AI enabled=false
  blocca nuove richieste, non revoca quelle già inviate.

## Test e smoke opt-in

`tests/fixtures/ai-{openai,anthropic,ollama}.json` sono fixture sintetiche,
non output di chiamate reali. Unit parser/HTTP multimodali; integration PGlite
settings→estrazione per tre provider con fetch mockata, nessuna food/diary write;
browser Chromium per preview/prefill/edit/save e fallback, admin settings con
handler reali + PGlite. Auth è iniettata solo nell'harness, non login reale;
fotocamera hardware non testata. Tutti entrano nei gate CI esistenti.

Verifica visuale opt-in riproducibile dopo build:
`AI_VISUAL_OUTPUT=/path/di/evidenze node tests/e2e/ai-visual.mjs`
usa CSS produzione, fixture sintetica e viewport 320/390/1440; asserisce
assenza overflow, select admin almeno 44px e ritorno focus al trigger.
Non costituisce un audit WCAG completo.

Smoke reale opzionale SOLO da operatore su ambiente dev/test autorizzato, mai CI:
provisionare la chiave nel vault/env (oppure modello vision su Ollama), configurare
il provider esplicitamente, accedere con sessione reale, scansionare una propria
etichetta non sensibile, confrontare manualmente i numeri stampati con il form,
verificare che non ci siano food/diary write prima della conferma; controllare
la voce dopo conferma e il fallback disabilitando AI. Non copiare chiavi/foto/raw
risposte nei report. Può generare costi cloud; non eseguito dall'agente.

## Provenienza e contributo umano

Codice, test, fixture e documentazione con assistenza AI Hermes. Contributo umano:
brief operatore, decisioni vincolanti TL su provider globale, segreti env, privacy,
contratto estrazione e stack; linee grafiche Marketing sul brand autonomo Syncloric.
Review tecnica/grafica e merge umani non dichiarati già effettuati. Trasparenza
AI ai sensi art.50 AI Act e L.132/2025; non è certificazione di conformità legale.
