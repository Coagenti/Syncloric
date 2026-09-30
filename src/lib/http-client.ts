/** Cliente fetch condiviso per i componenti client (§ 2: TanStack Query). */

/** Fetch JSON con gli errori propagati dal body (es. 422 → messaggio utente). */
export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(body?.error ?? `Errore ${res.status} durante il salvataggio`);
  }
  return body as T;
}