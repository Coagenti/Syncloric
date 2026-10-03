import { NextResponse } from "next/server";
import { z } from "zod";
import type { Db } from "@/server/db";
import { aiConfig, aiConnection, saveAiConfig, settingsSchema, providerSchema, type AiEnv } from "./config";
import { extractLabel } from "./extract";
const MAX_IMAGE = 5 * 1024 * 1024;
const imageSchema = z.object({ expectedProvider: providerSchema, mime: z.enum(["image/png", "image/jpeg", "image/webp"]), base64: z.string().min(4).max(Math.ceil(MAX_IMAGE / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
async function boundedJson(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max) throw new Error("too large");
  const reader = request.body?.getReader(); if (!reader) throw new Error("empty");
  const chunks: Uint8Array[] = []; let total = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > max) throw new Error("too large"); chunks.push(value); } }
  finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString()) as unknown;
}
function validImage(image: z.infer<typeof imageSchema>) {
  const data = Buffer.from(image.base64, "base64");
  if (data.length > MAX_IMAGE || data.toString("base64") !== image.base64) return false;
  if (image.mime === "image/png") return data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (image.mime === "image/jpeg") return data[0] === 255 && data[1] === 216 && data[2] === 255;
  return data.subarray(0,4).toString() === "RIFF" && data.subarray(8,12).toString() === "WEBP";
}
/** Assistive extraction only. No food/diary writes and no images persisted. */
export function buildAiHandlers(deps: { getDb: () => Db; getSession: (headers: Headers) => Promise<{ user: { id: string; role?: string | null } } | null>; env?: () => AiEnv; extract?: typeof extractLabel }) {
  const busy = new Set<string>();
  const env = deps.env ?? (() => process.env);
  async function session(request: Request, admin = false) {
    try {
      const session = await deps.getSession(request.headers);
      if (!session?.user) return json({ error: "Autenticazione richiesta." }, 401);
      if (admin && session.user.role !== "admin") return json({ error: "Richiede amministratore." }, 403);
      return session;
    } catch { return json({ error: "Accesso temporaneamente non disponibile." }, 503); }
  }
  function guard(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "Origine non consentita." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Invia dati JSON." }, 400);
    return null;
  }
  return {
    async GET(request: Request) {
      const auth = await session(request, true); if (auth instanceof Response) return auth;
      try { return json(await aiConfig(deps.getDb(), env())); } catch { return json({ error: "Impostazioni non disponibili." }, 503); }
    },
    async status(request: Request) {
      const auth = await session(request); if (auth instanceof Response) return auth;
      try { const { enabled, provider, ready, cloud } = await aiConfig(deps.getDb(), env()); return json({ enabled, provider, ready, cloud }); }
      catch { return json({ error: "AI non disponibile. Puoi compilare manualmente." }, 503); }
    },
    async PUT(request: Request) {
      const auth = await session(request, true); if (auth instanceof Response) return auth;
      const denied = guard(request); if (denied) return denied;
      let body: unknown; try { body = await boundedJson(request, 2048); } catch { return json({ error: "Dati non validi." }, 400); }
      const value = settingsSchema.safeParse(body); if (!value.success) return json({ error: "Seleziona un provider esplicito prima di abilitare AI." }, 400);
      try { await saveAiConfig(deps.getDb(), value.data, auth.user.id); return json(await aiConfig(deps.getDb(), env())); }
      catch { return json({ error: "Impossibile salvare le impostazioni." }, 503); }
    },
    async POST(request: Request) {
      const auth = await session(request); if (auth instanceof Response) return auth;
      const denied = guard(request); if (denied) return denied;
      if (busy.has(auth.user.id)) return json({ error: "Una scansione è già in corso." }, 429);
      busy.add(auth.user.id);
      try {
        const config = await aiConfig(deps.getDb(), env());
        if (!config.ready || !config.provider) return json({ error: "AI disabilitata o non configurata. Compila manualmente.", code: "AI_UNAVAILABLE" }, 409);
        let body: unknown; try { body = await boundedJson(request, Math.ceil(MAX_IMAGE / 3) * 4 + 1024); } catch { return json({ error: "Foto non valida o troppo grande (massimo 5 MB)." }, 400); }
        const image = imageSchema.safeParse(body);
        if (!image.success || !validImage(image.data)) return json({ error: "Usa una foto JPEG, PNG o WebP fino a 5 MB." }, 400);
        if (image.data.expectedProvider !== config.provider) return json({ error: "Il provider AI è cambiato. Verifica il nuovo destinatario prima di riprovare; puoi compilare manualmente.", code: "AI_PROVIDER_CHANGED" }, 409);
        const label = await (deps.extract ?? extractLabel)(aiConnection(config.provider, env()), { mime: image.data.mime, base64: image.data.base64 });
        return json({ label });
      } catch { return json({ error: "Etichetta non leggibile o provider non disponibile. Riprova o compila manualmente.", code: "AI_EXTRACTION_FAILED" }, 502); }
      finally { busy.delete(auth.user.id); }
    },
  };
}
