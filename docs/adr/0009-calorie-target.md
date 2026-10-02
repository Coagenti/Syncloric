# ADR-0009 — Target calorico per utente

Decisione TL della card t_37d3e20e. Questa decisione prevale sulla formula iniziale
in ARCHITECTURE §4.3 (offset donna e arrotondamenti intermedi).

## Formula server-side

Età = anno corrente del server − anno di nascita (limiti della funzione: 10–100).
BMR = 10 × peso kg + 6,25 × altezza cm − 5 × età + offset.
Offset: uomo +5, donna −166 (valore esplicitamente stabilito dal TL).
Nessun arrotondamento intermedio.

| Attività | Fattore TDEE |
| --- | --- |
| Sedentario | 1,2 |
| Leggero | 1,375 |
| Moderato | 1,55 |
| Attivo | 1,725 |
| Molto attivo | 1,9 |

TDEE = BMR × fattore attività.

| Obiettivo | Delta kcal |
| --- | --- |
| Perdita peso | −500 |
| Mantenimento | 0 |
| Massa | +300 |

Target = Math.round(max(TDEE + delta, floor) / 5) × 5.
Floor: donna 1200 kcal, uomo 1500 kcal. Il floor riguarda la stima,
non modifica il valore manuale scelto dall'utente.

## Persistenza e API

/profile richiede sessione; redirect server-side a /login prima dell'accesso DB.
GET /api/v1/profile restituisce {profile: null | profilo} dell'utente autenticato.
PUT /api/v1/profile valida e fa UPSERT sulla PK profiles.user_id: sex (f/m),
heightCm (intero positivo), weightKg (positivo, una cifra decimale, max 999,9),
birthYear (anno corrente −100 … −10), activityLevel, goal, targetSource,
manualTargetKcal (intero positivo oppure null; obbligatorio se fonte manuale).
Il server ricalcola sempre calculatedTargetKcal; altezza e risultato devono
rientrare nell'intervallo PostgreSQL integer positivo (max 2147483647).
Gli errori delle dipendenze restituiscono JSON generico 503 senza dettagli interni;
l'UPSERT restituisce la riga salvata senza una seconda lettura.
Eventuali userId/calculatedTargetKcal
nel payload vengono ignorati. Le risposte profilo/preview sono private, no-store.
Le scritture richiedono JSON e Origin uguale all'origine della richiesta.
POST /api/v1/profile/preview usa gli stessi dati, restituisce
{calculatedTargetKcal} senza salvare. La UI richiede la stima dopo 300 ms,
annulla richieste obsolete e non presenta una stima precedente per dati modificati.

Il feed diario sceglie esclusivamente il campo corrispondente a targetSource.
Nessun profilo: target null, riepilogo informativo e CTA «Configura obiettivo»;
nessun numero di differenza proposto. Profilo configurato: differenza rispetto
al target selezionato. Nessuna raccomandazione nutrizionale.

## Verifiche e trasparenza

Vettori fissi a 30 anni, attività moderata: uomo 80 kg/180 cm
2260/2760/3060 kcal (perdita/mantenimento/massa); donna 60 kg/165 cm
1540/2040/2340. Casi sotto soglia verificano 1200/1500.
Test PGlite: UPSERT, switch, isolamento utenti, feed, validazione e preview senza write.
Browser Chromium: form reale + HTTP reali + PGlite; sessione iniettata solo
nell'harness di test (non è una prova di login end-to-end), guard con test unitari.

Implementazione e test generati con assistenza AI. Contributo umano documentato:
formula, API/UX e priorità definite dal Technical Lead; operatore ha autorizzato
il modello equivalente; review TL/Marketing e merge demandati ai responsabili.
Nessuna approvazione umana implicita in questi test.
