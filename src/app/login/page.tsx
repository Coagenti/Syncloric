import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { Brand } from "@/components/brand";

export const metadata: Metadata = { title: "Accedi — Syncloric" };

/** Intentionally accessible with an active session too; protected pages own their guards. */
export default function LoginPage() {
  return <main className="auth-shell"><div className="auth-brand brand"><Brand /></div><LoginForm /></main>;
}
