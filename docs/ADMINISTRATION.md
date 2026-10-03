# Administration

`/settings` is available to authenticated users. Non-administrators see only the existing “Richiede amministratore” notice, with no settings forms or user list. The server authorizes every settings/users request independently; anonymous requests return 401, non-admin requests 403. Settings are global to the instance, not per user.

## Configuration and precedence

The page presents Norish, AI, Barcode and Users in that order. Settings sections save independently; editing a toggle is not an autosave. Unsaved changes are labelled, and success is shown only after a server response.

- `norish.base_url`: the non-secret GUI value in `admin_settings` takes precedence over `NORISH_BASE_URL`; clearing the GUI value restores the environment fallback. A configured URL does not prove connectivity. Changing its origin reminds users to verify their personal Norish credentials.
- `ai.enabled` and `ai.provider`: saved together in `admin_settings`. Providers are `openai`, `anthropic`, `ollama`. No implicit provider: missing provider means AI disabled. Cloud credentials are environment-only (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`); Ollama does not require a cloud key. The UI shows availability booleans only, never secret values. Settings do not make paid test calls. Photo extraction remains assistive and requires user verification before diary save.
- `barcode.enabled`: defaults to true for absent settings. False suppresses Open Food Facts requests in both barcode search and product confirmation. Local catalog and manual entries remain available. The change is read on every request, without a restart.

API: GET/PUT `/api/v1/settings/ai`, GET/PUT `/api/v1/settings/barcode`, GET/PUT/DELETE `/api/v1/settings/norish-url`. Secrets never belong in JSONB or API response payloads.

## Users and invariant

GET `/api/v1/admin/users` returns the administration projection (id, username, role, banned, banReason, createdAt) and currentUserId; no password, email, session token or provider credentials. POST accepts `{userId, action, reason?}`: promote, demote, ban, unban, remove. The UI exposes the first four, with inline explicit confirmation. Ban/unban require a trimmed nonempty reason (maximum 2000 characters). Self-ban/remove are prohibited.

At least one active administrator must remain: `role = 'admin' AND banned IS NOT TRUE`. Multiple admins are allowed; ban expiry does not count as active until unban. Promote a second user before demoting yourself. A prohibited change returns 409 with `code: LAST_ACTIVE_ADMIN`, leaves the user unchanged and records the denied attempt. The last active admin's UI actions are disabled with a visible explanation; the server remains authoritative.

The same policy covers Better Auth native `set-role`, `update-user`, `ban-user`, `unban-user`, `remove-user`, `create-user` through top-level before/after hooks, including internal `auth.api.*` calls. Declarative plugin access control removes impersonation privileges; no impersonation UI exists. Password/session management is not exposed by this panel.

## Audit and concurrency

Migration `0003_admin_audit_invariant.sql` installs `admin_audit_log` (id, actor_user_id, action, target, detail JSONB, created_at) and a users trigger. Actor defaults to `system` for events without a session actor, and remains readable after account deletion (no user foreign key). Settings writes and custom user mutations commit their audit in the same transaction. Native hooks audit successful operations and denied last-admin attempts; the native adapter write and success audit are separate transactions, so an audit DB outage can produce an error after the change applied. Reload before retrying an uncertain response.

All invariant checks and custom writes use dedicated PostgreSQL advisory transaction lock `19373302`, distinct from first-admin bootstrap `19373301`. The trigger holds the same lock inside the actual update/delete transaction, closing native hook TOCTOU gaps. A native concurrent loser may receive a DB 500 rather than the usual preflight 409; no zero-admin state is committed. Integration tests exercise submitted concurrent updates on PGlite's single connection; they are not a multi-connection PostgreSQL stress test.

Native update audit allowlist: role, banned, banReason, banExpires values; email/emailVerified/name changes only boolean markers; other fields only `customFields` count; passwords never logged. Deleted users retain email/name in the removal audit, per the Technical Lead traceability decision. Ban reasons are operator-entered content: do not enter credentials. Audit storage should be treated as administrative data; this panel does not add an audit viewer or retention automation.

## Verification and contribution

Regression coverage includes config precedence, API guard/validation, settings rollback on audit failure, native HTTP/internal last-admin refusal, declarative impersonation denial without cookies/sessions, successful native mutation audits, trigger protection, and Chromium panel/confirmation/focus/reflow tests with synthetic fixtures. Run integration files separately on resource-constrained PGlite hosts (`--maxWorkers=1 --hookTimeout=600000 --testTimeout=600000`). Browser harnesses use production React components and local handlers; synthetic sessions/mock upstreams are not a production/provider connectivity test.

Code, tests, fixtures and documentation generated with AI assistance (Hermes). Human contribution: product brief, Technical Lead architecture/security decisions, Marketing requirements; technical/visual approval and merge remain separate human/team gates. No deployment or production access is performed by this task.
