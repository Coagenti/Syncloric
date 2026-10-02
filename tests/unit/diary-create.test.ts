import { describe, expect, it } from "vitest";
import { buildDiaryCreateHandlers } from "@/server/services/diary/create";

const handlers = buildDiaryCreateHandlers({
  getSession: async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }),
  getDb: () => { throw new Error("Invalid input must not access DB"); },
});
const valid = { date: "2026-10-01", slot: "Lunch", entryType: "food", foodId: "aaaaaaaa-1111-4111-8111-111111111111", quantityGrams: 150 };

describe("diary POST validation before DB", () => {
  it.each(["https://attacker.invalid", "http://sub.localhost", "null"])("rejects cross-origin browser writes: %s", async (origin) => {
    const response = await handlers.POST(new Request("http://localhost/api/v1/diary", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(valid) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Origine della richiesta non consentita." });
  });

  it("rejects simple text/plain requests even when they contain JSON", async () => {
    const response = await handlers.POST(new Request("http://localhost/api/v1/diary", { method: "POST", body: JSON.stringify(valid) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Usa Content-Type application/json." });
  });

  it("rejects malformed JSON with 400", async () => {
    const response = await handlers.POST(new Request("http://localhost/api/v1/diary", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "JSON non valido." });
  });

  it("sanitizes database failures", async () => {
    const response = await handlers.POST(new Request("http://localhost/api/v1/diary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Non è stato possibile salvare la voce. Riprova." });
  });

  it("sanitizes session provider failures", async () => {
    const response = await buildDiaryCreateHandlers({ getSession: async () => { throw new Error("private auth failure"); }, getDb: () => { throw new Error("unused"); } }).POST(new Request("http://localhost/api/v1/diary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Non è stato possibile salvare la voce. Riprova." });
  });

  it.each([
    { ...valid, quantityGrams: 0.001 },
    { ...valid, quantityGrams: 1.234 },
    { ...valid, quantityGrams: 1000000 },
    { ...valid, slot: "Brunch" },
    { ...valid, entryType: undefined },
    { ...valid, entryType: "other" },
    { ...valid, date: "2026-02-30" },
    { ...valid, foodId: "not-uuid" },
    { ...valid, quantityGrams: 0 },
    { ...valid, quantityGrams: -1 },
    { ...valid, quantityGrams: "150" },
    { ...valid, foodId: undefined, name: " ", kcal: 50 },
    { ...valid, foodId: undefined, name: "Pera" },
    { ...valid, foodId: undefined, name: "Pera", quantityGrams: undefined, kcal: 50 },
    { date: valid.date, slot: valid.slot, entryType: "recipe", recipeId: valid.foodId },
    null,
  ])("returns clear 400 without DB access: %j", async (body) => {
    const response = await handlers.POST(new Request("http://localhost/api/v1/diary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });
});
