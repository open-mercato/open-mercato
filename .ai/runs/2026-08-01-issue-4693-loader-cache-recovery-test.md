# Port the loader→generated-cache recovery integration test (#4693)

## Goal

Close the coverage gap left behind when #4682 was superseded. The one-line behaviour
fix (`return await import(fileUrl)` in `packages/shared/src/lib/bootstrap/dynamicLoader.ts`)
already merged via #4540, but the regression test that drives the *unmocked* path from
`compileAndImport` into the real `generatedCacheRecovery` module did not. This run ports
that test — and only that test — onto current `develop`.

## Scope

- `packages/shared/src/lib/bootstrap/__tests__/dynamicLoader.generatedCacheRecovery.test.ts` —
  new, test-only. Runs the real recovery module from the loader's `catch`.
- No source file is touched. `dynamicLoader.ts` in particular is left byte-identical to
  `develop`; the temporary revert used for the discrimination check was reverted with
  `git checkout --` before committing.

## Notes

Three suites now cover this area and none subsumes the others:

- `dynamicLoader.cacheRecovery.test.ts` (merged in #4540) mocks `../generatedCacheRecovery`
  in full and asserts how the loader *reacts* to a rejecting import.
- `generatedCacheRecovery.test.ts` exercises the recovery module directly, not through the
  loader.
- The new `dynamicLoader.generatedCacheRecovery.test.ts` runs the real recovery module from
  the loader's `catch`, so the loader ↔ recovery seam is covered end to end. It is the only
  place in the repository that asserts the `runtime-import-error` marker reason
  (`generatedCacheRecovery.ts:172`).

Two scoping decisions carried over from #4682 and documented in the test header: the fixture
assembles its decorator import at runtime so the startup scan does not delete the cache before
the import-time path is reached, and assertions stop at the recovery boundary because Jest's
module registry replays an already-evaluated module on the guarded retry, making the retry's
outcome a property of the runner rather than of the loader.

## Progress

- [x] Triage: confirm the test file is still absent from `upstream/develop` and that
      `runtime-import-error` is asserted nowhere in the repository
- [x] Port the test from #4682 under the non-colliding name, with a header explaining why all
      three suites exist
- [x] Run the suite on the final branch — 2/2 pass
- [x] Discrimination check: revert the `await` → case 1 fails on the missing marker; restore
      it → 2/2 pass again
- [x] Confirm the working tree contains no source-file change
- [x] Run the full validation gate (local runner)
- [x] Open the PR and request labels from a maintainer (`refactor`, `priority-low`,
      `risk-low`, `skip-qa`)
