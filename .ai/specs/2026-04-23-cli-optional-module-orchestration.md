# CLI Optional Module Orchestration

| Field | Value |
|-------|-------|
| **Status** | Partially Implemented |
| **Author** | Codex |
| **Created** | 2026-04-23 |
| **Related** | [2026-04-02-empty-app-starter-presets.md](./2026-04-02-empty-app-starter-presets.md), [SPEC-067-2026-03-17-cli-standalone-app-support.md](./SPEC-067-2026-03-17-cli-standalone-app-support.md), [BACKWARD_COMPATIBILITY.md](../../BACKWARD_COMPATIBILITY.md) |

## TLDR

Lean starter presets such as `empty` and `crm` intentionally disable many modules, but the CLI still had hidden assumptions that those modules existed.

Three failure classes surfaced:

1. `init` called module commands directly without marking them optional.
2. `server dev` / `server start` auto-started background services such as `scheduler` without checking whether the module was enabled.
3. standalone dev supervision allowed unexpected child exits to look like a successful shutdown.

This spec standardizes optional-module handling across all CLI orchestration layers:

- direct in-process module command execution
- spawned background module services
- long-lived dev supervisors

The rule is simple:

- required steps fail hard
- optional module steps skip cleanly when the module/CLI/command is absent
- real runtime failures inside an existing module still fail hard

No public CLI command names, import paths, routes, events, or module IDs are changed.

## Overview

The starter preset work introduced intentionally lean apps. That exposed a deeper CLI design issue: optionality existed only at some call sites, not at the orchestration contract level.

The existing helper `runModuleCommand(..., { optional: true })` already covered some bootstrap flows inside `mercato init`, but other code paths bypassed it entirely by:

- spawning `mercato <module> <command>` as a subprocess
- supervising long-lived children without preserving child identity or exit reason

As a result, users saw failures such as:

- `Module not found: "feature_toggles"`
- `Module not found: "dashboards"`
- `Module not found: "scheduler"`
- warmup failures that were only downstream symptoms of a runtime that had already exited

The CLI must treat preset-driven absence of modules as a first-class supported state.

## Problem Statement

Today there are two separate notions of "optional":

1. logical optionality in preset/module architecture
2. operational optionality in CLI execution

Those two notions drifted apart.

### Observed failures

| Area | Old behavior | Failure |
|------|--------------|---------|
| `mercato init` post-bootstrap extras | direct calls assumed modules existed | lean presets crashed on `feature_toggles`, `dashboards`, `search` |
| `mercato server dev` | auto-spawned `scheduler start` when `QUEUE_STRATEGY=local` | CRM/empty presets crashed with `Module not found: "scheduler"` |
| `mercato server start` | same unconditional scheduler auto-spawn | production-style start could fail for lean apps |
| standalone `dev-runtime` | accepted first child exit too loosely | shell returned with no clear explanation why runtime died |
| `next dev` environment | dev process inherited production-style runtime env | Next.js warned about non-standard `NODE_ENV` |

### Root cause

The CLI had no single contract for "run this module command if and only if it exists".

Instead, behavior depended on invocation style:

- direct helper call: optional handling existed
- subprocess spawn: no optional handling
- supervisor: no durable child identity on failure path

That inconsistency is what must be fixed.

## Proposed Solution

### 1. Standardize module command lookup

Introduce a shared command-availability lookup in `packages/cli/src/mercato.ts`:

- `lookupModuleCommand(allModules, moduleName, commandName)`

It must classify outcomes as:

- `ok`
- `missing-module`
- `missing-cli`
- `missing-command`

This lookup becomes the foundation for both direct execution and spawned orchestration.

### 2. Keep `runModuleCommand(..., { optional: true })` as the direct execution path

For in-process CLI execution, `runModuleCommand` remains the canonical helper.

Behavior:

- module missing -> skip if optional, otherwise throw
- module has no CLI -> skip if optional, otherwise throw
- command missing -> skip if optional, otherwise throw
- command exists -> execute and return `true`

This helper must continue to be used by `mercato init` and any future in-process bootstrap/setup steps.

### 3. Add optional handling before spawned module subprocesses

For orchestration code that uses `spawn('node', [mercatoBin, module, command, ...])`, availability must be checked before spawning.

This applies to:

- `server dev`
- `server start`
- any future CLI-managed background service launcher

Behavior:

- if service module command exists -> spawn it
- if it does not exist and service is optional -> log a skip and continue
- if it does not exist and service is required -> fail hard

For current scope, `scheduler start` is optional in lean presets and must skip cleanly.

### 4. Preserve failure identity for supervised children

Long-lived dev supervisors must preserve:

- child label
- exit code
- signal

Unexpected child exits must surface as explicit failures, even if the child exited with `0`.

This is necessary because supervisor-style processes are themselves long-lived contracts. An unexpected early `exit=0` from a child is not success for the parent orchestration.

### 5. Keep dev and production server environments distinct

`next dev` must run with the natural dev environment instead of the production-oriented runtime env used by `server start`.

Worker and scheduler subprocesses may continue to use the inherited app environment, but `next dev` must not be forced into a production-style `NODE_ENV` normalization path.

## Architecture

### Command invocation matrix

| Invocation style | Example | Required mechanism |
|------------------|---------|--------------------|
| Direct in-process | `runModuleCommand(allModules, 'feature_toggles', 'seed-defaults', [], { optional: true })` | `runModuleCommand` |
| Optional spawned subprocess | `scheduler start` in `server dev` | `lookupModuleCommand` before `spawn(...)` |
| Required spawned subprocess | future mandatory platform daemon | explicit lookup + hard failure if missing |
| Supervised long-lived child | Next.js dev server, generator watch, scheduler child | labeled exit propagation |

### Availability contract

The CLI should conceptually follow this flow:

```ts
const resolved = lookupModuleCommand(allModules, moduleName, commandName)

if (resolved.status !== 'ok') {
  if (optional) {
    logSkip(...)
    return false
  }
  throw new Error(...)
}

await resolved.command.run(args)
return true
```

For spawned services:

```ts
const resolved = lookupModuleCommand(allModules, 'scheduler', 'start')

if (resolved.status !== 'ok') {
  logSkip(...)
} else {
  spawn('node', [mercatoBin, 'scheduler', 'start'], ...)
}
```

### Logging contract

Skip logs must be explicit and machine-scannable enough for diagnostics:

- `⏭️  Skipping "feature_toggles:seed-defaults" — module not enabled`
- `[server] Skipping scheduler auto-start — module not enabled`

Failure logs must preserve child identity:

- `💥 Failed: [server] Scheduler polling engine exited unexpectedly with exit code 1.`

## Data Models

No database schema changes.

No entity changes.

No migration work is required.

## API Contracts

No HTTP API changes.

No route URL changes.

No event ID changes.

No import-path changes.

### CLI contract changes

The CLI command surface remains backward compatible:

- command names do not change
- required flags do not change
- output is only extended with additional skip/failure diagnostics

This is additive behavior hardening, not a contract break.

## Implementation Scope

### In scope

- `packages/cli/src/mercato.ts`
  - command lookup helper
  - optional command dispatch hardening
  - `server dev` optional scheduler handling
  - `server start` optional scheduler handling
  - managed child exit reporting
  - dev env fix for `next dev`
- `packages/cli/src/__tests__/mercato.test.ts`
  - lean-preset optional command regression coverage
  - scheduler auto-start skip regression coverage
  - managed child exit regression coverage
- standalone runtime compatibility
  - preserve explicit child-exit failure reporting in `packages/create-app/template/scripts/dev-runtime.mjs`
- `apps/mercato/scripts/dev.mjs`
  - the `mercato` binary is now resolved via `resolveProjectBinary(...)` so the dev wrapper picks the workspace-local `node_modules/.bin/mercato` instead of relying on PATH lookup. This is required to keep dev startup portable across yarn-workspace setups where `mercato` is not on PATH (notably standalone-app CI), and matches the resolution strategy already used by the standalone template's `dev-runtime.mjs`.

### Out of scope

- changing which modules belong to `empty` or `crm`
- adding `scheduler` to lean presets
- redesigning worker discovery semantics
- reworking the create-app preset manifest itself
- Verdaccio/npm cache invalidation behavior

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|------|----------|---------------|------------|---------------|
| Optional logic accidentally swallows real module runtime failures | High | `init`, `dev`, `start` | Only skip missing module/CLI/command cases; allow real `cmd.run()` errors to throw | Low |
| Supervisor now fails on unexpected `exit=0`, exposing previously hidden issues | Medium | standalone dev runtime | This is intentional; add clear child labels so users know what died | Low |
| Dev env and prod env diverge incorrectly | Medium | Next.js dev startup | Keep `server start` on production runtime env; use plain app env only for `next dev` | Low |
| Future spawned services bypass the lookup helper again | Medium | CLI orchestration | Centralize lookup helper and document rule in lessons/spec | Medium |
| Lean presets still fail in another uncatalogued module coupling | Medium | starter presets | Add regression tests for each discovered coupling and keep preset spec separate from orchestration spec | Medium |

## Verification Plan

Minimum verification for this scope:

1. CLI regression suite passes for:
   - lean preset `init` optional module skips
   - scheduler auto-start skip when module absent
   - managed child unexpected exit failure
2. standalone runtime syntax remains valid
3. manual standalone smoke test for a lean preset confirms:
   - `yarn setup --reinstall` does not crash on missing `scheduler`
   - `yarn dev` does not attempt to start disabled module services

## Migration & Backward Compatibility

This change is backward compatible.

It does not:

- rename/remove any CLI commands
- rename/remove any modules
- rename/remove any ACL IDs
- rename/remove any routes
- alter generated contract file names

It only changes how the CLI behaves when optional module commands are absent.

### Behavior change: `server start` now exits non-zero on unexpected child exit

Previously `mercato server start` could return exit code `0` when a managed child (Next.js server, queue worker, scheduler) exited unexpectedly during startup or runtime. After this change, unexpected exits are surfaced as `[server] <Label> exited unexpectedly with ...` and propagated as a non-zero exit code.

This is intentional and consistent with `server dev`, but supervisors or CI pipelines that previously treated `server start` exit `0` as success even after a child crash will now correctly observe the failure. If a downstream supervisor relied on the old behavior, it should be updated to either restart on non-zero or accept that a crashed child is now a real failure.

### Note on `server dev` env handling for workers/scheduler

`server dev` no longer wraps the spawned `next dev`, queue-worker, and scheduler subprocesses with `buildServerProcessEnvironment(process.env)`. This is intentional:

- `next dev` requires the natural Node `NODE_ENV=development` environment, so the production-style normalization that `server start` applies caused Next.js to emit `NODE_ENV` warnings.
- Queue worker and scheduler subprocesses spawned from `server dev` should observe the same dev-time environment as the rest of the dev runtime so that DI containers, encryption keys, and config resolvers behave consistently across all dev children.

`server start` continues to use `runtimeEnv = buildServerProcessEnvironment(process.env)` for all three subprocess kinds because production deployments expect normalized environment variables (uppercased booleans, defaulted ports, etc.). The two server modes intentionally diverge here.

## Final Compliance Report

| Check | Result | Notes |
|-------|--------|-------|
| No breaking CLI rename/removal | Compliant | Existing commands preserved |
| No route/event/import-path break | Compliant | No public contract rename |
| Lean presets supported as intended | Compliant | Missing optional modules now treated as valid |
| Required steps still fail hard | Compliant | Only missing module/CLI/command cases are skipped |
| Diagnostics improved | Compliant | Child identity and skip reasons are explicit |
| Data model impact | None | No schema/entity changes |

## Changelog

| Date | Change |
|------|--------|
| 2026-04-23 | Created companion spec for CLI optional-module orchestration across `init`, `server dev`, `server start`, and standalone runtime supervision. |
| 2026-05-05 | Documented `server start` non-zero-exit behavior change in BC section, justified `dev.mjs` `resolveProjectBinary(...)` scope, and explained the intentional dev/prod env divergence for `next dev`, queue-worker, and scheduler subprocesses. Worker exit labels now include the discovered queue names so `Queue worker (queue-a, queue-b)` makes post-mortems unambiguous. |
