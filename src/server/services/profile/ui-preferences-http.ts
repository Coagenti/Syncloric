import { eq } from "drizzle-orm";
import { z } from "zod";
import { userUiPreferences } from "@/server/db/schema";
import { defaultUiPreferences, locales, normalizeUiPreferences, themes } from "@/lib/ui-preferences";
import { activeUser, checkOrigin, handle, input, json, sessionUserId, type Deps } from "@/server/services/households/common";

const updateSchema = z.object({ locale: z.enum(locales).optional(), theme: z.enum(themes).optional() }).strict().refine(value => Object.keys(value).length > 0);
export function buildUiPreferencesHandlers(deps: Deps) {
  async function owner(request: Request) { const id = await sessionUserId(deps, request); await activeUser(deps.getDb(), id); return id; }
  return {
    GET: (request: Request) => handle(async () => {
      const userId = await owner(request);
      const [row] = await deps.getDb().select().from(userUiPreferences).where(eq(userUiPreferences.userId, userId));
      return json({ preferences: normalizeUiPreferences(row) });
    }),
    PATCH: (request: Request) => handle(async () => {
      const userId = await owner(request); checkOrigin(request);
      const value = await input(request, updateSchema);
      // Update only supplied fields: changing the theme cannot overwrite a concurrent language change.
      const [row] = await deps.getDb().insert(userUiPreferences).values({ ...defaultUiPreferences, ...value, userId })
        .onConflictDoUpdate({ target: userUiPreferences.userId, set: { ...value, updatedAt: new Date() } }).returning();
      return json({ preferences: normalizeUiPreferences(row) });
    }),
  };
}
