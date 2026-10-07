"use client";

export function NeonSwitch({ label, checked, disabled = false, describedBy, onChange }: { label: string; checked: boolean; disabled?: boolean; describedBy?: string; onChange: (checked: boolean) => void }) {
  return <label className={`cyber-switch ${disabled ? "is-disabled" : ""}`}>
    <input type="checkbox" role="switch" aria-label={label} aria-describedby={describedBy} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <span className="cyber-switch-track" aria-hidden="true"><span className="cyber-switch-thumb" /><span className="cyber-switch-state">{checked ? "ON" : "OFF"}</span></span>
  </label>;
}
