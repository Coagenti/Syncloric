/**
 * Homepage placeholder dello scheletro: la UI grafica cyberpunk (GPT-6-SOL,
 * § 10.1) e il routing completo ((auth)/(app), § 3) arrivano nei task dedicati.
 * Questo file dimostra solo l'anello renderizzato.
 */
export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-[--color-cyber-cyan] sm:text-4xl">
        Syncloric
      </h1>
      <p className="max-w-md text-sm opacity-80">
        Diario calorie self-hosted con import automatico da norish. Scheletro
        avviato: la UI completa arriverà nei task successivi (vedi
        docs/ARCHITECTURE.md).
      </p>
      <a
        href="/api/health"
        className="rounded-md border border-[--color-cyber-border] px-4 py-2 text-sm hover:bg-[--color-cyber-surface]"
      >
        GET /api/health
      </a>
    </main>
  );
}