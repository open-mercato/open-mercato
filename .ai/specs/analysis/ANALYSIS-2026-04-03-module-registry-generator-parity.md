# Analysis: 2026-04-03 Module Registry Generator Parity

## Context

This analysis captures observations from reviewing the `packages/cli` module registry generator refactor against `develop`.

Goal: keep generation behavior identical to pre-refactor behavior even though generation was split for performance and standalone support.

## Executive Summary

One confirmed parity regression was found and fixed:

- standalone CLI generation could discover package workers/subscribers from a `src/modules` mirror, but then load metadata from the wrong runtime path
- result: `.mercato/generated/modules.cli.generated.ts` lost worker entries and degraded subscriber metadata
- impact: standalone queue workers and event-driven flows diverged from monorepo behavior

After the fix, standalone generation again registers published package workers/subscribers and app-local custom workers/subscribers.

Two important residual risks remain:

1. generator-time module imports are cached across `generate:watch` runs, which can keep metadata stale until the process restarts
2. the fallback metadata extractor is narrower than the real source shapes used in the repo, especially typed `export const metadata: WorkerMeta = { ... }`

## Confirmed Regression

### Standalone src-mirror metadata resolution bug

**Location**

- [module-registry.ts](../../packages/cli/src/lib/generators/module-registry.ts)
- [scanner.ts](../../packages/cli/src/lib/generators/scanner.ts)

**Failure mode**

- standalone package discovery used `src/modules` mirrors when available
- worker/subscriber scanning saw `.ts` source files
- metadata loading still resolved against `dist/modules` using the scanned `.ts` filename shape
- that path does not exist in real published packages

**Observed impact**

- `modules.cli.generated.ts` in standalone missed `workers:` entries entirely
- subscriber entries could remain present but with empty/partial metadata
- `mercato queue worker --all` reported no queues
- `server:dev` auto-spawned workers, the worker child exited immediately, and the dev server shut down

**Why monorepo still worked**

- monorepo generation reads app/package source directly and did not hit the standalone mirror/runtime mismatch

**Fix**

- resolve worker/subscriber metadata via `resolveModuleFile(...)` first
- then load metadata from the resolved runtime file path rather than reconstructing a path from the scan result

## Remaining Risks

### 1. Stale metadata in `generate:watch`

**Severity**: High

**Locations**

- [module-registry.ts](../../packages/cli/src/lib/generators/module-registry.ts)
- [mercato.ts](../../packages/cli/src/mercato.ts)

**Why**

- generator-time metadata loading now uses dynamic imports from file URLs
- `generate:watch` runs the generator suite repeatedly in the same long-lived process
- ESM imports are cached by URL, so subsequent regenerations can reuse old module contents

**Impact**

- edits to `metadata` in `workers/*.ts`, `subscribers/*.ts`, and `page.meta.ts` may not be reflected immediately
- generated outputs can lag behind source until the watcher process restarts
- this is a behavior regression relative to the old generator, which mostly deferred those reads to runtime imports in generated files

**What to do**

- add cache busting to generator-time dynamic imports, or
- stop using runtime imports for generator-only metadata extraction and switch fully to AST/source parsing

### 2. Fallback metadata extraction does not cover typed exports

**Severity**: Medium

**Locations**

- [module-registry.ts](../../packages/cli/src/lib/generators/module-registry.ts)

**Why**

- the fallback parser matches `export const metadata = ...`
- it does not match `export const metadata: WorkerMeta = { ... }`
- the repo uses typed metadata exports in many workers

**Examples**

- [status-poller.ts](../../packages/core/src/modules/payment_gateways/workers/status-poller.ts)
- [events.worker.ts](../../packages/events/src/modules/events/workers/events.worker.ts)
- [send-email.worker.ts](../../packages/core/src/modules/messages/workers/send-email.worker.ts)

**Impact**

- if runtime import fails for one of these modules during generation, fallback extraction may return `null`
- worker/subscriber/page metadata can silently degrade or disappear
- that can reintroduce parity problems in edge cases even after the standalone mirror fix

**What to do**

- replace the regex/object-literal fallback with a TypeScript AST extractor that supports typed exports and more source shapes

### 3. Generator now executes more top-level module code during generation

**Severity**: Medium

**Locations**

- [module-registry.ts](../../packages/cli/src/lib/generators/module-registry.ts)

**Why**

- the refactor imports source/runtime modules during generation to read metadata and route information

**Impact**

- generation can now fail because of top-level imports, side effects, or environment assumptions in files that used to be only referenced lazily by generated code
- this is especially relevant for page metadata modules and runtime-only worker/subscriber modules

**What to do**

- keep generator-side metadata extraction side-effect free where possible
- prefer static analysis for simple metadata surfaces

## Contract Parity Checks That Look Good

The following areas appear intentionally changed but still contract-safe based on review and targeted tests:

- standalone package discovery prefers `dist/modules` with `src/modules` mirror support
- app-local modules still override package modules
- generated app/runtime split (`modules.app.generated.ts`, `frontend-routes.generated.ts`, `backend-routes.generated.ts`, `api-routes.generated.ts`) is wired into the app bootstrap and route dispatchers
- CLI still loads `modules.cli.generated.ts` for non-Next contexts

## Recommended Follow-Up

1. Add cache busting for generator-time `import(pathToFileURL(...))` calls used by metadata loading.
2. Replace regex-based metadata fallback with TS AST parsing that supports typed exports.
3. Add a dedicated regression test for repeated `generate:watch` metadata edits in the same process.
4. Add fixtures covering typed worker metadata fallback failure paths, not only plain `export const metadata = { ... }`.

## Verification Notes

During this review:

- targeted generator tests passed after the standalone worker/subscriber fix
- regenerated standalone apps regained worker entries in `modules.cli.generated.ts`
- standalone `yarn dev:verbose` progressed to worker startup again instead of failing with `No queues discovered from modules`

That confirms the fixed regression was real and materially affected standalone behavior.
