import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";
import { bootstrapFirstAdmin } from "@/server/db/repositories/auth";
import { loadEnvConfig } from "@/server/config";

/**
 * Better Auth: username+password senza verifica email (§ 1, § 6.3).
 * - tabelle core mappate su src/server/db/schema.ts (user/session/account/verification);
 * - session cookie httpOnly default della libreria; rate limit login nativo;
 * - plugin `admin` per i ruoli (§ 6.4): l'amministratore gestisce ban/ruoli
 *   dal pannello (app)/admin/** (§ 4.1);
 * - bootstrap admin § 4.1 (il primo utente su istanza vuota diventa admin):
 *   bootstrap server-side serializzato nel repository auth dopo la creazione utente.
 *
 * Costruito lazily: import del modulo non tocca l'env; il fail fast avviene
 * nel bootstrap del server (src/instrumentation.ts).
 *
 * NOTA tipi: il tipo dell'istanza viene INFERITO da createAuth() e riusato via
 * typeof — better-auth 1.7 deriva i tipi dai plugin via $Infer, e un'annotazione
 * manuale (ReturnType<typeof betterAuth>) produce due istanziazioni non
 * compatibili ("two different types with this name").
 */

function createAuth() {
  return betterAuth({
    appName: "syncloric",
    secret: loadEnvConfig().BETTER_AUTH_SECRET,
    basePath: "/api/auth",
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, input: false, defaultValue: "user" },
      },
    },
    advanced: { database: { generateId: () => randomUUID() } },
    databaseHooks: {
      user: { create: { after: async user => { await bootstrapFirstAdmin(getDb(), user.id); } } },
      // Retry only for the original first user after a transient post-create failure.
      session: { create: { before: async session => { await bootstrapFirstAdmin(getDb(), session.userId); } } },
    },
    // Always read the database: logout, bans and role changes must apply immediately.
    session: { cookieCache: { enabled: false } },
    plugins: [username(), admin()],
  });
}

type AuthInstance = ReturnType<typeof createAuth>;

let authSingleton: AuthInstance | undefined;

export function getAuth(): AuthInstance {
  if (!authSingleton) {
    authSingleton = createAuth();
  }
  return authSingleton;
}

export type SyncloricSession = Awaited<ReturnType<AuthInstance["api"]["getSession"]>>;