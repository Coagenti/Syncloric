# Profilo, scadenze e obiettivi macro

`/profile` mantiene la navigazione dell’app e usa quattro tab: Profilo,
Obiettivo, Nutrienti e Sicurezza. I link al calcolo puntano a
`/profile#obiettivo`; il menu account in alto offre Profilo, Impostazioni ed Esci.

## Obiettivo temporale

Peso desiderato e data sono facoltativi e riguardano il target calcolato per
perdita di peso. Il riferimento per una prima fase del **5–10% in circa sei
mesi** viene dal [NIH/NIDDK](https://www.niddk.nih.gov/health-information/weight-management/choosing-a-safe-successful-weight-loss-program),
non da una scadenza universale OMS. La stima è limitata ad adulti con BMI ≥25,
traguardo entro il 10% del peso corrente, BMI desiderato ≥18,5 e periodo fino
a tre anni. Età approssimata dall’anno di nascita; non è un modello per minori,
gravidanza, allattamento o condizioni cliniche, che richiedono un percorso personale.

Per evitare la regola lineare dei 7.700 kcal/kg, il calcolo usa una **approssimazione
di primo ordine** della regola pratica di [Hall et al., Lancet 2011](https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/):
22 kcal/giorno per kg di variazione a regime, con tempo di dimezzamento di circa
un anno. Deficit richiesto = `22 × kg / (1 − exp(−ln(2) × giorni / 365))`.
Questa interpolazione del software non è il simulatore NIH completo, né una
previsione individuale validata. I valori vanno rivalutati aggiornando il peso.

Limiti del prodotto, non prescrizioni OMS: deficit fino a 500 kcal/giorno,
al 20% del mantenimento, ritmo richiesto fino a 0,5 kg/settimana e soglie caloriche
preesistenti di 1.200/1.500 kcal. Una data troppo breve produce una preview
limitata e una data alternativa; il server rifiuta il salvataggio del periodo
eccessivo. Data conclusa o peso raggiunto riportano il target al mantenimento.
La data non garantisce il raggiungimento del peso. Il target manuale resta
una scelta esplicita dell’utente e non usa il piano temporale.

## Macro

Le percentuali vengono convertite in grammi con 4 kcal/g per carboidrati e
proteine e 9 kcal/g per grassi. Sono obiettivi personali giornalieri; i dati
alimentari mancanti restano sconosciuti e le barre dichiarano i totali parziali.

- [EFSA carboidrati](https://www.efsa.europa.eu/en/efsajournal/pub/1462): 45–60% dell’energia.
- [EFSA grassi](https://www.efsa.europa.eu/en/efsajournal/pub/1461): 20–35%.
- [EFSA proteine](https://www.efsa.europa.eu/en/efsajournal/pub/2557): riferimento adulto sano di 0,83 g/kg/giorno.
- [OMS dieta sana](https://www.who.int/news-room/fact-sheets/detail/healthy-diet): 10–15% proteine generalmente sufficiente per adulti di peso sano; esigenze sportive maggiori.
- [ISSN](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/): 1,4–2 g/kg per chi si allena.
- [Leidy et al.](https://pubmed.ncbi.nlm.nih.gov/25926512/): studi sulla perdita di peso con 1,2–1,6 g/kg.
- [NASEM/AMDR](https://www.ncbi.nlm.nih.gov/books/NBK610333/): intervallo adulto proteine 10–35%.

I suggerimenti sono **scelte iniziali del software entro questi riferimenti**,
non ripartizioni prescritte dalle fonti. Il riferimento proteico è 0,83 g/kg
per vita sedentaria/leggera, 1–1,2 per attività generale, 1,4 per perdita di peso
e 1,6 per forza, resistenza o massa; viene convertito e limitato al 10–35%.
Carboidrati e grassi si adattano conservando gli intervalli sopra. Il peso è quello
registrato, non la massa magra; nell’obesità e in condizioni cliniche il risultato
va personalizzato. Il pannello mostra anche i g/kg: una percentuale entro range
non garantisce di soddisfare il riferimento individuale. Gli override devono
sommare 100%; nuovi suggerimenti macro non vengono offerti ai minori.

## Account e dati

Il nome visualizzato è modificabile; lo username di accesso resta quello
registrato. Foto JPEG/PNG/WebP fino a 2 MB e 16 milioni di pixel, decodificate
con sharp, ridimensionate a 256×256 WebP, senza metadati. Sono salvate nel DB,
lette solo con la sessione dell’utente e mai inserite nella cache PWA.

Il cambio password usa Better Auth con password attuale, conferma e revoca
facoltativa delle altre sessioni (attiva inizialmente). L’eliminazione richiede
password e `ELIMINA`, limita i tentativi e protegge l’ultimo amministratore.
La cancellazione e il trasferimento della proprietà di un nucleo sono atomici.
FK cascade revoca sessioni, token, chiavi e dati privati; il catalogo condiviso
e le copie autonome create da altri vengono conservati. Nessuna password,
foto o valore privato è scritto nell’audit dell’eliminazione.

Migrazione: `0007_goal_profile_account`. API private e con controllo Origin:
`GET/PATCH/DELETE /api/v1/account`, `GET/PUT/DELETE /api/v1/account/avatar`,
`PUT /api/v1/profile/macros`; i campi opzionali dell’obiettivo estendono le API
profilo e preview esistenti. Nessuna modifica del sync Norish.
