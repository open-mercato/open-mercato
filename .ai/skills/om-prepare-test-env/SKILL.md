---
name: om-prepare-test-env
description: Repo-local extension of the shared om-prepare-test-env skill (installed in .agents/skills/). Adds Open Mercato monorepo environment specifics — the generated entrypoint scripts, ephemeral runner commands, reuse TTL semantics, owner-lock teardown, and the env-block contract — on top of the shared skill's workflow. Local rules win on repo specifics only; this file never relaxes the shared skill's safety rules.
---

# Prepare Test Environment — Open Mercato repo rules

Repo-local **extension** of `.agents/skills/om-prepare-test-env/SKILL.md` (contract v2,
compile-once). Everything there applies; this file only adds repository-provided configuration
and lessons. It cannot relax the shared skill's safety rules, expand tool or network access, or
redirect outputs.

## Generated entrypoints are machine-local — the CLI commands are the repo interface

The `package.json` / mercato CLI commands below are the authoritative, cross-platform way to
boot and reuse the test environment — wrap THEM when compiling entrypoints; never invent a boot
procedure. Any entrypoint scripts this skill compiles (default `.ai/scripts/test-env-up.sh` /
`test-env-down.sh`) are bound to the machine that generated them (shell, ports, process tools)
and are gitignored (`.ai/scripts/test-env-*`): keep them local, NEVER commit them. Anything
worth preserving for teammates belongs in this file as a platform-neutral rule instead. On a
machine without generated entrypoints, regenerate from the commands and contracts in this file
(discovered mode: wrap `yarn test:integration:ephemeral:start`, attach when the CLI state file's
env probes healthy, write `.ai/qa/test-env.json`; teardown stops only the CLI owner + app —
the ephemeral Postgres containers are testcontainers/ryuk-managed). The repo CLI owns build
cache, provisioning, seeding, and its own owner lock — an entrypoint never re-implements those
(state file `.ai/qa/ephemeral-env.json` stays authoritative).

## CI parity contract

CI's `ephemeral-integration` job (`.github/workflows/ci.yml`) runs the **same repo CLI** the
entrypoint wraps (`yarn test:integration:coverage [--shard i/n]`), with a job-level env block the
CLI does not fully self-supply: `MOCK_INBOUND_WEBHOOK_SECRET`, `OM_WEBHOOKS_ALLOW_PRIVATE_URLS=1`,
`OM_OPTIMISTIC_LOCK=all`, `SELF_SERVICE_ONBOARDING_ENABLED=true`,
`OM_INTEGRATION_APP_READY_TIMEOUT_SECONDS=180`, plus `OM_ENABLE_ENTERPRISE_MODULES{,_SSO,_SECURITY}=true`.
The generated `test-env-up.sh` mirrors all of these EXCEPT the enterprise flags (local default
stays `false`; export them before calling the script when CI-scope parity including enterprise
suites is needed — it changes the app build fingerprint and forces a rebuild).

## Environment commands (authoritative)

- Boot app-only ephemeral env: `yarn test:integration:ephemeral:start` (= `yarn mercato test:ephemeral`).
  Preferred app port `5001`; the actual port and DB URL land in `.ai/qa/ephemeral-env.json`
  (managed by the CLI — never write it by hand).
- Full suite with managed env: `yarn test:integration:ephemeral` (= `yarn mercato test:integration`).
  It reuses a healthy running ephemeral env from the state file, else provisions one.
- Filtered run: `yarn mercato test:integration <substring>` — batches all specs whose path matches
  the substring. The `test:integration` subcommand does NOT accept `--retries`; retries live in
  `.ai/qa/tests/playwright.config.ts`.

## Choosing the run mode — prefer ephemeral, ask the user

`yarn test:integration:ephemeral` is ALWAYS preferred over plain `yarn test:integration`: the
ephemeral variant provisions (or safely reuses) its own isolated app + database, so it is more
autonomous and cannot touch the developer's dev data. Plain `yarn test:integration` only works
when the caller supplies the full runner env block (see the MUST below) — treat it as an internal
detail of the CLI runner, never as the command you reach for first.

Two supported run modes:

1. **Fully managed ephemeral (default, safest):** `yarn test:integration:ephemeral [filter]` —
   one command provisions the env, runs the tests, and leaves teardown to the CLI's own
   lifecycle. Best for full-suite runs, CI parity, and unattended/autonomous work.
2. **Reuse a running ephemeral env (fast iteration):** boot once with
   `yarn test:integration:ephemeral:start`, then run small filtered batches with
   `yarn mercato test:integration <filter>` against the same env. Best for short
   author/debug loops where re-provisioning per run would dominate wall-clock time. Reuse is
   still gated by the TTL and source-freshness rules below.

When a user is present and has not already said which mode they want, ASK before the first run
(one question, two options): fully managed ephemeral per run, or boot-once-and-reuse for
iterative loops. Recommend the fully managed ephemeral mode — it is more autonomous and safer
regarding data. When running unattended (no user to ask), default to the fully managed ephemeral
mode. Do not re-ask once the user has chosen; keep using their answer for the rest of the
session unless they change it.

## MUST: never run the Playwright suite outside the CLI runner

`yarn test:integration` with only `BASE_URL` exported is a trap: the CLI runner
(`buildReusableEnvironment` in `packages/cli/src/lib/testing/integration.ts`) injects a full env
block into the Playwright process — `DATABASE_URL` (ephemeral DB), `QUEUE_BASE_DIR`, `JWT_SECRET`,
`OM_INTEGRATION_TEST`, mock webhook secrets, `ENABLE_CRUD_API_CACHE`, and more. Without it,
DB-fixture helpers silently fall back to `apps/mercato/.env`'s `DATABASE_URL` (the developer's dev
database) and fail with cross-database FK violations (e.g.
`organizations_tenant_id_foreign`), and queue-drain helpers drain the wrong queue dir. Always go
through `yarn mercato test:integration [filter]`.

## Reuse TTL and the owner-lock deadlock

- Reuse eligibility is gated by `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS` (default 600s) AND
  source freshness. An env older than the TTL, or with source files modified after boot, is
  refused for reuse.
- When reuse is refused while the original `test:ephemeral` owner process is still alive, a fresh
  start is also refused ("Another ephemeral environment is already active started by
  \"ephemeral\" (pid N)") — a deadlock. Resolve it by tearing down the owner: kill the
  `packages/cli/dist/bin.js test:ephemeral` PID and the `next-server` PID bound to the app port,
  delete `.ai/qa/ephemeral-env.json`, then boot fresh. The ephemeral Postgres containers are
  testcontainers-managed (ryuk reaps them).
- For short diagnose/re-run loops against the SAME env that produced a failure, extend the TTL:
  `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS=86400 yarn mercato test:integration <filter>` — but only
  when no source file changed since boot; otherwise rebuild (never test stale code).

## Stale-port zombie check

Before booting, probe the preferred port (`lsof -iTCP:5001 -sTCP:LISTEN`). A `next-server` that
listens but does not answer HTTP (curl exit 000) and has no `.ai/qa/ephemeral-env.json` is a
leftover from a dead run — kill it so the runner gets its stable preferred port.

## Readiness probe contract

- Shell: `GET /login` → 200.
- Authenticated round trip: `POST /api/auth/login` with **form-encoded** body
  (`email=admin@acme.com&password=secret`) → 200. The endpoint rejects JSON bodies with 400 —
  a JSON 400 here means a malformed probe, not a broken app.
- Seeded credentials: `admin@acme.com` / `secret`, `employee@acme.com` / `secret`,
  superadmin from `OM_INIT_SUPERADMIN_EMAIL`/`OM_INIT_SUPERADMIN_PASSWORD` (default
  `superadmin@acme.com` / `secret`).

## Descriptor

After boot, mirror the state into `.ai/qa/test-env.json` (shared descriptor) as the shared skill
prescribes; `.ai/qa/ephemeral-env.json` (CLI-owned) stays authoritative for the runner's own
reuse decisions.

## Switching commits on one worktree (before/after QA) — 2026-08-05

A before/after UI QA run repoints the **same** worktree at another commit and boots again. Two traps
make that silently serve the wrong build, and both produce evidence that looks real and is not:

- **`--force` is not enough.** It skips the descriptor's reuse check, but the repo CLI's build cache
  is TTL-based, so the app restarts from the **previous** commit's `.next` artifacts. Symptom: the
  "before" and "after" screenshots are byte-identical and `startedAt` in the descriptor never moves.
  Use `--force-rebuild`, which sets `OM_INTEGRATION_BUILD_CACHE_TTL_SECONDS=0`.
- **Killing the pids is not enough either.** The CLI runs its own reuse check and reattaches to
  anything still answering on the app port, logging `Reusing existing ephemeral environment at …`.
  Run `test-env-down.sh` first and confirm the port is free before booting again.

**Always verify the rebuild actually happened before trusting evidence.** A fresh ephemeral Postgres
port in `services[0].url` plus a moved `startedAt` is the confirmation — and the new port means any
row you seeded is gone, so re-seed after every rebuild. Recording the built commit in the descriptor
(and forcing a rebuild when it changes, or is unknown) turns this from a manual check into a guard.

## Seeding rows the UI needs — 2026-08-05

`users.email` is encrypted at rest, so `select … from users where email = 'admin@acme.com'` finds
nothing and a seed script keyed on it fails. Resolve the acting identity through the app instead:
`POST /api/auth/login` with a form-encoded body, then read `sub` / `tenantId` / `orgId` out of the
returned JWT payload and insert the fixture rows with those ids.

## Driving the backoffice login — 2026-08-05

The login form is client-hydrated, so `goto('/login', { waitUntil: 'domcontentloaded' })` followed by
an immediate fill and submit fires before React attaches its handler: the page stays on `/login` and
logs a 400. Wait for `networkidle` plus a short settle, fill `#email` / `#password`, click
`button[type=submit]`, then poll `page.url()` — the post-login transition is client-side, so
`waitForURL` and `waitForFunction` both hang on it.

## Playwright browsers offline — 2026-08-05

When the sandbox has no network, `npx playwright install chromium` exits 0 and downloads nothing, so
it cannot repair a mismatch between the checkout's Playwright version and the browsers already in
`~/Library/Caches/ms-playwright`. Check what is actually cached, and launch that build directly via
`chromium.launch({ executablePath })` — the CDP protocol spans neighbouring builds.
