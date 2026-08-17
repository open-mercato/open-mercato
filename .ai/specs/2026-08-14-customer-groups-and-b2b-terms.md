# Customer Groups & B2B Commercial Terms

| Field | Value |
|-------|-------|
| **Status** | Specification |
| **Created** | 2026-08-14 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 1, Phase 0 |
| **Modules** | `customer_groups` (new), `customers` (extended), `catalog` (admin UI), `sales` (admin UI) |
| **Related** | [ADR-6](./2026-08-14-ecommerce-suite-roadmap.md#adr-6--customergroup-is-a-real-entity-and-it-is-a-prerequisite), [ADR-7](./2026-08-14-ecommerce-suite-roadmap.md#adr-7--buyer-context-is-resolved-once-at-the-edge), [SPEC-055 Promotions](./SPEC-055-2026-02-23-promotions-module.md) |

---

## TLDR

**Key Points:**
- `customer_group_id` is consumed today by `catalog/lib/pricing.ts` (specificity score +3), `catalog/api/prices`, `catalog/commands/prices.ts`, `catalog` AI price tooling and `sales.SalesTaxRate` — **with no table behind it anywhere in the repo**. This spec gives it an owner.
- A new `customer_groups` module introduces `CustomerGroup`, time-bounded `CustomerGroupMembership`, and group-level commercial terms (price kind, tax display mode, payment terms, credit limit, approval threshold).
- Credit is a **ledger, not a counter**: `CustomerCreditAccount` holds the limit, `CustomerCreditLedgerEntry` is append-only, and exposure is derived. Concurrent purchase-on-account checkouts cannot jointly overshoot the limit.
- No FK constraint is added to `catalog_product_prices.customer_group_id` or `sales_tax_rates.customer_group_id` in this release. Existing rows carrying arbitrary UUIDs keep resolving exactly as they do today; a reconciliation report surfaces orphans instead of a migration breaking them.

**Scope:**
- `CustomerGroup`, `CustomerGroupMembership`, `CustomerGroupTerms`, `CustomerCreditAccount`, `CustomerCreditLedgerEntry`, `CustomerPurchaseApproval`
- `customerGroupsService` DI contract: group resolution, terms resolution, credit reservation/settlement
- Admin CRUD for groups, membership, terms and credit; group pickers in `catalog` price rows and `sales` tax rates replacing the current free-text UUID
- Orphan reconciliation report and CLI

**Concerns:**
- Credit reservation must be serializable or concurrent checkouts overshoot the limit — the same class of race SPEC-055 documents for promotion budget caps, with a worse consequence (unsecured trade credit)
- Group membership is time-bounded, which means price resolution becomes time-dependent; cached prices must not outlive a membership boundary
- Overlapping memberships are legitimate (a customer can be in "Wholesale" and "Q3 Promo Tier"), so every consumer must handle a **set** of group ids, while `catalog` and `sales` today match a **single** `customer_group_id` column

---

## 1) Overview

This is the first spec of the ecommerce suite and a hard prerequisite for the rest of it. Every B2B behaviour downstream — contract pricing, group tax treatment, restricted assortment, purchase on account, buyer approvals — resolves through a customer group id that currently has no owning table.

The module is deliberately narrow. It owns *who belongs to which commercial group and on what terms they buy*. It does not own price rows (`catalog`), tax rates (`sales`), promotions (`promotions`) or identity (`customers`, `customer_accounts`).

---

## 2) Problem Statement

### 2.1 The dangling column

`customer_group_id` appears across the codebase as a plain nullable UUID with no referential integrity and no way for an operator to discover valid values:

| Consumer | File | Behaviour |
|---|---|---|
| Price specificity scoring | `catalog/lib/pricing.ts:66,84` | `if (row.customerGroupId && ctx.customerGroupId !== row.customerGroupId) return false`; matching row scores +3 |
| Price rows | `catalog/data/entities.ts` (`CatalogProductPrice.customerGroupId`) | Stored, never validated |
| Price API | `catalog/api/prices/route.ts` | Accepted as a filter and a write field |
| Price commands | `catalog/commands/prices.ts`, `catalog/commands/variants.ts` | Written through to price rows |
| AI price tooling | `catalog/ai-tools/prices-offers-pack.ts` | Exposed to an LLM as a settable field |
| Tax rates | `sales/data/entities.ts` (`SalesTaxRate.customerGroupId`) | Participates in priority-based tax resolution |

An operator wanting wholesale pricing today must invent a UUID, paste it into every relevant price row, and remember it. Nothing lists the groups that exist, nothing prevents a typo, and a typo silently means "this price never applies" rather than an error.

### 2.2 Missing B2B commercial terms

Beyond grouping, B2B selling needs terms that have no home:

- **Tax display mode** — B2B buyers expect net prices, B2C gross. `CatalogPriceKind.displayMode` sets this per price kind, not per buyer.
- **Payment terms** — `CustomerCompanyBilling.paymentTerms` exists as free text on the company profile, unused by any commerce path.
- **Credit limit and exposure** — nothing anywhere. Purchase on account cannot be gated.
- **Approval thresholds** — a junior buyer placing a 200 000 PLN order should route to an approver. `CustomerEntityRole` models roles on a customer entity but carries no purchase authority.

### 2.3 Single-value matching vs. real membership

`catalog` and `sales` each match one `customer_group_id` per row against one context value. Real customers belong to several commercial groups at once — a base tier plus a campaign tier plus a contract. The single-column shape on the *rule* side is fine and stays; the *context* side must become a set, and specificity scoring must define which of several matching groups wins.

---

## 3) Proposed Solution

A `customer_groups` module in `packages/core/src/modules/customer_groups/` owning six entities, one DI service, admin CRUD, and a reconciliation report. Consumers change only in that they resolve a **set** of group ids from the service instead of receiving a single opaque value from the caller.

### 3.1 Resolution model

```
CustomerEntity (customers)
      │
      │ CustomerGroupMembership  (time-bounded, many-to-many)
      ▼
CustomerGroup  ──── CustomerGroupTerms (1:1, commercial terms)
      │
      │ consumed as a SET of ids by:
      ├──► catalog pricing        (row.customerGroupId ∈ ctx.customerGroupIds)
      ├──► sales tax resolution   (row.customerGroupId ∈ ctx.customerGroupIds)
      ├──► promotions rules       (CustomerGroupRule)
      ├──► ecommerce assortment   (channel binding scope)
      └──► cart / checkout        (terms, credit, approval)
```

### 3.2 Group precedence

When several of a customer's groups match a rule row, the winner is the group with the highest `priority` (integer, descending), ties broken by the most recently created membership. `priority` is authored by the operator, is unique within a tenant, and is shown in the admin list so precedence is never implicit.

This rule is stated once here and referenced by every consumer. Consumers MUST NOT invent their own tie-breaking.

---

## 4) Architecture

### 4.1 Ownership boundaries

| Owns | Does not own |
|---|---|
| Group definition, hierarchy, priority | Price rows — `catalog` |
| Membership and its validity window | Tax rates — `sales` |
| Commercial terms attached to a group | Promotion rules — `promotions` |
| Credit limit, ledger and exposure | Payment execution — `payment_gateways` |
| Purchase approval policy and requests | Identity and authentication — `customers`, `customer_accounts` |

### 4.2 Dependency direction

`customer_groups` depends on `customers` by FK id only (`CustomerEntity.id`), resolved through the query engine. `catalog`, `sales`, `cart`, `checkout`, `promotions` and `ecommerce` depend on `customer_groups` through `customerGroupsService` in DI. `customer_groups` MUST NOT import from any of them.

### 4.3 Why credit is a ledger

A `credit_used` counter updated in place has two failure modes that a ledger does not: concurrent updates lost to last-write-wins, and no audit trail when a dispute arises about why a customer was blocked. The ledger is append-only, exposure is `SUM(amount)` over open entries, and the limit check plus the reserve entry happen in one serializable transaction. This mirrors the approach SPEC-055 specifies for promotion budget caps, where the same race exists with lower stakes.

---

## 5) Data Models

All entities carry `id` (UUID PK), `tenant_id`, `organization_id`, `created_at`, `updated_at`, `deleted_at` unless noted.

### 5.1 `CustomerGroup` (`customer_groups`)

| Column | Type | Notes |
|---|---|---|
| `code` | text | Unique within tenant; stable identifier used in imports and rules |
| `name` | text | Display name |
| `description` | text, nullable | |
| `kind` | text | `b2c \| b2b \| internal \| partner` |
| `parent_id` | uuid, nullable | FK → `customer_groups`; membership in a child implies the ancestors |
| `priority` | integer | Precedence per §3.2; unique within tenant |
| `is_default` | boolean | At most one per tenant; assigned to customers with no explicit membership |
| `is_active` | boolean | Inactive groups are excluded from resolution but retain history |
| `metadata` | jsonb, nullable | |

Constraints: unique `(tenant_id, code)`; unique `(tenant_id, priority)`; at most one `is_default = true` per tenant; `parent_id` must not form a cycle (enforced in the command, depth capped at 5).

### 5.2 `CustomerGroupMembership` (`customer_group_memberships`)

| Column | Type | Notes |
|---|---|---|
| `group_id` | uuid | FK → `customer_groups` |
| `customer_id` | uuid | `customers.CustomerEntity.id` — FK id only, no ORM relation |
| `source` | text | `manual \| import \| rule \| onboarding` |
| `valid_from` | timestamptz, nullable | null = always |
| `valid_until` | timestamptz, nullable | null = indefinite |
| `assigned_by_user_id` | uuid, nullable | Audit |
| `notes` | text, nullable | |

Constraints: unique `(tenant_id, group_id, customer_id)` among rows with `deleted_at IS NULL`. Overlapping memberships in *different* groups are legitimate and expected.

Index: `(tenant_id, customer_id, valid_from, valid_until)` — this is the hot path for buyer-context resolution.

### 5.3 `CustomerGroupTerms` (`customer_group_terms`)

One row per group. Absent row means "inherit from parent group, then tenant defaults".

| Column | Type | Notes |
|---|---|---|
| `group_id` | uuid | FK → `customer_groups`, unique |
| `price_kind_id` | uuid, nullable | `catalog.CatalogPriceKind.id` — the price kind this group buys at |
| `tax_display_mode` | text, nullable | `gross \| net` — drives `BuyerContext.taxMode` |
| `payment_terms_days` | integer, nullable | Net days; `0` = prepayment |
| `allow_purchase_on_account` | boolean | Default `false` |
| `default_credit_limit` | numeric(16,2), nullable | Applied to new credit accounts in this group |
| `credit_currency_code` | text, nullable | |
| `approval_required_above` | numeric(16,2), nullable | Order gross above this routes to approval; null = never |
| `min_order_value` | numeric(16,2), nullable | Rejected below this at checkout |
| `assortment_scope` | jsonb, nullable | `{ categoryIds?, tagIds?, excludeProductIds? }` — same shape as the channel binding scope |
| `metadata` | jsonb, nullable | |

### 5.4 `CustomerCreditAccount` (`customer_credit_accounts`)

One row per customer per currency. Overrides the group default.

| Column | Type | Notes |
|---|---|---|
| `customer_id` | uuid | `customers.CustomerEntity.id` |
| `currency_code` | text | |
| `credit_limit` | numeric(16,2) | Authoritative limit |
| `is_on_hold` | boolean | Manual block; blocks regardless of exposure |
| `hold_reason` | text, nullable | |
| `updated_by_user_id` | uuid, nullable | Audit |

Optimistic locking uses the platform's standard `updated_at` mechanism (already present per the §5 header), not a `version` counter — this entity is `CrudForm`-edited, so the header is auto-derived from `initialValues.updatedAt`; see the Concurrency Strategy subsection below. No separate `version` column.

Constraint: unique `(tenant_id, customer_id, currency_code)`.

### 5.5 `CustomerCreditLedgerEntry` (`customer_credit_ledger_entries`)

Append-only. No `updated_at`, no `deleted_at`; corrections are compensating entries.

| Column | Type | Notes |
|---|---|---|
| `credit_account_id` | uuid | FK → `customer_credit_accounts` |
| `entry_type` | text | `reserve \| release \| settle \| adjust` |
| `amount` | numeric(16,2) | Signed; `reserve` positive, `release`/`settle` negative, `adjust` either |
| `source_type` | text | `checkout \| order \| invoice \| payment \| manual` |
| `source_id` | uuid, nullable | |
| `idempotency_key` | text, nullable | Unique per account; makes retried reservations safe |
| `balance_after` | numeric(16,2) | Denormalized running exposure at write time, for audit reconstruction |
| `created_by_user_id` | uuid, nullable | |
| `note` | text, nullable | |

Constraints: unique `(credit_account_id, idempotency_key)` where the key is non-null. Index `(tenant_id, credit_account_id, created_at)`.

**Exposure** = `SUM(amount)` over the account's entries. `balance_after` is written for audit only and MUST NOT be read as the source of truth.

### 5.6 `CustomerPurchaseApproval` (`customer_purchase_approvals`)

| Column | Type | Notes |
|---|---|---|
| `customer_id` | uuid | |
| `requested_by_customer_user_id` | uuid | `customer_accounts.CustomerUser.id` |
| `subject_type` | text | `cart \| checkout_session \| quote` |
| `subject_id` | uuid | |
| `amount_gross` | numeric(16,2) | Snapshot at request time |
| `currency_code` | text | |
| `status` | text | `pending \| approved \| rejected \| expired \| withdrawn` |
| `decided_by_customer_user_id` | uuid, nullable | |
| `decided_at` | timestamptz, nullable | |
| `decision_note` | text, nullable | |
| `expires_at` | timestamptz | |

Optimistic locking on the decide action uses `updated_at` (already present per the §5 header), not a `version` counter: `POST /approvals/:id/decide` is a non-`makeCrudRoute` command endpoint, so it wraps its write with `enforceCommandOptimisticLock` reading the `updated_at`-derived header the client sent with the approval snapshot it decided against, and surfaces a conflict via `surfaceRecordConflict` if a second approver's decision lands first — this is what actually protects R8 ("approval double-decision"); a plain `version` integer with nothing reading or incrementing it would not. No separate `version` column.

Approver identification reuses `customers.CustomerEntityRole` (`roleType = 'purchase_approver'`) rather than introducing a parallel role model.

---

## 6) Service Contract

Registered in `customer_groups/di.ts` as `customerGroupsService`.

```typescript
type GroupResolution = {
  groupIds: string[]              // ordered by priority desc — the winner is groupIds[0]
  groups: Array<{ id: string; code: string; name: string; kind: string; priority: number }>
}

type ResolvedTerms = {
  priceKindId: string | null
  taxDisplayMode: 'gross' | 'net'
  paymentTermsDays: number | null
  allowPurchaseOnAccount: boolean
  approvalRequiredAbove: number | null
  minOrderValue: number | null
  assortmentScope: AssortmentScope | null
  sourceGroupId: string | null    // which group each value came from, for admin explainability
}

type CreditCheck = {
  allowed: boolean
  reason: 'ok' | 'on_hold' | 'limit_exceeded' | 'no_account' | 'not_permitted'
  creditLimit: number
  exposure: number
  available: number
  currencyCode: string
}

interface CustomerGroupsService {
  resolveGroups(input: { customerId: string | null; at?: Date }): Promise<GroupResolution>

  resolveTerms(input: { customerId: string | null; groupIds?: string[] }): Promise<ResolvedTerms>

  checkCredit(input: {
    customerId: string
    currencyCode: string
    amount: number
  }): Promise<CreditCheck>

  // Serializable transaction: re-checks the limit and appends the reserve entry atomically.
  reserveCredit(input: {
    customerId: string
    currencyCode: string
    amount: number
    sourceType: 'checkout' | 'order'
    sourceId: string
    idempotencyKey: string
  }): Promise<{ reserved: boolean; entryId: string | null; check: CreditCheck }>

  releaseCredit(input: { idempotencyKey: string; reason: string }): Promise<void>

  settleCredit(input: {
    customerId: string; currencyCode: string; amount: number
    sourceType: 'invoice' | 'payment'; sourceId: string; idempotencyKey: string
  }): Promise<void>
}
```

### 6.1 Terms inheritance

`resolveTerms` walks, per field independently: highest-priority group with a non-null value → its ancestors → tenant default. Each field records its `sourceGroupId` so the admin UI can explain *why* a buyer got a given term — the single most common B2B support question.

### 6.2 Anonymous and ungrouped buyers

`customerId: null` returns the default group (`is_default = true`) if one exists, otherwise an empty set and tenant-default terms with `taxDisplayMode: 'gross'` and `allowPurchaseOnAccount: false`. Absence of a group MUST NOT be an error — an anonymous storefront visitor is the common case.

### 6.3 Concurrency Strategy

`reserveCredit`'s "serializable transaction; retry on serialization failure" (R1, this spec's own top risk) has **no reference implementation anywhere in this codebase** to copy — a repo-wide check found zero production use of Postgres `SERIALIZABLE` isolation. This is new infrastructure, not an established pattern, and must be built and unit-tested as its own reviewable unit before `reserveCredit` is wired to it:

- **Isolation level**: `withAtomicFlush` (`packages/shared/src/lib/commands/flush.ts`) already exposes an `isolationLevel` option passed through to `em.begin()`, but nothing in the repo exercises it with `'serializable'` today — confirm MikroORM's Postgres driver honors it end-to-end before relying on it.
- **Retry helper**: add a small, generically-named retry-on-serialization-failure helper (candidate home: `packages/shared/src/lib/commands/`, alongside `withAtomicFlush`) that catches Postgres error code `40001`, retries the transaction a bounded number of times (e.g. 3, with jittered backoff), and re-throws past the bound. `reserveCredit` wraps its limit re-check + ledger-append phase in `withAtomicFlush(em, phases, { transaction: true, isolationLevel: 'serializable' })` through this helper.
- **Do not treat "mirrors SPEC-055"** (this repo's promotions spec, which proposes the identical pattern for budget caps) **as precedent** — SPEC-055 is itself unimplemented spec-only text, not working code. Whichever of the two specs implements this helper first should be the one the other references.
- The N=20-parallel-reservation integration test (§13) is the acceptance gate for this helper, not for `reserveCredit` itself — write and merge the helper with its own concurrency test before Phase 3 begins.

---

## 7) Consumer Changes

### 7.1 `catalog` pricing

`PricingContext.customerGroupId?: string | null` becomes `customerGroupIds?: string[]`. The matcher at `catalog/lib/pricing.ts:66` changes from equality to set membership; the specificity score at line 84 stays +3, and among several matching group rows the one whose group has the highest priority wins.

**Backward compatibility.** `customerGroupId` is retained as a deprecated optional field for at least one minor version, normalized internally to `[customerGroupId]`. Marked `@deprecated` with a pointer to the replacement, per the deprecation protocol in `BACKWARD_COMPATIBILITY.md`. `PricingContext` is a public type consumed by third-party modules; this is an additive change plus a deprecation, not a break.

### 7.2 `sales` tax resolution

Same substitution in tax-rate matching. `SalesTaxRate.customerGroupId` (the rule side) is unchanged.

### 7.3 Admin UI

The current free-text UUID inputs for `customerGroupId` in the catalog price editor and the sales tax-rate form are replaced with a group picker sourced from `/api/customer-groups`. A row referencing an id with no matching group renders as an explicit `Unknown group (<uuid>)` error state — it is not hidden, because hiding it is how the orphan problem became invisible in the first place.

**Coupling direction (resolved).** The picker ships as a widget `customer_groups` injects into the `crud-form:catalog.catalog_product_price:fields` and `crud-form:sales.sales_tax_rate:fields` spots (`packages/core/AGENTS.md` → Widget Injection / CrudForm Field Injection), not as a `catalog`/`sales` import of `customer_groups`. `catalog` and `sales` gain **no new `requires` entry** — `pricing.ts:66,84`'s matching logic already only compares against a `customerGroupId[s]` value the caller supplies, so neither module needs a runtime dependency on `customer_groups` to function; `catalog` in particular keeps its current zero-`requires` status. If `customer_groups` is ejected, both forms fall back to their present-day free-text UUID input — no error, no degraded matching behavior, just the loss of the picker convenience and the `Unknown group` explainer. The price API filter (`catalog/api/prices/route.ts`) is unaffected either way; it already accepts a raw UUID.

---

## 8) Migration & Backward Compatibility

### 8.1 No foreign key in this release

`catalog_product_prices.customer_group_id` and `sales_tax_rates.customer_group_id` remain plain nullable UUIDs. Adding a FK would fail the migration on any tenant that has been using invented ids, and would change effective prices for the rest.

### 8.2 Orphan reconciliation

A CLI command `yarn mercato customer-groups:reconcile [--tenant <id>] [--adopt]` reports every distinct `customer_group_id` referenced by price rows or tax rates with no matching group, including affected row counts and a sample. With `--adopt` it creates a placeholder inactive group per orphan id (`code: orphan-<short-uuid>`, `is_active: false`, priority at the bottom) so the operator can rename and activate rather than re-key every row.

The same report is surfaced in the admin UI as a banner on the groups list while orphans exist.

### 8.3 Sequencing

Adding the FK constraint is explicitly out of scope and requires its own spec once tenants have run reconciliation.

---

## 9) API Contracts

All admin routes use `makeCrudRoute`, export `openApi`, validate with Zod, and support optimistic locking via `updated_at` per root `AGENTS.md`.

| Method | Path | Feature |
|---|---|---|
| GET/POST | `/api/customer-groups` | `customer_groups.groups.view` / `.manage` |
| GET/PUT/DELETE | `/api/customer-groups/:id` | idem |
| GET/POST | `/api/customer-groups/memberships` | `customer_groups.memberships.view` / `.manage` |
| PUT/DELETE | `/api/customer-groups/memberships/:id` | idem |
| GET/PUT | `/api/customer-groups/:id/terms` | `customer_groups.terms.view` / `.manage` |
| GET/POST | `/api/customer-groups/credit-accounts` | `customer_groups.credit.view` / `.manage` |
| PUT | `/api/customer-groups/credit-accounts/:id` | `customer_groups.credit.manage` |
| GET | `/api/customer-groups/credit-accounts/:id/ledger` | `customer_groups.credit.view` |
| POST | `/api/customer-groups/credit-accounts/:id/adjust` | `customer_groups.credit.adjust` |
| GET | `/api/customer-groups/approvals` | `customer_groups.approvals.view` |
| POST | `/api/customer-groups/approvals/:id/decide` | `customer_groups.approvals.decide` |
| GET | `/api/customer-groups/reconcile` | `customer_groups.groups.manage` |

The ledger has no update or delete route. Corrections go through `/adjust`, which appends a compensating entry.

### 9.1 ACL features (`acl.ts`)

```typescript
export const features = [
  { id: 'customer_groups.groups.view',       title: 'View customer groups' },
  { id: 'customer_groups.groups.manage',     title: 'Manage customer groups' },
  { id: 'customer_groups.memberships.view',  title: 'View group memberships' },
  { id: 'customer_groups.memberships.manage',title: 'Manage group memberships' },
  { id: 'customer_groups.terms.view',        title: 'View commercial terms' },
  { id: 'customer_groups.terms.manage',      title: 'Manage commercial terms' },
  { id: 'customer_groups.credit.view',       title: 'View credit accounts' },
  { id: 'customer_groups.credit.manage',     title: 'Manage credit limits' },
  { id: 'customer_groups.credit.adjust',     title: 'Post credit adjustments' },
  { id: 'customer_groups.approvals.view',    title: 'View purchase approvals' },
  { id: 'customer_groups.approvals.decide',  title: 'Decide purchase approvals' },
]
```

`credit.manage` (change the limit) and `credit.adjust` (move the balance) are separate on purpose — they are different kinds of financial authority and tenants will want to grant them to different roles.

---

## 10) Events

```typescript
'customer_groups.group.created' | '.updated' | '.deleted'
'customer_groups.membership.added' | '.removed' | '.expired'
'customer_groups.credit.reserved' | '.released' | '.settled' | '.limit_exceeded'
'customer_groups.credit_account.put_on_hold' | '.released_from_hold'
'customer_groups.approval.requested' | '.approved' | '.rejected' | '.expired'
```

`customer_groups.membership.added` and `.removed` MUST invalidate any cached buyer context and any price cache keyed on that customer — see R2.

`customer_groups.credit.limit_exceeded` drives an in-app notification to the account manager; a blocked B2B checkout that nobody is told about becomes a support ticket.

---

## 11) Background Jobs

| Job | Cadence | Purpose |
|---|---|---|
| `expire-memberships` | hourly | Emit `.expired` for memberships whose `valid_until` has passed; invalidate caches |
| `expire-approvals` | hourly | Transition `pending` approvals past `expires_at` to `expired` |
| `credit-exposure-audit` | daily | Recompute `SUM(amount)` per account and compare against the last `balance_after`; report drift (drift means a bug, and it must be visible) |

---

## 12) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Concurrent credit overshoot | **Critical** | `customer_groups`, `checkout` | Two purchase-on-account checkouts for the same customer each read exposure 80k against a 100k limit, each reserves 30k, exposure lands at 140k. The tenant has extended 40k of unsecured credit it never approved. | `reserveCredit` runs the limit re-check and the ledger append in one `SERIALIZABLE` transaction via the retry helper specified in §6.3 (no reference implementation exists in this codebase — build and unit-test it first); concurrency test with N parallel reservations against a limit is a merge gate | Low, once §6.3's helper lands and is proven under the concurrency test |
| R2 | Stale group membership in cache | **High** | `catalog`, `ecommerce` | A customer is removed from "Wholesale" at 14:00; a price cached at 13:59 keyed only on product+channel keeps serving the wholesale price for the rest of its TTL. Revenue loss, and the reverse case discloses contract pricing. | Buyer-context digest (ADR-7) includes the sorted group id set; `membership.added`/`.removed` invalidate by tag `customer:{id}`; membership expiry runs hourly and also invalidates | Medium — a membership expiring between hourly runs serves a stale group for up to an hour; acceptable for `valid_until`, which is operator-scheduled, and documented |
| R3 | Orphan ids silently change prices | **High** | `catalog`, `sales` | An operator creates a group and, coincidentally or by copying, its id collides with an invented one already in price rows. Rows that previously never matched suddenly apply. | Generated UUIDs make accidental collision negligible; the real vector is `--adopt`, which is explicit and reversible; reconciliation report runs before any group creation is recommended in the rollout note | Low |
| R4 | Priority uniqueness blocks bulk import | Medium | `customer_groups` | Unique `(tenant_id, priority)` makes importing a group list fail on the first collision, mid-import. | Import assigns priorities in gaps of 10 and renumbers on conflict; the admin list supports drag-reorder which rewrites priorities in one transaction | Low |
| R5 | Terms inheritance is opaque | Medium | `customer_groups` | A buyer gets an unexpected payment term; support cannot tell which of four overlapping groups supplied it. | `ResolvedTerms.sourceGroupId` per field; admin "explain terms" panel on the customer detail page renders the resolution trace | Low |
| R6 | Deep group hierarchies degrade resolution | Low | `customer_groups` | Recursive ancestor walks on every price call. | Depth capped at 5; resolution result cached per `(customerId, date-bucket)` for 60s with tag `customer:{id}` | Low |
| R7 | `PricingContext` change breaks third-party modules | Medium | `catalog` | A third-party module constructs `PricingContext` with `customerGroupId` and stops matching after the change. | Field retained and normalized for ≥1 minor version with `@deprecated`; documented in `UPGRADE_NOTES.md`; per `BACKWARD_COMPATIBILITY.md` this is ADDITIVE plus deprecation | Low |
| R8 | Approval double-decision | Low | `customer_groups` | Two approvers open the same request and both decide. | `updated_at`-based optimistic locking on `CustomerPurchaseApproval` (§5.6) via `enforceCommandOptimisticLock` on the `/decide` action route; the second decision surfaces the conflict bar via `surfaceRecordConflict` | Low |

---

## 13) Integration Coverage

Per `.ai/qa/AGENTS.md`, shipping in the same change. Tests create their own fixtures and clean up; no reliance on seed data.

**API paths** — every route in §9, each asserting tenant isolation with a second-tenant fixture.

**Behavioural:**
- Group resolution with overlapping memberships returns priority-ordered ids
- Membership outside its validity window is excluded at the boundary instants
- Terms inheritance resolves per field across a 3-level hierarchy with `sourceGroupId` correct for each
- Price resolution picks the highest-priority group's row when two group rows match
- Tax resolution likewise
- Deprecated `customerGroupId` on `PricingContext` yields the same result as `customerGroupIds: [id]`
- `reserveCredit` under N=20 parallel calls against a limit admitting 3 reserves exactly 3
- `reserveCredit` with a repeated `idempotencyKey` is a no-op returning the original entry
- Exposure equals `SUM(amount)`; the daily audit reports zero drift
- Reconciliation lists orphans and `--adopt` creates inactive placeholders
- Anonymous (`customerId: null`) resolves to the default group without error

**UI paths:** group list with drag-reorder, group edit with terms, membership assignment from the customer detail page, credit account edit with optimistic-lock conflict, ledger view, approval decision, orphan banner.

---

## 14) Implementation Phases

### Phase 1 — Groups and membership
Entities `CustomerGroup`, `CustomerGroupMembership`; `resolveGroups`; admin CRUD; group picker replacing the UUID inputs in `catalog` and `sales`; reconciliation CLI and banner.

**Gate:** a price row authored against a real group resolves for a member and not for a non-member; orphan report is accurate.

### Phase 2 — Commercial terms
`CustomerGroupTerms`; `resolveTerms` with per-field inheritance and `sourceGroupId`; explain-terms admin panel; `catalog` and `sales` consume group id **sets**.

**Gate:** terms resolve correctly across a 3-level hierarchy; the deprecated single-value path is behaviourally identical.

### Phase 3 — Credit
`CustomerCreditAccount`, `CustomerCreditLedgerEntry`; `checkCredit` / `reserveCredit` / `releaseCredit` / `settleCredit`; admin credit UI and ledger; exposure audit job.

**Gate:** the N-parallel reservation test passes; idempotent retry verified; audit reports zero drift.

### Phase 4 — Approvals
`CustomerPurchaseApproval`; request and decision flow; approver resolution via `CustomerEntityRole`; notifications.

**Gate:** an over-threshold subject routes to approval and cannot proceed until decided; double-decision surfaces a conflict.

Phases 1 and 2 unblock the rest of the ecommerce suite. Phases 3 and 4 are required only by checkout (spec 7) and may land in parallel with specs 3–5.

---

## 15) Open Questions

1. **Rule-driven membership** — `source: 'rule'` is in the model but no rule engine is specified. Automatic assignment ("all customers with >100k lifetime revenue join Wholesale") is a natural fit for `business_rules`. *Deferred; the enum value reserves the space.*
2. **Per-organization vs. per-tenant groups** — groups are tenant-scoped here, consistent with `CatalogPriceKind`, which allows a null `organization_id`. Whether an organization can define private groups is unresolved. *Assumed no for v1.*
3. **Credit currency** — one account per currency. A customer trading in PLN and EUR has two independent limits with no aggregate cap. *Assumed acceptable; a group-level aggregate cap would need FX and is out of scope.*

---

## 16) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `customer_id` and `price_kind_id` are FK ids; no `@ManyToOne` crosses a module boundary |
| Tenant/organization scoping | Every entity scoped; every test asserts isolation against a second tenant |
| Zod validation in `data/validators.ts` | All routes; types via `z.infer` |
| No `any` | Service contract fully typed |
| Optimistic locking | Platform-standard `updated_at` mechanism only (§5.4, §5.6) — no `version` counter; `CustomerCreditAccount` uses `CrudForm`'s auto-derived header, `CustomerPurchaseApproval`'s `/decide` action route uses `enforceCommandOptimisticLock`; all editable entities expose `updatedAt` for `CrudForm` |
| Concurrency strategy | §6.3 — `reserveCredit`'s `SERIALIZABLE` + retry-on-40001 is new infrastructure with no reference implementation in this repo; helper built and unit-tested independently before Phase 3 |
| Cross-module coupling | §7.3 — admin group picker ships as a `crud-form:<entityId>:fields` widget injected by `customer_groups`; `catalog`/`sales` gain no new `requires` entry |
| Encryption | Credit limits and ledger amounts are commercially sensitive but not GDPR special categories; standard scoping applies, no field encryption — consistent with existing precedent (`sales`/`payment_gateways` encrypt blob/secret columns, not scalar monetary columns) |
| Backward compatibility | `PricingContext.customerGroupId` deprecated, not removed; no FK constraint added; documented in `UPGRADE_NOTES.md` |
| i18n | No hard-coded user-facing strings; `en.json` and `pl.json` |
| Migrations | `yarn db:generate` per entity batch, snapshot reviewed |
| Integration coverage | §13, shipping in the same change |

---

## 17) Changelog

### 2026-08-17
- Fixed three Critical gaps found by a `/om-pre-implement-spec` audit (see `ANALYSIS-2026-08-14-customer-groups-and-b2b-terms.md` in the upstream repo): removed the functionally-inert `version` optimistic-locking column from `CustomerCreditAccount` (§5.4) and `CustomerPurchaseApproval` (§5.6) in favor of this platform's actual `updated_at` + header-protocol mechanism; added §6.3 Concurrency Strategy specifying that the `SERIALIZABLE`-retry helper for `reserveCredit` has no reference implementation and must be built independently; resolved §7.3's admin-picker coupling direction as `crud-form:<entityId>:fields` widget injection, confirming `catalog`/`sales` gain no new `requires` entry.
- Updated R8 and §16 accordingly.

### 2026-08-14
- Initial specification.
- Grounded in a survey of `customer_group_id` consumers: `catalog/lib/pricing.ts` (lines 65–66 matching, 83–84 scoring), `catalog/api/prices/route.ts`, `catalog/commands/prices.ts`, `catalog/commands/variants.ts`, `catalog/ai-tools/prices-offers-pack.ts`, `catalog/data/entities.ts`, `sales/data/entities.ts` (`SalesTaxRate`) — none of which is backed by an owning table.
- Existing B2B surface reused rather than replaced: `CustomerCompanyProfile`, `CustomerCompanyBilling.payment_terms`, `CustomerEntityRole`, `CustomerPersonCompanyRole`.
