import { expect, it, vi } from "vitest";
import { extractLabel, parseLabel } from "@/server/services/ai/extract";
import { aiConnection } from "@/server/services/ai/config";
import openai from "../fixtures/ai-openai.json";
it.each(["openai", "anthropic"] as const)("cloud %s ignores malformed unused Ollama URL", async provider => {
  const config = aiConnection(provider, { OLLAMA_BASE_URL: "not a URL", OPENAI_API_KEY: "test", ANTHROPIC_API_KEY: "test" });
  const http = vi.fn(async () => Response.json(provider === "openai" ? openai : anthropic));
  expect(config.baseUrl).toBeUndefined();
  expect(await extractLabel(config, { mime: "image/png", base64: "aGVsbG8=" }, http)).toEqual(label);
  expect(http).toHaveBeenCalledTimes(1);
});
it("Ollama still validates its selected URL", () => {
  expect(() => aiConnection("ollama", { OLLAMA_BASE_URL: "not a URL" })).toThrow();
  expect(aiConnection("ollama", { OLLAMA_BASE_URL: "http://localhost:11434/" }).baseUrl).toBe("http://localhost:11434");
});
import anthropic from "../fixtures/ai-anthropic.json";
import ollama from "../fixtures/ai-ollama.json";
const label = { name: "Snack", brand: "Test", per100g: { kcal: 400, fat: 12, carbs: 60, protein: 8 } };
it("validates strict label JSON without inventing optional nutrients", () => {
  expect(parseLabel(JSON.stringify(label))).toEqual(label);
  for (const value of [{ ...label, per100g: { kcal: 400 } }, { ...label, per100g: { ...label.per100g, fat: -1 } }, { ...label, extra: "bad" }]) expect(() => parseLabel(JSON.stringify(value))).toThrow();
  expect(() => parseLabel("```json\n{}\n```")).toThrow();
});
it.each(["openai", "anthropic", "ollama"] as const)("extracts %s multimodal HTTP fixture", async provider => {
  const payload = { openai, anthropic, ollama }[provider];
  const http = vi.fn(async () => Response.json(payload));
  expect(await extractLabel({ provider, model: "test-vision", key: "test-only", baseUrl: "http://localhost:11434" }, { mime: "image/png", base64: "aGVsbG8=" }, http)).toEqual(label);
  const [url, init] = http.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain(provider === "openai" ? "api.openai.com" : provider === "anthropic" ? "api.anthropic.com" : "localhost:11434/api/chat");
  expect(init.method).toBe("POST"); expect(init.redirect).toBe("error");
  expect(init.body).toContain("aGVsbG8="); expect(init.body).toContain("test-vision");
});
