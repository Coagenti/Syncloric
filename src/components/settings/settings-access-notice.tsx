import Link from "next/link";

export function SettingsAccessNotice() {
  return <section className="auth-card" aria-labelledby="settings-access-title">
    <h2 id="settings-access-title">Richiede amministratore</h2>
    <p>La configurazione Norish e la chiave API sono globali per questa istanza. Non devi associare una chiave personale.</p>
    <p>Se Norish rifiuta la chiave, chiedi all’amministratore di verificare la configurazione in Impostazioni e aggiornare il segreto nell’ambiente del server. Qui non vengono mostrati valori o controlli di modifica.</p>
    <Link className="auth-switch" href="/diary">Torna al diario</Link>
  </section>;
}
