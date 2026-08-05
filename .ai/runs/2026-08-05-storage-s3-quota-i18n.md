# Execution plan — relocalize the S3 quota-admission error responses

Fixes #4995.

## Goal

Turn the `test` job green on `develop` and stop the tenant attachment-quota errors reaching operators
in untranslated English.

## Context

#4887 (issue #4830) localized every error response in the `storage_s3` routes, replacing hardcoded
English with `t('storage_s3.errors.<key>', …)`, and `apps/mercato/src/__tests__/storage-s3-routes.test.ts`
was extended to assert the localization.

#4076 (`e7ec10937`, *make storage quota admission atomic*) then rewrote the quota-admission path in
both POST routes. The rewrite kept the `const { t } = await resolveTranslations()` both files already
held, but stopped calling it — every error response it emits is a hardcoded English literal again.

The result: `rejects uploads that exceed tenant quota` fails on a pristine `develop`, so every open PR
inherits a red `test` job regardless of its own diff, and a genuinely broken suite becomes
indistinguishable from inherited breakage.

`git log -L` attributes all of it to `e7ec10937`:

- `upload.ts` lines 185, 188, 190, 195, 226
- `signed-url.ts` lines 88, 124, 127, 129
- `signed-upload/[token].ts` — the whole file, new in that commit, 11 strings

## Scope

The eight strings in the two POST routes, plus the three locale keys they need. Both files already
resolve `t`, so this is a mechanical change with no new plumbing.

## Non-goals

- `api/put/storage-providers/s3/signed-upload/[token].ts`. New in #4076, declared `requireAuth: false`
  (it authenticates by signed token), and carrying no translation plumbing. Adding locale resolution to
  an unauthenticated route is a behavioural change that should be reviewed on its own, not folded into
  a CI-unblocking fix.
- The quota-admission logic itself. #4076's atomic reservation behaviour is untouched; only the strings
  it returns change.

## Progress

- [x] Confirm the failure reproduces on the current `develop` (`c11a64ce0`)
- [x] Attribute every hardcoded string with `git log -L`
- [x] Route the four `upload.ts` responses through `t()`
- [x] Route the four `signed-url.ts` responses through `t()`
- [x] Add `keyAlreadyExists`, `quotaAccountingUnavailable`, `persistFailed` to en/pl/es/de/ko
      (`quotaExceeded` already existed — #4076 orphaned it)
- [x] Add a package-level regression test so the guard sits next to the route
- [x] Validation gate

## Why the guard moved

This is the second time this shape has landed — #4926 was the same class of breakage from #4887. The
package's own suite mocks `resolveTranslations`, so a route losing its localization stays green there
and only the app-level consumer suite notices, one layer away from the code being changed. The new test
in `__tests__/s3Routes.test.ts` asserts the `translated:<key>` marker on the quota-accounting branch, so
the next rewrite of this path fails in the package that owns it.

## Verification

```
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn build:app
yarn workspace @open-mercato/storage-s3 test   # 14 suites / 113 tests
yarn workspace @open-mercato/app test          # the previously red suite
```
