import { afterEach, describe, expect, it } from "vitest";
import { NorishClient, plannedRecipeSchema, recipeResponseSchema } from "@/server/services/norish/client";
import { PLANNED_RECIPE, RECIPE_DETAIL, OK_HEALTH } from "../fixtures/norish";

/**
 * Unit test del client norish (§ 5): fetch iniettata con i payload reali
 * archiviati (docs/norish-api/),.zero rete. Semantica kcal = kcal per porzione
 * (verificata live 2026-09-29) e matrice errori 401/404 come da § 5.5.
 */

function fetchOk(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

function fetchStatus(status: number, body: unknown = { message: "UNAUTHORIZED", code: "UNAUTHORIZED" }): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

const CLIENT_BASE = { baseUrl: "https://norish.example.invalid", apiKey: "test-key-1" };

describe("NorishClient (contratto § 5, fixture live)", () => {
  afterEach(() => {
    // nessuno stato globale da ripulire: fetch è iniettata per-test
  });

  it("parsa un planned recipe reale (kcal per porzione, § 5.2)", () => {
    const parsed = plannedRecipeSchema.parse(PLANNED_RECIPE);
    expect(parsed.calories).toBe(458);
    expect(parsed.slot).toBe("Breakfast");
  });

  it("parsa il payload ricetta (macro stringhe decimali, § 5.3)", () => {
    const parsed = recipeResponseSchema.parse(RECIPE_DETAIL);
    expect(parsed.name).toBe("Sachertorte");
    expect(parsed.fat).toBe("27.40");
  });

  it("getPlannedRecipesToday ritorna l'array con header x-api-key", async () => {
    let seenHeaders: Record<string, string> | undefined;
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify([PLANNED_RECIPE]), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new NorishClient({ ...CLIENT_BASE, fetchImpl });
    const items = await client.getPlannedRecipesToday();
    expect(items).toHaveLength(1);
    expect(items[0].recipeName).toBe("Sachertorte");
    expect(seenHeaders?.["x-api-key"]).toBe("test-key-1");
    expect(seenHeaders?.Accept).toBe("application/json");
  });

  it("getRecipe su 404 ritorna null (item skippato con log, § 5.5)", async () => {
    const client = new NorishClient({ ...CLIENT_BASE, fetchImpl: fetchStatus(404) });
    expect(await client.getRecipe("1f0e6f5e-1aab-4bbb-8ccc-000000000002")).toBeNull();
  });

  it("401 si propaga come NorishApiError senza retry (§ 5.5)", async () => {
    const client = new NorishClient({ ...CLIENT_BASE, fetchImpl: fetchStatus(401) });
    await expect(client.getPlannedRecipesToday()).rejects.toThrow(/UNAUTHORIZED|401/);
  });

  it("getHealth ritorna true su 200 senza auth", async () => {
    const client = new NorishClient({ ...CLIENT_BASE, fetchImpl: fetchOk(OK_HEALTH) });
    expect(await client.getHealth()).toBe(true);
  });

  it("getHealth ritorna false su errore di rete (mai throw)", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const client = new NorishClient({ ...CLIENT_BASE, fetchImpl });
    expect(await client.getHealth()).toBe(false);
  });

  it("rifiuta una base URL con path (il client aggiunge /api/v1, § 5.0)", () => {
    expect(
      () => new NorishClient({ baseUrl: "https://example.com/nested", apiKey: "k" }),
    ).toThrow(/path/);
  });
});