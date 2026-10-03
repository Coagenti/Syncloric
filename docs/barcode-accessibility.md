# Barcode: focus e feedback asincrono

Il dialog mantiene i token e il branding esistenti, inclusa la conferma AI.

- Ricerca conclusa: focus sul nome prodotto (anche readonly per il catalogo locale).
- Ricerca o salvataggio falliti: alert focalizzabile e visibile nel dialog scrollabile, dopo il render che riabilita i controlli.
- Se l'utente sposta deliberatamente il focus durante la richiesta, non viene riposizionato alla risposta. Escape/chiusura/successo del salvataggio riportano al trigger Scansiona.
- La validazione HTML nativa focalizza il primo campo non valido. Le risposte 400/422 mostrano i vincoli; 401 richiede accesso, 403 distingue il permesso, gli altri errori HTTP non attribuiscono il guasto ai valori.
- Una ricerca fallita non dichiara il prodotto assente. Il fallback manuale resta disponibile anche senza rete. Solo una risposta `origin: unknown` conferma la ricerca senza risultato.
- Il salvataggio fallito conserva i valori e permette retry. Se la connessione cade durante POST l'esito può essere incerto: il messaggio invita a verificare il diario prima del retry, senza promettere idempotenza non presente nell'API.

Verifica: `pnpm exec vitest run --config vitest.e2e.config.ts tests/e2e/barcode-feedback.spec.ts --maxWorkers=1`.
`BARCODE_EVIDENCE_DIR=/percorso` salva screenshot a 320/390/1440. Il test usa Chromium, componente reale e CSS completo compilato dalla pipeline PostCSS/Tailwind di produzione; API sospese/503/rete sono simulate. I test barcode/camera/AI esistenti verificano separatamente la persistenza PGlite e la conferma AI. Non equivale a camera fisica, provider cloud live, screen reader o audit WCAG completo.

Trasparenza: codice, test, documentazione e screenshot prodotti con assistenza AI Hermes. Contributo umano documentato: brief e perimetro di progetto dell'operatore; decisioni stack/contratti del Technical Lead; requisiti UX e branding della review Marketing M1/M2. Approvazione tecnica, merge e riesame grafico del delta rimangono ai gate assegnati; non si presume una review umana già eseguita.
