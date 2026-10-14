# Pre-Implementation Analysis: Customer Groups & B2B Commercial Terms

> Source: `adeptofvoltron/open-mercato` PR #9 (`spec/ecommerce-module-suite`, commit `e97c98d9266cebbbdcb193af335ba4b8ef551eec`), file `2026-08-14-customer-groups-and-b2b-terms.md`. This PR is spec-only; no code from it exists in this repo. This analysis audits the spec text against `develop` as of this worktree, not against any implementation.

## Executive Summary

The spec is well-researched and its factual claims about the current codebase check out exactly (verified independently: `pricing.ts:66,84`, entity field shapes, module `requires`/`ejectable` declarations, encryption precedent). It is not ready to implement as written. Three **Critical** issues block Phase 1 of its own implementation plan: (1) the optimistic-locking mechanism it specifies for `CustomerCreditAccount`/`CustomerPurchaseApproval` — a `version` integer column — has **zero wiring** anywhere in this platform's guard system and would leave R8 ("approval double-decision") entirely unprotected despite the spec claiming it is mitigated; (2) the `SERIALIZABLE` transaction + retry-on-40001 strategy for `reserveCredit` (R1, the spec's own top risk — "unsecured trade credit") has no production reference implementation in this repo, only an unused `isolationLevel` option on `withAtomicFlush` and a test-only mock; (3) the spec never resolves whether the admin group-picker in `catalog`/`sales` (§7.3) is built via a hard module dependency or via the existing `crud-form:<entityId>:fields` widget-injection spot, which is exactly the mechanism this platform already provides for this use case. Recommendation: **needs spec updates before implementation**, concentrated in a new "Concurrency Strategy" subsection, a corrected optimistic-locking model, and an explicit widget-injection design for §7.3.

## Backward Compatibility

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---------|-------|----------|-------------|
| 1 | Widget injection / Cross-module coupling | §7.3 says the catalog price editor's and sales tax-rate form's free-text UUID inputs are "replaced with a group picker sourced from `/api/customer-groups`" but never states the mechanism. Implemented as a direct import/dependency, this forces `catalog` (verified: `catalog/index.ts` has **no `requires` field at all** today — the only zero-dependency core module) and `sales` (verified: `sales/index.ts:12` already lists `requires: ['catalog', 'customers', 'dictionaries']`) to add `requires: ['customer_groups']`, when `pricing.ts:66,84` (verified) only ever compares a `customerGroupId[s]` value the **caller** already supplied — the matcher itself never needs to resolve groups. This is precisely the case `packages/core/AGENTS.md` → Widget Injection / Cross-Module Coupling and the Task Router's "Injecting UI widgets into other modules" row exist to solve. | **Critical** | Ship the group picker as a `crud-form:catalog.<price-entity>:fields` / `crud-form:sales.sales_tax_rate:fields` injected field widget (verified live mechanism: `packages/ui/AGENTS.md:378-382`, "CrudForm Field Injection"), owned by `customer_groups`. `catalog`/`sales` gain no new `requires` entry; `customer_groups` alone depends on nothing from either. State this explicitly in §7.3 and in a new Migration & Backward Compatibility subsection. |
| 2 | Type definitions (`PricingContext`) | §7.1's deprecation-bridge plan (`customerGroupId` retained, normalized to `[customerGroupId]`) is sound and additive, but the spec asserts `PricingContext` "is a public type consumed by third-party modules" without confirming it is actually exported/documented as such under `BACKWARD_COMPATIBILITY.md` §2's STABLE type list (it is not currently enumerated there). | Warning | Before implementation, confirm `PricingContext`'s export surface and, if it is indeed consumed externally, add it to `BACKWARD_COMPATIBILITY.md` §2 in the same change so future edits are held to the same bar the spec is already applying to itself. |

### Missing BC Section

Not missing — §8 "Migration & Backward Compatibility" exists and correctly covers the FK/orphan-reconciliation surface. It does **not** cover finding #1 (the coupling-direction question) or the `PricingContext` export-surface question (finding #2); both should be folded into §8 or a new subsection.

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---------|--------|---------------|
| Concurrency Strategy (subsection of Architecture or Service Contract) | R1 — the spec's own highest-severity risk — has no implementable mitigation as written; `reserveCredit`'s "serializable transaction; retry on serialization failure" is asserted with no reference to how either half is built in this codebase | Add a subsection naming: where the retry-on-`40001` helper lives (candidate: `packages/shared/src/lib/commands/`, alongside the already-existing but unused `isolationLevel` option on `withAtomicFlush`), and confirming MikroORM's Postgres driver honors that option end-to-end (`em.begin({ isolationLevel })` — verified present in `packages/shared/src/lib/commands/flush.ts` but never exercised with `'serializable'` anywhere in the repo) |

### Incomplete Sections

| Section | Gap | Recommendation |
|---------|-----|---------------|
| §5.4 / §5.6 Data Models, §16 Final Compliance | `version: integer` is specified as the optimistic-locking mechanism for `CustomerCreditAccount` and `CustomerPurchaseApproval`, but this platform's *only* optimistic-locking mechanism is `updated_at` + the extension header protocol (`buildOptimisticLockHeader` / `enforceCommandOptimisticLock` / `surfaceRecordConflict`) — confirmed exhaustively via `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx` (587 lines, `updated_at`-only, no `version`-column pattern documented anywhere) and a repo-wide grep: every existing `version` column in the codebase (`business_rules`, `workflows` definition/instance, `configs`, `ai_assistant`) is a **schema/definition version**, never a MikroORM `@Version`-style row-lock counter. As specified, `version` is inert: nothing reads or increments it, so R8 ("approval double-decision... surfaces the conflict bar") is **not actually mitigated** by anything in §5.6 or §16 | Drop `version` from both entities (both already carry `updated_at` per the §5 header convention) and route `CustomerCreditAccount` edits + `CustomerPurchaseApproval` decisions through the documented `updated_at`/header flow — `enforceCommandOptimisticLock` for the `/approvals/:id/decide` action route since it is a non-`makeCrudRoute` command endpoint (see `concurrency-locking.mdx` → "Protecting command/action endpoints") |
| §9 API Contracts / §6 Service Contract | Custom action routes (`credit-accounts/:id/adjust`, `approvals/:id/decide`, and the `reserveCredit`/`releaseCredit`/`settleCredit` service methods `checkout` will call) never state whether they go through the mutation-guard registry (`runMutationGuards`, `getAllMutationGuardInstances`) or the Command pattern's undo/audit machinery — required by `packages/core/AGENTS.md` → API Routes / Command Side Effects for any non-CRUD write | State explicitly that these are Commands (even if non-undoable, since the ledger is intentionally append-only/no-undo by design — that's a legitimate design choice but should be *stated*, not left implicit) and that the action routes wire the mutation-guard registry per the standard custom-write-route contract |
| §11 Background Jobs | `expire-memberships` / `expire-approvals` / `credit-exposure-audit` are given cadences ("hourly", "daily") but queue workers in this platform are event/enqueue-triggered, not self-scheduling (`packages/queue/AGENTS.md` has no cron concept). The repo already has a scheduling mechanism (`@open-mercato/scheduler`, BullMQ repeatable jobs) and a per-org cron-registration-in-`setup.ts` precedent (`communication_channels/workers/gmail-renew-watch.ts`) that the spec never references | Name the scheduling mechanism explicitly — either `@open-mercato/scheduler` or the `setup.ts`-registered-per-org-cron pattern — for each of the three jobs |
| §10 Events | Event IDs are listed with no payload shapes | Add payload field lists per event, at minimum for `customer_groups.membership.added`/`.removed` (R2's cache-invalidation consumer needs the group id and customer id) and `customer_groups.credit.limit_exceeded` (the notification subscriber needs enough context to render the notification) |
| Module file checklist | Per `packages/core/src/modules/customers/AGENTS.md` "Module Files Checklist," a new module should ship `acl.ts, ce.ts, di.ts, events.ts, index.ts, notifications.ts, search.ts, setup.ts`. The spec covers `acl.ts` (§9.1), `events.ts` (§10), and implies `di.ts` (§6), but never mentions `setup.ts`/`defaultRoleFeatures` (required whenever `acl.ts` gains features — `packages/core/AGENTS.md` → ACL Grant Sync), `notifications.ts` (needed for the `credit.limit_exceeded` in-app notification §10 already promises), or `search.ts` (groups/terms are natural admin-search targets) | Add a short "Module Files" subsection enumerating these, or explicitly scope them out with a stated reason |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|------|----------|-----|
| Cross-Module Coupling — "prefer widget injection... never a hard `requires` on an optional/UI-only peer" (`packages/core/AGENTS.md` → Cross-Module Coupling, Widget Injection) | §7.3 Admin UI | Use `crud-form:<entityId>:fields` injection (see BC finding #1) |
| "User-editable entities MUST include an `updated_at` column so OSS optimistic locking (default ON) can function" (`packages/core/AGENTS.md` → Database Entities) | §5.4, §5.6 | Both entities already have `updated_at` per §5's blanket header — the bug is the *additional*, functionally-inert `version` field, not a missing `updated_at`. Remove `version`; rely on the documented mechanism (see Spec Completeness table above) |
| "Implement write operations via the Command pattern... include `indexer: { entityType, cacheAliases }`" (`packages/core/AGENTS.md` → Command Side Effects) | §6 Service Contract, §9 action routes | State Command-pattern wiring for `adjust`/`decide`/`reserveCredit` et al. (see Spec Completeness table) |
| "When adding features to `acl.ts`, also add them to `setup.ts` `defaultRoleFeatures`" (`packages/core/AGENTS.md` → ACL Grant Sync) | §9.1 | Add `setup.ts` coverage |

**Encryption — confirmed compliant, not a violation.** §16's "credit limits and ledger amounts... not GDPR special categories, standard scoping applies, no field encryption" is consistent with actual house style: surveyed every `encryption.ts` in the repo (12 files) and found zero precedent for encrypting a scalar monetary/amount column anywhere — `sales/encryption.ts` encrypts `totals_snapshot` (a JSONB blob bundling customer/address/payment context) while leaving the real numeric total columns (`subtotal_net_amount`, `grand_total_gross_amount`, etc.) plaintext; `payment_gateways/encryption.ts` encrypts secrets/JSON blobs (`client_secret`, `webhook_log`) while leaving lookup/status columns plaintext. The spec's call is defensible and matches this pattern; recommend citing it explicitly in §16 rather than resting solely on the "not GDPR" argument.

**Module structure — mostly compliant.** `customer_groups` (plural, snake_case) follows convention. §2.1's consumer survey (`pricing.ts:66,84`, `catalog/api/prices/route.ts`, `catalog/commands/prices.ts`, `catalog/commands/variants.ts`, `catalog/ai-tools/prices-offers-pack.ts`, `sales/data/entities.ts`) is accurate — independently re-verified `pricing.ts:66` (`if (row.customerGroupId && ctx.customerGroupId !== row.customerGroupId) return false`) and `:84` (`if (row.customerGroupId) score += 3`) match exactly. `CustomerEntityRole.roleType` (`customers/data/entities.ts:1049-1050`, plain non-nullable `text`) and `CustomerCompanyBilling.paymentTerms` (`:1185-1186`, plain nullable `text`) are also confirmed accurate characterizations.

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| R1 restated: `SERIALIZABLE` retry infrastructure doesn't exist | The spec's stated mitigation for its own top risk (concurrent credit overshoot) cannot be implemented by copying an existing pattern — `SERIALIZABLE` appears in this codebase's production code exactly zero times; the only hit is a test mock asserting `em.begin` receives `{ isolationLevel: 'serializable' }`. `withAtomicFlush` (`packages/shared/src/lib/commands/flush.ts`) does expose a real `isolationLevel` passthrough to `em.begin()`, so the primitive exists, but nothing exercises it and no retry-on-40001 helper exists anywhere | Build and unit-test the retry helper as its own reviewable unit before wiring `reserveCredit` to it; do not treat "mirrors SPEC-055" as precedent — SPEC-055 (promotions) is itself unimplemented spec-only text making the identical proposal, not working code |
| Optimistic-lock mechanism mismatch silently defeats R8 | As specified, nothing in the platform reads or increments `CustomerCreditAccount.version` / `CustomerPurchaseApproval.version` — a second approver's decision would not conflict, contradicting the spec's own claim in §12 R8 | See AGENTS.md Compliance table |

### Medium Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Coupling-direction ambiguity (§7.3) ships as a hard dependency by default | If an implementer follows the path of least resistance, `catalog`/`sales` gain `requires: ['customer_groups']`, permanently changing `catalog`'s uniquely-zero-dependency status and complicating any future "ejectable without customer_groups" story for either module | Resolve explicitly in the spec before implementation starts (see BC finding #1) |
| Background jobs have no stated trigger mechanism | `expire-memberships`/`expire-approvals`/`credit-exposure-audit` could each be implemented ad hoc (a bespoke setInterval, a manual CLI-only trigger, etc.), diverging from the platform's `@open-mercato/scheduler` convention | Name the mechanism in §11 |

### Low Risks

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `PricingContext` export-surface / BC-contract enumeration gap | Low practical impact (the deprecation bridge itself is correct), but leaves a documentation gap in `BACKWARD_COMPATIBILITY.md` | Add `PricingContext` to §2's STABLE list in the same change if confirmed public |
| CLI command name collision (`customer-groups:reconcile`) | Not independently verified against every CLI registration in the repo (only DI/ACL/event/route/table names were exhaustively checked) | Low priority; a final `grep` across `cli.ts` files before implementation is sufficient |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **Concurrency Strategy subsection**: name the `SERIALIZABLE`-retry helper's home and confirm MikroORM/Postgres driver support end-to-end (no reference implementation exists to copy)
- **Optimistic-locking model correction**: drop the inert `version` fields on `CustomerCreditAccount`/`CustomerPurchaseApproval`; wire the documented `updated_at` + `enforceCommandOptimisticLock` flow instead, especially for the `/approvals/:id/decide` action route
- **Widget-injection design for §7.3**: state that the group picker is a `crud-form:<entityId>:fields` injected widget, not a hard `catalog`/`sales` → `customer_groups` dependency

### Important Gaps (Should Address)

- Command-pattern / mutation-guard wiring for non-CRUD action routes (`adjust`, `decide`, `reserveCredit`/`releaseCredit`/`settleCredit`)
- `setup.ts` / `defaultRoleFeatures` coverage for the new `acl.ts` features
- `notifications.ts` declaration for the `credit.limit_exceeded` in-app notification already promised in §10
- Event payload shapes for all `customer_groups.*` events
- Background-job scheduling mechanism (`@open-mercato/scheduler` vs. per-org cron-in-`setup.ts`)

### Nice-to-Have Gaps

- `search.ts` for admin-searchable groups/terms
- A more granular per-phase implementation task list beyond the gate criteria already in §14
- Explicit `PricingContext` BC-contract enumeration

## Remediation Plan

### Before Implementation (Must Do)

1. **Add a Concurrency Strategy subsection** naming the retry-on-serialization-failure helper's location and confirming the MikroORM/Postgres isolation-level path works end-to-end via `withAtomicFlush`'s existing (but unexercised) `isolationLevel` option.
2. **Correct the optimistic-locking model**: remove `version` from §5.4/§5.6, rely on `updated_at` + the documented header/command-guard flow, and update §12 R8 and §16 accordingly.
3. **Resolve §7.3's coupling direction**: specify the `crud-form:<entityId>:fields` widget-injection design; confirm `catalog`/`sales` gain no new `requires` entry.

### During Implementation (Add to Spec)

1. State Command-pattern/mutation-guard wiring for every non-CRUD action route.
2. Add `setup.ts`/`defaultRoleFeatures`, `notifications.ts`, and event payload shapes.
3. Name the background-job scheduling mechanism.

### Post-Implementation (Follow Up)

1. If `PricingContext` is confirmed publicly consumed, add it to `BACKWARD_COMPATIBILITY.md` §2 in the same change.
2. Run a final CLI-command-name collision grep before merge.

## Recommendation

**Needs spec updates before implementation.** The architecture, ownership boundaries, and data model are otherwise sound and the codebase-survey claims are accurate throughout — but the three Critical gaps (concurrency strategy, optimistic-lock mechanism, coupling direction for the admin picker) all sit on Phase 1's own gate criteria and should be resolved in the spec text, not discovered mid-implementation.
