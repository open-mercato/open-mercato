# Fix `compileAndImport` never reaching its MikroORM v7 cache recovery path

Date: 2026-07-27
Slug: compile-and-import-await-cache-recovery
Branch: fix/issue-4526-compile-and-import-await
Issue: #4526

## Overview

### Goal

Make the reactive MikroORM v7 generated-cache recovery in
`packages/shared/src/lib/bootstrap/dynamicLoader.ts` actually run when a compiled
generated module fails to import, instead of surfacing the raw import rejection to
the CLI/worker caller.

### Background

`compileAndImport` returns the dynamic import **without awaiting it** inside its
`try` block:

```ts
try {
  const fileUrl = `${pathToFileURL(jsPath).href}?mtime=${fs.statSync(jsPath).mtimeMs}`
  return import(fileUrl)          // <-- not awaited
} catch (error) {
  ...
  const recovered = recoverMikroOrmV7GeneratedCacheFromImportError(appRoot, error)
  ...
  return compileAndImport(tsPath, false)
}
```

Because the promise is returned rather than awaited, an import-time rejection
settles **after** the `try` block has already exited, so `catch` never runs.
`recoverMikroOrmV7GeneratedCacheFromImportError` is dead code for exactly the
failure it exists to repair — the `does not provide an export named 'Entity'`
case caused by a stale MikroORM v7 generated cache written before the v7
migration. The caller sees the raw import error instead of a recovered load.

The proactive scan (`ensureMikroOrmV7GeneratedCacheCompatibility`, called once at
the top of `loadBootstrapData`) still works; only the reactive per-import recovery
is unreachable.

### Scope

- `packages/shared/src/lib/bootstrap/dynamicLoader.ts` — `await` the dynamic
  import so an import-time rejection is caught by the existing `catch`.
- `packages/shared/src/lib/bootstrap/__tests__/dynamicLoader.cacheRecovery.test.ts`
  — new regression guard: a rejecting import triggers the recovery once and the
  retry loads the refreshed module; a rejection with no applicable recovery still
  propagates, and the retry is attempted exactly once (`allowRecovery` guard).

### Non-goals

- No change to `generatedCacheRecovery.ts` (detection, deletion, marker) — it
  already has its own tests.
- No change to the proactive scan or to `loadBootstrapData`'s file set.
- No new logging/diagnostics (that is #4491 / PR #4505, deliberately
  behavior-preserving).

## Implementation Plan

### Phase 1: Fix

1.1 `return import(fileUrl)` → `return await import(fileUrl)`.

### Phase 2: Regression test

2.1 Add `dynamicLoader.cacheRecovery.test.ts` covering: recovery applied → retry
succeeds; recovery not applicable → original error propagates; recovery runs at
most once (no infinite retry loop).

### Phase 3: Validation

3.1 Run the configured validation gate (`yarn build:packages`, `yarn generate`,
`yarn typecheck`, `yarn test`, i18n checks, `yarn build:app`) or the smallest
relevant subset plus the shared package test suite.

## Progress

- [x] 1.1 Await the dynamic import in `compileAndImport` — `0e6274a99`
- [x] 2.1 Regression test for the reactive recovery path — `0e6274a99`
      (all three cases fail without the `await`, pass with it)
- [x] 3.1 Validation gate (runner: local) — `yarn build:packages` ✅,
      `yarn generate` ✅, `yarn i18n:check-sync` ✅, `yarn i18n:check-usage` ✅,
      `yarn typecheck` ✅ (21/21), `yarn test` 22/23 packages green
      (`@open-mercato/shared` 139 suites / 1501 tests pass; the single
      `@open-mercato/core` failure is the pre-existing `develop` breakage in
      `scripts/check-agents-md-budget.mjs:93` fixed by #4527, untouched here),
      `yarn build:app` ✅
- [x] 4.1 PR opened with labels requested
