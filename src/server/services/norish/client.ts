import { z } from "zod";

/**
 * Contratto dell'API norish — verificato live 2026-09-29 (docs/ARCHITECTURE.md § 5.1
 * e § 5.2) e archiviato in docs/norish-api/ (OpenAPI + ricetta di esempio).
 * Le fixture sono record storici: la base URL runtime arriva SOLO da env (§ 5.0).
 *
 * Il client è read-only: espone solo GET /api/v1/** (ADR-0006, § 5.0 — divieto
 * di modifica dati sull'istanza upstream). Niente POST/PUT/PATCH/DELETE, nemmeno
 * come metodo interno.
 *
 * Sicurezza del segreto (§ 2 del contratto): la chiave viaggia SOLO nell'header
 * `x-api-key` (mai in query/URL, mai loggata). I messaggi d'errore upstream non
 * sono fidati — un'istanza può echo-are l'header ricevuto — quindi NESSUN testo
 * fornito dall'upstream che contenga la chiave viene incluso nei diagnostic.
 */

/** Item pianificato (schema live `plannedRecipeListItem`, § 5.2). */
export const plannedRecipeSchema = z.object({
  id: z.uuid(), // norish_item_id: con user_id forma la chiave d'idempotenza (§ 3: uuid)
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // YYYY-MM-DD, ISO verificato live (§ 8.3, § 10.2)
  slot: z.enum(["Breakfast", "Lunch", "Dinner", "Snack"]),
  sortOrder: z.number().int().optional().nullable(),
  recipeId: z.uuid(), // uuid, § 3
  version: z.number().int().optional().nullable(),
  recipeName: z.string().optional().nullable(),
  recipeImage: z.string().optional().nullable(),
  servings: z.number().optional().nullable(), // frazioni possibili (§ 8.4)
  calories: z.number().optional().nullable(), // kcal PER PORZIONE; § 8.4: non escludere decimali
});
export type PlannedRecipe = z.infer<typeof plannedRecipeSchema>;

/** Ricetta completa (§ 5.3): macro come stringhe decimali, nullable. */
export const recipeDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  servings: z.number(), // frazione possibile (§ 8.4)
  calories: z.number().optional().nullable(), // § 8.4: non escludere decimali
  fat: z.string().optional().nullable(),
  carbs: z.string().optional().nullable(),
  protein: z.string().optional().nullable(),
}).passthrough();
export type RecipeDetail = z.infer<typeof recipeDetailSchema>;

/** Risposta payload ricetta (array o oggetto, a seconda dell'istanza) (§ 5.3). */
export const recipeResponseSchema = z.union([
  recipeDetailSchema,
  z.object({ recipe: recipeDetailSchema }).transform((r) => r.recipe),
  z.array(recipeDetailSchema).transform((r) => r[0] ?? null),
]);

/** Envelope d'errore upstream (verificato live: 401 UNAUTHORIZED, 404 NOT_FOUND) (§ 5.5). */
export const apiErrorSchema = z.object({
  message: z.string().optional(),
  code: z.string().optional(),
  data: z.unknown().optional(),
});

export class NorishApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "NorishApiError";
  }
}

const TIMEOUT_MS = 10_000; // § 5.5: timeout 10 s per richiesta (copre body, vedi sotto)

export interface NorishClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

const isRetryableStatus = (status: number) => status === 429 || (status >= 500 && status <= 599);
const BACKOFF_MS = [2_000, 4_000, 8_000]; // 2s→4s→8s poi la sync riparte nel prossimo ciclo (§ 5.5)
/** Codici d'errore locale che VALGONO un retry; tutto il resto (401/403/404/validation) no. */
const TRANSIENT_CODES = new Set(["NETWORK_ERROR", "TIMEOUT"]);

/**
 * Client REST per l'istanza norish configurata (§ 5). Solo lettura.
 * Matrice di retry (§ 5.5): 3 tentativi extra con backoff 2s→4s→8s su errori di
 * rete, timeout e 429/5xx; MAI su 401/403 (auth) né sui 4xx di validazione.
 * Diagnostica secret-safe: i messaggi upstream che contengono la chiave NON
 * vengono propagati (sostituiti da un fallback generico).
 */
export class NorishClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NorishClientOptions) {
    const base = options.baseUrl.replace(/\/+$/, "");
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("Norish base URL must be an HTTP(S) origin without credentials, query or fragment");
    }
    if (url.pathname !== "" && url.pathname !== "/") {
      throw new Error("NORISH_BASE_URL non deve contenere un path (il client aggiunge /api/v1)");
    }
    this.baseUrl = url.origin;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getHealth(): Promise<boolean> {
    try {
      const response = await this.request("GET", "/api/v1/health", { auth: false });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Pasti pianificati del giorno (core sync § 5.1). */
  async getPlannedRecipesToday(): Promise<PlannedRecipe[]> {
    return this.getPlanned("today");
  }

  /** Settimana corrente lato server (core sync § 5.1). */
  async getPlannedRecipesWeek(): Promise<PlannedRecipe[]> {
    return this.getPlanned("week");
  }

  /** Mese corrente (backfill alla prima connessione della chiave, § 5.4). */
  async getPlannedRecipesMonth(): Promise<PlannedRecipe[]> {
    return this.getPlanned("month");
  }

  /** Dettaglio ricetta per il mirror snapshot (ADR-0005). */
  async getRecipe(id: string): Promise<RecipeDetail | null> {
    let data: unknown;
    try {
      data = await this.getJsonWithRetry(`/api/v1/recipes/${encodeURIComponent(id)}`);
    } catch (error) {
      if (error instanceof NorishApiError && error.status === 404) return null; // item skippato con log (§ 5.5)
      throw error;
    }
    const parsed = recipeResponseSchema.safeParse(data);
    if (parsed.success) return parsed.data;
    throw new Error(`Payload ricetta non riconosciuto (GET /recipes/${id})`);
  }

  /**
   * @deprecated POST search is forbidden by ADR-0006, even if semantically read-only.
   * Retained for compatibility: always rejects before touching the transport.
   */
  async searchRecipes(params: { limit?: number; search?: string; cursor?: string } = {}) {
    const response = await this.request("POST", "/api/v1/recipes/search", {
      body: { limit: params.limit ?? 50, search: params.search, cursor: params.cursor },
    });
    if (!response.ok) throw await this.toApiError(response);
    const json: unknown = await response.json();
    const data = (json as { data?: unknown[] }).data ?? (Array.isArray(json) ? json : []);
    return data.map((item) => plannedRecipeSchema.partial().parse(item));
  }

  private async getPlanned(period: "today" | "week" | "month"): Promise<PlannedRecipe[]> {
    const data = await this.getJsonWithRetry(`/api/v1/planned-recipes/${period}`);
    const parsed = z.array(plannedRecipeSchema).safeParse(data);
    if (parsed.success) return parsed.data;
    throw new Error(`Payload inatteso da /planned-recipes/${period}: atteso array § 5.2`);
  }

  /**
   * GET + parse JSON con la matrice di retry § 5.5: al più 3 retry (4 tentativi
   * totali) con backoff 2s/4s/8s su errori di rete, timeout (anche sul body) e
   * 429/5xx. Tutti gli altri errori (401/403, 4xx, payload non valido) NON
   * ritentano: si propagano subito al caller.
   */
  private async getJsonWithRetry(path: string): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.request("GET", path);
      } catch (error) {
        if (error instanceof NorishApiError && TRANSIENT_CODES.has(error.code ?? "") && attempt < BACKOFF_MS.length) {
          await sleep(BACKOFF_MS[attempt]);
          continue;
        }
        throw error;
      }
      if (response.ok) {
        try {
          return await this.jsonWithDeadline(response);
        } catch (error) {
          if (error instanceof NorishApiError && error.code === "TIMEOUT" && error.status === 0 && attempt < BACKOFF_MS.length) {
            await sleep(BACKOFF_MS[attempt]);
            continue;
          }
          throw error;
        }
      }
      if (isRetryableStatus(response.status) && attempt < BACKOFF_MS.length) {
        await this.drain(response);
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw await this.toApiError(response);
    }
  }

  /** Rilascia il corpo di una risposta che non verrà consumata (best effort). */
  private async drain(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      // corpo già locked o già consumato: irrilevante
    }
  }

  /**
   * Il budget di 10 s copre ANCHE il consumo del body, non solo l'arrivo degli
   * header (§ 5.5): una stream bloccata non può appendare il sync worker.
   */
  private async jsonWithDeadline(response: Response): Promise<unknown> {
    const bodyPromise = response.json();
    void Promise.resolve(bodyPromise).catch(() => {}); // mai unhandled rejection dalla branch perdente
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        bodyPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new NorishApiError("Norish response body timed out", 0, "TIMEOUT")), TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if (error instanceof NorishApiError) throw error;
      throw new Error(`Payload ricetta/planned non è JSON valido (${response.status})`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Raw response; only literal GET and canonical /api/v1/ paths are allowed. */
  async request(
    method: string,
    path: string,
    { body, auth = true }: { body?: unknown; auth?: boolean } = {},
  ): Promise<Response> {
    if (method !== "GET") {
      throw new Error("Norish client is read-only: only GET is allowed");
    }
    const pathname = path.split("?", 1)[0];
    // Fail closed on encoded separators/dots/percent (including nested encoding).
    // Query values do not participate in path resolution.
    if (!path.startsWith("/api/v1/") || /[\\#\s\u0000-\u001f\u007f]/u.test(path) ||
        /%(?:2e|2f|5c|25)/i.test(pathname) ||
        pathname.split("/").some((segment) => segment === "." || segment === "..")) {
      throw new Error("Norish path must stay within /api/v1/ (no traversal or ambiguous encoding)");
    }
    const target = new URL(path, this.baseUrl);
    if (target.origin !== new URL(this.baseUrl).origin || !target.pathname.startsWith("/api/v1/")) {
      throw new Error("Norish path must stay within the configured origin and /api/v1/");
    }
    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth) headers["x-api-key"] = this.apiKey; // § 5.1: UNICO meccanismo (Bearer → 401, contratto § 2)
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const headersPromise = this.fetchImpl(target.href, {
        method,
        redirect: "manual", // Never follow Location outside the validated boundary.
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      void Promise.resolve(headersPromise).catch(() => {}); // mai unhandled rejection dalla branch perdente
      return await Promise.race([
        headersPromise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new NorishApiError("Norish request timed out", 0, "TIMEOUT"));
          }, TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if (error instanceof NorishApiError) throw error;
      throw new NorishApiError("Norish network request failed", 0, "NETWORK_ERROR");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Envelope d'errore upstream. Secreto-sicuro: se il messaggio upstream
   * contiene la chiave (echo dell'header lato server) NON viene propagated;
   * nemmeno l'URL della response entra nel messaggio (contiene solo origin e
   * path, ma meglio non riporre path arbitrari nei diagnostic).
   */
  private async toApiError(response: Response): Promise<NorishApiError> {
    const fallback = `Norish API error (HTTP ${response.status})`;
    let message = fallback;
    let code: string | undefined;
    try {
      const parsed = apiErrorSchema.safeParse(await this.jsonWithDeadline(response));
      if (parsed.success && typeof parsed.data.message === "string" && !parsed.data.message.includes(this.apiKey)) {
        message = parsed.data.message;
      }
      if (parsed.success) code = parsed.data.code;
    } catch {
      // corpo non JSON o non leggibile: resta il fallback generico
    }
    return new NorishApiError(message, response.status, code);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}