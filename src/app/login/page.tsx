import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Accedi — Syncloric" };

/** Intentionally accessible with an active session too; protected pages own their guards. */
export default function LoginPage() {
  return <main className="auth-shell"><div className="auth-brand">SYN<span className="brand-accent">CLORIC</span><small>CALORIE / IN FOCUS</small></div><LoginForm /></main>;
}
