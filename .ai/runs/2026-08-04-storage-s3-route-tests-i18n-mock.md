# Fix red `test` job on develop — app-level storage_s3 route suite misses the i18n mock

- **Issue:** [#4926](https://github.com/open-mercato/open-mercato/issues/4926)
- **Branch:** `fix/issue-4926-storage-s3-route-tests-i18n`
- **Base:** `develop` (`upstream/develop` @ `a575bebce`)
- **Skill:** `om-auto-fix-issue` (bug route)

## 🎯 Goal

Bring the unit `test` job on `develop` back to green. Since #4887 (`c95ff214e`) merged,
`apps/mercato/src/__tests__/storage-s3-routes.test.ts` fails all five of its cases, so every open PR
against `develop` inherits a red `test` job and a skipped `merge-coverage` regardless of its own diff.

## 🔍 Problem and root cause

#4887 replaced the hard-coded error strings in the `storage_s3` routes with `resolveTranslations()`.
`resolveTranslations()` loads the locale dictionary through `getModules()`, which throws
`[Bootstrap] Modules not registered. Call registerModules() at bootstrap.` whenever the module registry
has not been populated.

The PR updated the tests that live next to the routes — `packages/storage-s3/src/modules/storage_s3/__tests__/s3Routes.test.ts`
already mocks `@open-mercato/shared/lib/i18n/server`, so it stayed green. What it missed is the app-level
consumer suite, which imports the real `download`/`upload` handlers but mocks only
`@open-mercato/shared/lib/auth/server`, `@open-mercato/shared/lib/di/container` and the S3 driver. Nothing
registers modules and nothing mocks i18n, so the very first line of each handler throws before any
assertion runs.

This class of breakage is invisible to the package's own tests by construction: the package suite mocks i18n,
so localizing a route never surfaces the app-level consumer that does not.

## Approach

Test-side only; no production change is warranted. Add the i18n mock to the app-level suite, following the
pattern the sibling app suite `apps/mercato/src/__tests__/extract-tenant-candidate.test.ts` already uses
(`t: (key, fallback) => fallback ?? key`). That keeps the existing assertions on the user-facing English
messages meaningful instead of degrading them into assertions on translation keys.

To make the change a real regression guard rather than a plain unbreak, the mocked `t` is a `jest.fn` and two
error-path cases additionally assert that the route asked for the expected translation key — so silently
reverting #4887's localization would fail the suite again.

## 📋 Progress

- [x] Reproduce the failure on `upstream/develop` (`yarn workspace @open-mercato/app test --testPathPatterns storage-s3-routes` → 5 failed / 5 total)
- [x] Confirm the root cause against `download.ts` / `upload.ts` and the package-level suite
- [x] Audit the other `apps/mercato/src/__tests__/*` suites that import real route modules
- [x] Add the i18n mock and the translation-key assertions to `apps/mercato/src/__tests__/storage-s3-routes.test.ts`
- [x] Re-run the suite (5 passed / 5 total)
- [x] Run the full validation gate
- [x] Open the PR and request labels from a maintainer

## Audit of sibling app suites

Only three suites under `apps/mercato/src/__tests__/` import real route modules, and the other two are
already immune:

- `extract-tenant-candidate.test.ts` — mocks `@open-mercato/shared/lib/i18n/server` directly.
- `api-authorization.test.ts` — mocks `@open-mercato/shared/modules/registry`, so `getModules()` resolves.
- `storage-s3-routes.test.ts` — the one fixed here.

## Notes

- The account running this work has `read` permission on `open-mercato/open-mercato`, so assignee and label
  mutations return 403. The claim and the label request are posted as comments instead.
