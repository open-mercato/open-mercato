# SQL Transaction-Safety Audit — End-to-End Report

- **Date:** 2026-06-01
- **Scope:** Every command handler and API route across the monorepo (185 command files, ~770 API route files, 85 `makeCrudRoute` usages, plus shared write infrastructure and non-core packages).
- **Goal:** Find where SQL transaction usage should be improved; standardize on a hardened, state-of-the-art atomic-write helper; remediate the serious gaps and validate backward compatibility.
- **Prior art:** `SPEC-018-2026-02-05-safe-entity-flush.md` (introduced `withAtomicFlush`; its Phase 2 — non-command routes — was never completed, and many newer command-level gaps post-date it).

## TLDR

1. **Architectural root cause:** Neither `makeCrudRoute` nor `CommandBus` wraps a write in a database transaction. The entity mutation, custom-field write, audit-log write (on a **forked** EntityManager), and query-index update are **separate commits** that can partially fail. Transaction safety today depends entirely on each command internally calling `withAtomicFlush(..., { transaction: true })` — and many commands/routes do not.
2. **The helper itself was not SOTA.** `withAtomicFlush`'s transactional mode used raw `em.begin()/commit()/rollback()`, which is **not re-entrant** — MikroORM 7's `em.begin()` does not check `isInTransaction()` and silently clobbers an active transaction context (unlike `em.transactional()`'s savepoints). It also had **mock-only tests** (zero real-DB coverage). This has been hardened (see below).
3. **~52 findings** across modules: **5 CRITICAL**, **~22 HIGH**, **~25 MEDIUM**, plus ~30 LOW/idempotent items.

## Failure-mode taxonomy

| Code | Failure mode |
|------|--------------|
| PARTIAL-COMMIT | Multiple `em.flush()` in one write path with no enclosing transaction — a later failure leaves earlier writes committed. |
| UOW-LOSS | `em.find`/`em.findOne`/sync helper runs between a scalar mutation and `em.flush()` on the same EM without `withAtomicFlush` (SPEC-018 Problem 1 — silent lost update). |
| NON-COMMAND-DIRECT-WRITE | API route mutates ORM directly instead of dispatching a registered command — no atomicity/audit/undo/optimistic-lock. |
| MULTI-ENTITY-NON-ATOMIC | A write touching 2+ tables (header+lines, parent+children, entity+custom-fields) with no enclosing transaction; sequential `nativeDelete` cascades. |
| TXN-MISUSE | Side effects/events emitted inside a transaction, outer `em` used after a `.transactional()` fork, not awaited, or transaction context clobbered. |
| LOOP-WRITE | Loop of per-iteration mutations with a single trailing or per-iteration flush, no transaction (delete-all-then-reinsert is the prime suspect). |

## The `withAtomicFlush` SOTA verdict + hardening

**Verdict:** correct for the *current* usage pattern (every command forks the request EM first, then opens a top-level transaction), but **not safely composable** and **not proven against a real database**.

**Gaps identified:**
1. **Not re-entrant** — raw `em.begin()` overwrites `#transactionContext`; nesting (command-calls-command, or any future framework-level transaction) orphans the outer transaction → connection leak + `transactionRequired` on outer commit.
2. **Single trailing flush** vs the per-phase flush boundary the API implies (UoW-loss exposure if a later phase queries on earlier unflushed scalars).
3. **No isolation level / no retry** on serialization/deadlock (40001/40P01).
4. **Mock-only tests** — never proved rollback reverts rows, nesting, or UoW-loss against Postgres.

**Hardening applied (`packages/shared/src/lib/commands/flush.ts`):**
- **Re-entrancy guard:** when `em.isInTransaction()` is already true, join the ambient transaction (run phases + flush; the outermost caller owns commit/rollback) instead of clobbering it. Backward-compatible: no current caller nests, so behavior is unchanged today; future nesting is now safe.
- **Optional `isolationLevel`** forwarded to `em.begin()` (additive).
- **Non-transactional path kept byte-for-byte BC** (single trailing flush).
- Unit tests extended to cover re-entrancy, ambient-error propagation, and isolation-level forwarding. A real-DB integration test (rollback reverts rows / commit persists / nesting joins / UoW-loss) is to run on the ephemeral Postgres instance.

> Note: the framework-level seam (wrapping `CommandBus.execute` + the audit-log write in one transaction) was considered but **deliberately not pursued** in this effort — it carries HIGH backward-compat risk (the audit log is intentionally written on a forked EM; side-effect/event timing). The chosen strategy is per-command/per-route `withAtomicFlush({ transaction: true })`, which is localized and individually validatable.

## Severity tally

| Severity | Count (excl. LOW) | Where |
|---|---|---|
| CRITICAL | 5 | `makeCrudRoute` direct-ORM entity+custom-fields split; `sales.payments.updatePayment`; `sales.documents.createOrder` & `createQuote`; (framework) `CommandBus` non-atomic + forked audit log — documented, out of strategy scope |
| HIGH | ~22 | customer_accounts portal roles lockout; auth ACL routes + user-delete cascade; directory orgs; catalog products/variants/categories; currencies isBase; customers companies/personCompanyLinks; perspectives; messages updateDraft; inbox_ops reprocess; resources; sync-akeneo importer; onboarding provisioning; sales deletes/line-upserts/adjustments/quote-send |
| MEDIUM | ~25 | sales invoices/credit-memos; pipeline-stages; addresses primary-flag; staff.team-members.update; attachments+custom-fields; SCIM deactivateUser; data_sync cursor/counter split; dashboards redundant flush; dictionaries direct writes; translations save |

## Per-module findings

### Framework / shared infrastructure
| File:Lines | Category | Severity | Description |
|---|---|---|---|
| `crud/factory.ts` POST/PUT/DELETE + `data/engine.ts` createOrm/updateOrm/setCustomFields | PARTIAL-COMMIT | CRITICAL | Direct-ORM path commits the entity, then custom fields separately → orphaned row with no/partial custom fields on failure. |
| `commands/command-bus.ts` execute/undo + `audit_logs/services/actionLogService.ts` (forked EM) | PARTIAL-COMMIT / TXN-MISUSE | CRITICAL→documented | Command execution is not wrapped in a transaction; the audit log is written on `em.fork()` so it can never be atomic with the mutation. Left as-is (strategy scope); commands made internally atomic instead. |
| `data/engine.ts` `flushOrmEntityChanges` + query_index subscribers | NON-ATOMIC-SIDEEFFECT | HIGH | Index updates fire post-commit with swallowed errors → best-effort, can silently diverge. (By design; documented.) |

### sales
Key: `payments.updatePayment` (CRITICAL — 4 commit points), `documents.createOrder`/`createQuote` (CRITICAL — internal `setRecordCustomFields` flush commits a half-built doc), `documents.deleteOrder`/`deleteQuote` (HIGH — 8-statement `nativeDelete` cascade), `payments.deletePayment`, `documents` line-upserts & adjustment upserts/deletes & updateOrder/updateQuote (HIGH), `api/quotes/send` (HIGH — direct write + email before flush, no optimistic lock), invoices/credit-memos (MEDIUM), `returns` undo (MEDIUM, UoW-loss). Correct references already in repo: `createPaymentCommand`, shipment commands, `convertQuoteToOrderCommand` (all use `em.transactional`).

### customers / customer_accounts / portal
Key: `customer_accounts portal/users/[id]/roles` (HIGH — delete-then-reinsert → **zero-roles lockout**), `customer_accounts admin/users` POST (HIGH — user committed before roles), `companies` create/update (HIGH), `companies.deleteCompany.undo` (HIGH, multi-flush restore), `personCompanyLinks` update + undos (HIGH), `people.deletePerson` cascade (MEDIUM), `addresses` primary-flag, `pipeline-stages`, `deals.createDeal` (two separate transactions), `interactions` projection-after-commit, `tags`/`pipelines` (MEDIUM/LOW). `password/reset-confirm` emailVerifiedAt outside txn (LOW).

### catalog / currencies / dictionaries / translations
Key: `products` create/update (HIGH, two unwrapped flushes), `products` undo (HIGH, second forked `relationEm`), product delete cascade (HIGH), `variants` create/update (HIGH, default-enforcement + media aggregate), `categories` all (HIGH, hierarchy rebuild query+flush after commit), `currencies.isBase` enforcement (HIGH). `currencies/api/fetch-rates` loop+flush (MEDIUM, non-command), `dictionaries/api` POST + PATCH/DELETE (MEDIUM, non-command), `translations.save` non-transactional multi-statement + early event (MEDIUM).

### auth / api_keys / directory / staff / audit_logs
Key: `auth/api/roles/acl` & `auth/api/users/acl` PUT (HIGH — non-command direct RBAC writes, no optimistic lock), `auth.users.delete` 5-statement cascade (HIGH), `directory.organizations` create/update/delete (HIGH — org + children reparent + hierarchy rebuild across flushes), `auth.users` create/delete undo (MEDIUM), `auth/api/sidebar/preferences` PUT (MEDIUM, loop-write), `staff.team-members.update` (MEDIUM, UoW-loss), `sidebarPreferencesService` deactivate-all-then-write (MEDIUM), `staff.leave-requests` accept undo (LOW).

### dashboards / perspectives / attachments / configs / feature_toggles / messages / inbox_ops / notifications
Key: `perspectives/api/[tableId]` POST (HIGH — 3 independent committing writes), `perspectives.saveRolePerspectives` (HIGH, loop-write), `messages.updateDraftCommand` (HIGH — delete+recreate across 3 tables + UoW-loss), `inbox_ops .../reprocess` + `retireActiveProposalsForEmail` (HIGH, UoW-loss + 2 commits), `messages.restoreMessageAggregateSnapshot` (MED-HIGH), `attachments` POST/PATCH/DELETE + custom-fields (MEDIUM), `perspectiveService.saveUserPerspective` (MEDIUM), `dashboards/api/users/widgets` redundant flush (LOW). Many command-pattern handlers here already use `em.transactional` correctly.

### resources / planner / workflows / business_rules / entities / data_sync / sync_excel / integrations / payment_gateways / shipping_carriers
Key: `resources.resources` create/update/undo (HIGH, scalar flush + tag sync flush), `resources.tags` delete (MEDIUM), `data_sync sync-run-service.updateCursor` (MEDIUM, UoW-loss → breaks resume), `data_sync sync-engine` import batch (MEDIUM, counter/cursor split → double-count on crash), `sync_excel/api/import` (MEDIUM, 4-table non-command write), `workflows advance`/`retry` routes (MEDIUM, transition writes outside executor txn), `start-run` job+run split (LOW-MED). planner bulk-replace and `entities/lib/register.ts` already correct. payment_gateways/shipping_carriers clean (service-delegated, events after flush).

### Other packages / app modules
Key: `sync-akeneo catalog-importer` upsertProduct (HIGH — product+variants+offers+prices+attachments+relations across many commits) + `syncAssociations` (MEDIUM, loop+UoW), `onboarding verify` tenant provisioning (HIGH — tenant/org/user/roles/seed with no rollback; in-file TODO confirms), `enterprise sso scimService.deactivateUser` (MEDIUM — sessions survive deactivation), `enterprise sso user-deleted-cleanup` subscriber (MEDIUM, 3 writes), `example_customers_sync` (LOW, intentional cross-module). checkout/webhooks/scheduler/ai-assistant already protected.

## Remediation plan

1. **Foundation (done):** harden `withAtomicFlush` (re-entrancy, isolation level, tests). Add a real-DB integration test on the ephemeral instance.
2. **CRITICAL + HIGH** (this effort): wrap each leaky command/route in `withAtomicFlush({ transaction: true })` or `em.transactional`, keeping all side-effect/event emission **after** commit. Migrate the non-command RBAC/dictionary/perspective/quote routes onto commands or at minimum atomic writes. Fix the `makeCrudRoute` direct-ORM path to wrap entity + custom-field writes in one transaction.
3. **MEDIUM/LOW:** tracked in per-module issues for follow-up PRs.

## Backward-compatibility & validation strategy

- Side effects (`emitCrudSideEffects`, events, queue enqueue, cache invalidation) stay **outside/after** the transaction — no event-timing change.
- The non-transactional path of `withAtomicFlush` is unchanged.
- Each fix changes *when* a write commits (atomically), never *what* commits — observable success behavior is identical; only mid-failure partial states are eliminated.
- Validation: `yarn build:packages` / `yarn typecheck` / `yarn lint` / `yarn test`, plus targeted Playwright integration tests on the **ephemeral Postgres instance** (`yarn test:integration:ephemeral`), including injected-failure tests asserting no partial rows remain.
