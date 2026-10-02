import { describe, expect, it } from "vitest";
import { buildDiaryMutationHandlers } from "@/server/services/diary/mutate";

const handlers = buildDiaryMutationHandlers({
  getSession: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
  getDb: () => { throw new Error("Invalid input must not access DB"); },
});
const patch = (body: unknown) => handlers.PATCH(new Request("http://localhost/api/v1/diary/aaaaaaaa-1111-4111-8111-111111111111", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "aaaaaaaa-1111-4111-8111-111111111111" }) });

describe("diary mutation validation before DB", () => {
  it.each([
    { ...{ quantityGrams: 150 }, date: "2026-02-30" },
    { quantityGrams: -1 },
    { quantityGrams: 0 },
    { quantityGrams: 0.001 },
    { quantityGrams: 1000000 },
    { kcal: -1 },
    { kcal: 1.5 },
    { kcal: 2147483648 },
    { slot: "Brunch" },
    { servings: 0 },
    { servings: 1.234 },
    { userId: "22222222-2222-4222-8222-222222222222" },
    { source: "norish_sync" },
    { foodId: "aaaaaaaa-1111-4111-8111-111111111111" },
    { recipeId: "aaaaaaaa-1111-4111-8111-111111111111" },
    { entryType: "recipe" },
    { norishItemId: null },
    {},
    null,
  ])("returns a clear 400 without DB access: %j", async (body) => {
    const response = await patch(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it("rejects simple text/plain requests even when they contain JSON", async () => {
    const response = await handlers.PATCH(new Request("http://localhost/api/v1/diary/aaaaaaaa-1111-4111-8111-111111111111", { method: "PATCH", body: JSON.stringify({ kcal: 5 }) }), { params: Promise.resolve({ id: "aaaaaaaa-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Usa Content-Type application/json." });
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await handlers.PATCH(new Request("http://localhost/api/v1/diary/aaaaaaaa-1111-4111-8111-111111111111", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{" }), { params: Promise.resolve({ id: "aaaaaaaa-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "JSON non valido." });
  });

  it("sanitizes database failures", async () => {
    const response = await patch({ kcal: 5 });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Non è stato possibile aggiornare la voce. Riprova." });
  });

  it("sanitizes session provider failures", async () => {
    const response = await buildDiaryMutationHandlers({ getSession: async () => { throw new Error("private auth failure"); }, getDb: () => { throw new Error("unused"); } }).PATCH(new Request("http://localhost/api/v1/diary/aaaaaaaa-1111-4111-8111-111111111111", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kcal: 5 }) }), { params: Promise.resolve({ id: "aaaaaaaa-1111-4111-8111-111111111111" }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Non è stato possibile aggiornare la voce. Riprova." });
  });
});