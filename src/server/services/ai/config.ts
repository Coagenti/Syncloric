import { z } from "zod";
import type { Db } from "@/server/db";
import { getAdminSettings, setAdminSetting } from "@/server/db/repositories/settings";
import type { AiConnection } from "./extract";
import { writeAdminAudit } from "@/server/db/repositories/admin-users";
export const providerSchema = z.enum(["openai", "anthropic", "ollama"]);
export const settingsSchema = z.object({ enabled: z.boolean(), provider: providerSchema.nullable() }).strict().refine(v => !v.enabled || v.provider !== null);
export const models = { openai: "gpt-4.1-mini", anthropic: "claude-haiku-4-5-20251001", ollama: "llama3.2-vision" } as const;
export type AiEnv = Record<string,string | undefined>;
/** Only presence is projected; environment secrets never enter admin_settings. */
export async function aiConfig(db: Db, env: AiEnv = process.env) {
  const settings = await getAdminSettings(db, ["ai.provider", "ai.enabled"]);
  const parsed = providerSchema.safeParse(settings["ai.provider"]); const provider = parsed.success ? parsed.data : null;
  const enabled = settings["ai.enabled"] === true && provider !== null;
  const keys = { openai: !!env.OPENAI_API_KEY?.trim(), anthropic: !!env.ANTHROPIC_API_KEY?.trim(), ollama: true };
  const ready = enabled && provider !== null && keys[provider];
  return { enabled, provider, ready, keys, cloud: provider === "openai" || provider === "anthropic" };
}
export function aiConnection(provider: NonNullable<Awaited<ReturnType<typeof aiConfig>>["provider"]>, env: AiEnv): AiConnection {
  const model = env.SYNCLORIC_AI_MODEL?.trim() || models[provider];
  if (provider !== "ollama") return { provider, model, key: provider === "openai" ? env.OPENAI_API_KEY?.trim() : env.ANTHROPIC_API_KEY?.trim() };
  const baseUrl = env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434";
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid Ollama URL");
  return { provider, model, baseUrl: baseUrl.replace(/\/$/, "") };
}
export async function saveAiConfig(db: Db, value: z.infer<typeof settingsSchema>, actorUserId?: string) {
  await db.transaction(async tx => {
    await setAdminSetting(tx, "ai.enabled", value.enabled);
    await setAdminSetting(tx, "ai.provider", value.provider);
    await writeAdminAudit(tx, { actorUserId, action: "settings.update", target: "ai", detail: { enabled: value.enabled, provider: value.provider } });
  });
}
