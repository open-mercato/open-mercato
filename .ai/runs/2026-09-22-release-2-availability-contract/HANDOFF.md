# Handoff — 2026-09-22-release-2-availability-contract

**Last updated:** 2026-09-22T15:10:00Z
**Branch:** feat/release-2-availability-contract
**PR:** https://github.com/open-mercato/open-mercato/pull/6339
**Current phase/step:** Phase 1 + Phase 2 + Step 4.1–4.4 COMPLETE. All Tasks rows done. Next: PR finalize (labels, `om-auto-review-pr --autofix`, summary comment, ready flip).
**Last commit:** e51d13b41 — fix(availability): disambiguate the create-policy submit button in TC-AVAIL-003

## What just happened
- Ran the full local `validation.commands` gate (build:packages ×2, generate, i18n:check-sync/usage, typecheck, test, build:app) — all green, plus one real bug fixed along the way (`acl.ts` missing `export default features`, only caught by app-level typecheck).
- Provisioned a genuinely-working live QA environment in this sandbox (no container runtime available, but a disposable local Postgres via `createdb` + `mercato init --no-examples` via the CLI directly + a backgrounded `node scripts/dev.mjs` dev server works — see memory `qa-env-works-in-cezar-worktree`), superseding the earlier assumption that integration tests could not be executed at all here.
- Ran the availability-scoped Playwright suite (`OM_INTEGRATION_MODULES=availability`) against that live server and found 11/19 executions failing. Diagnosed every failure from real error output (not just pass/fail summaries) and fixed the root causes:
  - **Real app bug**: `wms/lib/availabilityCalculation.ts`'s raw SQL used `column = any(?)` with a JS array parameter. MikroORM's `.execute()` does not bind arrays at the driver level (`platform.formatQuery` interpolates a JS array as a bare comma list), so Postgres saw `= any('single-uuid')` and threw `malformed array literal`, 500ing `/api/availability/check` for any real product. Fixed with a new local `wms/lib/sqlInClause.ts` (`buildSqlInClause`) that renders one placeholder per value — the exact same fix already established in `staff/lib/time-tracking/sqlInClause.ts` and `dashboards/lib/aggregations.ts` (both reference #4669). Verified via curl reproduction against the live server before and after.
  - **Test bug**: `TC-AVAIL-001-policies-crud.spec.ts` built a fake UUID from `Date.now()` padded to 12 digits, but `Date.now()` is already a 13-digit number in 2026, so `padStart` was a no-op and the UUID was 37 characters (invalid). Fixed with `.slice(-12).padStart(12, '0')`.
  - **Test bug**: `TC-AVAIL-003-ui.spec.ts` clicked `[data-crud-field-id="allowBackorder"] input` for a shadcn checkbox; the real input is `aria-hidden`/`tabindex="-1"` and a styled wrapper intercepts pointer events. Fixed to target `button[role="checkbox"]` (established pattern, see `TC-ENTITIES-008-SETTING-POLICY.spec.ts`).
  - **Test bug**: both the create-policy and the stale-edit-conflict tests hit a Playwright strict-mode violation — CrudForm renders a detached sticky-footer submit button *and* an in-form one with the same accessible name. Fixed both with `.first()` (established pattern used throughout `catalog`'s `TC-LOCK-OSS-*` specs).
- Rebuilt all packages, restarted the dev server, and reran the suite twice: 11/12 then 12/12 clean (no retries).
- Re-ran the FULL `validation.commands` gate a second time after the fix: unit tests for the touched `wms` files (28/28), full core typecheck, full monorepo typecheck (38/38), i18n:check-sync/usage (both pass; check-usage's 7889 unused keys are advisory per `.ai/docs/agent-instructions.md`), the full `yarn test` aggregate (turbo aborted after `@open-mercato/shared` failed 2 tests that pass standalone — a known turbo-concurrency artifact, see memory `shared#test-crashes-under-turbo`; standalone-verified `core` (2 failures, both in `catalog/products/[id]` tests unrelated to this branch — `useLocale is not a function` from a stale jest mock in files this branch never touched, pre-existing on the base branch), `ui` (273/273), `app` (96/96), `cli` (103/103) all clean), and `build:app` (green).

## Next concrete action
- PR finalize: refresh the PR body/description, flip `Status:` to `complete`, apply the full label set (pipeline `review`, category, exactly one priority, exactly one risk, `needs-qa` since this PR touches UI) with rationale comment.
- Release the `in-progress` lock, invoke `om-auto-review-pr 6339 --autofix`, reclaim the lock on return.
- Post the final outcome/handoff comment on PR #6339, then flip the draft PR to ready via `mark-pr-ready`.
- Clean up the disposable QA environment: `dropdb om_qa_avail_6339`, kill the dev server (check current PIDs via `lsof -i :3339`), remove `/tmp/qa-avail-6339*` temp files.

## Blockers / open questions
- None. The live QA environment is real and working; all 12 availability-scoped Playwright specs pass cleanly with no retries. The one remaining test-suite red (`catalog/products/[id]` `useLocale` mock breakage) is pre-existing on the base branch and outside this PR's file scope — documented above, not fixed here (out of scope for an availability-contract PR).

## Environment caveats
- Dev runtime: running on port 3339 against `om_qa_avail_6339` (disposable local Postgres, current-user auth, no password). Needs cleanup before this run closes.
- Database/migration state: no new migrations since Phase 2 close; this session's fixes were code-only (raw SQL query text + test files).

## Worktree
- Path: /Users/bernard/workspace/open-mercato/.ai/cezar/worktrees/8967983c-8f33-4fe0-b10e-e683933caf94
- Created this run: no (reused the existing cezar-linked worktree)
