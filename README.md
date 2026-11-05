<div align="center">

<img src=".github/assets/banner.svg" alt="Syncloric — self-hosted calorie diary with a cyberpunk interface" width="100%">

<br>

[![CI](https://github.com/Coagenti/Syncloric/actions/workflows/ci.yml/badge.svg)](https://github.com/Coagenti/Syncloric/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-00f0ff)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)

**Self-hosted calorie diary with a cyberpunk interface and a read-only sync to Norish.**

One container, one database, your data on your own machine. No account on a third-party service.

**English** · [Italiano](README.it.md) · [Español](README.es.md)

</div>

---

## What it is

Syncloric counts the calories and macros of what you eat, day by day: four meals, portions,
recipes, barcodes, AI label reading (opt-in) and automatic import of the meals you log on a
[Norish](https://github.com/norish-recipes/norish) instance. It runs entirely on your own server,
in a single Docker Compose stack.

It started as a real project, used every day: the diary is not a demo, and the views only read
your own data from your own database.

## Screenshots

> Captures from a local instance with **fictional data** (no real person's data).

<div align="center">
  <img src=".github/assets/screenshot-dashboard.png" alt="Dashboard: energy balance, macros and a summary of the four meals" width="49%">
  <img src=".github/assets/screenshot-diary.png" alt="Day diary with kcal and macros per meal" width="49%">
  <br>
  <img src=".github/assets/screenshot-meal.png" alt="Meal detail with the list of foods, grams and kcal" width="49%">
  <img src=".github/assets/screenshot-themes.png" alt="Four themes: Cyberpunk, Arasaka Red, Synthwave, Terminal" width="49%">
  <br>
  <img src=".github/assets/screenshot-mobile.png" alt="Mobile view of the diary" width="26%">
</div>

## Features

**Diary and nutrition**

- Daily diary across four meals (breakfast, lunch, snack, dinner) with kcal, protein,
  carbohydrates, fat and the micronutrients available for each entry and each meal.
- Manual entry, food search with portions and custom measures, recipes with portions.
- Monthly calendar to browse your history; "today" is the browser's local date.
- Calorie target either **computed** (sex, height, weight, age, activity level, goal) or
  **manual**, stored per user. Informational numbers, not nutritional prescriptions.

**Getting data in**

- **Barcode**: the code can be typed by hand, native camera where the browser supports it,
  local-first lookup with an Open Food Facts fallback, product and grams confirmed before
  anything is written.
- **AI label reading** (opt-in, the admin's choice): photo of the label → nutritional values in a
  preview → explicit confirmation. OpenAI, Anthropic or a local Ollama; Syncloric never stores or
  logs the photos.
- **Norish sync** in **read-only** mode: imports the meals of the calendar and their kcal, with
  weekly/monthly reconciliation; imported entries stay owned by the sync.

**Sharing and data**

- Households: invitations, meal sharing and copying a meal from one member to another.
- Full JSON/CSV export and read-only export tokens.
- Every user manages their own Norish key from the UI; keys are encrypted at rest
  (AES-256-GCM) and are never returned to the pages.

**Interface**

- Four themes (Cyberpunk, Arasaka Red, Synthwave, Terminal), Italian and English, preferences
  synced per user.
- **Reduce motion** option for anyone who prefers less movement.
- Mobile-first, installable as a PWA over HTTPS.

**Administration**

- The first user of the instance becomes the administrator; user panel with roles, bans and an
  audit log of changes. Impersonation is disabled.
- AI keys and provider, barcode threshold, Norish URL: global configuration from `/settings`,
  stored in the database (secrets encrypted).

## Quick start (Docker)

```bash
git clone https://github.com/Coagenti/Syncloric.git
cd Syncloric
cp docker/.env.example docker/.env
# fill in the three required secrets in docker/.env:
#   POSTGRES_PASSWORD   (URL-safe: use hex)
#   BETTER_AUTH_SECRET  (at least 32 characters)
#   ENCRYPTION_KEY      (64 hex digits)
# and set BETTER_AUTH_URL to the public origin, e.g. https://diary.example.com
chmod 600 docker/.env
docker compose -f docker/docker-compose.yml --env-file docker/.env -p syncloric up -d --wait
```

The app answers on `http://localhost:3000` (`APP_PORT` changes the port). On first access create
the account from the registration page: **the first user of the instance becomes admin**.

Keep `ENCRYPTION_KEY` together with your database backups: without that key the encrypted
credentials (Norish/AI keys) can no longer be read. Do not commit `docker/.env` and do not print
`docker compose config` into shared logs: it contains the resolved secrets.

Health checks: `GET /api/health` (app) and `GET /api/v1/health` (app + database).

## Local development

Requirements: Node.js 22 (see `.nvmrc`), pnpm 10, PostgreSQL 17 (or Docker for the database
only).

```bash
corepack enable
pnpm install
cp .env.example .env      # development values, see the comments in the file
pnpm db:migrate           # applies the drizzle migrations to DATABASE_URL
pnpm dev                  # http://localhost:3000
```

The bootstrap (`src/instrumentation.ts`) validates the environment: without `DATABASE_URL`,
`BETTER_AUTH_SECRET` or `ENCRYPTION_KEY` the app does not start. `NORISH_BASE_URL` is optional and
has no default: when it is missing, the scheduler runs but skips the sync.

## Tests

```bash
pnpm test:unit              # vitest: config, Norish client (mocked fetch), crypto
pnpm test:integration       # vitest + PGlite (Postgres WASM) on the same migrations
pnpm test                   # both
pnpm build                  # prerequisite for the browser tests
pnpm test:settings-browser  # real Chromium + production components/APIs on PGlite
```

The integration tests do not need Docker: PGlite is an in-process Postgres WASM running the real
drizzle migrations. The Chromium harnesses check real components and APIs (settings, feed,
barcode, auth with real Better Auth sessions), with HTTP upstreams mocked: no test contacts an
external service, and no real AI call is made.

## How the diary works

`/dashboard`, `/diary` and `/calendar` read `GET /api/v1/diary?month=YYYY-MM`, which requires a
valid session and filters by the current user; the response is `private, no-store` and contains
neither keys nor raw upstream messages. Writes go through `POST /api/v1/diary` and
`PATCH`/`DELETE /api/v1/diary/:id` (contracts in [DIARY-WRITES](docs/DIARY-WRITES.md) and
[DIARY-MUTATE](docs/DIARY-MUTATE.md)); entries that came from the sync (`norish_sync`) answer
`403` to any manual change. The entry view is described in [FOOD-ENTRY](docs/FOOD-ENTRY.md).

Sessions live in HTTP-only cookies (not in `localStorage`) and roles are read from the database,
with no authorization cache. If the first-admin bootstrap fails on a transient error, the next
login retries it.

## Norish: integration and reconciliation

The connection to Norish uses **each user's personal key**, saved from the UI and encrypted with
AES-256-GCM. `NORISH_API_KEY` is no longer used. The client exposes only `GET /api/v1/**` towards
the upstream: Syncloric never writes to Norish.

The scheduler resolves the effective URL at every tick (every 30 minutes) with the precedence
**Settings → environment variable → no URL**: without a URL it records no run and does not
contact the upstream. The contract is pinned to Norish `v0.24.0-beta`: the weekly sync reconciles
Monday–Sunday, the `month` backfill the whole month; entries that disappeared upstream are marked
as removed (never physically deleted) and restored if they come back. With an empty payload the
default is **zero markings**: to allow them you need `NORISH_UPSTREAM_TZ` with the actually
verified timezone of the Norish server (no implicit default). Only a complete fetch enables the
markings; a 401/403 produces `reason=auth` without touching the credentials.

Details: [ARCHITECTURE § 5](docs/ARCHITECTURE.md), [runtime configuration](docs/configuration.md),
[Settings contract](docs/NORISH-SETTINGS.md). The fixtures in `docs/norish-api/` are snapshots of
the observed contract, not an endpoint to configure.

## AI label reading

An admin enables the feature and picks the provider in `/settings`; without a provider, or with
`ai.enabled=false`, scanning stays disabled and the manual form keeps working. OpenAI/Anthropic
keys are entered from the UI, encrypted in the database, and take precedence over any legacy
environment keys; the GUI only shows the status and an empty field to replace them. Ollama needs
no keys and uses `OLLAMA_BASE_URL`. `SYNCLORIC_AI_MODEL` overrides the vision model.

The photo is not sent until you press the button, the UI states the recipient, and the reading has
to be verified before confirming: it is an aid, not dietary advice. Privacy, APIs and limits:
[AI-LABEL](docs/AI-LABEL.md), [configuration](docs/configuration.md).

## Deploy and environments

The `.env.example` template in the root is for development; for a deployment use
`docker/.env.example` (`NORISH_BASE_URL`, `NORISH_UPSTREAM_TZ`, `BETTER_AUTH_URL`). Behind a
reverse proxy, set `BETTER_AUTH_URL` to the public HTTPS origin the browser actually sees: auth
and API writes use the same value.

A second instance only needs its own `.env` and a different project name: networks, volumes and
secrets stay isolated, and the image is the same.

```bash
APP_PORT=3001 docker compose -f docker/docker-compose.yml --env-file docker/.env.second -p syncloric-b up -d --wait
```

Full procedure (build, cutover, migrations, rollback) in **[docs/DEPLOY.md](docs/DEPLOY.md)**. The
recommended path is to build the image **once** in CI, publish it by digest, and let the servers
only `pull`: no archive transfers, no secrets in the layers.

## Project status

The application is complete and used daily (v0.2.1). Open and in progress:

- strict separation of secrets between development, test and production environments;
- test coverage on some views (see `docs/`), accessibility and performance on slow devices.

Code arrives through branches and pull requests, never as direct merges to `main`; every PR goes
through `lint → typecheck → unit → integration → build` plus the browser regression. See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

_Project documentation is currently written in Italian._

| Document | Content |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | stack, structure, data model, sync, deployment |
| [DEPLOY](docs/DEPLOY.md) | build, cutover, migrations, rollback |
| [DIARY-UI](docs/DIARY-UI.md) · [FOOD-ENTRY](docs/FOOD-ENTRY.md) | diary, entry, food catalogs |
| [BARCODE](docs/BARCODE.md) · [AI-LABEL](docs/AI-LABEL.md) | barcode scanning, label reading |
| [HOUSEHOLDS-MEAL-SHARING](docs/HOUSEHOLDS-MEAL-SHARING.md) | households and meal sharing |
| [ADMINISTRATION](docs/ADMINISTRATION.md) | roles, audit, keys, panel limits |
| [MOBILE-NUTRITION-EXPORT](docs/MOBILE-NUTRITION-EXPORT.md) | mobile, nutrients, export |

## License

Copyright (C) 2026 Coagenti.

Syncloric is released under the **GNU Affero General Public License v3.0 or later**
(`AGPL-3.0-or-later`). The full text is in [`LICENSE`](LICENSE).

In practice: you can use, modify and self-host it freely; if you offer it as a service reachable
over a network you must make the source of your modifications available (AGPL § 13). For uses
that cannot comply with the AGPL — for example a commercial offering with unpublished
modifications — a **commercial license** is available: contact the maintainers through the
organization's profile.

The name "Syncloric", the logo and the visual identity are **not** covered by the code license.

How to contribute (including the terms on contributions): [`CONTRIBUTING.md`](CONTRIBUTING.md).
How to report a vulnerability: [`SECURITY.md`](SECURITY.md).
