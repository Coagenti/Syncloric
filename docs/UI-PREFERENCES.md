# Temi e lingua

Il menu account contiene, nell'ordine, **Profilo**, **Temi**, **Lingua**,
**Impostazioni**, **Esci**. Le due nuove pagine richiedono una sessione attiva.

## Preferenze personali

- Temi scuri: **Cyberpunk** (ciano/giallo, predefinito), **Arasaka Red**
  (nero/rosso/bianco con geometrie giapponesi), **Synthwave**
  (viola/magenta) e **Terminal** (verde/ambra). Le schede mostrano un'anteprima
  della palette e funzionano anche con tastiera e lettore di schermo.
- Cyberpunk include una skin HUD con cornici angolari, tacche, pulsanti
  intagliati e barre segmentate. Le decorazioni non intercettano i click;
  gli sfondi seguono i tagli delle cornici senza sporgere agli angoli,
  anche negli stati selezionati o di eccesso. Il ritaglio riguarda solo
  la superficie dipinta e lascia integri moduli e menu. Scansione luminosa dell'header,
  pulsazione laterale e movimento dei pulsanti rispettano Riduci animazioni.
  I pannelli hanno smussi grandi in alto a sinistra e in basso a destra, piccoli
  sugli altri angoli. Sopra la cornice nine-slice stanno elementi a dimensione
  fissa che non si deformano: linguetta gialla, chevron, tratteggio,
  quadratini di stato, binario laterale e tacche. I pannelli dati li hanno tutti,
  le card più piccole solo una parte. In eccesso la cornice vira al magenta.
  Pulsanti con contorno: gli smussi hanno la loro linea e due staffe interne.
  Schede e celle del calendario sono smussate con lo stesso tratto; il focus
  resta visibile dentro il controllo. I titoli di pagina usano un separatore
  con plateau, codice a barre e nodo finale; la sidebar ha nodi e capsula.
  L'indicatore live diventa un mirino (rotante solo con animazioni attive)
  e le icone delle voci stanno in esagoni.
  La skin è isolata in `src/app/cyberpunk-hud.css`; gli altri temi mantengono
  la propria presentazione. L'anteprima della scheda Cyberpunk riflette l'HUD.
- Arasaka Red ha superfici piatte, cornici rettangolari, logo monocromatico
  e accenti rosso segnale. Il cruscotto è bianco in condizioni ordinarie e rosso
  in eccesso; i colori dei nutrienti mantengono la propria identità.
  Titoli e contatori usano Rajdhani, il testo Zen Kaku Gothic New. I font WOFF2
  sono locali, con subset Latin/Latin Extended e licenze in
  `public/fonts/arasaka-red/` (90 KB complessivi, nessun CDN durante l'uso).
  Venticinque icone SVG originali con tratti squadrati e accento rosso sono
  selezionate dal tema.
  Stili in `src/app/arasaka-red.css`, font-face in `src/app/arasaka-fonts.css`.
- Ogni tema ha una propria identità tipografica e 25 icone SVG originali:

  | Tema | Titoli e contatori | Testo e moduli | Icone |
  | --- | --- | --- | --- |
  | Cyberpunk | Chakra Petch | Barlow | HUD angolari e segmentati |
  | Arasaka Red | Rajdhani | Zen Kaku Gothic New | Tratti squadrati e sigillo rosso |
  | Synthwave | Orbitron | Space Grotesk | Curve e accenti magenta |
  | Terminal | IBM Plex Mono | IBM Plex Mono | Tratti ortogonali da console |

  I valori secondari del cruscotto Synthwave usano Space Grotesk per restare
  leggibili anche a 320 px. Icone, dimensioni delle aree cliccabili e nomi
  accessibili mantengono le stesse funzioni. La selezione del set è CSS,
  quindi vale anche al rendering iniziale senza attendere JavaScript;
  il set condiviso resta come fallback in assenza di un tema.
  Le tre nuove famiglie di glyph sono in `src/components/theme-icon-paths.ts`,
  selezionate da `src/components/ui-icon.tsx` e `src/app/theme-identity.css`.
  I 24 WOFF2 degli altri tre temi sono in `public/fonts/themes/` (380.412 byte
  complessivi), con licenze OFL, URL originali e hash SHA-256 in `sources.json`.
  `src/app/theme-fonts.css` dichiara i font locali; vengono caricati solo i
  caratteri usati dal tema attivo, senza richieste a servizi esterni.
- Lingue: **Italiano** (predefinito) e **English**. La traduzione riguarda
  interfaccia, etichette accessibili, messaggi e formati di date/numeri.
  Nomi di alimenti, marche, ricette e dati personali restano quelli inseriti.
  La lingua viene comunicata anche alla ricerca pubblica Open Food Facts.
- Ogni selezione viene salvata automaticamente per l'utente autenticato.
  Un errore di salvataggio ripristina la preferenza precedente e mostra un
  messaggio. Le altre schede aperte vengono aggiornate dopo il salvataggio.
- **Riduci animazioni** resta una preferenza del browser, presente anche
  nella pagina Temi, inizializzata dalla preferenza del dispositivo.

## API e dati

`GET /api/v1/account/preferences` restituisce
`{preferences:{locale:"it"|"en",theme:"cyberpunk"|"arasaka-red"|"synthwave"|"terminal"}}`.

`PATCH` accetta almeno uno dei due campi, con JSON e Origin valido.
Aggiorna solo i campi forniti: cambiare tema non sovrascrive la lingua.
Valori sconosciuti, campi extra e identificativi utente sono rifiutati.
L'utente è ricavato esclusivamente dalla sessione e il ban è verificato nel DB.
Le risposte sono private/no-store.

La migrazione **0008_user_ui_preferences** aggiunge una tabella con chiave
utente e cancellazione in cascata. Nessuna configurazione globale cambia.
Non occorrono nuove variabili d'ambiente.

I cookie pubblici `syncloric.locale` e `syncloric.theme` contengono soltanto
valori ammessi, per applicare lingua e tema già al rendering iniziale.
Il DB resta la fonte autorevole per l'utente autenticato. In localStorage
viene scritto soltanto un segnale temporale per aggiornare le altre schede,
senza credenziali o dati dell'account.

## Verifica

Il selettore data della barra di Oggi, Diario e Calendario usa
`ThemedDatePicker`: la tendina è un calendario React Aria con palette del tema
e cornice HUD per Cyberpunk. Clic o tocco sulla data e sull'icona lo aprono;
la data resta digitabile da tastiera. Invio, Spazio o Alt+Freccia giù sul campo
aprono il calendario; le frecce muovono il giorno e Invio lo seleziona.
Escape, clic esterno e Chiudi lo chiudono ripristinando il focus.
Vai a oggi usa la data locale. Giorni e intestazioni seguono la lingua scelta;
il valore salvato rimane `YYYY-MM-DD`, senza conversioni di fuso orario.
Su schermi bassi la tendina scorre senza uscire dal viewport.

Unit test per catalogo, parametri di traduzione e valori ammessi; integrazione
con migrazioni reali, isolamento fra utenti, aggiornamenti parziali e controlli
di accesso; Chromium per persistenza, rollback, menu, conferme in inglese e
assenza di overflow a 320/390/1440 px nelle due lingue e nei quattro temi.
Per tutti i temi sono verificati anche il caricamento reale dei font locali,
le famiglie applicate e l'attivazione di un solo set di icone dedicato,
oltre a persistenza e rollback. La distanza fra le etichette della navigazione
mobile viene controllata anche a 320 px nelle due lingue.
Le prove browser usano API simulate; le prove di integrazione usano PGlite.
