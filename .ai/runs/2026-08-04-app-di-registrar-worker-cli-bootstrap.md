# Register the app-level DI hook in worker/CLI bootstrap (`@/di` ERR_MODULE_NOT_FOUND spam)

- **Branch:** `fix/app-di-registrar-worker-cli-bootstrap`
- **Base:** `develop`
- **Skill:** `om-auto-create-pr`

## 🎯 Goal

Make the app's `src/di.ts` registrations run in worker/CLI/scheduler processes the same way they run in the
Next.js runtime, and stop the per-job `Cannot find package '@/di'` module-resolution failure that the missing
wiring produces.

## 🔍 Problem and root cause

Reported symptom — `yarn dev` prints this once per queue job/scheduler tick:

```
DEBUG [shared:di] App-level DI override module (@/di) not resolvable; skipping
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/di' imported from
  packages/shared/dist/lib/di/container.js
```

Chain:

1. The Next.js runtime boots through `apps/mercato/src/bootstrap.ts`, which passes
   `{ appDiRegistrar: registerAppDi }` (from `@/di`) into `createBootstrap`. `createBootstrap` calls
   `registerAppDiRegistrar(...)`, so the web process has the app DI hook wired explicitly and never
   dynamic-imports `@/di`.
2. Worker, scheduler and CLI processes boot through `packages/cli/src/bin.ts` →
   `bootstrapFromAppRoot()` in `packages/shared/src/lib/bootstrap/dynamicLoader.ts`, which calls
   `createBootstrap(data)` **with no options**. `registerAppDiRegistrar()` is therefore never called there.
3. Consequently `getAppDiRegistrar()` in `packages/shared/src/lib/di/container.ts` returns `null` for every
   request container in those processes, and the legacy compatibility fallback `await import('@/di')` runs.
   Those processes are plain Node ESM importing `packages/shared/dist/**`, where the `@/*` tsconfig alias does
   not exist — so the import throws `ERR_MODULE_NOT_FOUND`, is caught, and is logged with its stack on
   **every** container creation (one per job).

Impact is not only log noise: the app's `src/di.ts` `register()` never runs in worker/CLI/scheduler
processes, so app-level DI overrides and the `application.bootstrap.*` lifecycle events are silently missing
there — the same "registry silently no-ops in workers only" failure class as #4327 (command interceptors)
and #4491.

A second, latent defect sits in the same path: `createCliBundlePlugins`' `@/` alias plugin maps `@/x` to
`<appRoot>/x`, while the app tsconfig maps `@/*` → `./src/*` and only `@/.mercato/*` → `./.mercato/*`. Today
only `@/.mercato/...` specifiers reach it, so it happens to work; anything else (including `@/…` imports
inside `src/di.ts`) would mis-resolve.

## Approach

1. Load the app's `src/di.ts` in the dynamic (worker/CLI) bootstrap path and hand its `register` export to
   `createBootstrap(data, { appDiRegistrar })`, mirroring what the app bootstrap already does. Absent file =
   supported case (debug log, `null`); present-but-broken = error log, bootstrap continues.
2. Parameterize `compileAndImport` with an explicit app root and output path — its current
   `dirname(dirname(dirname(tsPath)))` derivation only holds for `<appRoot>/.mercato/generated/*.ts` — and
   emit the compiled app-DI module into the gitignored `.mercato/generated/` directory instead of next to
   `src/di.ts`.
3. Fix the `@/` alias plugin to mirror the tsconfig mapping (`@/.mercato/*` → app root, `@/*` → `<appRoot>/src`),
   the same two-tier resolution `packages/cli/src/lib/generators/openapi.ts` already implements.
4. Memoize the legacy `@/di` fallback outcome per process in `container.ts`, so an unresolvable `@/di` costs
   one failed resolution per process instead of one per request container.

## Non-goals

- Removing the `@/di` dynamic-import fallback (kept for apps that have not adopted explicit wiring).
- Changing how the Next.js runtime wires app DI.
- Touching `external/official-modules` or any generated file by hand.

## Risks

- Enabling the app DI registrar in worker/CLI processes means `apps/mercato/src/di.ts` now runs there, which
  emits `application.bootstrap.started/completed` once per worker process. That is the intended semantics of
  an app-level DI hook, but it is new behavior for those processes.
- `compileAndImport` signature change must stay backward compatible (options object with defaults preserving
  today's derivation) — it is module-private, but its cache-metadata format is depended on by existing tests.
- The alias-plugin change must keep existing `@/.mercato/*` resolution byte-identical.

## 📋 Implementation Plan

### Phase 1: Worker/CLI app-DI wiring

Parameterize `compileAndImport`, load `src/di.ts`, pass it to `createBootstrap`, fix the `@/` alias plugin,
and cover all of it with regression tests.

### Phase 2: Fallback memoization

Make the legacy `@/di` dynamic import at most once per process, with a test.

### Phase 3: Docs

Document the worker/CLI app-DI wiring in the IoC container docs and the shared package AGENTS.md row.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Worker/CLI app-DI wiring

- [x] 1.1 Parameterize `compileAndImport` with explicit app root and output path — 6a5ec9a56
- [x] 1.2 Mirror the tsconfig `@/*` mapping in the CLI bundle alias plugin — 6a5ec9a56
- [x] 1.3 Load `src/di.ts` and pass `appDiRegistrar` from `bootstrapFromAppRoot` — 6a5ec9a56
- [x] 1.4 Regression tests for the dynamic-loader app-DI path — 6a5ec9a56

### Phase 2: Fallback memoization

- [ ] 2.1 Memoize the unresolvable `@/di` fallback per process
- [ ] 2.2 Test that the fallback import is attempted at most once

### Phase 3: Docs

- [ ] 3.1 Document worker/CLI app-DI wiring (IoC docs + shared AGENTS.md)
