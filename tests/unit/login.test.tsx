import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginForm } from "@/components/auth/login-form";
import { z } from "zod";
import { registrationEmail, validateCredentials } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/logout-button";
import { SettingsContent } from "@/components/settings/settings-content";
import { SettingsAccessNotice } from "@/components/settings/settings-access-notice";

describe("username/password access", () => {
  it("uses the production settings branch for regular users", () => {
    const html = renderToStaticMarkup(<SettingsContent access="requires-admin" />);
    expect(html).toContain('id="settings-tab-norish"');
    expect(html).not.toContain('id="settings-tab-utenti"');
    expect(html).not.toContain("Provider AI");
  });
  it("supports every valid username without creating malformed or colliding metadata emails", () => {
    const names = [".abc", "abc.", "a..b", "valid_user", "a".repeat(30)];
    for (const name of names) expect(z.email().safeParse(registrationEmail(name)).success).toBe(true);
    expect(new Set(names.map(registrationEmail)).size).toBe(names.length);
  });
  it("offers an explicit logout control", () => {
    expect(renderToStaticMarkup(<LogoutButton />)).toContain("Esci");
  });
  it("validates username and password without requesting email", () => {
    expect(validateCredentials("ab", "12345678")).toBeTruthy();
    expect(validateCredentials("valid_user", "short")).toBeTruthy();
    expect(validateCredentials("valid_user", "12345678")).toBeNull();
    expect(validateCredentials("invalid@user", "12345678")).toBeTruthy();
  });
  it("renders persistent accessible labels and no email input", () => {
    const html = renderToStaticMarkup(<LoginForm />);
    expect(html).toContain('for="username"');
    expect(html).toContain('for="password"');
    expect(html).toContain('autoComplete="username"');
    expect(html).not.toContain('type="email"');
    expect(html).toContain("Crea un account");
  });
  it("explains the global key without exposing controls to regular users", () => {
    const html = renderToStaticMarkup(<SettingsAccessNotice />);
    expect(html).toContain("Richiede amministratore");
    expect(html).toContain("amministratori");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<button");
  });
});
