import { NextResponse } from "next/server";
import { z } from "zod";
import type { Db } from "@/server/db";
import { isAllowedRequestOrigin } from "@/server/http/request-origin";
import { norishBaseUrl, NORISH_SETTINGS_KEY } from "@/server/config";
import { getAdminSettings, deleteAdminSetting } from "@/server/db/repositories/settings";
import { writeAdminAudit } from "@/server/db/repositories/admin-users";
import { buildAdminSettingsOverride } from "./norish-url";
import { apiKeySchema, norishCredentialKey, aiCredentialKey, cloudProviderSchema, credentialStatus, saveCredential } from "./credentials";
import { aiConfig, type AiEnv } from "@/server/services/ai/config";

type Deps = { getDb: () => Db; getSession: (headers: Headers) => Promise<{ user: { id: string; role?: string | null } } | null>; env?: () => AiEnv };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const norishInput = z.object({ apiKey: apiKeySchema }).strict();
const aiInput = z.object({ provider: cloudProviderSchema, apiKey: apiKeySchema }).strict();
const aiDelete = z.object({ provider: cloudProviderSchema }).strict();

async function boundedInput(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > 8192) throw new Error("Input non valido.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Input non valido.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > 8192) throw new Error("Input non valido.");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally { await reader.cancel(); }
}

/** The owner comes exclusively from the authenticated session; no userId input. */
export function buildCredentialHandlers(deps: Deps, scope: "norish" | "ai") {
  async function authorize(request: Request, write: boolean) {
    const session = await deps.getSession(request.headers);
    if (!session?.user) return json({ error: "Autenticazione richiesta." }, 401);
    if (scope === "ai" && session.user.role !== "admin") return json({ error: "Richiede amministratore." }, 403);
    if (write && !isAllowedRequestOrigin(request, { requireOrigin: true })) return json({ error: "Origine non consentita." }, 403);
    return session;
  }
  async function status(db: Db, userId: string) {
    if (scope === "ai") return aiConfig(db, deps.env?.() ?? process.env);
    const key = norishCredentialKey(userId);
    const settings = await getAdminSettings(db, [key, NORISH_SETTINGS_KEY]);
    const baseUrl = norishBaseUrl(buildAdminSettingsOverride(typeof settings[NORISH_SETTINGS_KEY] === "string" ? settings[NORISH_SETTINGS_KEY] : undefined));
    return { ...credentialStatus(settings[key]), urlConfigured: !!baseUrl };
  }
  async function run(request: Request, operation: "GET" | "PUT" | "DELETE") {
    try {
      const session = await authorize(request, operation !== "GET");
      if (session instanceof Response) return session;
      const db = deps.getDb();
      if (operation === "GET") return json(await status(db, session.user.id));
      let key = norishCredentialKey(session.user.id);
      let apiKey: string | undefined;
      if (operation === "PUT" || scope === "ai") {
        if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Invia dati JSON." }, 400);
        let body: unknown; try { body = await boundedInput(request); } catch { return json({ error: "Dati non validi." }, 400); }
        if (scope === "ai") {
          const parsed = (operation === "PUT" ? aiInput : aiDelete).safeParse(body);
          if (!parsed.success) return json({ error: "Indica un provider cloud e una chiave valida per il salvataggio." }, 400);
          key = aiCredentialKey(parsed.data.provider);
          if ("apiKey" in parsed.data && typeof parsed.data.apiKey === "string") apiKey = parsed.data.apiKey;
        } else {
          const parsed = norishInput.safeParse(body);
          if (!parsed.success) return json({ error: "Inserisci una chiave API valida." }, 400);
          apiKey = parsed.data.apiKey;
        }
      }
      await db.transaction(async tx => {
        if (operation === "PUT") await saveCredential(tx, key, apiKey!);
        else await deleteAdminSetting(tx, key);
        await writeAdminAudit(tx, { actorUserId: session.user.id, action: "settings.update", target: key, detail: { configured: operation === "PUT", outcome: "success" } });
      });
      return json(await status(db, session.user.id));
    } catch { return json({ error: "Credenziali non disponibili. Riprova." }, 503); }
  }
  return { GET: (request: Request) => run(request, "GET"), PUT: (request: Request) => run(request, "PUT"), DELETE: (request: Request) => run(request, "DELETE") };
}
