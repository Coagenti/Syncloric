import { NextResponse } from "next/server";
import type { Db } from "@/server/db";
import { z } from "zod";
import { lastAdminMessage, listAdminUsers, mutateAdminUser } from "@/server/db/repositories/admin-users";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const input = z.object({ userId: z.string().uuid(), action: z.enum(["promote", "demote", "ban", "unban", "remove"]), reason: z.string().trim().min(1).max(2000).optional() }).strict().refine(v => !["ban", "unban"].includes(v.action) || Boolean(v.reason), { message: "Indica il motivo dell’operazione." });
export function buildAdminUsersHandlers(deps: { getDb: () => Db; getSession: (headers: Headers) => Promise<{ user: { id: string; role?: string | null; banned?: boolean | null } } | null> }) {
  async function requireAdmin(request: Request) {
    try {
      const session = await deps.getSession(request.headers);
      if (!session?.user) return json({ code: "UNAUTHENTICATED", error: "Autenticazione richiesta." }, 401);
      if (session.user.role !== "admin" || session.user.banned) return json({ code: "FORBIDDEN", error: "Richiede amministratore." }, 403);
      return session;
    } catch { return json({ error: "Accesso temporaneamente non disponibile. Riprova." }, 503); }
  }
  return {
    async GET(request: Request) {
      const session = await requireAdmin(request); if (session instanceof Response) return session;
      try { return json({ users: await listAdminUsers(deps.getDb()), currentUserId: session.user.id }); }
      catch { return json({ error: "Lista utenti non disponibile. Riprova." }, 503); }
    },
    async POST(request: Request) {
      const session = await requireAdmin(request); if (session instanceof Response) return session;
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) return json({ error: "Origine non consentita." }, 403);
      if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return json({ error: "Invia dati JSON." }, 400);
      let body: unknown;
      try { const text = await request.text(); if (text.length > 4096) throw new Error("too large"); body = JSON.parse(text); }
      catch { return json({ error: "Richiesta non valida." }, 400); }
      const parsed = input.safeParse(body); if (!parsed.success) return json({ error: "Dati non validi: seleziona l’azione e indica un motivo non vuoto (massimo 2000 caratteri) per sospensione e riattivazione." }, 422);
      const { action, userId, reason } = parsed.data;
      try {
        const result = await mutateAdminUser(deps.getDb(), { actorUserId: session.user.id, target: userId, action, remove: action === "remove", changes: action === "promote" ? { role: "admin" } : action === "demote" ? { role: "user" } : action === "ban" ? { banned: true, banReason: reason!, banExpires: null } : action === "unban" ? { banned: false, banReason: null, banExpires: null } : {}, detail: reason ? { reason } : {} });
        if (!result.ok) {
          const status = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 409;
          return json({ code: result.code, error: result.code === "LAST_ACTIVE_ADMIN" ? lastAdminMessage : result.code === "SELF_ACTION_FORBIDDEN" ? "Non puoi sospendere o eliminare il tuo account." : result.code === "FORBIDDEN" ? "Richiede amministratore." : "Utente non disponibile. Ricarica la lista." }, status);
        }
        return json({ saved_ok: true, accessLost: userId === session.user.id && action === "demote" });
      } catch { return json({ error: "Non è stato possibile verificare l’operazione. Ricarica lo stato prima di riprovare." }, 503); }
    },
  };
}
