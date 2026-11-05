# Diario per pasto

Il diario riassume Colazione, Pranzo, Spuntino e Cena in card cliccabili:
kcal, proteine, carboidrati e grassi totali. Il pulsante + mantiene l'inserimento
diretto. Gli alimenti sono nella pagina autenticata
`/diary/meal?date=YYYY-MM-DD&slot=Lunch` (slot canonici del diario).

La pagina del pasto mostra macro, micronutrienti disponibili e gli alimenti
della sola data e del solo pasto selezionati. Zero noto e dato sconosciuto
restano distinti; le somme incomplete mostrano Parziale. La lista conserva
quantità, porzioni e dettagli nutrizionali per voce. Le voci manuali offrono
modifica, eliminazione con conferma e duplicazione. La condivisione tramite
link rimane disponibile nell'intestazione della lista.

La duplicazione consente di scegliere data e pasto di destinazione; quantità,
porzioni, nome e valori nutrizionali sono copiati. La copia è manuale e
indipendente dal catalogo e dalla sincronizzazione. Si possono duplicare anche
voci Norish: l'originale rimane gestito dal sync, la copia è modificabile.
Per le ricette importate vengono copiati i totali effettivamente mostrati,
applicando le porzioni una sola volta. Kcal e nutrienti mancanti restano tali.

`POST /api/v1/diary/{id}/duplicate` accetta esclusivamente:

```json
{"date":"2026-11-04","slot":"Dinner"}
```

Richiede una sessione attiva, utente non bloccato e Origin consentita.
La voce deve appartenere all'utente della sessione; ID inesistenti o altrui
restituiscono 404. Nessun campo nutrizionale o riferimento di catalogo viene
accettato dal client: lo snapshot viene letto dal database nella transazione.
La risposta 201 contiene `id`, `date` e `slot`, con cache privata disabilitata.
La UI verifica la risposta prima di confermare il successo; in caso di esito
incerto invita a controllare il diario prima di riprovare.
