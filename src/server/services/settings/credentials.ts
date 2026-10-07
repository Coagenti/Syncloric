import { z } from "zod";
import { loadEnvConfig } from "@/server/config";
import { encryptSecret, decryptSecret } from "@/server/services/norish/crypto";
import { setAdminSetting } from "@/server/db/repositories/settings";

export const apiKeySchema = z.string().trim().min(1).max(4096).regex(/^[!-~]+$/);
export const norishCredentialKey = (userId: string) => `norish.key.${userId}`;
export const cloudProviderSchema = z.enum(["openai", "anthropic"]);
export type CloudProvider = z.infer<typeof cloudProviderSchema>;
export const aiCredentialKey = (provider: CloudProvider) => `ai.key.${provider}`;

/** Existing Norish ciphertexts remain readable; secrets never enter responses or audits. */
export function credentialValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const ciphertext = (value as { ciphertext?: unknown } | null)?.ciphertext;
  if (typeof ciphertext !== "string") throw new Error("Credenziale non utilizzabile.");
  const secret = decryptSecret(ciphertext, loadEnvConfig().ENCRYPTION_KEY);
  if (!apiKeySchema.safeParse(secret).success) throw new Error("Credenziale non utilizzabile.");
  return secret;
}

export function credentialStatus(value: unknown) {
  try { return { configured: !!credentialValue(value), stored: value !== undefined }; }
  catch { return { configured: false, stored: true }; }
}

export async function saveCredential(db: Parameters<typeof setAdminSetting>[0], key: string, apiKey: string) {
  await setAdminSetting(db, key, { ciphertext: encryptSecret(apiKey, loadEnvConfig().ENCRYPTION_KEY) });
}
