# Execution plan — localize the remaining storage_s3 route error responses

Closes #4830. Consolidates #4997 (closed) into this PR.

## Goal

Every user-facing error the `storage_s3` routes return goes through `t()` instead of a hardcoded
English literal, and the package carries its own regression guard so the next rewrite of these paths
fails in the package that owns them.

## Context

#4887 (issue #4830) localized the `storage_s3` route errors. #4076 (`e7ec10937`, *make storage quota
admission atomic*) then rewrote the quota-admission path in both POST routes and added
`api/put/storage-providers/s3/signed-upload/[token].ts`. The rewrite kept the
`const { t } = await resolveTranslations()` binding both POST files already held but stopped calling
it, and the new PUT route never had translation plumbing at all. So this is a regression, not a
missing feature — which is why the guards below matter more than the string edits.

The same shape has now landed three times: #4926, #4995 and #5000.

### What changed underneath this branch

**#5001 (`61001cf9a`, merged 2026-08-05T09:50Z) landed first** and localized the three quota
responses in `upload.ts` (`quota_exceeded`, `quota_target_exists`, the accounting-unavailable 500)
plus the legacy non-atomic path. `develop`'s `test` job is green again, so the "unblock a red base
branch" framing this branch was cut with is **no longer true** — that half of the work is delivered.

#5001 named its keys `storage_s3.errors.quotaTargetExists` and `storage_s3.errors.quotaUnavailable`.
This branch had named the same message `quotaAccountingUnavailable`. The rebase adopts **develop's**
name rather than renaming a merged surface, because resolving the conflict hunks by keeping the branch
side leaves both names alive — five keys for three messages, two pairs with byte-identical English
values — and neither checker flags that: `i18n:check-sync` sees the same key set in all five locales,
`i18n:check-usage` downgrades unused keys to an advisory warning and exits `0`. On #4997's narrower
diff `en.json` auto-merged outright, so the duplicate pair would not even have surfaced as a conflict
to think about; on this diff all five locale files conflict, which makes the trap visible but no less
real.

## Scope

Post-rebase, the remaining work is:

- `api/post/storage-providers/s3/signed-url.ts` — four error responses (missing quota service 500,
  `quota_exceeded` 413, `quota_target_exists` 409, reservation-failure 500). Still fully hardcoded on
  `develop`.
- `api/post/storage-providers/s3/upload.ts` — the persist-failure 500. Still hardcoded on `develop`;
  #5001 did not touch it.
- `api/put/storage-providers/s3/signed-upload/[token].ts` — all ten responses, plus the
  `resolveTranslations` import. Never localized. The `UploadBodyTooLargeError` branch also stops
  echoing an internal exception message to an unauthenticated caller and returns
  `reservedSizeExceeded` like its two sibling size checks.
- Five genuinely new locale keys in all five locales: `persistFailed`, `readFailed`,
  `reservedSizeExceeded`, `uploadTokenInvalid`, `uploadTokenRequired`. `quotaTargetExists` and
  `quotaUnavailable` come from `develop` via #5001 and are reused as-is.
- `[internal]` markers on the two diagnostic-only `throw` messages, per root `AGENTS.md`.
- Package-level regression guards (see below).
- `__tests__/i18nPackageExports.test.ts` — the export-map check covered `en/de/es/pl` but not `ko`,
  which the repo gained in #4912.

## Non-goals

- The quota-admission logic itself. #4076's atomic reservation behaviour is untouched; only the
  strings it returns change.
- The `storage_s3` health-check strings and integration-credential field labels — integration-config
  metadata, not route error responses, and outside #4830's acceptance criteria.
- `packages/core/src/modules/attachments/api/route.ts:519`, which has the identical hardcoded
  `Failed to persist attachment.` from the same #4076-era work. Same regression class, different
  module — worth a follow-up issue, not an absorption here.

## Regression guards

Two layers, both inside `packages/storage-s3` so an author rewriting this package gets a local signal:

1. **Static, in `__tests__/routeErrorLocalization.test.ts`** — walks every `.ts` file under `api/`
   recursively, so it also covers routes that do not exist yet: no route returns a hardcoded
   user-facing `error: '…'` literal; every `storage_s3.errors.*` key a route uses exists in all five
   locales; every inline English fallback is byte-identical to `en.json`; every thrown `Error`
   message carries `[internal]`.
2. **Behavioral, in `__tests__/s3Routes.test.ts` and `__tests__/upload.test.ts`** — carried over from
   #4997 and extended from one branch to all of them. The package suite mocks `resolveTranslations`
   as ``t: (key) => `translated:${key}` ``, so a localized body reads `translated:<key>` while a
   hardcoded string does not. Covered: all four `signed-url.ts` quota branches, and `upload.ts`'s
   persist-failure plus its three quota branches (the ones #5001 localized, which had no
   package-level guard either).

## Progress

- [x] Read the #4997 review in full and carry its findings over
- [x] Rebase onto current `develop` (`d1ce9999e`, post-#5001)
- [x] Resolve `i18n/{de,es,ko,pl}.json` by taking `develop`'s values and adding only new keys — #5001
      re-worded `quotaExceeded` in all four, and a "take ours" resolution would have reverted it
- [x] Adopt `develop`'s key names (`quotaUnavailable`, `quotaTargetExists`); no synonym pair survives
- [x] Verify every locale diff against `origin/develop` is additions only
- [x] Route `signed-url.ts`, `upload.ts` persist-failure and all of `[token].ts` through `t()`
- [x] Carry the #4997 package-level guard over and extend it to every localized response
- [x] Rewrite this plan and the PR body — the "develop is red" premise is stale
- [x] Full validation gate on the rebased tree

## Verification

CI green on the pre-#5001 head is not evidence: those runs have a merge base that no longer exists.
The gate below was re-run locally on the rebased tree.

```
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```
