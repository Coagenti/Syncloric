import Link from "next/link";

export function SettingsAccessNotice() {
  return <section className="auth-card" aria-labelledby="settings-access-title">
    <h2 id="settings-access-title">Richiede amministratore</h2>
      <p>URL del server Norish, provider e chiavi AI, barcode e utenti sono configurabili soltanto dagli amministratori.</p>
      <p>Puoi gestire la tua chiave personale Norish nella scheda qui sopra. Se il server Norish non è configurato, chiedi all’amministratore di impostarne l’URL.</p>
    <Link className="auth-switch" href="/diary">Torna al diario</Link>
  </section>;
}
