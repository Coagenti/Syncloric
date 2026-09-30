# Configurazione runtime (ADR-0007)

Il bootstrap Node.js `register()` in `src/instrumentation.ts` chiama
`loadEnvConfig()` prima di migrazioni e scheduler. `NORISH_BASE_URL` è obbligatoria:
nessun default, nessun host upstream incorporato. Valori assenti, vuoti o URL
malformati causano un errore con `NORISH_BASE_URL` e `ADR-0007` e impediscono
l'avvio. Il valore non viene stampato nella diagnostica.

Come prescritto da ARCHITECTURE § 9.2, usare HTTPS (HTTP solo per sviluppo su
localhost), senza slash finale sull'host radice. Specificare un URL assoluto
con schema e authority, non una forma abbreviata come `https:host`.
Il caricatore elimina gli spazi esterni; non verifica la raggiungibilità di rete.

I moduli server importano `loadEnvConfig` o `norishBaseUrl` da `@/server/config`;
il client HTTP usa `norishBaseUrl()` e aggiunge i propri path API. Il risultato
è memorizzato per processo: cambiare env richiede un riavvio, non un rebuild.
`resetEnvConfigCache()` è riservato ai test. La validazione completa include
anche DATABASE_URL, BETTER_AUTH_SECRET ed ENCRYPTION_KEY.

Il build Next.js e il runtime non-Node non eseguono questo bootstrap. L'immagine
può quindi essere costruita senza la configurazione specifica del deployment;
la validazione obbligatoria avviene all'avvio del server.

Verifiche: `pnpm test:unit` include i casi validi/assenti/vuoti/malformati e il
bootstrap reale con soli effetti DB/scheduler isolati; `pnpm test` include
anche i test d'integrazione. Nessun test config contatta l'upstream.

Contributo AI: aggiornamenti del loader, test e questa documentazione generati
con assistenza AI. Contributo umano: specifica e decisioni architetturali in
ADR-0007; review/approvazione finale demandata al Technical Lead, non dichiarata
già eseguita da questo deliverable.
