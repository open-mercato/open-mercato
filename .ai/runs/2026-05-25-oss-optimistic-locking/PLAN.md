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
| 7 | 7.1 | customers/di.ts reader for customers.person | done | 360a99fc7 |
| 7 | 7.2 | Integration test TC-LOCK-OSS-002.spec.ts (race → 409 on person) | done | 7374b65ea |
| 8 | 8.1 | Shared optimistic-lock-store.ts (registerOptimisticLockReaders / getAllOptimisticLockReaders) + factory pulls readers from store when none passed; customers/di.ts migrates to store | done | 31d4c3a1d |
| 8 | 8.2 | sales/di.ts adds sales.order reader via store; integration test TC-LOCK-OSS-003.spec.ts (race → 409 on order) | done | ff7841453 |
| 9 | 9.1 | CrudForm: `optimisticLockUpdatedAt` prop auto-injects extension header on PUT/PATCH/DELETE | done | a3d13cc5b |
| 9 | 9.2 | CrudForm unit test for header injection (UI touch → UI test) | done | a3d13cc5b |
| 10 | 10.1 | useGuardedMutation: detect 409 `optimistic_lock_conflict`, surface `ui.forms.flash.recordModified` flash | done | ca507bad5 |
| 10 | 10.2 | useGuardedMutation unit test for the flash (UI touch → UI test) | done | ca507bad5 |
| 11 | 11.1 | Wire customers.company edit page to pass `optimisticLockUpdatedAt={record.updatedAt}` (UI touch → integration test extension) | done | 4e4438ad6 |
| 12 | 12.1 | Final gate (build / typecheck / test / build:app / ds-guardian / auto-review-pr) + PR body flip to `complete` | done | 65bab423d |
| 13 | 13.1 | Generic optimistic-lock reader factory (`createGenericOptimisticLockReader`) in `@open-mercato/shared` + unit tests | done | 8932cd344 |
| 13 | 13.2 | `registerOptimisticLockReaderIfAbsent` store helper (hand-wired readers always win) + unit tests | done | 7ef8c5e0f |
| 13 | 13.3 | Auto-register a generic reader from `makeCrudRoute` for every CRUD route's resourceKind + factory unit test | done | dda055339 |
| 13 | 13.4 | Spec + docs update: "all CRUD entities" auto-registered, decision matrix Q5 = C (platform-wide) | done | cddd2ce47 |
| 13 | 13.5 | New integration spec `TC-LOCK-OSS-004` for `customers.deal` proving the generic path + CI env expands to `all` | done | 284b72b38 |
| 14 | 14.1 | Flip `parseOptimisticLockEnv` default from OFF → all; add explicit OFF tokens (`off` / `false` / `0` / `no` / `disabled` / `none`); update unit tests + add positive default-ON detection test | done | e8bcf4287 |
| 14 | 14.2 | Register a default `crudMutationGuardService` in the shared DI bootstrap (`packages/shared/src/lib/di/container.ts`) so coverage is universal even without `customers` / `sales` modules opting in | done | e8bcf4287 |
| 14 | 14.3 | Simplify `customers/di.ts` and `sales/di.ts`: register hand-wired readers unconditionally; drop redundant module-level `crudMutationGuardService` binding | done | e8bcf4287 |
| 14 | 14.4 | Update spec §3.4 + §4 + decision matrix Q7 = C; update `concurrency-locking.mdx` (default state, opting out, reference example); update root `AGENTS.md` Task Router row | done | e8bcf4287 |
| 14 | 14.5 | CHANGELOG `Unreleased` entry + `UPGRADE_NOTES.md` migration section + CI workflow comment refresh | done | e8bcf4287 |
| 15 | 15.1 | Deals: send optimistic-lock header on update + delete handlers + unit test | done | 19d662563 |
| 15 | 15.2 | Company-v2 + People-v2: send lock header on custom delete handlers + tests | done | 583bdb1c9 |
| 15 | 15.3 | Sales channels list delete: send lock header (row updatedAt) + conflict refresh | done | 419670342 |
| 15 | 15.4 | Integration: stale + header-less DELETE for customers.deal (entity-agnostic delete-guard proof) | done | 7d083ad09 |
| 15 | 15.5 | Coverage spec reconciliation (impl-status table) — docs already cover the pattern | done | b1dbcf79c |
| 16 | 16.0 | Merge develop → resolve conflicts (CHANGELOG, yarn.lock) | done | 20b4ba3ff |
| 16 | 16.1 | Generalist command-level helper `optimistic-lock-command.ts` (read/assert/enforce) + export `normalizeIsoToken` + unit tests | done | 7d30ee397 |
| 17 | 17.1 | Sales command helper `enforceSalesDocumentOptimisticLock` in commands/shared.ts (parent order/quote version check; parent bump is automatic via totals recalc) | done | PENDING |
| 17 | 17.2 | Wire order/quote line upsert + delete commands to document-aggregate lock | done | PENDING |
| 17 | 17.3 | Wire order/quote adjustment upsert + delete commands | done | PENDING |
| 17 | 17.4 | Wire return create command + quote convert_to_order (#2114 race) | done | PENDING |
| 17 | 17.5 | Sales command-level optimistic-lock unit + command tests | done | PENDING |
| 17 | 17.6 | Decision: payments/shipments already row-level-guarded by makeCrudRoute (flat mapInput → candidateId set); a document-aggregate check would conflict with the single header, so no command check there — documented in spec + follow-up | done | PENDING |
| 18 | 18.1 | Client: sales document sub-resource sections send `buildOptimisticLockHeader(document.updatedAt)` + 409 conflict flash/refresh + tests | todo | — |
| 19 | 19.1 | Update coverage-completion spec (Phase 4) + main optimistic-locking spec (command-level section) | todo | — |
| 19 | 19.2 | Update `concurrency-locking.mdx` docs + root AGENTS.md command-level contract | todo | — |
| 20 | 20.1 | File follow-up GitHub issue (extend command-level lock to other modules) + CHANGELOG entry | todo | — |

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

### Phase 13: Auto-coverage for all CRUD entities (resume — `add support for all other entities`)

Goal: extend the guard from the 3 hand-wired reference entities to every
entity managed by `makeCrudRoute` (64 routes today, more as modules
ship). Hand-wired readers (`customers.company` with `kind: 'company'`,
`customers.person` with `kind: 'person'`, `sales.order`) MUST keep
winning — we add a generic reader as a per-route fallback that the
CRUD factory installs at module load time. `OM_OPTIMISTIC_LOCK=all`
finally means what it says.

- 13.1 New `createGenericOptimisticLockReader({ entity, idField,
  tenantField, orgField, softDeleteField, extraFilter? })` factory
  exported from `packages/shared/src/lib/crud/optimistic-lock.ts`.
  Reads only `updatedAt`, fails-open on schema mismatch / missing
  column (returns `null` so the guard SKIPS rather than 500s).
  Unit tests under `__tests__/optimistic-lock.test.ts`.
- 13.2 New `registerOptimisticLockReaderIfAbsent(key, reader)` helper
  in `optimistic-lock-store.ts`. Idempotent. Hand-wired readers (which
  register first via `customers/di.ts` / `sales/di.ts`) always win.
  Unit tests under `__tests__/optimistic-lock-store.test.ts`.
- 13.3 `makeCrudRoute` (in `factory.ts`) auto-registers a generic
  reader for each route's `resourceKind` + aliases using the factory's
  own `orm` config (idField / tenantField / orgField / softDeleteField).
  Strict-additive: no behavior change when env is OFF or the entity
  is not in the allow-list. Add a `__tests__/crud-factory.test.ts`
  case asserting registration happens at factory call time.
- 13.4 Update `.ai/specs/2026-05-25-oss-optimistic-locking.md`
  (flip decision-matrix Q5 from "B target, A this PR" to "C —
  platform-wide via generic reader auto-registration") + extend
  `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx`
  with a "Supported entities" section explaining the
  auto-registration model and the hand-wired override path.
- 13.5 New integration spec
  `packages/core/src/modules/customers/__integration__/TC-LOCK-OSS-004.spec.ts`
  for `customers.deal` (an entity NOT in the original 3-reference set).
  CI env (`.github/workflows/ci.yml`) flips
  `OM_OPTIMISTIC_LOCK='customers.company,customers.person,customers.people,sales.order'`
  → `OM_OPTIMISTIC_LOCK='all'` so the generic-reader path runs in
  ephemeral-integration. Keeps TC-LOCK-OSS-001..003 green
  (`all` covers everything they need).

## Resume — command-level optimistic locking (Phases 16–20)

**Trigger:** `/auto-continue-pr-loop 2055 fix conflicts then continue the
implementation for sales sub requests based on the commands — generalist way
to support OSS optimistic locks for commands (not only CrudForms), implement
for sales, update docs/specs, file a follow-up issue for other modules.`

**Why this is new scope on a "complete" PR.** Phases 1–15 protect every
`makeCrudRoute` mutation (incl. command-dispatched CRUD actions like sales
lines, which already get a *row-level* guard via the factory). What was NOT
covered: domain writes that mutate an aggregate's sub-resources through the
Command pattern want to guard the **aggregate root** (the parent order/quote),
not just the child row — and pure action endpoints (quote→order conversion)
bypass the CRUD guard entirely. This resume adds a generalist command-level
primitive and demonstrates it on sales.

**Design decision (architectural).** Sub-resource commands enforce the
**document-aggregate** version: read the expected parent order/quote
`updated_at` (extension header, same wire contract), compare against the loaded
parent, throw the identical structured 409 on mismatch, and **bump the parent
`updated_at`** on a successful sub-resource mutation so concurrent sub-edits
conflict. Row-level granularity is already provided by the existing factory
guard, so the document-aggregate layer is the part that adds new value.
Strictly additive: no header ⇒ no 409.

### Phase 16: Generalist command-level helper (`@open-mercato/shared`)

- 16.1 New `packages/shared/src/lib/crud/optimistic-lock-command.ts`:
  `readOptimisticLockExpected(request|headers)`,
  `assertOptimisticLock({ resourceKind, resourceId, expected, current })`
  (pure; throws `CrudHttpError(409, OptimisticLockConflictBody)`; no-op when
  env-disabled / no expected / no current), and
  `enforceCommandOptimisticLock({ resourceKind, resourceId, current, expected?,
  request? })` (resolves expected from explicit override or header, then
  asserts). Reuses the exported `normalizeIsoToken` from `optimistic-lock.ts`
  so command + CRUD paths normalize identically. Respects the same
  `OM_OPTIMISTIC_LOCK` env contract. Unit tests.

### Phase 17: Sales document-aggregate command wiring

- 17.1 Sales-local helper `enforceSalesDocumentOptimisticLock(ctx, { order |
  quote })` + `touchSalesDocument(order|quote)` in `commands/shared.ts`
  (reads `ctx.request` headers, maps the document to `sales.order` /
  `sales.quote` resourceKind, enforces + bumps `updatedAt`).
- 17.2 Order/quote line upsert + delete commands enforce + bump the parent
  document before flush + tests.
- 17.3 Order/quote adjustment upsert + delete commands + tests.
- 17.4 Shipment create/update/delete commands + tests.
- 17.5 Payment create/update/delete commands + tests.
- 17.6 Return create command + quote `convert_to_order` (closes the #2114
  accept/convert race surface) + tests.

### Phase 18: Client wiring

- 18.1 Sales document UI sub-resource sections send
  `buildOptimisticLockHeader(document.updatedAt)` via
  `withScopedApiRequestHeaders(...)` on POST/PUT/DELETE; surface the 409
  conflict flash (`ui.forms.flash.recordModified`) + refresh. Paired UI test.

### Phase 19: Docs + specs

- 19.1 Coverage-completion spec Phase 4 marked implemented (impl-status table)
  + main spec gains a "Command-level checks" section.
- 19.2 `concurrency-locking.mdx` "Protecting command/action endpoints" section
  + root AGENTS.md note that command-dispatching routes mutating an aggregate
  SHOULD call `enforceCommandOptimisticLock`.

### Phase 20: Follow-up issue + finalize

- 20.1 File a GitHub follow-up issue to extend command-level optimistic locking
  to other modules (catalog nested resources, workflows action endpoints,
  staff/resources adapters) + CHANGELOG `Unreleased` entry. Final gate +
  auto-review + summary comment + label normalization.
