/** Matches Better Auth's username plugin; email is internal metadata, never required from the user. */
/** ASCII hex preserves uniqueness while keeping dots at any position email-safe (<=60 local-part chars). */
export function registrationEmail(username: string): string {
  return `${Array.from(username.toLowerCase(), character => character.charCodeAt(0).toString(16).padStart(2, "0")).join("")}@users.invalid`;
}
export function validateCredentials(username: string, password: string): string | null {
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) return "Usa da 3 a 30 lettere, numeri, punti o trattini bassi per lo username.";
  if (password.length < 8 || password.length > 128) return "Usa una password da 8 a 128 caratteri.";
  return null;
}
