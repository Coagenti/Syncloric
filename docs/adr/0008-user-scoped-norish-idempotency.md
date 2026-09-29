# ADR-0008 — Idempotenza norish per coppia utente/item

Stato: decisione approvata dal Technical Lead nella card `t_3899c9f8`;
documentazione soggetta a review e merge tramite PR.
Data: 2026-09-29.
Raffina: ADR-0006 in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Contesto

Utenti Syncloric distinti possono condividere lo stesso household norish e
importare lo stesso item upstream nei rispettivi diari. Un vincolo UNIQUE globale
su `diary_entries.norish_item_id` impedirebbe il secondo import; un upsert basato
solo sull'item potrebbe aggiornare la voce di un altro utente.

## Decisione

- `norish_item_id` resta UUID nullable, senza UNIQUE globale.
- L'indice univoco è `(user_id, norish_item_id)` con predicato
  `WHERE norish_item_id IS NOT NULL`.
- L'upsert del sync usa esattamente la coppia e il predicato come conflict target;
  `user_id` proviene dall'utente del run, non dal payload upstream.
- `date` e `slot` restano fuori dalla chiave: possono cambiare upstream e vengono
  aggiornati sulla voce esistente, secondo le regole di ownership del § 5.4.
- `(user_id, date, slot, norish_item_id)` è soltanto un indice di query
  non-univoco; resta anche l'indice di query `(user_id, date)`.

Forma SQL normativa del vincolo (non è una migrazione eseguita):

```sql
CREATE UNIQUE INDEX diary_entries_user_norish_item_unique
ON diary_entries (user_id, norish_item_id)
WHERE norish_item_id IS NOT NULL;
```

Forma del conflict target: `ON CONFLICT (user_id, norish_item_id)
WHERE norish_item_id IS NOT NULL DO UPDATE ...`. I campi aggiornati e il controllo
di modifica manuale restano quelli di ARCHITECTURE.md § 5.4.

## Conseguenze e verifiche richieste all'implementazione

1. Due utenti possono importare lo stesso item senza contaminazione dei diari.
2. Reimport dello stesso item per lo stesso utente aggiorna una sola voce.
3. Cambio upstream di data/slot non crea duplicati.
4. Più voci con `norish_item_id IS NULL` restano ammesse per lo stesso utente.
5. La migrazione iniziale e i test di integrazione PostgreSQL devono coprire
   questi casi, oltre al rispetto delle modifiche manuali previsto dal § 5.4.

Non cambiano il sync read-only, la gestione delle voci orfane o il modello
un solo upstream per istanza (ADR-0007). Quest'ultimo è il trigger di revisione
della chiave qualora in futuro venissero introdotti più upstream per istanza.

## Provenienza e supervisione

Testo redatto con assistenza AI da Hermes, profilo Sviluppatore, sulla decisione
del Technical Lead tracciata nella card `t_3899c9f8`. Nessuna revisione umana
è attestata in questa versione; il contributo umano documentato è il brief
di progetto, mentre la review e il merge di questa PR restano da eseguire.