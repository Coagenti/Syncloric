import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/index";

/**
 * Better Auth route handler (§ 3: /api/auth/[...all] — /register, /login, sessioni).
 *
 * Lazy: l'handler si costruisce alla prima richiesta, NON a module-level — un
 * `getAuth()` top-level importerebbe la config durante `next build` (che in
 * Docker gira senza env) e il fail fast § 5.0 romperebbe la build. Stesso
 * pattern dei lazy singleton di src/server/**.
 */

type AuthHandlers = ReturnType<typeof toNextJsHandler>;

let handler: AuthHandlers | undefined;

function authHandler(): AuthHandlers {
  if (!handler) {
    handler = toNextJsHandler(getAuth());
  }
  return handler;
}

export async function GET(request: Request): Promise<Response> {
  return authHandler().GET(request);
}

export async function POST(request: Request): Promise<Response> {
  return authHandler().POST(request);
}