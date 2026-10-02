import { expect, it } from "vitest";
import { buildProfileHandlers } from "@/server/services/profile/http";
const request = () => new Request("http://localhost/api/v1/profile");
it("returns private generic JSON when session lookup fails", async () => {
  const handlers = buildProfileHandlers({ getDb: () => { throw new Error("private-db"); }, getSession: async () => { throw new Error("private-auth"); } });
  const response = await handlers.GET(request());
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.text()).not.toContain("private-auth");
});
it("returns private generic JSON when database access fails", async () => {
  const handlers = buildProfileHandlers({ getDb: () => { throw new Error("private-db"); }, getSession: async () => ({ user: { id: "test-user" } }) });
  const response = await handlers.GET(request());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-db");
});
const valid = { sex: "m", heightCm: 180, weightKg: 80, birthYear: new Date().getFullYear() - 30, activityLevel: "moderate", goal: "maintain", targetSource: "calculated" };
const writeRequest = (data: unknown) => new Request("http://localhost/api/v1/profile", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(data) });
const handlers = () => buildProfileHandlers({ getDb: () => { throw new Error("Unexpected database access"); }, getSession: async () => ({ user: { id: "test-user" } }) });
it.each([2147483648, 2147483647])("rejects height/target integer overflow %s before DB access", async (heightCm) => {
  expect((await handlers().PUT(writeRequest({ ...valid, heightCm }))).status).toBe(422);
  expect((await handlers().PREVIEW(writeRequest({ ...valid, heightCm }))).status).toBe(422);
});
it.each([
  ["sex", "x", "Seleziona Donna o Uomo per il calcolo."],
  ["heightCm", 0, "Inserisci un’altezza intera tra 1 e 2147483647 cm."],
  ["weightKg", 1000, "Inserisci un peso tra 0,1 e 999,9 kg, con al massimo un decimale."],
  ["birthYear", 1800, `Inserisci un anno di nascita intero tra ${new Date().getFullYear() - 100} e ${new Date().getFullYear() - 10} (età da 10 a 100 anni).`],
  ["activityLevel", "unknown", "Seleziona un livello di attività dall’elenco."],
  ["goal", "unknown", "Seleziona Perdita peso, Mantenimento o Massa."],
  ["targetSource", "unknown", "Seleziona Calcolato o Manuale."],
  ["manualTargetKcal", -1, "Inserisci un target manuale intero tra 1 e 2147483647 kcal."],
])("explains the %s validation constraint in Italian", async (field, value, message) => {
  const response = await handlers().PUT(writeRequest({ ...valid, [field as string]: value }));
  expect(response.status).toBe(422);
  expect((await response.json()).fields[field as string]).toEqual([message]);
});

it("preview ignores the unrelated manual target and source", async () => {
  const response = await handlers().PREVIEW(writeRequest({ ...valid, targetSource: "manual", manualTargetKcal: -1 }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ calculatedTargetKcal: 2760 });
});
