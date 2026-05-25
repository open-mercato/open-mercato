# Execution plan — OSS opt-in optimistic locking (issue #1981)

**Source spec:** `.ai/specs/2026-05-25-oss-optimistic-locking.md`
**Issue:** [#1981](https://github.com/open-mercato/open-mercato/issues/1981)
**Branch:** `feat/oss-optimistic-locking`
**Base:** `develop`

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On
> landing a Step, flip `Status` to `done` and fill the `Commit` column
> with the short SHA. The first row whose `Status` is not `done` is the
> resume point for `auto-continue-pr-loop`. Step ids are immutable once
> a Step has a commit. Per the skill contract, the table is the source
> of truth — the historical `Progress` section is kept as additional
> context.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Run-folder plan committed | done | 686f9d172 |
| 1 | 1.2 | Full spec at .ai/specs/2026-05-25-oss-optimistic-locking.md | done | 3fe3eb526 |
| 2 | 2.1 | packages/shared optimistic-lock.ts + createOptimisticLockGuardService | done | fb20f038e |
| 2 | 2.2 | packages/shared optimistic-lock-headers.ts constants | done | fb20f038e |
| 2 | 2.3 | Unit tests under packages/shared/src/lib/crud/__tests__ (20/20 pass) | done | fb20f038e |
| 3 | 3.1 | extractOptimisticLockConflict helper | done | 9f279d3e1 |
| 3 | 3.2 | buildOptimisticLockHeader helper | done | 9f279d3e1 |
| 3 | 3.3 | i18n ui.forms.flash.recordModified across 4 locales | done | 9f279d3e1 |
| 3 | 3.4 | Unit tests for client helpers (10/10 pass) | done | 9f279d3e1 |
| 4 | 4.1 | packages/core customers/di.ts registers guard service | done | a549a7be9 |
| 4 | 4.2 | Verify list/detail expose updatedAt; integration test reads it from GET /api/customers/companies | done | a549a7be9 |
| 4 | 4.3 | Integration test TC-LOCK-OSS-001.spec.ts + CI env OM_OPTIMISTIC_LOCK | done | a549a7be9 |
| 5 | 5.1 | Docs page concurrency-locking.mdx + sidebar entry | done | cc58b5ce0 |
| 5 | 5.2 | Task Router row in root AGENTS.md | done | cc58b5ce0 |
| 6 | 6.1 | Per-package unit tests pass | done | f3a07a67c |
| 6 | 6.2 | Targeted validation gate | done | f3a07a67c |
| 6 | 6.3 | PR opened with feature + review + needs-qa labels | done | 7f98bfe47 |
| 6 | 6.4 | Decision-matrix comment posted | done | 7f98bfe47 |
| 7 | 7.1 | customers/di.ts reader for customers.person | todo | — |
| 7 | 7.2 | Integration test TC-LOCK-OSS-002.spec.ts (race → 409 on person) | todo | — |
| 8 | 8.1 | sales/di.ts reader for sales.order + ensure responses expose updatedAt | todo | — |
| 8 | 8.2 | Integration test TC-LOCK-OSS-003.spec.ts (race → 409 on order) | todo | — |
| 9 | 9.1 | CrudForm: `optimisticLockUpdatedAt` prop auto-injects extension header on PUT/PATCH/DELETE | todo | — |
| 9 | 9.2 | CrudForm unit test for header injection (UI touch → UI test) | todo | — |
| 10 | 10.1 | useGuardedMutation: detect 409 `optimistic_lock_conflict`, surface `ui.forms.flash.recordModified` flash | todo | — |
| 10 | 10.2 | useGuardedMutation unit test for the flash (UI touch → UI test) | todo | — |
| 11 | 11.1 | Wire customers.company edit page to pass `optimisticLockUpdatedAt={record.updatedAt}` (UI touch → integration test extension) | todo | — |

## Goal (resume)

Finish the OSS optimistic-locking spec end-to-end on PR #2055:

- Wire two more reference entities (`customers.person`, `sales.order`) so
  the OSS layer matches the Q5/Q6 target scope from the spec.
- Pull the optimistic-lock contract directly into `CrudForm` and
  `useGuardedMutation` so callers stop having to wrap `updateCrud` by
  hand. Standalone helpers remain (they're public utilities), but the
  default form/mutation flow becomes automatic.
- Wire the `customers.company` edit page so the end-to-end UI path is
  observable in the reference module.

Per the user's directive in this resume: **every commit that touches a
UI file gets a UI test**. The Steps reflect that — each `*.tsx` /
`useGuardedMutation` / `CrudForm` change has a paired test Step.

## New phases (resume scope)

### Phase 7: customers.person reference

- 7.1 Extend `packages/core/src/modules/customers/di.ts` with a
  `customers.person` reader on the same `OptimisticLockGuardService`
  registration (single service, two readers).
- 7.2 New integration test `TC-LOCK-OSS-002.spec.ts` mirrors the
  company spec for `customers.people`. Uses `createPersonFixture`,
  reads `updatedAt` from `GET /api/customers/people`, races two
  updates, asserts 409 with structured body. Teardown via
  `deleteEntityByBody('/api/customers/people', id)`.

### Phase 8: sales.order reference

- 8.1 New (or augmented) `packages/core/src/modules/sales/di.ts`
  registers `crudMutationGuardService` (gated by the env) with a
  `sales.order` reader. The customers DI registration must compose
  cleanly — if both modules register the same DI key, the last writer
  wins under Awilix, so we consolidate by registering a single
  multi-reader service at the sales side **only when `customers` is
  not also opted in**, OR (simpler) move the registration into a
  shared `apps/mercato`-level location. Decision: keep per-module
  registration but with a documented limitation that
  `OM_OPTIMISTIC_LOCK` mixing customers + sales requires the future
  composition work; this PR ships the readers separately and the
  integration tests run in their own ephemeral env.
- 8.2 New integration test `TC-LOCK-OSS-003.spec.ts` mirrors the
  pattern for `sales/orders`. Uses
  `createOrderFixture` (or constructs one inline if no fixture
  helper exists) and the corresponding update endpoint.

### Phase 9: CrudForm auto-injection

- 9.1 Add an optional prop `optimisticLockUpdatedAt?: string | null`
  to `CrudForm`. When present and non-empty, the form merges the
  extension header into the `withScopedApiRequestHeaders(...)` scope
  used for `handleSubmit` and `handleDelete`. No behavior change when
  the prop is absent. Calls into `buildOptimisticLockHeader` from the
  helpers we already shipped.
- 9.2 Unit test under
  `packages/ui/src/backend/__tests__/CrudForm.optimisticLock.test.tsx`
  — mock `apiCall`, render the form with
  `optimisticLockUpdatedAt='2026-05-25T08:42:18.123Z'`, trigger
  submit, assert the request was issued with the extension header set.

### Phase 10: useGuardedMutation default 409 flash

- 10.1 In `useGuardedMutation`, after the `operation()` throws and the
  error matches `extractOptimisticLockConflict(err)`, call
  `flash(t('ui.forms.flash.recordModified'), 'error')` and rethrow.
  This is non-disruptive: it adds a default surface when callers
  haven't built their own handler. Callers that already catch and
  flash get an extra flash — acceptable for the default; spec note
  to document.
- 10.2 Unit test under
  `packages/ui/src/backend/injection/__tests__/useGuardedMutation.optimisticLock.test.tsx`
  — assert the flash fires exactly once when the operation throws a
  `CrudHttpError(409, body)` with `code: 'optimistic_lock_conflict'`,
  and does NOT fire for other 409s.

### Phase 11: Wire customers.company edit page end-to-end

- 11.1 Update the `customers.company` edit page to pass
  `optimisticLockUpdatedAt={record.updatedAt}` on the `CrudForm`.
  Touches a `.tsx` page → bundled with verification via the existing
  `TC-LOCK-OSS-001` test (already covers the API path) + a
  Playwright smoke that confirms the form sends the header.

## Risks (resume-specific)

- **DI clash for `crudMutationGuardService`.** Both `customers` and
  `sales` modules will try to register the same Awilix key. Awilix's
  `register` REPLACES the binding, so whichever module loads last
  wins. For this PR, the readers ship under separate modules and the
  CI env opts in for the test entities only one at a time — accept
  the limitation, document it in the spec, queue the composition fix
  as a follow-up.
- **`useGuardedMutation` flash double-fire risk.** Existing callers
  that catch and flash will produce two toasts. Mitigate by:
  documenting the behavior in the page-level guide and giving callers
  an opt-out via `formatErrorMessage` if needed (not in this resume —
  documented as a known interaction).
- **Sales order update endpoint shape may differ** from the
  customers PUT. Confirm before writing TC-LOCK-OSS-003.

## Progress (legacy — superseded by Tasks table; kept for context)

### Phase 1: Spec + run scaffolding

- [x] 1.1 Run-folder plan committed — 686f9d172
- [x] 1.2 Full spec at .ai/specs/2026-05-25-oss-optimistic-locking.md — 3fe3eb526

### Phase 2: Core guard service

- [x] 2.1 packages/shared optimistic-lock.ts + createOptimisticLockGuardService — fb20f038e
- [x] 2.2 packages/shared optimistic-lock-headers.ts constants — fb20f038e
- [x] 2.3 Unit tests under packages/shared/src/lib/crud/__tests__ (20/20 pass) — fb20f038e

### Phase 3: Client wiring

- [x] 3.1 extractOptimisticLockConflict helper (callers use this to drive the flash) — 9f279d3e1
- [x] 3.2 buildOptimisticLockHeader helper (callers wrap updateCrud with this) — 9f279d3e1
- [x] 3.3 i18n ui.forms.flash.recordModified across 4 locales (yarn i18n:check-sync ✓) — 9f279d3e1
- [x] 3.4 Unit tests for client helpers (10/10 pass) — 9f279d3e1

### Phase 4: Reference entity wiring (customers.company)

- [x] 4.1 packages/core customers/di.ts registers guard service — a549a7be9
- [x] 4.2 Verify list/detail expose updatedAt; integration test reads it from GET /api/customers/companies — a549a7be9
- [x] 4.3 Integration test TC-LOCK-OSS-001.spec.ts (race → 409) + CI env OM_OPTIMISTIC_LOCK=customers.company — a549a7be9

### Phase 5: Docs + Task Router

- [x] 5.1 Docs page concurrency-locking.mdx + sidebar entry — cc58b5ce0
- [x] 5.2 Task Router row in root AGENTS.md — cc58b5ce0
- [x] 5.3 (Follow-up next PR) Wire customers.person + sales.order — superseded by Phases 7–11 below

### Phase 6: Validation gate + PR

- [x] 6.1 Per-package unit tests pass — f3a07a67c
- [x] 6.2 Targeted validation gate — f3a07a67c
- [x] 6.3 PR opened with feature + review + needs-qa labels — PR #2055
- [x] 6.4 Decision-matrix comment posted to PR #2055 — 7f98bfe47
