import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, username } from "better-auth/plugins";
import { getDb } from "@/server/db";
import * as schema from "@/server/db/schema";
import { loadEnvConfig } from "@/server/config";

/**
 * Better Auth: username+password senza verifica email (§ 1, § 6.3).
 * - tabelle core mappate su src/server/db/schema.ts (user/session/account/verification);
 * - session cookie httpOnly default della libreria; rate limit login nativo;
 * - plugin `admin` per i ruoli (§ 6.4): l'amministratore gestisce ban/ruoli
 *   dal pannello (app)/admin/** (§ 4.1);
 * - bootstrap admin § 4.1 (il primo utente su istanza vuota diventa admin):
 *   logica di registrazione nella card auth feature, non in un hook globale.
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
    session: {
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
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