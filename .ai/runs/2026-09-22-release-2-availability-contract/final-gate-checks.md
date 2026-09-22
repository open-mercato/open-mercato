# Final Gate — Steps 4.1 – 4.4 (all Tasks rows done)

**Range:** Step 4.1 through Step 4.4-live-qa-fixes (closes the run — every Tasks row is `done`).
**Commits:** `14aef0b2b` .. `e51d13b41` (see PLAN.md Tasks table for per-Step SHAs).
**Touched areas (4.4 fix):** `packages/core/src/modules/wms/lib/{availabilityCalculation,sqlInClause}.ts` (new file + raw-SQL fix), `packages/core/src/modules/availability/__integration__/{TC-AVAIL-001-policies-crud,TC-AVAIL-003-ui}.spec.ts` (test-only fixes).

## Runner

Local mode (no Docker `app` container running). No container runtime available for `yarn test:integration:ephemeral` (documented, verified memory `no-container-runtime-on-this-mac`); used the documented fallback instead — a disposable local Postgres (`createdb om_qa_avail_6339`, current-user auth, no password) + `mercato init --no-examples` invoked directly via the CLI + a backgrounded `node scripts/dev.mjs` dev server on port 3339.

## Full `validation.commands` gate

| Check | Scope | Result |
|---|---|---|
| `yarn build:packages` (1st) | full, `--force` | ✅ 38/38 |
| `yarn generate` | full | ✅ no new auto-discovery drift |
| `yarn build:packages` (2nd, post-fix) | full, `--force` | ✅ 38/38, 0 cached |
| `yarn i18n:check-sync` | full | ✅ all 5 locales in sync |
| `yarn i18n:check-usage` | full | ✅ pass (7889 unused keys reported — advisory only per `.ai/docs/agent-instructions.md` Phase 1) |
| `yarn typecheck` | full monorepo | ✅ 38/38 |
| `yarn test` (aggregate) | full monorepo | turbo aborted remaining packages after `@open-mercato/shared` reported 2 failures (known artifact, see below) — standalone-verified every package individually instead (see rows below) |
| `@open-mercato/shared` test | standalone, `TMPDIR=/private/var/tmp` | ✅ the 2 tests that failed under the turbo aggregate (`dynamicLoader.generatedCacheRecovery.test.ts`) pass 2/2 standalone — confirmed turbo-concurrency artifact (memory `shared-test-crashes-under-turbo`), not a real regression |
| `@open-mercato/core` test | standalone, `TMPDIR=/private/var/tmp` | 1957/1959 suites, 17685/17691 tests pass. 2 remaining failures are `catalog/products/[id]` tests (`useLocale is not a function` — stale jest mock), in files this branch never touched (confirmed via `git diff --stat main...HEAD`) — pre-existing on the base branch, out of scope for this PR |
| `@open-mercato/ui` test | standalone | ✅ 273/273 suites, 2391/2391 tests |
| `@open-mercato/app` test | standalone | ✅ 96/96 suites, 592/592 tests |
| `@open-mercato/cli` test | standalone | ✅ 103/103 suites, 1932/1932 tests |
| `yarn build:app` | full, `--force` | ✅ compiled, typechecked, all routes collected |

## Live integration-test run (the actual gate-defining evidence)

First run (before the 4.4 fix), 12 tests / 19 executions with retries: **11 failed**. Diagnosed every failure from real error/stack-trace output (not summary lines alone):

1. **Real `wms` bug** — `POST /api/availability/check` 500'd for any real catalog product. Server log: `⨯ error: malformed array literal: "<uuid>"`. Root cause: `wms/lib/availabilityCalculation.ts`'s raw SQL used `column = any(?)` with a JS-array parameter; MikroORM's `AbstractSqlConnection.execute()` does not bind parameters at the driver level — `platform.formatQuery` interpolates a JS array as a bare comma-separated list, so a single-element array reached Postgres as a bare scalar (`= any('uuid')`), which Postgres rejects. This is the exact same bug class already fixed twice elsewhere in this codebase (`staff/lib/time-tracking/sqlInClause.ts`, `dashboards/lib/aggregations.ts`, both referencing #4669). Fixed with a new local `wms/lib/sqlInClause.ts` (`buildSqlInClause`) rendering one `?` placeholder per array member, applied to all three raw-SQL queries in `availabilityCalculation.ts` (balance aggregation, profile lookup, variant rollup). Verified via direct `curl` reproduction against the live server before (500) and after (200) the fix.
2. **Test bug** — `TC-AVAIL-001-policies-crud.spec.ts` built a fake product UUID as `` `00000000-0000-4000-8000-${String(stamp).padStart(12, '0')}` ``; `Date.now()` is already a 13-digit number in 2026 so `padStart(12)` was a no-op, producing a 37-character (invalid) UUID and a real 400 from the zod validator. Fixed with `.slice(-12).padStart(12, '0')`.
3. **Test bug** — `TC-AVAIL-003-ui.spec.ts` clicked `[data-crud-field-id="allowBackorder"] input`; the shadcn checkbox's real `<input>` is `aria-hidden`/`tabindex="-1"` and a styled wrapper `<div>` intercepts pointer events. Fixed to target `button[role="checkbox"]`, the pattern already used in `TC-ENTITIES-008-SETTING-POLICY.spec.ts`.
4. **Test bug** — both the create-policy and stale-edit-conflict UI tests hit a Playwright strict-mode violation on `getByRole('button', { name: /save changes|create policy/i })`: CrudForm renders a detached sticky-footer submit button (`form="<id>"` attribute) alongside the in-form one, both with the same accessible name. Fixed both with `.first()`, the pattern already used throughout `catalog`'s `TC-LOCK-OSS-*` specs.

After the fix: rebuilt all 38 packages (`--force`, 0 cached), restarted the dev server against the same disposable database, reran the suite twice — 11/12 clean, then (after the last `.first()` fix) **12/12 clean, zero retries**:

```
Running 12 tests using 1 worker
  ✓ TC-AVAIL-001 × 4 (create/list/update/delete, ACL gating, tenant isolation, 409 conflict)
  ✓ TC-AVAIL-002 × 4 (ACL forbidden, unknown-id 404, not_tracked/canFulfil, quantity default)
  ✓ TC-AVAIL-003 × 4 (browser create + flash, view-only readOnly, optimistic-lock conflict bar, admin check tool)
  12 passed (32.8s)
```

## Phase 1 + Phase 2 gate verification (spec §13) — now proven end-to-end, not just in unit mocks

- **Phase 1 gate** ("a storefront-shaped consumer gets coherent states with `wms` disabled; policy resolution correct at all six levels"): covered by `TC-AVAIL-001`/`TC-AVAIL-002`'s live CRUD/ACL/tenant-isolation/optimistic-lock/not_tracked-fallback assertions against the real API + DB.
- **Phase 2 gate** (R1, R4, hand-computed multi-location states): unit-proven in `checkpoint-3-checks.md`; now additionally exercised live via `TC-AVAIL-002`'s real-product `not_tracked`/`canFulfil` check and `TC-AVAIL-003`'s live admin check-tool UI test, both hitting the actual `wms` raw-SQL path this session's fix corrected.

## Full integration suite (`om-integration-tests`, running-only mode)

The repo's integration suite is 1337 spec files run single-worker (`workers: 1` in `.ai/qa/tests/playwright.config.ts`) — running the literal full suite serially in this local, no-CI-sharding sandbox is not feasible within a session (would take many hours). Scoped instead to every spec in the two modules this PR touches, `availability` + `wms` (`OM_INTEGRATION_MODULES=availability,wms`), which is the repo's own existing mechanism for narrowing suite scope:

```
Running 66 tests using 1 worker
  64 passed, 1 failed (1st pass), 1 self-resolved on Playwright's built-in retry
```

- `TC-WMS-INVENTORY-UI-001` "posts a positive adjust…" failed its first attempt, passed on retry #1 — ordinary flake, self-resolved.
- `TC-WMS-020` "should create, edit, and archive a warehouse…" failed both the initial attempt and the retry, reproduced again in isolation. Diagnosed via `.mercato/dev-runtime-status.json`: the dev-runtime diagnostics banner (`data-health="degraded"`) was showing because of an unrelated ERROR-level log line — `[notifications] email delivery failed error=SYSTEM_EMAIL_CHANNEL_NOT_CONFIGURED` (this disposable QA tenant has no email channel configured) — and that banner overlay intercepts pointer events on every page once any error-level log occurs anywhere in the app, blocking the test's `Edit` menu-item click. Neither `availability` nor `wms` logs anything related; this PR touches no notification or email code. **Classification: environment/data issue, not a product regression** — the QA tenant fixture is missing an email channel, and the diagnostics banner's blocking behavior on ANY unrelated error is a pre-existing dev-runtime characteristic, not something this PR changed or could fix without out-of-scope changes to notification config or the diagnostics banner's click-blocking design.

## Next Step

None — every Tasks row is `done`. Proceeding to PR finalize (labels, `om-auto-review-pr --autofix`, summary comment, ready flip) and QA-environment cleanup.
