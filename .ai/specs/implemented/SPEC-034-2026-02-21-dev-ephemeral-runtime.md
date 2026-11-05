# SPEC-034: Dev Ephemeral Runtime Command

## TLDR
Add `yarn dev:ephemeral` as a one-command, worktree-friendly development launcher that validates Node 24, bootstraps `.env` only when missing, runs `yarn install`, builds packages, runs generators, starts a dedicated ephemeral PostgreSQL container, initializes against that DB, selects a free local app port, starts the app on that port, prints the URL for testing, opens the browser automatically, and tracks running instances in `.ai/dev-ephemeral-envs.json`.

## Overview
This change introduces a new root-level developer workflow for running multiple Open Mercato development instances in parallel across worktrees without manual port management.

The command is implemented as a TypeScript script (`scripts/dev-ephemeral.ts`) and exposed via `package.json` as `dev:ephemeral`.

## Problem Statement
Current local development assumes a mostly fixed port workflow (`yarn dev` on `localhost:3000`), which creates friction for parallel worktree sessions and LLM-assisted development where multiple app instances are needed at once.

Pain points:
- Manual port juggling is repetitive and error-prone.
- New worktrees may fail to start quickly if `.env` is missing.
- Developers can accidentally run with incompatible Node versions.
- First-run dependency installation is often forgotten.

## Proposed Solution
Add `yarn dev:ephemeral` that performs deterministic preflight and runtime boot:

1. Validate runtime is Node 24.x.
2. Ensure `apps/mercato/.env` exists:
- Reuse if present.
- Copy from `apps/mercato/.env.example` if absent.
3. Run `yarn install`.
4. Run `yarn build:packages` so compiled CLI generators are current.
5. Run `yarn generate` so required `.mercato/generated` files are present.
6. Start ephemeral PostgreSQL container and resolve unique `DATABASE_URL`.
7. Register a random ownership marker on the allocated PostgreSQL database and write a private, temporary proof containing its name, connection digest and marker. Run `yarn initialize -- --reinstall --ephemeral-database-guard=<proof>` against the ephemeral `DATABASE_URL`; the argument survives Turbo strict environment filtering. Forward `DATABASE_URL`, `APP_URL` and `NEXT_PUBLIC_APP_URL` through the `initialize` task. The CLI validates the effective connection after normal configuration loading and verifies the connected database identity before initialization, then rechecks the actual DROP connection before destructive SQL. Missing or mismatched proof fails closed. Guarded initialization skips Redis FLUSHALL because the launcher owns only PostgreSQL.
8. Resolve runtime port:
- Use `DEV_EPHEMERAL_PREFERRED_PORT` only when explicitly set and within `5000-65535`.
- Otherwise pick a random free port in `5000-65535`.
- If random attempts fail, allocate a free fallback port and enforce `>=5000`.
9. Start `yarn dev:app` with `PORT=<resolved-port>` and ephemeral `DATABASE_URL`.
10. Print explicit URL(s) for QA/testing.
11. Wait for readiness and open browser at `/backend`.
12. Maintain `.ai/dev-ephemeral-envs.json`:
- Prune stale/non-responsive instances at startup.
- Register current process instance with pid + URL metadata + postgres container metadata.
- Remove current instance on process exit.

## Architecture
### Runtime Components
- `scripts/dev-ephemeral.ts`
- Root script entry in `package.json`:
  - `"dev:ephemeral": "tsx scripts/dev-ephemeral.ts"`

### Port Strategy
- Reuses integration ephemeral port-selection pattern semantics:
  - Preferred port first.
  - Fallback to free port when busy.

### Command Relationship
- `dev` remains unchanged.
- `dev:greenfield` remains available.
- `dev:ephemeral` is additive and non-breaking.

## Migration & Backward Compatibility

The internal optional `--ephemeral-database-guard=<proof>` argument adds a precondition only when explicitly supplied by the disposable launcher. Existing `init` commands, flags, schemas, generated contracts and unguarded reinstall behavior remain supported. No application data migration or new dependency is required. The proof and database comment belong only to the disposable allocation and disappear with its cleanup.

## Data Models
No DB schema/entity changes.

Files touched by runtime behavior:
- Reads: `apps/mercato/.env.example`
- Writes if missing: `apps/mercato/.env`
- Reads/Writes: `.ai/dev-ephemeral-envs.json`
- Temporary ownership proofs: `.mercato/ephemeral-database-guards/<container-id>/`, mode 0600 inside a private directory; removed on launcher cleanup.
- Runtime dependency: local Docker daemon for ephemeral PostgreSQL container lifecycle
- No migrations.

## API Contracts
No API route changes.
No OpenAPI changes.
No RBAC changes.

## Integration Coverage
This feature is command/runtime orchestration, not a new API module. Coverage focuses on startup and reachable UI endpoints:

- Command path: `yarn dev:ephemeral`
- Startup preflight expectations:
  - Fails with guidance on Node < 24
  - Creates `.env` only when missing
  - Installs dependencies
  - Builds packages before generation
  - Generates module registry files
  - Starts isolated ephemeral PostgreSQL and initializes against it
  - Refuses stripped, missing or mismatched effective database configuration before destructive work
  - Verifies the ownership marker on the connection used for DROP, not only in the caller
  - Preserves a separate owned control database when testing dotenv fallback under actual strict Turbo execution
  - Selects free port
  - Removes non-responsive entries from `.ai/dev-ephemeral-envs.json`
  - Registers and unregisters current runtime in `.ai/dev-ephemeral-envs.json`
  - Opens browser after readiness
- Key UI path after boot:
  - `GET /backend` on printed ephemeral base URL

## Risks & Impact Review
1. Risk: `yarn install` adds startup time.
- Severity: Medium
- Affected area: Developer experience
- Mitigation: Explicitly documented behavior; keeps command deterministic for fresh worktrees.
- Residual risk: Higher startup time on repeated runs.

2. Risk: Port race condition between allocation and dev bind.
- Severity: Low
- Affected area: Runtime startup
- Mitigation: Allocate close to launch and pass explicit `PORT`.
- Residual risk: Rare conflict remains possible if another process binds first.

3. Risk: Existing `.env` may contain stale values.
- Severity: Low
- Affected area: Local config consistency
- Mitigation: Command only bootstraps `.env` when missing and logs reuse.
- Residual risk: Misconfiguration must be fixed manually by developer.

4. Risk: Registry file drift for running instances.
- Severity: Low
- Affected area: Agent/runtime coordination
- Mitigation: Startup pruning + unregister on exit + health probing.
- Residual risk: Abrupt OS-level termination may leave short-lived stale entry until next launch prunes it.

5. Risk: Turbo environment filtering or dotenv fallback redirects destructive initialization.
- Severity: Critical
- Affected area: Local database isolation
- Mitigation: Explicit initialize environment forwarding plus a private ownership proof carried as a CLI argument; exact connection digest, database identity and random marker are checked before mutation, including on the DROP connection. Guarded mode never flushes unowned Redis.
- Residual risk: Deliberately unguarded normal `init --reinstall` retains its supported destructive semantics; the marker is an accidental-target protection, not a boundary against a malicious local process with the same OS/database privileges.

## Final Compliance Report
- Simplicity First: Implemented as one standalone script and one package script entry.
- Minimal Impact: `dev` behavior unchanged; additive command only.
- Safety: Existing destructive initialization is restricted to the allocated disposable target for this launcher; normal unguarded CLI semantics remain compatible. No schema or migration changes.
- Multi-instance support: Free-port strategy allows concurrent worktree runs.
- Coordination: Running dev instances are tracked in `.ai/dev-ephemeral-envs.json` for reuse by agent testing workflows.
- Documentation: Added CLI docs page, sidebar entry, CLI overview entry, README mention, and agent guidance updates.

## Changelog
- 2026-02-21: Added `dev:ephemeral` command with Node24 preflight, `.env` bootstrap-if-missing, dependency installation, free-port startup, and URL output. Updated docs and README.
- 2026-02-21: Extended `dev:ephemeral` with generator pre-step, browser auto-open, and `.ai/dev-ephemeral-envs.json` lifecycle (stale pruning + register/unregister). Updated `.ai/skills/om-integration-tests/SKILL.md`, `.ai/qa/AGENTS.md`, and root `AGENTS.md` to reuse dev ephemeral instances for testing.
- 2026-02-21: Removed DRY duplication between `dev:ephemeral` and integration ephemeral runtime by extracting shared Node24 + port/runtime probe helpers into `packages/cli/src/lib/testing/runtime-utils.ts`.
- 2026-02-21: Upgraded `dev:ephemeral` to start a dedicated ephemeral PostgreSQL Docker container per run, initialize app state against that DB, inject `DATABASE_URL` into dev runtime, and clean container state on shutdown/stale-entry pruning.

- 2026-11-05: Fixed strict-Turbo initialize environment forwarding and added fail-closed disposable-database ownership checks before initialization/DROP, guarded Redis isolation, and regression coverage using two owned databases.
