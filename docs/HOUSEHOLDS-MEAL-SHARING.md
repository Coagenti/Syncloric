# Nuclei familiari e copia dei pasti

## Nucleo

Da **Impostazioni → Nucleo → Nucleo familiare** ogni utente può creare un nucleo oppure
inserire un codice di invito. Un utente appartiene a un solo nucleo alla volta.
Chi lo crea diventa amministratore del nucleo, indipendentemente dal ruolo di
amministratore dell’istanza.

Il codice a 6 cifre dura 10 minuti e può essere usato da più persone durante
questo intervallo. È mostrato solo quando viene creato/rigenerato e il DB conserva
il suo hash. Rigenerazione, rimozione di un membro e passaggio dell’amministrazione
invalidano il codice precedente. Il join permette 5 tentativi per account in una
finestra di 10 minuti, registrati nel DB; il limite resiste ai riavvii.

L’amministratore può rinominare il nucleo, rimuovere membri e passare
l’amministrazione. Prima di uscire da un nucleo con altri membri deve passare
l’amministrazione; l’ultimo membro chiude il nucleo uscendo. La cancellazione
dell’account amministratore chiude il nucleo tramite FK cascade. Nessuna di
queste operazioni elimina i diari personali. Gli account sospesi non possono
leggere, copiare o amministrare; restano visibili nella lista per permetterne
la rimozione.

Il modello funzionale prende come riferimento [Norish](https://github.com/norish-recipes/norish/blob/main/packages/db/src/repositories/households.ts):
un nucleo per utente, amministratore del nucleo, invito a 6 cifre per 10 minuti.
L’implementazione di Syncloric è autonoma e non sincronizza i nuclei con Norish.

## Pasti nel nucleo

Nel diario, il pulsante **Nucleo** apre membro, data e pasto. Tutti i membri
possono leggere tutti i pasti dei membri attivi, anche precedenti all’ingresso
nel nucleo, senza inviti o condivisioni ulteriori. Profili, obiettivi calorici,
credenziali, token e payload upstream non sono esposti.

È possibile selezionare tutte le voci o solo alcuni alimenti/ricette, scegliendo
data e pasto di destinazione. La copia aggiunge voci al proprio diario e non
sostituisce quelle già presenti. Le copie hanno nuovi ID, fonte `manual`, flag
`copied_meal`, nessun identificativo Norish e record nutrizionali indipendenti:
sono modificabili ed eliminabili con i normali controlli. Nome e totali sono
salvati direttamente nella voce privata, senza duplicare il catalogo comune.
La copia conserva
nome, quantità, kcal e nutrienti totali. Per Norish applica le porzioni locali
una sola volta. Quantità/porzioni successive ridimensionano gli snapshot delle
copie; i valori sconosciuti restano sconosciuti.

Uscita e rimozione interrompono immediatamente nuove letture e copie dal nucleo.
Le copie già inserite restano nel diario del destinatario.

## URL per persone esterne

L’icona di condivisione accanto al `+` di un pasto non vuoto genera un URL valido
**2 ore**, anche se il proprietario non appartiene a un nucleo. Il link mostra
solo una fotografia nutrizionale di quel singolo pasto al momento della creazione.
Le modifiche successive all’originale non la aggiornano. Un nuovo link invalida
il precedente; il proprietario può revocarlo dal dialog di condivisione.

Il destinatario può leggere senza account, ma deve accedere per copiare nel
proprio diario. Il link funziona anche tra utenti di nuclei differenti. Scadenza,
revoca e sospensione del proprietario impediscono lettura e copia. Le copie già
inserite restano disponibili.

Il segreto ha 256 bit casuali e il DB conserva solo SHA-256. È collocato nel
fragment dell’URL (`/shared-meal#syncloric_meal_…`), che il browser non invia
nelle richieste della pagina; il client lo trasmette nel corpo JSON solo agli
endpoint dedicati. Pagina pubblica noindex/no-referrer; API `private, no-store`.
Il service worker non conserva pasti o API. Usare l’origin pubblico HTTPS
dell’istanza per condividere con persone che possono raggiungerla.

## API e distribuzione

- `GET /api/v1/household`: il proprio nucleo e i suoi membri.
- `POST /api/v1/household`: azioni `create`, `join`, `regenerate`, `rename`,
  `leave`, `remove`, `transfer`; scritture session-only e Origin obbligatorio.
- `GET /api/v1/household/meals?memberId=<uuid>&date=YYYY-MM-DD`: quattro pasti
  del membro, accessibili solo all’interno del nucleo corrente.
- `GET/POST/DELETE /api/v1/meals/links`: metadati dei propri link attivi,
  creazione con `{date, slot}`, revoca con `?id=<uuid>`.
- `POST /api/v1/meals/shared/read`: `{token}`, restituisce il singolo pasto.
- `POST /api/v1/meals/copy`: `{via:"household",memberId,date,slot,targetDate,targetSlot,entryIds?}`
  oppure `{via:"link",token,targetDate,targetSlot,entryIds?}`. Destinatario
  sempre derivato dalla sessione. Una richiesta copia al massimo 200 voci.

Le copie e le modifiche del nucleo sono transazionali; un lock condiviso nel DB
serializza le autorizzazioni con rimozioni e revoche. Richieste incomplete o
voci selezionate fuori dal pasto vengono rifiutate senza copie parziali.
Se una risposta di copia si perde, controllare il diario prima di riprovare:
una nuova richiesta può aggiungere nuovamente le stesse voci.

Applicare la migrazione `0005_households_meal_sharing` prima di avviare la nuova
versione. Nessun nuovo segreto o IP interno richiesto nella configurazione.
