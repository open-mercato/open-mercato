# Execution plan — OSS opt-in optimistic locking (issue #1981)

**Source spec:** `.ai/specs/2026-05-25-oss-optimistic-locking.md` (created in Phase 1.2)
**Issue:** [#1981](https://github.com/open-mercato/open-mercato/issues/1981)
**Branch:** `feat/oss-optimistic-locking`
**Base:** `develop`

## Goal

Ship an **opt-in, additive** generic optimistic-locking guard in OSS, gated by
`OM_OPTIMISTIC_LOCK` env (default OFF). Uses the existing `updated_at` common
column as the version token — no migration, no entity fork. On conflict
returns HTTP 409 with a structured body the enterprise `record_locks` module
can extend. Surfaces through `useGuardedMutation` as a built-in flash. One
reference entity (`customers.company`) is wired end-to-end with a Playwright
integration test that exercises the conflict path.

The two remaining reference entities from the spec
(`customers.person`, `sales.order`) and their integration tests are left as
**explicit follow-up steps** (Phase 5) so this PR ships incrementally — the
reviewer sees a complete, working reference on one entity before broader
rollout.

## Scope

- `packages/shared` — `OptimisticLockGuardService` (DI-registered via
  `crudMutationGuardService` legacy bridge), env parsing, header parsing.
- `packages/ui` — `useGuardedMutation` 409 conflict default flash (i18n key
  `ui.forms.flash.recordModified`); `CrudForm` round-trips `updatedAt` via
  the extension header when present on the loaded record.
- `packages/core/src/modules/customers` — DI-register the optimistic guard
  for `customers.company` entityType. Audit detail/list responses for
  `updatedAt` exposure (they already serialize it; add a regression test).
- `packages/core/src/modules/customers/__integration__` — new
  `TC-LOCK-OSS-001.spec.ts`: race two updates on the same company; assert
  second gets 409 with the structured body.
- `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx` — new
  docs page covering OSS (this spec) and forward-link to enterprise
  `record_locks`.
- Root `AGENTS.md` — Task Router row.

## Non-goals

- Participant presence, heartbeat, force-release, conflict-merge UI
  (lives in `packages/enterprise/src/modules/record_locks/`).
- Auto-applying the guard reflectively to **every** entity. Reference impl
  is opt-in per entity via `OM_OPTIMISTIC_LOCK` allow-list to keep BC
  surface zero.
- New columns or migrations.
- Pessimistic `SELECT ... FOR UPDATE` paths.

## External references

None for this run. All primitives are in-tree.

## Risks

- The static-`data/guards.ts` path cannot read DB. The spec calls this out
  explicitly; the impl uses `crudMutationGuardService` DI which IS
  container-bound. Mitigation: a code comment at the registration site +
  a docs note in the new docs page.
- `customers.company` updates have other guards (e.g. record-locks legacy
  bridge from enterprise). Mitigation: guard priority lets the optimistic
  check run **after** the enterprise pessimistic check (when present), so
  the existing flow is unchanged when enterprise is enabled.

## Decisions recorded

Per user confirmation 2026-05-25T09:50Z — recommended options selected:
- Wire transport: extension header
  `x-om-ext-optimistic_lock-expected-updated-at` (camelCase ISO 8601,
  ms-precision).
- 409 body shape: `{ error: 'record_modified', code:
  'optimistic_lock_conflict', currentUpdatedAt, expectedUpdatedAt }`.
- `OM_OPTIMISTIC_LOCK` accepts `all` keyword OR comma-separated
  entityType allow-list.
- Enterprise hook: priority-composed guards + `resolveExpectedUpdatedAt`
  extension point (deferred — enterprise module owns its own
  registration).
- Reference entities: starts with `customers.company` this PR; follow-up
  steps for `customers.person` + `sales.order` recorded in Phase 5.
- Integration tests: one pair per reference entity (one this PR, two
  follow-up).

The full option matrix is posted as a PR comment after PR open per user
request, for the architectural decision log.

## Implementation plan

### Phase 1: Spec + run scaffolding

- 1.1 Run-folder plan committed (this file).
- 1.2 Write the full specification at
  `.ai/specs/2026-05-25-oss-optimistic-locking.md`. Includes problem,
  proposed solution, architecture, wire formats, server algorithm,
  client wiring, enterprise-extension contract, BC contract, phasing,
  testing strategy. Final spec is the centerpiece deliverable of this PR.

### Phase 2: Core guard service in @open-mercato/shared

- 2.1 New file `packages/shared/src/lib/crud/optimistic-lock.ts` exporting
  `createOptimisticLockGuardService(opts)` and
  `parseOptimisticLockEnv(raw)` (pure parsing — unit-testable).
- 2.2 Header constants in
  `packages/shared/src/lib/crud/optimistic-lock-headers.ts`
  (`OPTIMISTIC_LOCK_HEADER_NAME`, `OPTIMISTIC_LOCK_CONFLICT_CODE`).
- 2.3 Unit tests
  `packages/shared/src/lib/crud/__tests__/optimistic-lock.test.ts`
  covering: env parsing (`undefined`, `''`, `'all'`,
  `'customers.company,sales.order'`, whitespace, dupes); header parsing
  (missing, malformed, valid ISO); mismatch detection (equal, off by
  one second, off by one ms, missing client token in strict mode,
  missing client token in lenient mode).

### Phase 3: Client wiring (useGuardedMutation + CrudForm + i18n)

- 3.1 `useGuardedMutation`: detect HTTP 409 with `code:
  'optimistic_lock_conflict'`, emit default flash via the new i18n key
  `ui.forms.flash.recordModified`, leave `retryLastMutation` available.
- 3.2 `CrudForm`: when a loaded record has `updatedAt`, automatically
  inject the `x-om-ext-optimistic_lock-expected-updated-at` header on
  every `PUT`/`PATCH`/`DELETE` via `withScopedApiRequestHeaders`.
- 3.3 i18n: add `ui.forms.flash.recordModified` to all 4 locales (en /
  de / es / pl); the non-English values default to the English string
  per project convention (translation deferred).
- 3.4 Unit tests for the 409 detection helper + header-injection helper.

### Phase 4: Reference entity wiring (customers.company)

- 4.1 `packages/core/src/modules/customers/di.ts` — register the
  optimistic-lock service when `OM_OPTIMISTIC_LOCK` includes
  `customers.company` (or is `all`). Use `asFunction` resolution so the
  env is read once per process.
- 4.2 Verify `GET /api/customers/companies/:id` and `GET
  /api/customers/companies` already include `updatedAt` in the
  response; add a unit-level regression test if not.
- 4.3 Integration test
  `packages/core/src/modules/customers/__integration__/TC-LOCK-OSS-001.spec.ts`:
  fixture-create a company; perform two `PUT` requests racing on the
  same company; the second carries a stale
  `x-om-ext-optimistic_lock-expected-updated-at` header; assert 409
  with the structured body. Teardown deletes the company.

### Phase 5: Docs + Task Router

- 5.1 New docs page
  `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx`
  covering: when to opt in, env config, wire format, server algorithm,
  reference impl (customers.company), client UX, enterprise extension
  path. Forward-links to enterprise `record_locks`.
- 5.2 Task Router row in root `AGENTS.md` pointing to the new docs page
  and to `packages/shared/src/lib/crud/optimistic-lock.ts` as the
  reference implementation.
- 5.3 (Follow-up — not in this PR) Wire `customers.person` and
  `sales.order` per the spec. Tracked as separate steps in this Progress
  section so `auto-continue-pr` can pick them up next time.

### Phase 6: Validation gate + PR

- 6.1 Per-package unit tests for changes (shared, ui, customers).
- 6.2 Full validation gate: `yarn build:packages` → `yarn generate` →
  `yarn build:packages` again → `yarn i18n:check-sync` → `yarn
  i18n:check-usage` → `yarn typecheck` → `yarn test`.
- 6.3 Push branch, open PR, apply `feature` + `review` labels.
- 6.4 Post the decision-matrix comment per user request.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

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
  Note: standalone helpers in this PR; pulling them into CrudForm/useGuardedMutation
  directly is deferred to a follow-up so the reference impl is observable first.
- [x] 3.3 i18n ui.forms.flash.recordModified across 4 locales (yarn i18n:check-sync ✓) — 9f279d3e1
- [x] 3.4 Unit tests for client helpers (10/10 pass) — 9f279d3e1

### Phase 4: Reference entity wiring (customers.company)

- [x] 4.1 packages/core customers/di.ts registers guard service — a549a7be9
- [x] 4.2 Verify list/detail expose updatedAt; integration test reads it from GET /api/customers/companies — a549a7be9 (no regression test added — TC-LOCK-OSS-001 covers this in-flight)
- [x] 4.3 Integration test TC-LOCK-OSS-001.spec.ts (race → 409) + CI env OM_OPTIMISTIC_LOCK=customers.company — a549a7be9

### Phase 5: Docs + Task Router

- [ ] 5.1 Docs page concurrency-locking.mdx
- [ ] 5.2 Task Router row in root AGENTS.md
- [ ] 5.3 (Follow-up next PR) Wire customers.person + sales.order

### Phase 6: Validation gate + PR

- [ ] 6.1 Per-package unit tests pass
- [ ] 6.2 Full validation gate passes
- [ ] 6.3 PR opened with feature + review labels
- [ ] 6.4 Decision-matrix comment posted
