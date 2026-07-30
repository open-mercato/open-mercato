# Await the dynamic import in compileAndImport (#4526)

## Goal

Make the MikroORM v7 generated-cache recovery in `compileAndImport` reachable. The
function returned its dynamic `import()` without awaiting it, so an import-time
rejection settled outside the surrounding `try` and the `catch` — the only caller of
`recoverMikroOrmV7GeneratedCacheFromImportError` — never ran.

## Scope

- `packages/shared/src/lib/bootstrap/dynamicLoader.ts` — await the dynamic import so the
  rejection reaches the recovery `catch`.
- `packages/shared/src/lib/bootstrap/__tests__/dynamicLoader.generatedCacheRecovery.test.ts` —
  new regression coverage that the import-time recovery path runs.

## Notes

The startup scan (`ensureMikroOrmV7GeneratedCacheCompatibility`) already deletes a stale
cache it can see, so the import-time `catch` covers the narrower window where a stale
compiled file only becomes visible after that scan has run. The regression fixture
reproduces exactly that window: the staged `.mjs` carries no decorator import at scan
time, writes a stale sibling as it loads, and then rejects with the decorator-export
error Node raises for a v6 import.

Assertions stop at the recovery boundary. Jest's module registry keeps serving a file it
has already evaluated, so the single guarded retry re-runs the rejecting module from
memory regardless of what recovery wrote to disk — the retry's outcome is a property of
the runner, not of the loader. The marker file and the deleted-file list are the
observable proof that the `catch` ran, and they are absent without the fix.

## Progress

- [x] Verify the defect still exists on `develop` (`dynamicLoader.ts:94`)
- [x] Apply the one-line fix (`return await import(fileUrl)`)
- [x] Add the regression test for the import-time recovery path
- [x] Confirm the test fails without the fix and passes with it
- [x] Run the full validation gate (green, local runner)
- [x] Open the PR (#4682) and request labels from a maintainer
