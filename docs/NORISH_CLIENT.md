# Client HTTP norish read-only

Contratto ADR-0006 e ARCHITECTURE §9.3, implementato in
`src/server/services/norish/client.ts`.

## Interfaccia

`new NorishClient({ baseUrl, apiKey, fetchImpl? })`: baseUrl è obbligatoria,
iniettata dal chiamante (normalmente dal loader di NORISH_BASE_URL), senza
accessi a env o host predefiniti nel client. Deve essere un'origine HTTP(S),
senza path applicativo, credenziali, query o fragment; slash finale ammesso.
`fetchImpl` è un transport fidato compatibile con fetch, sostituibile nei test.

`await client.request(method, path, { auth?, body? }?)` restituisce la Response
raw; gli status HTTP non-2xx restano al caller. Il metodo deve essere esattamente
`GET` (case-sensitive); qualunque altro valore rigetta la Promise con errore
`Norish client is read-only: only GET is allowed` prima di chiamare il transport.
Anche il vecchio `searchRecipes()` è deprecato e rigetta: POST search non è
un'eccezione alla policy, nemmeno se semanticamente di sola lettura.
L'opzione body è mantenuta per compatibilità interna, ma un body GET non è
supportato dal fetch standard e non va passato.

Il path è completo e root-relative: `/api/v1/health`, non `/health`.
Sono ammesse query; sono rifiutati URL assoluti, path fuori `/api/v1/`, fragment,
whitespace/control characters, backslash e segmenti dot. Per prevenire ambiguità
tra proxy, sono rifiutati nel pathname anche dot/slash/backslash/percent codificati
(inclusa codifica annidata). La URL risolta viene ricontrollata per origine e
prefisso. Gli ID ricetta vengono codificati come singolo segmento.

Ogni fetch usa `redirect: "manual"`: nessun redirect viene seguito, neppure
verso la stessa origine. Il caller riceve lo status 3xx e non deve seguirne
Location fuori da questo client. La chiave non viene inoltrata a destinazioni
indicate da un redirect. Timeout esistente: 10 secondi; errori di rete propagati.

Restano disponibili getHealth (false su errore/non-2xx, senza auth),
getPlannedRecipesToday/Week/Month e getRecipe, con gli schemi e il backoff
preesistenti. Tutte le richieste attraversano la stessa guardia.

## Verifica

`pnpm test:unit` include `tests/unit/norish-readonly.test.ts`: transport mockato,
nessuna rete verso norish, rifiuto metodi e path con zero chiamate, GET consentito,
POST search bloccato, controllo redirect e validazione base URL.
`pnpm test:integration`, `pnpm lint`, `pnpm typecheck`, `pnpm build` completano
le verifiche; la CI esistente esegue questi gate.

## Provenienza

Codice, test e questa documentazione sono generati con assistenza AI (Hermes).
Specifiche e vincoli derivano dalla card e dagli ADR del Technical Lead;
review/approvazione umana non attestata da questa implementazione e da registrare
al momento dell'approvazione. Nessun merge autonomo.
