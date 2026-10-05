import { z } from "zod";

/** One explicit public origin for auth and API writes, independent of proxy rewrites. */
export const appOriginSchema = z.preprocess(
  value => typeof value === "string" && !value.trim() ? undefined : value,
  z.string().trim().refine(value => {
    if (!/^https?:\/\/[^/\\\s?#]+\/?$/i.test(value)) return false;
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
    } catch { return false; }
  }, "BETTER_AUTH_URL: usa l’origine HTTP(S) pubblica dell’app, senza credenziali, percorso, query o fragment")
    .transform(value => new URL(value).origin).optional(),
);

export function isAllowedRequestOrigin(request: Request, { requireOrigin = false } = {}): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    // Preserve non-browser clients, but never allow an explicit cross-site fetch.
    return !requireOrigin && request.headers.get("sec-fetch-site") !== "cross-site";
  }
  const configured = appOriginSchema.parse(process.env.BETTER_AUTH_URL);
  // Host/Forwarded headers and Origin itself cannot grant trust. Behind a proxy,
  // the deployer supplies BETTER_AUTH_URL rather than trusting arbitrary headers.
  return origin === (configured ?? new URL(request.url).origin);
}
