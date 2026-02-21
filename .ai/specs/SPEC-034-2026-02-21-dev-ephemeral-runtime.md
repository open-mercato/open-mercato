# SPEC-034: Dev Ephemeral Runtime Command

## TLDR
Add `yarn dev:ephemeral` as a one-command, worktree-friendly development launcher that validates Node 24, bootstraps `.env` only when missing, runs `yarn install`, runs generators, selects a free local port, starts the app on that port, prints the URL for testing, opens the browser automatically, and tracks running instances in `.ai/dev-ephemeral-envs.json`.

## Overview
This change introduces a new root-level developer workflow for running multiple Open Mercato development instances in parallel across worktrees without manual port management.

The command is implemented as a Node script (`scripts/dev-ephemeral.mjs`) and exposed via `package.json` as `dev:ephemeral`.

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
4. Run `yarn generate` so required `.mercato/generated` files are present.
5. Resolve runtime port:
- Try preferred port `3000` (or `DEV_EPHEMERAL_PREFERRED_PORT` if set).
- If unavailable, allocate a free fallback port.
6. Start `yarn dev` with `PORT=<resolved-port>`.
7. Print explicit URL(s) for QA/testing.
8. Wait for readiness and open browser at `/backend`.
9. Maintain `.ai/dev-ephemeral-envs.json`:
- Prune stale/non-responsive instances at startup.
- Register current process instance with pid + URL metadata.
- Remove current instance on process exit.

## Architecture
### Runtime Components
- `scripts/dev-ephemeral.mjs`
- Root script entry in `package.json`:
  - `"dev:ephemeral": "node scripts/dev-ephemeral.mjs"`

### Port Strategy
- Reuses integration ephemeral port-selection pattern semantics:
  - Preferred port first.
  - Fallback to free port when busy.

### Command Relationship
- `dev` remains unchanged.
- `dev:greenfield` remains available.
- `dev:ephemeral` is additive and non-breaking.

## Data Models
No DB schema/entity changes.

Files touched by runtime behavior:
- Reads: `apps/mercato/.env.example`
- Writes if missing: `apps/mercato/.env`
- Reads/Writes: `.ai/dev-ephemeral-envs.json`
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
  - Generates module registry files
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

## Final Compliance Report
- Simplicity First: Implemented as one standalone script and one package script entry.
- Minimal Impact: `dev` behavior unchanged; additive command only.
- Safety: No destructive DB operations added; no migration changes.
- Multi-instance support: Free-port strategy allows concurrent worktree runs.
- Coordination: Running dev instances are tracked in `.ai/dev-ephemeral-envs.json` for reuse by agent testing workflows.
- Documentation: Added CLI docs page, sidebar entry, CLI overview entry, README mention, and agent guidance updates.

## Changelog
- 2026-02-21: Added `dev:ephemeral` command with Node24 preflight, `.env` bootstrap-if-missing, dependency installation, free-port startup, and URL output. Updated docs and README.
- 2026-02-21: Extended `dev:ephemeral` with generator pre-step, browser auto-open, and `.ai/dev-ephemeral-envs.json` lifecycle (stale pruning + register/unregister). Updated `.ai/skills/integration-tests/SKILL.md`, `.ai/qa/AGENTS.md`, and root `AGENTS.md` to reuse dev ephemeral instances for testing.
