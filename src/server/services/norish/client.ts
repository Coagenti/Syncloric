import { z } from "zod";

/**
 * Contratto dell'API norish — verificato live 2026-09-29 (docs/ARCHITECTURE.md § 5.1
 * e § 5.2) e archiviato in docs/norish-api/ (OpenAPI + ricetta di esempio).
 * Le fixture sono record storici: la base URL runtime arriva SOLO da env (§ 5.0).
 *
 * Il client è read-only: espone solo GET /api/v1/** (ADR-0006, § 5.0 — divieto
 * di modifica dati sull'istanza upstream). Niente POST/PUT/PATCH/DELETE, nemmeno
 * come metodo interno.
 */

/** Item pianificato (schema live `plannedRecipeListItem`, § 5.2). */
export const plannedRecipeSchema = z.object({
  id: z.string().min(1), // norish_item_id: con user_id forma la chiave d'idempotenza
  date: z.string(), // YYYY-MM-DD, fuso del server norish — trattato come stringa (§ 10.2)
  slot: z.enum(["Breakfast", "Lunch", "Dinner", "Snack"]),
  sortOrder: z.number().int().optional().nullable(),
  recipeId: z.string(),
  version: z.number().int().optional().nullable(),
  recipeName: z.string().optional().nullable(),
  recipeImage: z.string().optional().nullable(),
  servings: z.number().int().optional().nullable(),
  calories: z.number().int().optional().nullable(), // kcal PER PORZIONE (§ 5.2, verificato)
});
export type PlannedRecipe = z.infer<typeof plannedRecipeSchema>;

/** Ricetta completa (§ 5.3): macro come stringhe decimali, nullable. */
export const recipeDetailSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  servings: z.number().int(),
  calories: z.number().int().optional().nullable(),
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

const TIMEOUT_MS = 10_000; // § 5.5: timeout 10 s per richiesta

export interface NorishClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

const RETRYABLE_STATUS = new Set([429, 503]);
const BACKOFF_MS = [2_000, 4_000, 8_000]; // 2s→4s→8s poi la sync riparte nel prossimo ciclo (§ 5.5)

/**
 * Client REST per l'istanza norish configurata (§ 5). Solo lettura.
 * Throttling difensivo: backoff su 429/503 (rate limit opaco 500/h, no header
 * esposti); 401/404 non ritentano (inutile/dannoso) — si propagano al caller (§ 5.5).
 */
export class NorishClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NorishClientOptions) {
    const base = options.baseUrl.replace(/\/+$/, "");
    const url = new URL(base);
    if (url.pathname !== "" && url.pathname !== "/") {
      throw new Error("NORISH_BASE_URL non deve contenere un path (il client aggiunge /api/v1)");
    }
    this.baseUrl = base;
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getHealth(): Promise<boolean> {
    try {
      const response = await this.request("GET", "/health", { auth: false });
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
    const response = await this.request("GET", `/recipes/${id}`);
    if (response.status === 404) return null; // item skippato con log (§ 5.5)
    if (!response.ok) throw await this.toApiError(response);
    const parsed = recipeResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new Error(`Payload ricetta non riconosciuto (GET /recipes/${id})`);
    }
    return parsed.data;
  }

  /**
   * Ricerca ricette upstream (POST /recipes/search, § 5.1) — v1.1 feature;
   * il POST qui sotto NON modifica dati upstream ed è l'unica post prevista.
   */
  async searchRecipes(params: { limit?: number; search?: string; cursor?: string } = {}) {
    const response = await this.request("POST", "/recipes/search", {
      body: { limit: params.limit ?? 50, search: params.search, cursor: params.cursor },
    });
    if (!response.ok) throw await this.toApiError(response);
    const json: unknown = await response.json();
    const data = (json as { data?: unknown[] }).data ?? (Array.isArray(json) ? json : []);
    return data.map((item) => plannedRecipeSchema.partial().parse(item));
  }

  private async getPlanned(period: "today" | "week" | "month"): Promise<PlannedRecipe[]> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.request("GET", `/planned-recipes/${period}`);
      if (response.ok) {
        const body: unknown = await response.json();
        if (!Array.isArray(body)) {
          throw new Error(
            `Payload inatteso da /planned-recipes/${period}: atteso array (§ 5.2)`,
          );
        }
        return body.map((item) => plannedRecipeSchema.parse(item));
      }
      const error = await this.toApiError(response);
      // 429/503 → backoff e retry fino a 3 volte, poi il ciclo riparte dopo (§ 5.5)
      if (RETRYABLE_STATUS.has(response.status) && attempt < 3) {
        await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
        continue;
      }
      throw error;
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    { body, auth = true }: { body?: unknown; auth?: boolean } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (auth) headers["x-api-key"] = this.apiKey; // § 5.1: header x-api-key (o Bearer equivalente)
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async toApiError(response: Response): Promise<NorishApiError> {
    let message = `HTTP ${response.status} da ${response.url}`;
    let code: string | undefined;
    try {
      const parsed = apiErrorSchema.safeParse(await response.json());
      if (parsed.success) {
        message = parsed.data.message ?? message;
        code = parsed.data.code;
      }
    } catch {
      // corpo non JSON: resta il messaggio di default
    }
    return new NorishApiError(message, response.status, code);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}