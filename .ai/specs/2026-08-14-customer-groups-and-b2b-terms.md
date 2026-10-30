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
- Three DI contracts: `customerGroupsService` (group, terms and assortment resolution, unchanged by Phases 3–4), `customerCreditService` (credit check, reservation, release, settlement) and `customerPurchaseApprovalService` (approval requests and decisions)
- Buyer-side approval API on the customer portal, so a B2B buyer's own approver can decide without a first-party storefront (Phase 4)
- Admin CRUD for groups, membership, terms and credit; a group picker in `catalog` price rows replacing the current free-text UUID (the `sales` tax-rate form keeps its free-text input until issue #6414 gives it an `entityId`, §7.2)
- Orphan reconciliation report and CLI

**Concerns:**
- Credit reservation must be serialized per credit account or concurrent checkouts overshoot the limit — the same class of race promotions solved for budget caps in Release 4 (D-R4-12), with a worse consequence (unsecured trade credit). Reservations take a `PESSIMISTIC_WRITE` row lock on the credit account (§6.3)
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

A `customer_groups` module in `packages/core/src/modules/customer_groups/` owning seven entities (six plus the Phase 5 override of §5.7), three DI services (§6), admin CRUD, portal approval routes, and a reconciliation report. Consumers change only in that they resolve a **set** of group ids from the service instead of receiving a single opaque value from the caller.

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

A `credit_used` counter updated in place has two failure modes that a ledger does not: concurrent updates lost to last-write-wins, and no audit trail when a dispute arises about why a customer was blocked. The ledger is append-only, exposure is `SUM(amount)` over the account's entries, and the limit check plus the reserve entry happen in one transaction under a row lock on the credit account (§6.3). This is the mechanism promotions adopted for budget caps in Release 4 (D-R4-12), where the same race exists with lower stakes.

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
| `price_kind_id` | uuid, nullable | `catalog.CatalogPriceKind.id` — the price kind this group buys at; its own `displayMode` (`including-tax` \| `excluding-tax`) is the **only** source of gross/net display for this group — see §6.1a. No separate `tax_display_mode` column: a `/om-pre-implement-spec` audit found the original draft stored gross/net twice (here, independently of `price_kind_id`), with no reconciliation rule and no codebase precedent for a buyer-level tax preference independent of the selected price kind (`catalog`'s own `LineItemDialog.tsx` derives mode from `displayMode` 1:1 everywhere). |
| `payment_terms_days` | integer, nullable | Net days; `0` = prepayment |
| `allow_purchase_on_account` | boolean, nullable | `null` = not set on this group, inherit from the parent chain; the tenant default is `false` |
| `default_credit_limit` | numeric(16,2), nullable | Pre-fills the limit when an operator creates a credit account for a member (D-R5-5). Never creates an account by itself |
| `credit_currency_code` | text, nullable | Currency pre-filled with `default_credit_limit` in the account form |
| `approval_required_above` | numeric(16,2), nullable | A cart whose goods gross (cart `totals.grandTotalGrossAmount`: goods after promotions, no delivery) is above this routes to approval; null = never. Compared only in `terms_currency_code` (below) |
| `min_order_value` | numeric(16,2), nullable | Rejected below this at checkout, on the same goods-gross basis, only in `terms_currency_code` |
| `terms_currency_code` | text, nullable | Added Release 5 (D-R5-4). Currency of `approval_required_above` and `min_order_value`. Inherited like the other terms; tenant default `null`. A cart in another currency always requires approval (fail-closed) and is not checked against `min_order_value`. No FX conversion. **Base-currency fallback (D-R5-37).** When no group in the chain sets it, `resolveTerms` returns the organization's base currency (`currencies.Currency` with `is_base = true` in the buyer's organization) and records `sources.termsCurrencyCode = 'base_currency'`. Only when the organization has no base currency does it stay `null`; a non-null threshold with a `null` resolved currency then behaves as "every currency differs": approval always required |
| `approval_policy` | text, nullable | Added Release 5 (D-R5-1). `buyer \| merchant \| both`: which side signs an approval request. `null` = inherit from the parent chain; tenant default `buyer`. No `either` value. Snapshotted on each request (§5.6) |
| `allow_quote_requests` | boolean, nullable | Added Release 5 (D-R5-20). Whether checkout offers the `request_quote` payment method. `null` = inherit; tenant default `false` |
| `requires_po_number` | boolean, nullable | Added Release 5 (D-R5-28). Whether checkout requires a purchase-order number, written to `SalesQuote.customer_reference`. `null` = inherit; tenant default `false` |
| `assortment_scope` | jsonb, nullable | `AssortmentScope \| null` — `{ categoryIds?, tagIds?, excludeProductIds?, excludeCategoryIds?, excludeTagIds? }`, the shared type from `packages/shared/src/lib/catalog-visibility/` ([Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §3.3). Same shape as the channel binding scope. `excludeCategoryIds`/`excludeTagIds` added 2026-09-06 for symmetry with `excludeProductIds`; additive jsonb keys, no migration. Resolved by `resolveAssortmentScope()`, **not** by `resolveTerms()` — §6.4 |
| `metadata` | jsonb, nullable | |

> **Status 2026-10-05: `assortment_scope` is not on `develop`.** #6709 shipped `CustomerGroupTerms` without this column. As a result, `resolveAssortmentScope()` is a stub: every matching group contributes `null`, so every buyer resolves to `scope: null` (unrestricted) (`customer_groups/services/customerGroupsService.ts:103-111`). The stub's comment calls the column "Phase 5 scope", which is wrong. Phase 5 is the per-customer override (§5.7); this column belongs to Phase 2's terms and is specified in this row. The column (additive, nullable `jsonb`, no backfill) and the group-terms pickers ship with the storefront release (owner decision D13, `.ai/specs/analysis/ANALYSIS-2026-10-05-storefront-release-decisions.md`), replacing the stub's body with a read of the column.

### 5.4 `CustomerCreditAccount` (`customer_credit_accounts`)

One row per customer per currency. The limit on the account is authoritative; the group's `default_credit_limit` only pre-fills it.

| Column | Type | Notes |
|---|---|---|
| `organization_id` | uuid, **NOT NULL** | The customer's organization. Groups are tenant-scoped (`organization_id` nullable, §5.1), but customers, carts and orders are organization-scoped, and so is credit |
| `customer_id` | uuid | `customers.CustomerEntity.id`, FK id only. For a B2B buyer this is the **company** entity (§6.5 identity rule, G11) |
| `currency_code` | text | |
| `credit_limit` | numeric(16,2) | Authoritative limit. May be set below current exposure; the account then refuses new reservations and the admin UI shows `available < 0` |
| `is_on_hold` | boolean | Manual block; blocks regardless of exposure |
| `hold_reason` | text, nullable | Required when `is_on_hold = true` (validator). Free text, encrypted (§16) |
| `updated_by_user_id` | uuid, nullable | Audit |

**Provisioning (D-R5-5).** Accounts are created by an operator only. Nothing creates one lazily: with no account in the requested currency, `checkCredit` returns `no_account`, and checkout offers prepayment or, where `allow_quote_requests` allows it, `request_quote` (D-R5-20). A banner on the credit panel lists customers whose resolved terms allow purchase on account but who have no account in their resolved `terms_currency_code`, modelled on the Phase 1 orphan banner (§7.3).

Optimistic locking uses the platform's standard `updated_at` mechanism (already present per the §5 header), not a `version` counter — this entity is `CrudForm`-edited, so the header is auto-derived from `initialValues.updatedAt`. List and detail responses return `updatedAt`. Reservations lock the row (§6.3) but never write to it, so they do not bump `updated_at` and cannot cause a false 409 on an admin edit. No separate `version` column.

Constraint: unique `(tenant_id, organization_id, customer_id, currency_code)` among rows with `deleted_at IS NULL`. Accounts are never hard-deleted while ledger entries reference them; Release 5 has no delete route (§9).

### 5.5 `CustomerCreditLedgerEntry` (`customer_credit_ledger_entries`)

Append-only. No `updated_at`, no `deleted_at`; corrections are compensating entries. `organization_id` is the account's organization.

| Column | Type | Notes |
|---|---|---|
| `credit_account_id` | uuid | FK → `customer_credit_accounts` (same module, so an ORM relation is allowed) |
| `entry_type` | text | `reserve \| release \| settle \| adjust` |
| `amount` | numeric(16,2) | Signed; `reserve` positive, `release`/`settle` negative, `adjust` either. Never zero |
| `source_type` | text | `checkout \| order \| invoice \| payment \| manual` |
| `source_id` | uuid, nullable | For a checkout reserve, the checkout session id |
| `related_entry_id` | uuid, nullable | The `reserve` entry a `release` or `settle` belongs to, or the `adjust` entry an undo compensates. FK → `customer_credit_ledger_entries` |
| `linked_order_id` | uuid, nullable | `sales.SalesOrder.id`, FK id only. Set on a `reserve` entry by `linkCreditReservationToOrder` (C6). It is the one column that is written after insert, and only once: `UPDATE … SET linked_order_id = ? WHERE id = ? AND linked_order_id IS NULL`. It does not change the amount or the exposure |
| `idempotency_key` | text | Required on `reserve`, `release` and `settle`; for `adjust` the command id. Rules in §6.5 |
| `balance_after` | numeric(16,2) | Exposure after this entry, computed under the account row lock (§6.3), for audit reconstruction |
| `created_by_actor_type` | text | `staff_user \| system`. Service calls made by checkout or a subscriber are `system`; `/adjust` is `staff_user` |
| `created_by_user_id` | uuid, nullable | Staff user for `staff_user` entries |
| `note` | text, nullable | Required on `adjust`. Free text, encrypted (§16) |

Constraints: unique `(tenant_id, idempotency_key)`. A key is therefore unique across every account of the tenant, which lets `releaseCredit` and `linkCreditReservationToOrder` address a reservation by key alone (G2). Indexes `(tenant_id, credit_account_id, created_at)`, `(tenant_id, related_entry_id)` and `(tenant_id, linked_order_id)` where non-null.

**Exposure** = `SUM(amount)` over the account's entries. `balance_after` is written for audit only and MUST NOT be read as the source of truth. Because every write happens under the account row lock, the latest `balance_after` equals `SUM(amount)` whenever no bug exists; the daily audit (§11) checks exactly that.

**Open amount of a reservation** = the `reserve` amount plus the (negative) amounts of every `release` and `settle` entry whose `related_entry_id` points at it. A release releases this open amount, never the original amount.

**Money.** The service contract carries amounts as decimal strings with 2 decimal places. Inputs with more places (sales amounts are `numeric(18,4)`) are rounded half-up to 2 dp at the service boundary, before the lock, using the minor-unit helpers promotions already uses (`promotions/lib/promotion-usage-service.ts`). The ledger never stores more than 2 dp, so the exposure audit cannot report rounding as drift (G14).

### 5.6 `CustomerPurchaseApproval` (`customer_purchase_approvals`)

An approval is consent to spend up to an amount in a currency (D-R5-3). It has two decision slots, one per side, and the group's `approval_policy` snapshotted at creation decides which slots must sign (D-R5-1).

| Column | Type | Notes |
|---|---|---|
| `organization_id` | uuid, **NOT NULL** | The subject's organization |
| `customer_id` | uuid | `customers.CustomerEntity.id`, FK id only. The **company** entity for a B2B buyer (§6.5 identity rule), so every buyer-side approver of that company sees the request |
| `requested_by_actor_type` | text | `customer_user \| staff_user`. Release 5 writes only `customer_user`: only a buyer requests approval (proposals are never locked, cart K4). `staff_user` is reserved for a rep-authored request and no Release 5 route accepts it (X7) |
| `requested_by_actor_id` | uuid | `customer_accounts.CustomerUser.id` or `auth.User.id`, per the actor type |
| `subject_type` | text | `cart \| quote`. The cart is the one canonical subject of a purchase (D-R5-3); checkout reuses `Cart.approvalId` and creates no approval of its own. `quote` is reserved for approval at quote acceptance (D-R5-23), which is outside Release 5; nothing creates it yet |
| `subject_id` | uuid | |
| `amount_gross` | numeric(16,2) | Snapshot at request time, on the cart's goods-gross basis (cart `totals.grandTotalGrossAmount`, no delivery; cart K1). Taken from server-side cart totals, never from a request body |
| `currency_code` | text | The subject's currency |
| `approval_policy` | text | `buyer \| merchant \| both`, snapshotted from the resolved terms at creation. Changing the group's terms does not change the rules of a pending request |
| `status` | text | `pending \| approved \| rejected \| expired \| withdrawn` (§6.6) |
| `buyer_decision` | text | `pending \| approved \| rejected \| not_required`. `not_required` when the policy is `merchant` |
| `buyer_decided_by_actor_type` | text, nullable | Always `customer_user` when set |
| `buyer_decided_by_actor_id` | uuid, nullable | |
| `buyer_decided_at` | timestamptz, nullable | |
| `buyer_decision_note` | text, nullable | Free text, encrypted (§16) |
| `merchant_decision` | text | `pending \| approved \| rejected \| not_required`. `not_required` when the policy is `buyer` |
| `merchant_decided_by_actor_type` | text, nullable | Always `staff_user` when set |
| `merchant_decided_by_actor_id` | uuid, nullable | |
| `merchant_decided_at` | timestamptz, nullable | |
| `merchant_decision_note` | text, nullable | Free text, encrypted (§16) |
| `decided_at` | timestamptz, nullable | When `status` left `pending` |
| `withdrawn_reason` | text, nullable | `requester \| cart_merged \| cart_expired \| cart_purged`; set only with `status = 'withdrawn'` |
| `expires_at` | timestamptz | `created_at` + the tenant's approval expiry, default **14 days** (D-R5-27, `ModuleConfigService` key `customer_groups.approval_expiry_days`). Cart expiry withdraws a pending request earlier (cart K3) |

Constraints: a partial unique index `(tenant_id, subject_type, subject_id) WHERE status = 'pending'` — at most one pending request per subject, which makes `requestApproval` idempotent under concurrency (G8). Check constraints keep the slot actor types to their side. Indexes `(tenant_id, organization_id, customer_id, status)` and `(tenant_id, status, expires_at)` for the expiry job.

**Concurrency.** Every transition is a conditional update on `status = 'pending'` (and, for a decision, on the caller's slot being `pending`) — §6.6. That compare-and-set is what prevents a double decision (R8). The `updated_at` header stays as the UX layer: the decide routes wrap the write with `enforceCommandOptimisticLock`, and a client that decided against a stale snapshot gets the standard conflict, surfaced with `surfaceRecordConflict`. The header alone is not the guard: it is fail-open without a header or with `OM_OPTIMISTIC_LOCK=off`, and the expiry job sends none. No separate `version` column.

**Approver model (D-R5-1).** Buyer-side deciders are `CustomerUser`s whose company (`CustomerUser.customer_entity_id`) equals the approval's `customer_id` and who hold `customer_groups.portal.approvals.decide`. Merchant-side deciders are staff holding `customer_groups.approvals.decide` in the approval's organization. A requester can never decide their own request. `customers.CustomerEntityRole` is not the approver model — its `userId` is a staff user and it allows one holder per role per company; its `account_manager` rows only route staff notifications (§10).

### 5.7 `CustomerAssortmentOverride` (`customer_assortment_overrides`) — added 2026-09-16

One **optional** row per customer, carrying a catalog-visibility rule that applies to that customer alone, above and below whatever their groups grant. Absent row — the common case — means "this customer's assortment comes entirely from their groups," and resolves to a value byte-identical to the group-only result, which is what keeps that buyer sharing storefront cache entries with their group peers ([Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §3.7).

| Column | Type | Notes |
|---|---|---|
| `customer_id` | uuid | `customers.CustomerEntity.id` — FK id only, no ORM relation, same convention as §5.2 |
| `grant_scope` | jsonb, nullable | `AssortmentScope \| null` — the **widening** direction: joins the buyer's OR-list as one more branch, exactly like an additional group grant |
| `restrict_scope` | jsonb, nullable | `AssortmentScope \| null` — the **narrowing** direction: intersected over *every* branch, so it also cuts what the customer's groups grant |
| `valid_from` | timestamptz, nullable | null = always; same window semantics as a membership (§5.2) |
| `valid_until` | timestamptz, nullable | null = indefinite |
| `notes` | text, nullable | Why this account has a bespoke assortment — the first question support asks |
| `metadata` | jsonb, nullable | |

Constraints: unique `(tenant_id, customer_id)` among rows with `deleted_at IS NULL`. That unique partial index also serves the cached `EXISTS` probe the storefront uses to decide whether this buyer diverges from their group at all.

Declared as an **entity extension** of the customer, not as columns on `CustomerEntity`, per root `AGENTS.md`'s rule for extending another module's data — `customer_groups/data/extensions.ts` links `customers:customer_entity` → `customer_groups:customer_assortment_override` on `id` ↔ `customer_id`, `one-to-one`. Both scopes and the two-direction algebra are specified in the visibility spec §3.6/§4.4; this module owns the table because it already owns `resolveAssortmentScope()` and already owns validity-windowed buyer rows with exactly these semantics.

---

## 6) Service Contract

Three services are registered in `customer_groups/di.ts`, each with its own exported interface:

| DI key | Interface | Phase | Purpose |
|---|---|---|---|
| `customerGroupsService` | `CustomerGroupsService` | 1–2 (shipped) | Group, terms and assortment resolution. **No credit or approval method is added to it** (G26): an app that overrides this key through `entry.overrides.di` keeps satisfying its interface |
| `customerCreditService` | `CustomerCreditService` | 3 | Credit check, reservation, release, settlement, order linkage |
| `customerPurchaseApprovalService` | `CustomerPurchaseApprovalService` | 4 | Approval request, read, withdraw, decide |

Consumers outside this module (`cart`, `checkout`) resolve the two new keys with `tryResolve`, so an app without `customer_groups` keeps booting (D-R5-18).

```typescript
type GroupResolution = {
  groupIds: string[]              // ordered by priority desc — the winner is groupIds[0]
  groups: Array<{ id: string; code: string; name: string; kind: string; priority: number }>
}

type ResolvedTerms = {
  priceKindId: string | null   // gross/net display is derived downstream from this price kind's own `displayMode` — see §6.1a; ResolvedTerms does not carry a separate tax-mode field
  paymentTermsDays: number | null
  allowPurchaseOnAccount: boolean
  approvalRequiredAbove: number | null
  minOrderValue: number | null
  termsCurrencyCode: string | null                 // Release 5 (D-R5-4): currency of approvalRequiredAbove and minOrderValue; falls back to the organization's base currency (D-R5-37), null only without one
  approvalPolicy: 'buyer' | 'merchant' | 'both'    // Release 5 (D-R5-1): tenant default 'buyer'
  allowQuoteRequests: boolean                      // Release 5 (D-R5-20): tenant default false
  requiresPoNumber: boolean                        // Release 5 (D-R5-28): tenant default false
  sourceGroupId: string | null    // which group each value came from, for admin explainability
  // NOTE: no `assortmentScope` field — withdrawn 2026-09-06, see §6.4. Assortment scope is a
  // visibility grant, not a scalar term, so it cannot follow §6.1's highest-priority-wins rule.
}

// Shipped (#6709) inputs carry `tenantId` — groups are tenant-scoped, `organization_id` is nullable.
// `customerIds` added 2026-10-05 (additive; see §6.0): the storefront buyer is a person AND their company.
type BuyerIdentityInput =
  | { customerId: string | null; tenantId: string; at?: Date }          // shipped, kept
  | { customerIds: string[]; tenantId: string; at?: Date }              // new — person first, then company

interface CustomerGroupsService {
  resolveGroups(input: BuyerIdentityInput): Promise<GroupResolution>

  resolveTerms(input: BuyerIdentityInput & { groupIds?: string[] }): Promise<ResolvedTerms>

  // Assortment scope resolves separately from the scalar terms above — §6.4.
  resolveAssortmentScope(input: BuyerIdentityInput): Promise<{
    scope: EffectiveAssortmentScope   // groups unioned, the customer's own grant unioned in and its restriction intersected over the result (§6.4); nothing matching → null (unrestricted)
    sourceGroupIds: string[]          // every group that contributed, for the explain-terms panel
    sourceCustomerOverrideId: string | null   // the customer's own §5.7 row, or null — the common case
  }>
}

// ---- Phase 3: customerCreditService ----

type CommerceScope = { tenantId: string; organizationId: string }
type DecimalString = string   // 2 dp; inputs with more places are rounded half-up at the boundary (§5.5)

// The buyer as the caller knows it: person first, then company (§6.0). For carts outside the
// storefront channel the caller fills it from `storeContextService.resolveForBuyer` (D-R5-22).
// `customerId` alone is accepted for staff routes that already name the account holder.
type CreditBuyerInput = { customerIds: string[] } | { customerId: string }

type CreditCheck = {
  allowed: boolean
  reason: 'ok' | 'no_account' | 'on_hold' | 'limit_exceeded' | 'not_permitted'
  customerId: string                  // the resolved account holder (company first, §6.5)
  creditAccountId: string | null      // null with 'no_account'; set with 'not_permitted' when an account exists
  creditLimit: DecimalString | null
  exposure: DecimalString | null
  available: DecimalString | null     // creditLimit − exposure; may be negative
  currencyCode: string
}

type CreditEntryView = {
  entryId: string
  creditAccountId: string
  entryType: 'reserve' | 'release' | 'settle' | 'adjust'
  amount: DecimalString
  balanceAfter: DecimalString
  idempotencyKey: string
  relatedEntryId: string | null
  linkedOrderId: string | null
}

interface CustomerCreditService {
  // Read-only, no lock. A hint for the UI and checkout's payment-method list, never a guarantee.
  checkCredit(input: {
    scope: CommerceScope
    buyer: CreditBuyerInput
    currencyCode: string
    amount: DecimalString
  }): Promise<CreditCheck>

  // Row lock on the credit account (§6.3); re-checks under the lock and appends the reserve entry.
  // `amount` is the caller's full payable total (D-R5-24): for checkout, goods gross after
  // promotions + selected delivery cost − delivery discount.
  reserveCredit(input: {
    scope: CommerceScope
    buyer: CreditBuyerInput
    currencyCode: string
    amount: DecimalString
    sourceType: 'checkout' | 'order'
    sourceId: string
    idempotencyKey: string
  }): Promise<{
    reserved: boolean
    released: boolean                // true when this key's reservation was already released (§6.5 rule 3)
    entry: CreditEntryView | null
    check: CreditCheck
  }>

  // Releases the open amount of the reservation named by its key (§5.5). Second call is a no-op.
  releaseCredit(input: {
    scope: CommerceScope
    reserveIdempotencyKey: string
    reason: string
  }): Promise<{ released: boolean; entryId: string | null }>

  // Lowers exposure for a payment. With `reserveIdempotencyKey`, the settle belongs to that
  // reservation and may not exceed its open amount; without it, it is account-level.
  settleCredit(input: {
    scope: CommerceScope
    buyer: CreditBuyerInput
    currencyCode: string
    amount: DecimalString
    sourceType: 'invoice' | 'payment'
    sourceId: string
    idempotencyKey: string
    reserveIdempotencyKey?: string
  }): Promise<{ settled: boolean; entry: CreditEntryView }>

  // C6: writes the order id on the reservation once, so the `sales.order.cancelled`
  // subscriber can release it (§6.5). Same order id again is a no-op; a different one is 409.
  linkCreditReservationToOrder(input: {
    scope: CommerceScope
    idempotencyKey: string           // the reserve entry's key
    orderId: string
  }): Promise<{ linked: boolean; entryId: string }>
}

// ---- Phase 4: customerPurchaseApprovalService ----

type ApprovalActor =
  | { actorType: 'customer_user'; actorId: string; customerEntityId: string }   // company from the customer session
  | { actorType: 'staff_user'; actorId: string }

type ApprovalSlotView = {
  decision: 'pending' | 'approved' | 'rejected' | 'not_required'
  decidedBy: { actorType: 'customer_user' | 'staff_user'; actorId: string } | null
  decidedAt: string | null
  note: string | null
}

type ApprovalView = {
  id: string
  customerId: string
  subjectType: 'cart' | 'quote'
  subjectId: string
  amountGross: DecimalString
  currencyCode: string
  approvalPolicy: 'buyer' | 'merchant' | 'both'
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'withdrawn'
  requestedBy: { actorType: 'customer_user' | 'staff_user'; actorId: string }
  buyer: ApprovalSlotView
  merchant: ApprovalSlotView
  withdrawnReason: 'requester' | 'cart_merged' | 'cart_expired' | 'cart_purged' | null
  decidedAt: string | null
  expiresAt: string
  createdAt: string
  updatedAt: string
}

interface CustomerPurchaseApprovalService {
  // No public create route: only cart commands call this, with server-side totals (G3).
  // Idempotent per (subject_type, subject_id) while a request is pending: returns it with created: false.
  requestApproval(input: {
    scope: CommerceScope
    buyer: { customerIds: string[] }   // resolved to the company inside the service (§6.5)
    requestedBy: ApprovalActor         // Release 5 callers pass only 'customer_user' (X7)
    subjectType: 'cart' | 'quote'      // Release 5 callers pass only 'cart' (D-R5-23)
    subjectId: string
    amountGross: DecimalString
    currencyCode: string
    expiresAt?: Date                   // default: now + tenant expiry (14 days, D-R5-27)
  }): Promise<{ approval: ApprovalView; created: boolean }>

  getApproval(input: { scope: CommerceScope; approvalId: string }): Promise<ApprovalView | null>

  // The pending request for the subject, or null.
  getActiveApprovalForSubject(input: {
    scope: CommerceScope
    subjectType: 'cart' | 'quote'
    subjectId: string
  }): Promise<ApprovalView | null>

  // A requester withdraws their own request; cart commands and sweepers withdraw as 'system'.
  withdrawApproval(input: {
    scope: CommerceScope
    approvalId: string
    actor: ApprovalActor | { actorType: 'system'; reason: 'cart_merged' | 'cart_expired' | 'cart_purged' }
  }): Promise<ApprovalView>

  // The actor's type selects the slot: customer_user → buyer, staff_user → merchant.
  decideApproval(input: {
    scope: CommerceScope
    approvalId: string
    decision: 'approved' | 'rejected'
    actor: ApprovalActor
    note?: string
    expectedUpdatedAt?: string         // the optimistic-lock header value, UX layer only (§5.6)
  }): Promise<ApprovalView>
}
```

The feature check (`customer_groups.approvals.decide`, `customer_groups.portal.approvals.decide`) is the route's job. The service enforces everything that depends on the record: the slot must be required and `pending`, the actor must not be the requester, and a `customer_user` actor's `customerEntityId` must equal the approval's `customer_id`. Decision notes are returned to both sides.

### 6.0 Multiple buyer identities (added 2026-10-05)

A storefront buyer is resolved as their person entity **and** their company entity (`CustomerUser.person_entity_id`, `CustomerUser.customer_entity_id`; SPEC-029 §6, roadmap ADR-7). Memberships can be attached to either one: the module injects group tabs on both `detail:customers.person` and `detail:customers.company`. `customerIds` is therefore accepted alongside the shipped single `customerId`. That is an additive input, and the single-id form stays valid and behaves exactly as today.

- **Groups** are the union of the memberships of every id in `customerIds` (each valid-at-`at`, active, not deleted, same as today), de-duplicated by group.
- **Ordering** of `groupIds`: `priority` descending; on equal priority, a membership of `customerIds[0]` (the person) comes before one of a later id (the company); then the newest membership first, as shipped.
- **Default group**: applied only when none of the ids has an effective membership, the same rule as shipped for one id.
- **Terms** (§6.1) and **assortment** (§6.4) run over that ordered union without any other change. Scalar terms follow it per field; assortment unions every contributing group regardless of order.

**Shipped `ResolvedTerms` differs from the type above (code = current behavior).** #6709 replaced the single `sourceGroupId` with a per-field `sources: Record<field, string | null>` map (`services/customerGroupsService.ts:25-43`), and `explain-terms` reads it per field. Treat the `sources` map as the contract; `sourceGroupId` above is the pre-implementation sketch. Release 5 adds `termsCurrencyCode`, `approvalPolicy`, `allowQuoteRequests` and `requiresPoNumber` to `TERMS_FIELD_NAMES`, so each gets its `sources` entry and its explain-terms row like the five shipped fields. The shipped number fields (`approvalRequiredAbove`, `minOrderValue`) keep their `number` type; callers compare them in minor units against their own decimal totals.

### 6.1 Terms inheritance

`resolveTerms` walks, per field independently: highest-priority group with a non-null value → its ancestors → tenant default. Each field records its `sourceGroupId` so the admin UI can explain *why* a buyer got a given term — the single most common B2B support question.

### 6.1a Tax display mode is derived, not stored (fixed 2026-08-17)

An earlier draft gave `CustomerGroupTerms` its own `tax_display_mode: 'gross' | 'net'` column, independent of `price_kind_id`. A `/om-pre-implement-spec` audit found this created two unreconciled sources of truth: `catalog.CatalogPriceKind.displayMode` (`'including-tax' | 'excluding-tax'`, the field every existing gross/net computation in this codebase actually reads — `catalog`'s own `LineItemDialog.tsx` translates it 1:1) and this module's independent `tax_display_mode`, with no rule for what happens when an admin sets `price_kind_id` to an `excluding-tax` kind while leaving `tax_display_mode` at `'gross'`.

Fixed: `resolveTerms` resolves only `priceKindId` (§5.3). The consumer that needs a gross/net display mode (`ecommerce.storeContextService.resolve()`, spec 3, which already depends on `catalog` for price-kind data) derives it by reading the resolved price kind's `displayMode` and translating `'excluding-tax' → 'net'`, `'including-tax' → 'gross'` — the same translation `LineItemDialog.tsx` already performs. This module has no reason to depend on `catalog` just to duplicate that lookup; `ecommerce` already makes it as part of the same resolution step.

### 6.2 Anonymous and ungrouped buyers

`customerId: null` returns the default group (`is_default = true`) if one exists, otherwise an empty set and tenant-default terms with `allowPurchaseOnAccount: false`. The anonymous buyer's gross/net display mode falls out of §6.1a — derived from whichever price kind the channel binding resolves to for an anonymous request, not from a value returned here. Absence of a group MUST NOT be an error — an anonymous storefront visitor is the common case.

### 6.3 Concurrency Strategy

Every write that changes an account's exposure (`reserveCredit`, `releaseCredit`, `settleCredit`, the `adjust` command and its undo) serializes on the account row (G1, revised 2026-10-26). It runs inside `withAtomicFlush(em, phases, { transaction: true })`, which joins the caller's transaction when one is open (checkout submit) and opens one otherwise:

1. `findOne(CustomerCreditAccount, { id, tenantId, organizationId, deletedAt: null }, { lockMode: LockMode.PESSIMISTIC_WRITE })`;
2. the idempotency lookup by `(tenant_id, idempotency_key)` (§6.5); a replay returns here, still under the lock;
3. `SUM(amount)` over the account's entries;
4. for a reserve: refuse when `is_on_hold`, or when `exposure + amount > credit_limit`;
5. append the entry with `balance_after` computed under the lock.

A parallel caller blocks at step 1 until the first commits, then reads the new sum. No retry loop is needed and no isolation level is requested. This is the Release 4 promotions mechanism (`promotions/lib/promotion-usage-service.ts`, D-R4-12), which replaced the same `SERIALIZABLE` design for a concrete reason that applies here too: `withAtomicFlush` ignores `isolationLevel` when it joins an existing transaction (`packages/shared/src/lib/commands/flush.ts`), and checkout calls `reserveCredit` inside its own submit sequence. No retry-on-40001 helper is built.

Rules that keep the lock cheap and deadlock-free:

- The lock covers only steps 1–5. No gateway or network call runs while it is held (checkout reserves before payment).
- Lock order is "stock, then credit": checkout reserves availability before credit (checkout §7.2), and every other caller keeps that order.
- `checkCredit` takes no lock. It is a hint; only `reserveCredit` decides.
- The amount checked under the lock is the amount appended. `reserveCredit` is a service operation, not a command with interceptors; if a later release wraps it in a command, the check under the lock MUST use the post-interceptor amount, with a regression test for an interceptor that changes it (G25).

The acceptance gate is the N=20 parallel-reservation test **and** the same test with each reservation called inside an outer transaction (§13). Both ship with the lock path, before any route (§14).

### 6.4 Assortment scope resolves separately from the scalar terms (amended 2026-09-06)

`ResolvedTerms` originally carried an `assortmentScope` field resolved by §6.1's generic per-field algorithm. That is wrong, and [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §1.1 shows why: §6.1's rule picks the highest-`priority` group's value and discards the rest, which is correct for a scalar setting (exactly one payment term must win) and incorrect for a **visibility grant**. A buyer in both "Wholesale" (scoped to a bulk-goods category) and "Q3 Preview" (scoped to a launch tag) would see only whichever group happens to carry the higher `priority` integer — a number the operator set to tie-break price rows, not to rank visibility. Adding a second, more permissive group would silently be a no-op.

Fixed: the `assortmentScope` field is **withdrawn** from `ResolvedTerms`, and `resolveAssortmentScope()` (§6) replaces it. It returns an `EffectiveAssortmentScope` — an OR-list of AND-scopes, one branch per contributing group — so grants combine additively regardless of priority. The type and its pure combinators (`matchesOne`, `matchesScope`, `unionScopes`, `intersectScopes`) live in `packages/shared/src/lib/catalog-visibility/`; that spec owns their definition and this one consumes it. Every other `ResolvedTerms` field is untouched and keeps resolving via §6.1 exactly as before — this is a single-field exception, stated once, not a change to the algorithm.

`customerId: null` (anonymous, or no matching groups) returns `{ scope: null, sourceGroupIds: [], sourceCustomerOverrideId: null }` — `null` meaning unrestricted, consistent with §6.2's rule that absence of a group MUST NOT be an error.

**Per-customer overrides resolve in the same call (added 2026-09-16).** A customer's own `CustomerAssortmentOverride` (§5.7) is applied here, inside this method, so that every consumer keeps receiving one finished `EffectiveAssortmentScope` and no caller learns how many sources produced it:

```
branches   = [ ...scopeOfEachMatchingGroup ]
if (override?.grantScope) branches.push(override.grantScope)   // omitted when absent — NEVER pushed as null,
                                                               // which unionScopes reads as "unrestricted source"
unioned    = unionScopes(branches)
buyerScope = intersectScopes(override?.restrictScope ?? null, unioned)
```

The grant widens (one more OR-branch, like an extra group) and the restriction narrows across every branch (the same operator the storefront channel's own scope uses). Setting both to the same scope yields "this customer sees only this," so no `mode` column exists. The override is bounded by the layers above it — `ecommerce` still intersects this result with the channel's own scope, and `require_authentication` short-circuits before this method is called at all — so an override can never reveal what a channel excludes. Full algebra, cache rule and risks: the visibility spec §3.6, §3.7, R8–R10.

### 6.5 Credit lifecycle (added 2026-10-26)

**Identity (G11, D-R5-22).** Credit and approvals belong to the company. From `customerIds` the service picks the first id that is a company entity; with no company it uses the person. It reads the entity kind through the query engine (FK id, no import of `customers`). Callers pass the ids they already hold: the storefront cart's `customerIds`, or, for carts outside the storefront channel (`pay_link`, `api`, `agent`), the `customerIds` returned by `storeContextService.resolveForBuyer` (SPEC-029). Every channel therefore resolves to the same account. The resolved `customerId` and `creditAccountId` are returned so the caller can snapshot them. `not_permitted` comes from `resolveTerms` over the same `customerIds`: `allowPurchaseOnAccount = false`.

**Reason order of `checkCredit` and `reserveCredit`:** `not_permitted` → `no_account` (no live account in the currency) → `on_hold` → `limit_exceeded` → `ok`.

**Who moves exposure (D-R5-2, hybrid settlement):**

| Entry | Written by | When | Amount |
|---|---|---|---|
| `reserve` | checkout submit, step 4 (`reserveCredit`, `sourceType: 'checkout'`, `sourceId` = session id) | On-account submit, after stock is held and before the document exists | The full payable total (D-R5-24). A refusal leaves no entry and no order behind |
| — (link) | checkout, after the order is created (`linkCreditReservationToOrder`, C6) | Order outcome only | No amount; writes `linked_order_id` |
| `release` | checkout compensation (`releaseCredit`) | A submit step after the reserve fails, before or after document creation | The reservation's open amount |
| `release` | `customer_groups` subscriber on `sales.order.cancelled` | An order with a linked reservation is cancelled (a failed or abandoned payment is compensated by cancelling the order) | The open amount: nothing already settled is released |
| `settle` | An integration calling `settleCredit`, or an operator through `/adjust` | A payment is received. **Payments are not settled automatically in Release 5** | The paid amount, rounded to 2 dp |
| `adjust` | Operator, `/adjust` command | Any correction, including manual settlement | Signed, with a required note |

The user documentation states plainly that without an integration calling `settleCredit`, exposure after payment is lowered manually through `/adjust`. Settling at invoice time would be wrong: an unpaid invoice is still exposure. The quote outcome (`request_quote`, D-R5-20) reserves nothing.

**Idempotency (G12).**

1. Same key, same `(amount, currency, sourceType, sourceId)` → the original entry is returned, nothing is written.
2. Same key, any difference → `409 idempotency_key_mismatch`. A checkout attempt that re-prices mints a new key.
3. A key whose reservation was released is not reusable: `reserveCredit` returns the original entry with `reserved: false, released: true`.
4. `releaseCredit` writes its entry with the key `release:{reserveKey}`, so a second call is a no-op returning `released: false` and the first entry's id. It releases the open amount; with an open amount of zero (fully settled) it writes nothing.
5. `settleCredit` with `reserveIdempotencyKey` refuses an amount above the reservation's open amount with `400 settle_exceeds_reservation`; the excess is settled on the account level, without the reservation key.
6. `linkCreditReservationToOrder` with the same order id is a no-op; with a different order id it answers `409 idempotency_key_mismatch`.

**Commands, audit and undo (G20).** `adjust` is a command (`customer_groups.credit.adjust`) with an audit entry; its undo appends the inverse entry with `related_entry_id` set to the original and the key `undo:{entryId}`, never a delete. `reserve`, `release`, `settle` and the order link are service operations: each writes an audit-log entry marked system-initiated when no staff user is behind it, and none is undoable from the audit UI. Reversal is always the counter-entry above.

### 6.6 Approval lifecycle (added 2026-10-26)

Every transition is one conditional `UPDATE … WHERE id = ? AND tenant_id = ? AND organization_id = ? AND status = 'pending' …`. Zero rows updated means `409 approval_not_pending`, with the current `status` and both slots in the body. Under Postgres's default isolation a concurrent update on the same row waits and then re-evaluates its `WHERE` and its `SET` expressions against the committed row, so with policy `both` two simultaneous decisions from different sides still produce the right final status.

| From | To | Actor | Guard (in the `WHERE` or before it) | Event |
|---|---|---|---|---|
| — | `pending` | cart command `cart.approval.request` on behalf of the buyer (`customer_user`) | No pending request for the subject (partial unique index); otherwise the existing one is returned with `created: false`. Amount from server-side cart totals. Policy snapshotted from `resolveTerms`; the slot the policy leaves out is `not_required` | `customer_groups.approval.requested` |
| `pending` | `pending` (one slot decided) | Eligible decider of one side, policy `both` | Slot `pending`; `expires_at > now()`; actor ≠ requester; `customer_user` of the approval's company. Decision `approved` while the other slot is still `pending` | none (the other side was notified at request) |
| `pending` | `approved` | Eligible decider | Same guards; after this decision every required slot is `approved` | `customer_groups.approval.approved` |
| `pending` | `rejected` | Eligible decider of either required side | Same guards; one rejection from either side ends the request | `customer_groups.approval.rejected` |
| `pending` | `expired` | `expire-approvals` job (system) | `expires_at <= now()` | `customer_groups.approval.expired` |
| `pending` | `withdrawn` | The requester (portal withdraw), or the cart as `system` (merged source, expired, purged; cart K3) | A `customer_user` actor must be the requester | `customer_groups.approval.withdrawn` |

`approved`, `rejected`, `expired` and `withdrawn` are terminal. Decide and expire use disjoint conditions on `expires_at`, so a decision at the boundary instant either lands or expires, never both. A decision is not undoable: a recorded decision is authoritative, and a mistaken approval is answered by a new request.

**What an approval authorises (D-R5-3).** An `approved` request covers the subject while the subject's goods gross stays at or below `amount_gross` in `currency_code`. Changed lines at the same or a lower total keep it; a higher total makes the cart re-request, and `Cart.approvalId` moves to the new request while the old one stays `approved` and no longer qualifies. There is no line digest. The policy is opaque to the cart: it reads only the final `status`.

**Out of scope (G24):** per-approver authority limits ("approves up to X") and multi-step approval chains (§15).

---

## 7) Consumer Changes

### 7.1 `catalog` pricing

`PricingContext.customerGroupId?: string | null` becomes `customerGroupIds?: string[]`, and the matcher at `catalog/lib/pricing.ts:66` changes from equality to set membership.

**Ownership split with [Pricing Engine](./2026-08-21-pricing-engine.md) (resolved 2026-09-06).** Both specs touch this type; each owns one half, and neither restates the other's:

| Concern | Owner |
|---|---|
| The `PricingContext` **type shape** — adding `customerGroupIds`, deprecating `customerGroupId`, adding `currencyCode`, and hardening `registerCatalogPricingResolver`'s registry | `2026-08-21-pricing-engine.md` Phase 2. It is `catalog`-internal infrastructure work in the module that owns the resolver. |
| The **group tie-break semantics** those ids resolve under | This spec, §3.2. Group precedence is the `customer_groups` domain rule. |

Pricing Engine's Edge Cases table names its tie-break a *provisional* default *"pending that sibling spec"* — this is that sibling spec, so the rule below is the one to implement, and Pricing Engine's provisional wording is superseded rather than contradicted.

**Tie-break, authoritative.** Resolution is unchanged at first order: `scorePrice`'s specificity score decides, and a matching group row still scores +3 at `catalog/lib/pricing.ts:84`. The second-order rule is what this spec adds — when two or more **equally-scored** rows match by way of *different* groups the buyer belongs to, the row whose group carries the highest `CustomerGroup.priority` wins (§3.2), ties broken by the most recently created membership. This is additive to `scorePrice`'s existing weights; it does **not** reorder them, and per `catalog/AGENTS.md` § Ask First, changing resolver priority semantics is explicitly out of scope for both specs.

**Backward compatibility.** `customerGroupId` is retained as a deprecated optional field for at least one minor version, normalized internally to `[customerGroupId]`. Marked `@deprecated` with a pointer to the replacement, per the deprecation protocol in `BACKWARD_COMPATIBILITY.md`. `PricingContext` is a public type consumed by third-party modules; this is an additive change plus a deprecation, not a break. The `UPGRADE_NOTES.md` entry is authored once, by whichever of the two specs' phases lands first.

### 7.2 `sales` tax resolution

Same substitution in tax-rate matching. `SalesTaxRate.customerGroupId` (the rule side) is unchanged. The rest of the matching, which row applies by address, date and the row's other columns (channel, priority, compound, validity), is specified by the `sales-tax-rates` provider of the tax-providers roadmap (`2026-10-03-tax-providers-roadmap.md`, its Spec 2, still to be written) and applies once the organization selects that provider: `resolveGroups` is its input, this substitution and the precedence of §3.2 stay this spec's rules, and how they combine with the row's `priority` is that provider's specification to state. The group picker of §7.3 is not shipped for the tax-rate form: `TaxRatesSettings` renders its `CrudForm` without an `entityId`, so the `crud-form:sales.sales_tax_rate:fields` spot never resolves; giving that form an `entityId` so that the spot resolves is tracked as issue #6414 and coordinated with the admin UI of the `sales-tax-rates` provider, which extends that same dialog (that roadmap's ADR-6 and §11).

### 7.3 Admin UI

The free-text UUID input for `customerGroupId` in the catalog price editor is replaced with a group picker sourced from `/api/customer_groups/customer-groups`; the sales tax-rate form keeps its free-text input until that form gets an `entityId` (issue #6414), which §7.2 routes to the admin UI of the `sales-tax-rates` provider. A row referencing an id with no matching group renders as an explicit `Unknown group (<uuid>)` error state — it is not hidden, because hiding it is how the orphan problem became invisible in the first place.

**Coupling direction (resolved).** The picker ships as a widget `customer_groups` injects into the `crud-form:catalog.catalog_product_price:fields` spot (`packages/core/AGENTS.md` → Widget Injection / CrudForm Field Injection), not as a `catalog`/`sales` import of `customer_groups`; the `crud-form:sales.sales_tax_rate:fields` entry is part of this design but is not shipped (§7.2). `catalog` and `sales` gain **no new `requires` entry** — `pricing.ts:66,84`'s matching logic already only compares against a `customerGroupId[s]` value the caller supplies, so neither module needs a runtime dependency on `customer_groups` to function; `catalog` in particular keeps its current zero-`requires` status. If `customer_groups` is ejected, both forms fall back to their present-day free-text UUID input — no error, no degraded matching behavior, just the loss of the picker convenience and the `Unknown group` explainer. The price API filter (`catalog/api/prices/route.ts`) is unaffected either way; it already accepts a raw UUID.

**Phases 3–4 admin UI (added 2026-10-26).**

- **Terms form.** Adds `terms_currency_code`, `approval_policy`, `allow_quote_requests` and `requires_po_number`, each with Inherit / explicit value, like `allow_purchase_on_account`. When `approval_required_above` is set on the tenant's **default group**, the form shows a warning that it blocks guest orders and pay-link orders by guests above that amount: a guest cart over the threshold is refused at lock with `409 approval_requires_identified_buyer` (D-R5-12), and pay-link, `api` and `agent` carts get no channel exemption (D-R5-29). When a threshold or minimum order value resolves without a `terms_currency_code`, the form warns that every cart will then require approval and no minimum will be checked (D-R5-4).
- **Credit panel.** A tab injected on `detail:customers.company` and `detail:customers.person` with the account, its ledger and the adjust dialog (§17 Epic E). The credit list carries the "no credit account" banner of D-R5-5: customers whose resolved terms allow purchase on account and who have no live account in their resolved `terms_currency_code`. `default_credit_limit` and `credit_currency_code` pre-fill the create form.
- **Approvals.** A staff list of approval requests with a decide dialog for the merchant slot (§17 Epic F).

### 7.4 `cart` (Phase 4 consumer)

What the cart relies on from this module; the cart spec (`2026-08-14-cart-module.md` §9, §9a, §11) owns the cart side.

- **Terms.** The cart resolves terms through `customerGroupsService.resolveTerms({ customerIds: cart.customerIds, tenantId })` in its totals phase, so every channel is covered. For carts outside the storefront channel, `customerIds` come from `resolveForBuyer` (D-R5-22).
- **`requiresApproval`.** Basis: `totals.grandTotalGrossAmount` (goods after promotions, no delivery). True when the cart's currency differs from `termsCurrencyCode` (fail-closed, D-R5-4), or when the basis exceeds `approvalRequiredAbove`.
- **Gate in `cart.lock`.** Unless `Cart.approvalId` names an approval that is `approved`, in the cart's currency, with `amountGross ≥` the current basis (read live through `getApproval`), the lock refuses with `409 cart_requires_approval`. A guest cart over the threshold is refused with `409 approval_requires_identified_buyer` (D-R5-12). No channel is exempt (D-R5-29). With `purpose: 'quote'` the approval gate and the `min_order_value` check are skipped (D-R5-23); approval of a quote belongs to quote acceptance, outside Release 5.
- **Request.** `cart.approval.request` (route `POST /api/cart/current/request-approval`) calls `requestApproval` with the requester taken from the customer session, never the body, and stores the returned id in `Cart.approvalId`.
- **Withdraw.** Merging a cart away (source side), expiring it or purging it calls `withdrawApproval` with a `system` actor if the request is pending. Conversion leaves an approved request as it is.
- **Signals.** `cart.approval.requested` is a cart state signal with no notification (D-R5-32). A cart subscriber on `customer_groups.approval.*` with `subjectType = 'cart'` maintains `Cart.awaiting_approval_since`.

### 7.5 `checkout` (Phases 3–4 consumer)

What checkout relies on; `2026-03-19-checkout-simple-checkout.md` §7–§8 owns the checkout side.

- **DI.** Checkout resolves `customerGroupsService`, `customerCreditService` and `customerPurchaseApprovalService` with `tryResolve`. Without `customer_groups`, on-account payment and approvals are unavailable; pay links keep working (D-R5-18).
- **Payment methods.** `on_account` is offered when `allowPurchaseOnAccount` is true and a live, not-on-hold account exists in the cart currency; `request_quote` when `allowQuoteRequests` is true (D-R5-20). A PO number is required when `requiresPoNumber` is true (D-R5-28).
- **Approval.** `POST /api/checkout/sessions/current/request-approval` delegates to `cart.approval.request`. The session stores no approval id and reads `Cart.approvalId`; it resumes on the `customer_groups.approval.*` events through its own subscriber. Checkout sends no approval notifications (D-R5-32).
- **Credit at submit.** After `availability.reserve` (stock, then credit), checkout calls `reserveCredit` with the full payable amount (D-R5-24) and a key minted per attempt. A refusal aborts with `402 credit_refused`, carrying the `CreditCheck.reason`; the buyer is offered prepayment or, where allowed, `request_quote`, never switched automatically. After the order is created it calls `linkCreditReservationToOrder` (C6); any later compensation calls `releaseCredit`. The quote outcome reserves nothing.

---

## 8) Migration & Backward Compatibility

### 8.1 No foreign key in this release

`catalog_product_prices.customer_group_id` and `sales_tax_rates.customer_group_id` remain plain nullable UUIDs. Adding a FK would fail the migration on any tenant that has been using invented ids, and would change effective prices for the rest.

### 8.2 Orphan reconciliation

A CLI command `yarn mercato customer-groups:reconcile [--tenant <id>] [--adopt]` reports every distinct `customer_group_id` referenced by price rows or tax rates with no matching group, including affected row counts and a sample. With `--adopt` it creates a placeholder inactive group per orphan id (`code: orphan-<short-uuid>`, `is_active: false`, priority at the bottom) so the operator can rename and activate rather than re-key every row.

The same report is surfaced in the admin UI as a banner on the groups list while orphans exist.

### 8.3 Sequencing

Adding the FK constraint is explicitly out of scope and requires its own spec once tenants have run reconciliation.

### 8.4 Phases 3–4 (added 2026-10-26)

Everything Phases 3–4 add is additive. Nothing shipped in #6709 is renamed or removed.

| Surface | Change | Classification |
|---|---|---|
| DI keys | New `customerCreditService`, `customerPurchaseApprovalService` with their own exported interfaces. `CustomerGroupsService` gains no method (G26) | Additive |
| Types | `ResolvedTerms` gains `termsCurrencyCode`, `approvalPolicy`, `allowQuoteRequests`, `requiresPoNumber` and their `sources` entries. Additive for callers; an app that **overrides** `customerGroupsService` must return the four fields. Recorded in `UPGRADE_NOTES.md` | Additive (override note) |
| DB | New tables `customer_credit_accounts`, `customer_credit_ledger_entries`, `customer_purchase_approvals`; four nullable columns on `customer_group_terms`, no backfill (null = inherit, tenant defaults per §5.3) | Additive |
| Event ids and payloads | §10's `credit.*`, `credit_account.*` and `approval.*` ids and their payload types become FROZEN when Phase 3 / Phase 4 ships. Payloads may only gain optional fields afterwards | Additive, then frozen |
| Notification type ids | `customer_groups.credit.limit_exceeded`, `customer_groups.approval.requested` (§10) | Additive, then frozen |
| ACL features | Five staff features, two portal features (§9.1) | Additive, then frozen |
| API routes | New staff routes under `/api/customer_groups/customer-groups/`, new portal routes under `/api/customer_groups/portal/` (§9) | Additive |
| Behaviour | Thresholds already stored on groups start to apply: Phase 2 stored `approval_required_above` and `min_order_value` but nothing read them. A threshold with no `terms_currency_code` is read in the organization's base currency (D-R5-37), so a single-currency tenant keeps working without a data change; carts in other currencies require approval (D-R5-4). Only an organization without a base currency sees every cart require approval. Recorded in `UPGRADE_NOTES.md` | Behaviour change, documented |

**Grants on existing tenants.** `setup.ts` grants apply to new tenants only. Existing tenants run, after upgrading:

```bash
yarn mercato auth sync-role-acls
yarn mercato customer_accounts sync-customer-role-acls
```

The first grants `employee` the two new view features; the second grants the portal features to `portal_admin` and `buyer` (D-R5-7). Both steps are listed in `UPGRADE_NOTES.md`.

---

## 9) API Contracts

All admin CRUD routes use `makeCrudRoute`, export `openApi`, validate with Zod, and support optimistic locking via `updated_at` per root `AGENTS.md`. Action routes (`adjust`, `decide`, `withdraw`) are command routes that export `openApi` and validate with Zod. Shipped routes live under the module prefix `/api/customer_groups/customer-groups/` (`api/customer-groups/` in the module); the new rows use the same prefix (G17).

| Method | Path | Feature |
|---|---|---|
| GET/POST | `/api/customer_groups/customer-groups` | `customer_groups.groups.view` / `.manage` |
| GET/PUT/DELETE | `/api/customer_groups/customer-groups/:id` | idem |
| GET/POST | `/api/customer_groups/customer-groups/memberships` | `customer_groups.memberships.view` / `.manage` |
| PUT/DELETE | `/api/customer_groups/customer-groups/memberships/:id` | idem |
| GET/PUT | `/api/customer_groups/customer-groups/:id/terms` | `customer_groups.terms.view` / `.manage` |
| GET/POST | `/api/customer_groups/customer-groups/credit-accounts` | `customer_groups.credit.view` / `.manage`. List filters `customerId`, `currencyCode`, `isOnHold`, `ids`; returns `exposure` and `available` computed per row, and `updatedAt` |
| GET/PUT | `/api/customer_groups/customer-groups/credit-accounts/:id` | `customer_groups.credit.view` / `.manage`. PUT edits `credit_limit`, `is_on_hold`, `hold_reason`; optimistic lock via `CrudForm` |
| GET | `/api/customer_groups/customer-groups/credit-accounts/missing` | `customer_groups.credit.view`. The D-R5-5 banner: customers allowed on account with no account in their terms currency, with count |
| GET | `/api/customer_groups/customer-groups/credit-accounts/:id/ledger` | `customer_groups.credit.view`. Read-only, newest first, `pageSize ≤ 100` |
| POST | `/api/customer_groups/customer-groups/credit-accounts/:id/adjust` | `customer_groups.credit.adjust`. Body `{ amount: string, note: string }`; runs the `customer_groups.credit.adjust` command under the row lock (§6.3) |
| GET | `/api/customer_groups/customer-groups/approvals` | `customer_groups.approvals.view`. Organization-scoped list; filters `status`, `customerId`, `subjectType`, `ids`; returns `ApprovalView` with `updatedAt` |
| POST | `/api/customer_groups/customer-groups/approvals/:id/decide` | `customer_groups.approvals.decide`. Body `{ decision: 'approved' \| 'rejected', note?: string }` plus the optimistic-lock header; decides the merchant slot |
| GET | `/api/customer_groups/customer-groups/reconcile` | `customer_groups.groups.manage` |

There is no create route for approvals (requests come only from cart commands with server-side totals), no update or delete route for approvals, and no delete route for credit accounts.

**Portal routes (Phase 4, D-R5-1, G5).** Release 5 sells API-only, so a buyer-side approver acts through these routes. Each uses `requireCustomerAuth` and `requireCustomerFeatures`, takes the customer user and company from the customer session (never from the body), exports `openApi`, and is scoped to the session's tenant, organization and company. A request for an approval of another company answers `404`, the same body as an unknown id.

| Method | Path | Portal feature | Notes |
|---|---|---|---|
| GET | `/api/customer_groups/portal/approvals` | `customer_groups.portal.approvals.view` | Holders of `…decide` see their company's requests; others see only requests they made. Pending first, `pageSize ≤ 100` |
| GET | `/api/customer_groups/portal/approvals/:id` | `customer_groups.portal.approvals.view` | Same visibility rule |
| POST | `/api/customer_groups/portal/approvals/:id/decide` | `customer_groups.portal.approvals.decide` | Body `{ decision, note? }` plus the optimistic-lock header; decides the buyer slot |
| POST | `/api/customer_groups/portal/approvals/:id/withdraw` | `customer_groups.portal.approvals.view` | Requester only |

`POST /api/customer_groups/customer-groups` returns `{ id, isDefault }`. When `isDefault: true` was requested but the default promotion lost a concurrent race, the group is still created (201) and the response carries `isDefault: false`; the admin UI warns about it.

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
  { id: 'customer_groups.credit.manage',     title: 'Manage credit limits',      dependsOn: ['customer_groups.credit.view'] },
  { id: 'customer_groups.credit.adjust',     title: 'Post credit adjustments',   dependsOn: ['customer_groups.credit.view'] },
  { id: 'customer_groups.approvals.view',    title: 'View purchase approvals' },
  { id: 'customer_groups.approvals.decide',  title: 'Decide purchase approvals', dependsOn: ['customer_groups.approvals.view'] },
  // Portal features (customer RBAC, granted through defaultCustomerRoleFeatures)
  { id: 'customer_groups.portal.approvals.view',   title: 'View purchase approvals (portal)' },
  { id: 'customer_groups.portal.approvals.decide', title: 'Decide purchase approvals (portal)', dependsOn: ['customer_groups.portal.approvals.view'] },
]
```

`credit.manage` (change the limit) and `credit.adjust` (move the balance) are separate on purpose — they are different kinds of financial authority and tenants will want to grant them to different roles.

**Grant plan (`setup.ts`, D-R5-7, least privilege):**

```typescript
defaultRoleFeatures: {
  superadmin: ['customer_groups.*'],
  admin: ['customer_groups.*'],
  employee: [/* shipped view features */, 'customer_groups.credit.view', 'customer_groups.approvals.view'],
},
defaultCustomerRoleFeatures: {
  portal_admin: ['customer_groups.portal.approvals.view', 'customer_groups.portal.approvals.decide'],
  buyer: ['customer_groups.portal.approvals.view'],   // own requests: view and withdraw
  // viewer: nothing
},
```

`credit.manage`, `credit.adjust` and `approvals.decide` stay with `admin` or are granted by hand. Existing tenants run the two sync commands of §8.4.

### 9.2 Error codes (added 2026-10-26)

Error bodies use the platform shape `{ error: <code>, … }`; user-facing messages come from `customer_groups.errors.<code>`.

| Code | HTTP | Raised by | Meaning |
|---|---|---|---|
| `not_permitted` | — (reason) | `checkCredit`, `reserveCredit` | Resolved terms do not allow purchase on account. Returned as `CreditCheck.reason`, not thrown; checkout maps any refusal to `402 credit_refused` carrying the reason |
| `no_account` | — (reason) | idem | No live credit account in the currency (D-R5-5) |
| `on_hold` | — (reason) | idem | The account is on hold |
| `limit_exceeded` | — (reason) | idem | `exposure + amount > credit_limit` under the lock; also emits `customer_groups.credit.limit_exceeded` |
| `idempotency_key_mismatch` | 409 | `reserveCredit`, `settleCredit`, `linkCreditReservationToOrder` | The key was used with different inputs or another order (§6.5) |
| `settle_exceeds_reservation` | 400 | `settleCredit` | The settle amount is above the reservation's open amount |
| `credit_account_exists` | 409 | `POST …/credit-accounts` | A live account already exists for the customer and currency |
| `approval_not_pending` | 409 | decide, withdraw, expiry | The request, or the caller's slot, is no longer `pending` (decided, `not_required`, expired, withdrawn). Body carries `status`, both slots and the deciders. A request past `expires_at` the job has not yet processed reports `status: 'expired'` |
| `approval_self_decision_forbidden` | 403 | decide | The actor is the requester (G24) |
| `approval_withdraw_forbidden` | 403 | portal withdraw | The caller is not the requester |
| optimistic-lock conflict | 409 | decide, credit account PUT | The standard platform conflict body; the client shows `surfaceRecordConflict` |

A portal request for another company's approval answers `404` with the unknown-resource body, never `403`, so it does not disclose that the id exists.

---

## 10) Events

```typescript
'customer_groups.group.created' | '.updated' | '.deleted'
'customer_groups.membership.added' | '.removed' | '.expired'
'customer_groups.terms.updated'
'customer_groups.credit.reserved' | '.released' | '.settled' | '.adjusted' | '.limit_exceeded'
'customer_groups.credit_account.put_on_hold' | '.released_from_hold'
'customer_groups.approval.requested' | '.approved' | '.rejected' | '.expired' | '.withdrawn'
'customer_groups.assortment_override.created' | '.updated' | '.deleted' | '.expired'
```

**Shipped on `develop` (2026-10-05):** `customer_groups.group.created|updated|deleted`, `customer_groups.membership.added|removed|expired`, `customer_groups.terms.updated` (`events.ts:4-10`). Everything else above is unshipped Phase 3–5 scope. `customer_groups.membership.expired` is **declared but never emitted**; no worker or subscriber produces it. Consumers MUST therefore bound their membership-derived caches by TTL rather than rely on that event, until an expiry job emits it (§11). `terms.updated` and `group.*` carry `groupId` and no `customerId` (`lib/groupEvents.ts:19-49`). Consumers that cache per buyer need a per-group tag (for example `customer-group:{groupId}`) to honor the "every member of the group" duty below.

`customer_groups.membership.added` and `.removed` MUST invalidate any cached buyer context and any price cache keyed on that customer — see R2. `customer_groups.terms.updated` carries the same duty for every member of the group, since a terms change alters their resolved pricing.

`customer_groups.assortment_override.*` carries the same duty for catalog visibility: it MUST invalidate the cached buyer context, the cached "does this customer have an override" probe (visibility spec §3.7) and any storefront cache entry keyed on that buyer's `assortmentScopeHash`. It is also a buyer-identity-class change for `cart`, which re-runs its whole-cart re-visibility pass on it exactly as it does on a membership change (`2026-08-14-cart-module.md` §5.2 trigger 2) — otherwise an override's `valid_until` would be the one buyer-side change that reaches checkout unchecked.

### 10.1 Phases 3–4 payloads (added 2026-10-26)

Every new payload carries `tenantId` and `organizationId` (D-R5-32) and no personal data: no names, e-mails or notes, consistent with checkout's redaction rule. Amounts are 2-dp decimal strings. Events are emitted after the writing transaction commits.

```typescript
type CreditEntryEventPayload = {   // credit.reserved | .released | .settled | .adjusted
  tenantId: string; organizationId: string
  creditAccountId: string; customerId: string; currencyCode: string
  entryId: string; amount: string; exposureAfter: string
  sourceType: 'checkout' | 'order' | 'invoice' | 'payment' | 'manual'; sourceId: string | null
  relatedEntryId: string | null; linkedOrderId: string | null
}

type CreditLimitExceededPayload = {   // credit.limit_exceeded, emitted on a refused reserveCredit
  tenantId: string; organizationId: string
  creditAccountId: string; customerId: string; currencyCode: string
  requestedAmount: string; exposure: string; creditLimit: string
  sourceType: 'checkout' | 'order'; sourceId: string
}

type CreditAccountHoldPayload = {   // credit_account.put_on_hold | .released_from_hold
  tenantId: string; organizationId: string
  creditAccountId: string; customerId: string; currencyCode: string
}

type ApprovalEventPayload = {   // approval.requested | .approved | .rejected | .expired | .withdrawn
  tenantId: string; organizationId: string
  approvalId: string; customerId: string
  subjectType: 'cart' | 'quote'; subjectId: string
  amountGross: string; currencyCode: string
  approvalPolicy: 'buyer' | 'merchant' | 'both'
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'withdrawn'
  buyerDecision: 'pending' | 'approved' | 'rejected' | 'not_required'
  merchantDecision: 'pending' | 'approved' | 'rejected' | 'not_required'
  requestedBy: { actorType: 'customer_user' | 'staff_user'; actorId: string }
  decidedBy?: { actorType: 'customer_user' | 'staff_user' | 'system'; actorId: string | null }
  withdrawnReason?: 'requester' | 'cart_merged' | 'cart_expired' | 'cart_purged'
}
```

`approval.*` events are declared with `portalBroadcast: true` (D-R5-6), so a portal client of the approval's company can follow them, and are available to webhooks. `cart` and `checkout` subscribe to them persistently and idempotently to resume or clear their subject (cart §11, checkout §8.2); `customer_groups` imports neither (§4.2).

### 10.2 Notifications and e-mail (added 2026-10-26)

`customer_groups` is the only module that notifies about approvals (D-R5-32). `cart.approval.requested` and `checkout.session.approval_*` are state signals with no notification.

**In-app notification types** (declared in `customer_groups/notifications.ts`, i18n under `customer_groups.notifications.*`; staff recipients only, since in-app notifications reach `recipient_user_id`):

| Type id | Trigger | Recipients |
|---|---|---|
| `customer_groups.credit.limit_exceeded` | `credit.limit_exceeded` | The company's `account_manager` (`customers.CustomerEntityRole`); without one, staff holding `customer_groups.credit.manage` in the organization |
| `customer_groups.approval.requested` | `approval.requested` with policy `merchant` or `both` | Staff holding `customer_groups.approvals.decide` in the organization |

**E-mail to buyer-side users** through the shared `sendEmail` pipeline, with templates and i18n in this module:

| Trigger | Recipients |
|---|---|
| `approval.requested` with policy `buyer` or `both` | Every `CustomerUser` of the approval's company holding `customer_groups.portal.approvals.decide`, except the requester |
| `approval.approved`, `.rejected`, `.expired` | The requester, when a `customer_user` |

E-mail is on by default and can be switched off per tenant through `ModuleConfigService` (key `customer_groups.approval_emails_enabled`), for integrators who notify through their own storefront (D-R5-6). Every eligible decider is notified; the first decision closes the slot (§6.6). A notification for a staff requester (`approval.decided`) is not declared in Release 5, because no Release 5 path creates a staff-requested approval (X7).

A blocked B2B checkout that nobody is told about becomes a support ticket; that is why `limit_exceeded` notifies.

---

## 11) Background Jobs

| Job | Cadence | Purpose |
|---|---|---|
| `expire-memberships` | hourly | Emit `.expired` for memberships whose `valid_until` has passed; invalidate caches |
| `expire-approvals` | hourly | Transition `pending` approvals past `expires_at` to `expired` with the §6.6 conditional update (`status = 'pending' AND expires_at <= now()`), per tenant in batches. Emits `customer_groups.approval.expired` once per row actually updated; a row a concurrent decision won is skipped silently. Safe to re-run |
| `credit-exposure-audit` | daily, or on demand | Queue worker (`packages/queue/AGENTS.md`), one job per tenant, idempotent. Recomputes `SUM(amount)` per account and compares it with the latest `balance_after`. Meaningful because §6.3 writes `balance_after` under the row lock. Drift means a bug, so each drifting account is logged and passed to `reportError`, and the job result lists them. Triggered from the credit list it runs as a `ProgressJob` |

**Subscriber** (persistent, idempotent): `sales.order.cancelled` → `customer_groups` finds the reservation with `linked_order_id = orderId` in the event's tenant and organization and calls `releaseCredit` with its key (D-R5-2). An order without a linked reservation is ignored. A replayed event is a no-op by rule 4 of §6.5.

---

## 12) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Concurrent credit overshoot | **Critical** | `customer_groups`, `checkout` | Two purchase-on-account checkouts for the same company each read exposure 80k against a 100k limit, each reserves 30k, exposure lands at 140k. The tenant has extended 40k of unsecured credit it never approved. The same happens if the guard silently weakens when called inside checkout's transaction. | `PESSIMISTIC_WRITE` lock on the credit account row around re-sum and append, inside `withAtomicFlush(…, { transaction: true })`, which joins an outer transaction (§6.3, the Release 4 promotions mechanism). Credit resolves to the company in every channel (§6.5), so a person and their company cannot hold two parallel limits. Merge gate: N=20 parallel reservations against a limit admitting 3 reserve exactly 3, standalone **and** each inside an outer transaction | Low. Same-company on-account checkouts serialize for the length of one short transaction |
| R2 | Stale group membership in cache | **High** | `catalog`, `ecommerce` | A customer is removed from "Wholesale" at 14:00; a price cached at 13:59 keyed only on product+channel keeps serving the wholesale price for the rest of its TTL. Revenue loss, and the reverse case discloses contract pricing. | Buyer-context digest (ADR-7) includes the sorted group id set; `membership.added`/`.removed` invalidate by tag `customer:{id}`; membership expiry runs hourly and also invalidates | Medium — a membership expiring between hourly runs serves a stale group for up to an hour; acceptable for `valid_until`, which is operator-scheduled, and documented |
| R3 | Orphan ids silently change prices | **High** | `catalog`, `sales` | An operator creates a group and, coincidentally or by copying, its id collides with an invented one already in price rows. Rows that previously never matched suddenly apply. | Generated UUIDs make accidental collision negligible; the real vector is `--adopt`, which is explicit and reversible; reconciliation report runs before any group creation is recommended in the rollout note | Low |
| R4 | Priority uniqueness blocks bulk import | Medium | `customer_groups` | Unique `(tenant_id, priority)` makes importing a group list fail on the first collision, mid-import. | Import assigns priorities in gaps of 10 and renumbers on conflict; the admin list supports drag-reorder which rewrites priorities in one transaction | Low |
| R5 | Terms inheritance is opaque | Medium | `customer_groups` | A buyer gets an unexpected payment term; support cannot tell which of four overlapping groups supplied it. | `ResolvedTerms.sourceGroupId` per field; admin "explain terms" panel on the customer detail page renders the resolution trace | Low |
| R6 | Deep group hierarchies degrade resolution | Low | `customer_groups` | Recursive ancestor walks on every price call. | Depth capped at 5; resolution result cached per `(customerId, date-bucket)` for 60s with tag `customer:{id}` | Low |
| R7 | `PricingContext` change breaks third-party modules | Medium | `catalog` | A third-party module constructs `PricingContext` with `customerGroupId` and stops matching after the change. | Field retained and normalized for ≥1 minor version with `@deprecated`; documented in `UPGRADE_NOTES.md`; per `BACKWARD_COMPATIBILITY.md` this is ADDITIVE plus deprecation | Low |
| R8 | Approval double-decision | High | `customer_groups`, `cart`, `checkout` | Two approvers of the same side open the request; both pass a header check made before either writes; one approves, one rejects, and the cart resumes on whichever event arrives last. Or the expiry job (no header) expires a request a decider just approved. | Every transition is a conditional update on `status = 'pending'` and on the caller's slot (§6.6); zero rows is `409 approval_not_pending`. Decide and expiry use disjoint `expires_at` conditions. The `updated_at` header stays as the UX layer for `surfaceRecordConflict` | Low |
| R9 | Exposure never decreases | High | `customer_groups`, operators | Release 5 has no automatic payment settlement. A customer pays every invoice and still reaches `limit_exceeded`; operators "fix" it with ad-hoc adjusts. | Hybrid settlement (D-R5-2, §6.5): automatic release on `sales.order.cancelled`; payments settled by an integration through `settleCredit` or by an operator through `/adjust`, stated plainly in the user docs; the ledger and the audit job make every movement visible | Medium. Without an integration, settlement is manual work. An account-level settle for an order that is later cancelled lowers exposure twice; integrations pass `reserveIdempotencyKey` when a payment belongs to an order, and the ledger shows the pair |
| R10 | Duplicate approvals for one purchase | Medium | `customer_groups`, `cart`, `checkout` | Cart and checkout each create an approval for the same purchase; one is approved, one rejected; the subject resumes on whichever arrives last. | The cart is the one subject (D-R5-3); checkout delegates to `cart.approval.request`; a partial unique index allows one pending request per subject and `requestApproval` returns the existing one; `Cart.approvalId` is authoritative | Low |
| R11 | No eligible decider | Medium | `customer_groups`, buyers | Policy `buyer`, and the requester is the company's only `portal_admin`: nobody can decide, since self-approval is refused. The request waits until it expires. | The request stays visible as pending in the portal and staff lists. The company grants the portal decide feature to another user, or the operator moves the group to `merchant` or `both` and the buyer withdraws and re-requests (the policy is snapshotted per request) | Medium, documented in the user docs |

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
- Reconciliation lists orphans and `--adopt` creates inactive placeholders
- Anonymous (`customerId: null`) resolves to the default group without error

**Phase 3 — credit.** Every test runs with a second-tenant fixture **and** a second company in the same organization, and asserts neither can read or move the other's account. API paths: `GET/POST …/credit-accounts`, `GET/PUT …/credit-accounts/:id`, `GET …/credit-accounts/missing`, `GET …/credit-accounts/:id/ledger`, `POST …/credit-accounts/:id/adjust`, each with a caller lacking the feature (`403`).
- `reserveCredit` under N=20 parallel calls against a limit admitting 3 reserves exactly 3
- The same N=20 test with each `reserveCredit` called inside an outer transaction (G1)
- Repeated key with identical inputs returns the original entry; with a different amount answers `409 idempotency_key_mismatch` (G12)
- A released key is not reusable: `reserved: false, released: true`
- `releaseCredit` twice writes one entry; release after a partial settle releases only the open amount; release after a full settle writes nothing
- `settleCredit` above the open amount answers `400 settle_exceeds_reservation`
- `linkCreditReservationToOrder` then `sales.order.cancelled` releases the open amount; a replayed event is a no-op
- `on_hold` refuses regardless of exposure; `no_account` with no account in the currency; `not_permitted` when terms forbid purchase on account
- A person + company `customerIds` input resolves to the company's account (G11)
- Decimal inputs with 4 dp round half-up to 2 dp; the audit then reports zero drift
- Exposure equals `SUM(amount)`; the daily audit reports zero drift
- A refused reserve emits `customer_groups.credit.limit_exceeded` and creates the in-app notification for the account manager
- `adjust` appends an entry with a required note; its undo appends the inverse entry and deletes nothing
- `POST …/credit-accounts` for an existing customer and currency answers `409 credit_account_exists`; `is_on_hold: true` without `hold_reason` answers `400`
- `PUT …/credit-accounts/:id` with a stale header answers the optimistic-lock `409`; a reservation in between does not cause one

**Phase 4 — approvals.** Same isolation fixtures, plus a second company's `CustomerUser` holding the portal decide feature. API paths: `GET …/approvals`, `POST …/approvals/:id/decide`, `GET /api/customer_groups/portal/approvals`, `GET …/portal/approvals/:id`, `POST …/portal/approvals/:id/decide`, `POST …/portal/approvals/:id/withdraw`, each without the feature (`403`) and, for portal routes, without a customer session (`401`). Requests are created through the cart's `request-approval` route, since there is no create route; the service-level cases below are first covered by unit tests against `customerPurchaseApprovalService`, and the API-level tests ship once the cart route exists (§14).
- `resolveTerms` with no group setting `terms_currency_code` returns the organization's base currency with `sources.termsCurrencyCode = 'base_currency'`; an organization without a base currency returns `null` (D-R5-37)
- `requestApproval` twice for the same cart returns one request (`created: false`), also under concurrency (G8)
- Policy `buyer`: a portal approver's approval approves; a merchant decide answers `409 approval_not_pending` (slot `not_required`)
- Policy `merchant`: the mirror case
- Policy `both`: buyer then merchant approve → `approved`; merchant first then buyer → `approved`; either rejects → `rejected`; simultaneous decisions from both sides end correctly
- Double decide on the same slot: one wins, the other gets `409 approval_not_pending` (G6)
- Decide versus expiry at the boundary instant: exactly one transition lands
- Self-approval refused with `403 approval_self_decision_forbidden` (G24)
- A portal approver of another company gets `404` on read, decide and withdraw (D-R5-1, G5)
- A `buyer` without the decide feature sees only own requests; withdraw by a non-requester answers `403 approval_withdraw_forbidden`
- A policy change on the group after the request does not change the pending request's slots
- Default expiry is 14 days; the tenant setting overrides it (D-R5-27)
- `expire-approvals` emits `.expired` once per row and skips a row a decision won
- `approval.requested` creates the in-app notification for merchant deciders (policy `merchant`/`both`) and sends the e-mail to buyer deciders (policy `buyer`/`both`); with the tenant e-mail switch off, no e-mail is sent
- Every `approval.*` payload carries `tenantId` and `organizationId`

**UI paths:** group list with drag-reorder, group edit with terms (including the default-group threshold warning), membership assignment from the customer detail page, credit panel with account edit and optimistic-lock conflict, ledger view, adjust dialog, the "no credit account" banner, staff approval list and decision with conflict, orphan banner.

---

## 14) Implementation Phases

### Phase 1 — Groups and membership
Entities `CustomerGroup`, `CustomerGroupMembership`; `resolveGroups`; admin CRUD; group picker replacing the UUID input in `catalog` (the `sales` tax-rate form follows §7.2); reconciliation CLI and banner.

**Gate:** a price row authored against a real group resolves for a member and not for a non-member; orphan report is accurate.

### Phase 2 — Commercial terms
`CustomerGroupTerms`; `resolveTerms` with per-field inheritance and `sourceGroupId`; explain-terms admin panel; `catalog` and `sales` consume group id **sets**.

**Gate:** terms resolve correctly across a 3-level hierarchy; the deprecated single-value path is behaviourally identical.

### Phase 3 — Credit
Steps, in order:
1. **Lock path first.** `CustomerCreditAccount`, `CustomerCreditLedgerEntry` and `customerCreditService.reserveCredit` with the §6.3 row lock, with the N=20 test and the nested-transaction test, as its own reviewable step before any route.
2. The rest of `customerCreditService` (`checkCredit`, `releaseCredit`, `settleCredit`, `linkCreditReservationToOrder`) with the §6.5 idempotency rules and identity resolution; the `sales.order.cancelled` subscriber.
3. Staff routes, the `adjust` command with undo, `encryption.ts`, ACL features and grants, `notifications.ts` with `credit.limit_exceeded`, events with §10.1 payloads.
4. Admin credit panel, ledger, adjust dialog, "no credit account" banner; `credit-exposure-audit` worker.

**Gate:** the N=20 test passes standalone and inside an outer transaction; every §6.5 idempotency rule is tested; a cancelled order releases its open reservation; the audit reports zero drift; tenant and company isolation hold on every route.

### Phase 4 — Approvals
`CustomerPurchaseApproval` with the two-slot model; the four new `CustomerGroupTerms` columns and their `ResolvedTerms` fields; `customerPurchaseApprovalService` with the §6.6 conditional transitions; staff and portal routes; portal features and grants; `approval.*` events with `portalBroadcast`; in-app notification for merchant deciders and e-mail for buyer deciders with the tenant switch; `expire-approvals` with the conditional update; terms-form fields and the default-group warning. Lands before the cart approval gate (cart Phase 4), which calls it.

**Gate:** service tests cover every §6.6 transition, the three policies, the double decision, the decide/expiry boundary and self-approval; portal routes refuse another company. Once the cart approval gate lands, the §13 API tests pass end to end: an over-threshold cart cannot lock until its request is approved.

### Phase 5 — Per-customer assortment overrides
`CustomerAssortmentOverride` (§5.7) and its `data/extensions.ts` link; `resolveAssortmentScope` extended per §6.4 to union the grant and intersect the restriction, returning `sourceCustomerOverrideId`; the override's CRUD events and their invalidation duty (§10); the injected "Assortment" section on the customer detail page. Tracked as Phase 4 of the visibility spec, which owns the algebra, the cache rule and the tests.

**Gate:** a grant-only override widens without losing any group grant; a restriction cuts a product a group granted; an absent grant does not unrestrict the buyer; a buyer with no override row resolves byte-identically to the group-only result.

**Release status (2026-10-05).** Phases 1 and 2 shipped in #6709 (squashed into `2338e5ea96`), except Phase 2's `CustomerGroupTerms.assortment_scope` column (§5.3 status note), which ships with the storefront release along with the additive `customerIds` input (§6.0). Phases 3, 4 and 5 are not started.

**Release 5 (2026-10-26).** Phases 3 and 4 are in eComm Release 5 (fork PR #16, `feat/release-5-conversion`): Phase 3 in wave 1, Phase 4 in wave 2, ahead of the cart approval gate and checkout B.4/B.5 (`ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md`, final implementation order). Phase 5 is not in Release 5.

Phases 1 and 2 unblock the rest of the ecommerce suite. Phase 3 is required by checkout (spec 7); Phase 4 by the cart's approval gate and checkout B.5. Both may land in parallel with specs 3–5. Phase 5 depends only on Phase 2 and is deliberately sequenced after the visibility spec's own Phase 3 (the cart write-side enforcement), so a merchandising convenience does not ship ahead of that spec's Critical fix.

---

## 15) Open Questions

1. **Rule-driven membership** — `source: 'rule'` is in the model but no rule engine is specified. Automatic assignment ("all customers with >100k lifetime revenue join Wholesale") is a natural fit for `business_rules`. *Deferred; the enum value reserves the space.*
2. **Per-organization vs. per-tenant groups** — groups are tenant-scoped here, consistent with `CatalogPriceKind`, which allows a null `organization_id`. Whether an organization can define private groups is unresolved. *Assumed no for v1.*
3. **Credit currency** — one account per currency. A customer trading in PLN and EUR has two independent limits with no aggregate cap. *Deferred: a cross-currency aggregate cap would need FX and stays out of Release 5.*
4. **Per-approver authority limits and approval chains** — "approves up to X", or a second approver above a higher amount (G24). Release 5 has one decision per side, with no amount limit per approver. *Deferred to a follow-up spec.*

**Closed on 2026-10-26** (`ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md`): who approves (D-R5-1, per-group `approval_policy`); settlement trigger (D-R5-2, hybrid); line-level re-approval (D-R5-3, amount only, cart as subject); threshold currency (D-R5-4, `terms_currency_code`); account provisioning (D-R5-5, operator only); buyer-side notification channel (D-R5-6, e-mail with a tenant switch); `employee` grants (D-R5-7); guest carts over a threshold (D-R5-12); quote requests (D-R5-20, D-R5-23); credit and approval identity (D-R5-22); reserved amount (D-R5-24); approval expiry (D-R5-27); PO number (D-R5-28); channel exemption (D-R5-29, none).

---

## 16) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | `customer_id` and `price_kind_id` are FK ids; no `@ManyToOne` crosses a module boundary |
| Tenant/organization scoping | Every entity scoped; credit accounts, ledger entries and approvals carry a NOT NULL `organization_id`; every credit and approval service input carries `scope: { tenantId, organizationId }`; every test asserts isolation against a second tenant, and Phases 3–4 tests also against a second company (§13) |
| Zod validation in `data/validators.ts` | All routes; types via `z.infer` |
| No `any` | Service contract fully typed |
| Optimistic locking | Platform-standard `updated_at` mechanism (§5.4, §5.6) — no `version` counter. `CustomerCreditAccount` uses `CrudForm`'s auto-derived header and returns `updatedAt`; reservations do not bump it. `CustomerCreditLedgerEntry` is append-only and exempt (it is not added to the editable-entities test list). `CustomerPurchaseApproval` decide routes use `enforceCommandOptimisticLock` as the UX layer, and the §6.6 conditional update as the guard |
| Concurrency strategy | §6.3 — `PESSIMISTIC_WRITE` row lock on the credit account inside `withAtomicFlush(…, { transaction: true })`, joining checkout's transaction; the Release 4 promotions mechanism (D-R4-12). No `SERIALIZABLE`, no retry helper. Approvals: compare-and-set on `status = 'pending'` (§6.6) |
| Commands and undo | `adjust` is an undoable command whose undo appends the inverse entry; reserve, release, settle and the order link are audited, non-undoable service operations; decisions are not undoable (§6.5, §6.6) |
| Portal RBAC | Portal routes use `requireCustomerAuth` + `requireCustomerFeatures`; portal features granted through `defaultCustomerRoleFeatures` (§9.1) |
| Notifications | Types declared in `notifications.ts`, i18n under `customer_groups.notifications.*`; e-mail through `sendEmail` with a per-tenant switch (§10.2) |
| Cross-module coupling | §7.3 — admin group picker ships as a `crud-form:<entityId>:fields` widget injected by `customer_groups`; `catalog`/`sales` gain no new `requires` entry |
| Encryption | Free-text columns that can hold personal data are declared in `customer_groups/encryption.ts` and read through `findWithDecryption`: `CustomerCreditAccount.hold_reason`, `CustomerCreditLedgerEntry.note`, `CustomerPurchaseApproval.buyer_decision_note` and `merchant_decision_note` (G22). Monetary columns are commercially sensitive but not personal data and stay unencrypted, consistent with precedent (`sales`/`payment_gateways` encrypt blob/secret columns, not scalar monetary columns). Event payloads carry no notes or names (§10.1) |
| Backward compatibility | `PricingContext.customerGroupId` deprecated, not removed; no FK constraint added; documented in `UPGRADE_NOTES.md`. Phases 3–4: new DI keys instead of growing `CustomerGroupsService`, frozen event and notification ids, ACL sync steps (§8.4) |
| i18n | No hard-coded user-facing strings; `en.json` and `pl.json` |
| Migrations | `yarn db:generate` per entity batch, snapshot reviewed |
| Integration coverage | §13, shipping in the same change |

---

## 17) User Story Map (Prototype Input)

Added 2026-08-31 to support the `om-mockup-prototype` backend click-through. Derived from §13's UI-path list and the data models/API contracts in §5–§9; no new scope. Roles are backoffice unless noted.

### Epic A — Group Management
Operator authors the commercial-group catalog and its precedence.

- **US-A1** — As a commerce operator, I want to create and edit customer groups with a priority and optional parent, so that I can express overlapping B2B tiers (e.g. "Wholesale", "Q3 Promo Tier") with unambiguous precedence.
  - AC: empty state (no groups yet) shows a "Create your first group" CTA, not a bare empty table.
  - AC: create/edit form validates unique `code` and unique `priority` within the tenant inline, before submit.
  - AC: the list supports drag-reorder; dropping a row rewrites affected `priority` values in one transaction (per R4) and the change is visible immediately, no page reload.
  - AC: `parent_id` picker excludes the group itself and any descendant (cycle prevention) and warns when depth would exceed 5.
  - AC: `is_default` is a toggle; enabling it on one group and attempting to enable it on a second shows an inline conflict ("X is currently default — enabling this will replace it") rather than a silent double-default.
  - AC: deleting a group with active memberships or terms shows a confirm dialog naming the dependent counts (per platform optimistic-lock delete pattern); Escape cancels, Cmd/Ctrl+Enter confirms.
  - AC: `is_active = false` groups remain visible in the list (filterable), never disappear, since history depends on them.

- **US-A2** — As an operator, I want an orphan-reference banner on the groups list and a reconciliation report, so that price rows or tax rates pointing at unmodeled UUIDs are visible instead of silently inert (§8.2, R3).
  - AC: banner shows only while `GET /api/customer_groups/customer-groups/reconcile` reports orphans > 0, with the count.
  - AC: report screen lists each orphan UUID, its affected-row count, and a sample of referencing rows (catalog price / tax rate) with a link to each.
  - AC: report empty state ("No orphaned references") replaces the banner-triggering table when the count is zero.
  - AC: "Adopt" action requires a confirm naming how many placeholder groups will be created, since it is a real write (`is_active: false`, `code: orphan-<short-uuid>`); result list is highlighted so the operator can rename/activate them next.

### Epic B — Group Membership
Operator manages which customers belong to which groups and for how long.

- **US-B1** — As an operator, I want to assign a customer to a group with an optional validity window from the customer detail page, so that time-bounded commercial relationships (a seasonal contract, a trial tier) are explicit and expire on their own.
  - AC: assignment form defaults `valid_from` to now and `valid_until` to empty (= indefinite); both are optional per §5.2.
  - AC: assigning the same customer to a group they already (currently or historically, non-deleted) belong to is blocked with an inline "already a member of this group" error — the unique constraint is surfaced before submit, not as a raw 500/409.
  - AC: assigning to a *different* group while already a member of another is allowed with no warning (overlapping membership is expected, §2.3).
  - AC: the membership list on the customer detail page shows current, upcoming (`valid_from` in the future), and expired memberships with distinct status pills; expired rows are read-only.
  - AC: removing a membership is a soft delete behind a confirm dialog (Escape cancel, Cmd/Ctrl+Enter confirm).

### Epic C — Commercial Terms
Operator sets, and support explains, the per-group buying terms.

- **US-C1** — As an operator, I want to edit a group's commercial terms (price kind, payment terms, credit default, approval threshold, min order, terms currency, approval policy, quote requests, PO number, assortment scope), so that a B2B buyer in that group automatically gets the right pricing, payment, and approval behavior at checkout.
  - AC: a group with no terms row yet shows an explicit "No terms set — inheriting from parent / tenant defaults" empty state, not a form pre-filled with blanks that look like explicit zeros.
  - AC: `price_kind_id` is a picker sourced from `catalog` price kinds, not a free-text id (contrast with the *rule*-side `customerGroupId` columns this spec explicitly leaves as free text — §7.3 note applies only there).
  - AC: numeric fields (`default_credit_limit`, `approval_required_above`, `min_order_value`) reject negative input inline.
  - AC: saving over a stale version shows the platform conflict bar (`surfaceRecordConflict`) with the concurrent editor's change summarized, per the optimistic-locking rule in root `AGENTS.md`.
  - AC: `approval_policy`, `allow_quote_requests`, `requires_po_number` and `terms_currency_code` offer Inherit / explicit value, like `allow_purchase_on_account`; Inherit shows the inherited value and its source.
  - AC: when `approval_required_above` is set on the tenant's default group, an inline warning states that guest carts above that amount, pay-link carts included, are refused at checkout (D-R5-12, D-R5-29).
  - AC: when a threshold or minimum order value resolves without a terms currency, an inline warning states that every cart will require approval and no minimum will be checked (D-R5-4).
  - AC: `assortment_scope` uses the same category/tag/exclude picker pattern as the channel-binding scope elsewhere in the app — do not invent a new picker.

- **US-C2** — As a support agent, I want an "explain terms" panel on the customer detail page, so that when a buyer asks "why do I have net-30 instead of net-60" I can answer without guessing across four overlapping groups (R5).
  - AC: each resolved scalar field (`priceKindId`, `paymentTermsDays`, `allowPurchaseOnAccount`, `approvalRequiredAbove`, `minOrderValue`, `termsCurrencyCode`, `approvalPolicy`, `allowQuoteRequests`, `requiresPoNumber`) shows its value and the group it came from (`sourceGroupId`).
  - AC: assortment scope is shown in its own row, sourced from `resolveAssortmentScope()` rather than `resolveTerms()` (§6.4), and names **every** contributing group (`sourceGroupIds`, plural) — it is a union across groups, not a single highest-priority winner, so a single-source label would misrepresent it.
  - AC: when the customer carries an override (§5.7), that row also names it (`sourceCustomerOverrideId`) **alongside** the contributing groups, split into its widening and narrowing halves — naming only the group union would attribute a customer-specific rule to groups that did not make it, which is the wrong answer to the question this panel exists to answer.
  - AC: a field with `sourceGroupId: null` is labeled "tenant default", not left blank.
  - AC: the trace is a visible ancestor path (child → parent → tenant), not a tooltip that must be discovered.

- **US-C3** — As an operator, I want to widen *or* narrow one named customer's assortment independently of their groups, so that I can give a single account early access to a collection, or hold it to its contracted assortment, without creating a group of one (§5.7, added 2026-09-16).
  - AC: the customer detail page carries an "Assortment" section injected by this module (§5.7, §7.3), with two blocks labelled by **direction** — "Also allow" (`grant_scope`) and "Restrict to / exclude" (`restrict_scope`) — plus the validity window and `notes`.
  - AC: empty state — a customer with no override row shows both blocks empty and a line stating their assortment comes entirely from their groups; saving both blocks empty writes **no row**, rather than an empty one.
  - AC: "Also allow" can only add: everything the customer's groups grant survives, since the grant joins the union as one more branch (§6.4).
  - AC: "Restrict to / exclude" narrows across **every** group grant, not only the products this override itself added — the direction no group-level scope can express; the screen states the consequence before saving.
  - AC: setting both blocks to the same scope yields "this customer sees only this"; the resulting "replacement" label is **derived from the two values and read-only**, because §6.4 deliberately has no `mode` column for it to disagree with.
  - AC: the validity window uses the same semantics as a membership (§5.2) — `valid_from` null = always, `valid_until` null = indefinite.
  - AC: permission — gated behind the same feature that gates group-terms editing (US-C1); a viewer without it sees the section **read-only rather than hidden**, so a bespoke account stays recognisable as one.
  - AC: the pickers are the same category/tag/exclude widget US-C1 and the channel-binding scope already use — do not invent a third.

### Epic D — Group Picker in Catalog & Sales
Operator references a group from a price row or tax rate without inventing a UUID.

- **US-D1** — As an operator editing a catalog price row, I want to pick a customer group by name instead of pasting a UUID, so that I can't typo a group reference into permanent silence (§2.1); the sales tax-rate form gets the same picker once issue #6414 gives it an `entityId` (§7.2).
  - AC: the picker is searchable by code/name, shows `priority` inline so precedence is visible while authoring.
  - AC: a price row or tax rate whose stored `customer_group_id` matches no group renders an explicit `Unknown group (<uuid>)` error chip in place of the picker's normal selected-value display — never hidden (§7.3).
  - AC: the picker is one injected widget per §7.3; it renders in `catalog.catalog_product_price` now and identically in `sales.sales_tax_rate` once that form has an `entityId` (issue #6414, §7.2).

### Epic E — Credit Accounts & Ledger
Finance operator manages purchase-on-account exposure.

- **US-E1** — As a finance operator, I want to view a customer's credit account and its ledger, so that I see current exposure as a computed fact rather than trusting a counter that could have drifted (§4.3, R1).
  - AC: exposure is displayed as `SUM(amount)` over ledger entries — the screen never shows `balance_after` as the primary number, only as a per-row audit annotation.
  - AC: editing `credit_limit` is optimistic-lock protected; a stale save shows the conflict bar rather than silently overwriting a concurrent change.
  - AC: toggling `is_on_hold` requires a `hold_reason` before it can be saved; once on hold, the account's status badge reflects it regardless of computed exposure.
  - AC: the ledger table is read-only and append-only — there is no row-level edit or delete action, matching §5.5's "no update or delete route."
  - AC: "Adjust" opens a dialog that appends a new `adjust` entry with a signed amount and a required note; it is visually distinct from `reserve`/`release`/`settle` entries (which the UI never creates directly — reservations and releases come from checkout and from order cancellation, settlements from an integration).
  - AC: the account sits on the company's detail page for a B2B buyer (credit belongs to the company, §6.5); a person page without its own account links to its company's.
  - AC: the panel states that payments are not settled automatically without an integration, and that an operator records a payment through "Adjust" (D-R5-2).
  - AC: `available < 0` (limit lowered below exposure) is shown explicitly, with the account refusing new on-account orders.
  - AC: a release entry shows the order it belongs to (`linked_order_id` of its reservation).

- **US-E2** — As a finance operator, I want a banner listing customers allowed to buy on account who have no credit account, so that a B2B buyer is not refused at checkout only because nobody opened their account (D-R5-5).
  - AC: the banner shows only while `GET /api/customer_groups/customer-groups/credit-accounts/missing` reports a count > 0, with the count.
  - AC: each listed customer has a "Create account" action whose form is pre-filled from the group's `default_credit_limit` and `credit_currency_code`.
  - AC: an empty state ("Every customer allowed on account has an account") replaces the list when the count is zero.

### Epic F — Purchase Approvals
Approver/account manager reviews over-threshold purchase requests.

- **US-F1** — As a merchant-side approver (staff), I want to see purchase approval requests and decide the merchant side, so that an over-threshold B2B order doesn't proceed without the sign-off the group's `approval_required_above` and `approval_policy` terms require.
  - AC: the pending list shows customer, requester, subject type, snapshot amount and currency, the policy, both slots' state, and time remaining until `expires_at`.
  - AC: the decide action appears only when the merchant slot is `pending`; with policy `buyer` the row is read-only and says that the buyer's company decides.
  - AC: deciding opens a dialog with Approve/Reject and an optional note; Cmd/Ctrl+Enter submits, Escape cancels.
  - AC: deciding after someone else already decided surfaces the conflict bar naming who decided and when, rather than silently double-deciding (R8); the server refuses with `409 approval_not_pending` even when the client sent no header.
  - AC: with policy `both`, a row where the buyer side already approved says so, and the merchant approval completes the request.
  - AC: an approval past `expires_at` renders as a read-only "Expired" row with no decide action available.

- **US-F2** — As a buyer-side approver at a customer company, I want to list and decide my company's purchase requests through the portal API, so that my team's orders over the threshold wait for my sign-off even though the merchant has no storefront of its own (D-R5-1, G5). API-only in Release 5; a storefront renders it.
  - AC: `GET /api/customer_groups/portal/approvals` lists the company's requests, pending first; a buyer without the decide feature sees only their own.
  - AC: the decide route decides the buyer slot only; deciding one's own request answers `403 approval_self_decision_forbidden`.
  - AC: a request of another company answers `404`, never `403`.
  - AC: the requester can withdraw a pending request; nobody else can.
  - AC: buyer-side approvers receive an e-mail when a request needs them, and the requester when it is decided or expires, unless the tenant switched e-mail off (D-R5-6).

The buyer's own story for a refused on-account order is checkout's **US-B3**. Since D-R5-20 it reads: the buyer over the limit is offered prepayment or, where `allow_quote_requests` allows it, `request_quote`.

### Cross-cutting rules (apply to every screen above)

- Every dialog: Cmd/Ctrl+Enter submits, Escape cancels (root `AGENTS.md`).
- Every list: `pageSize` ≤ 100, an explicit empty state, and an explicit no-access state distinct from empty.
- The optimistic-lock conflict bar is the same visual pattern across Group Terms, Credit Account, and Approval Decide — one component, three call sites.
- No hardcoded status colors; group `kind` (`b2c | b2b | internal | partner`), membership status, approval status, and credit-hold status all use DS status tokens.
- The group picker (Epic D) is one widget, rendered in the catalog price form now and in the sales tax-rate form once issue #6414 lands (§7.2) — do not draw it twice as different components.

---

## 18) Changelog

### 2026-10-26 (Release 5 spec revision)
Phases 3 (Credit) and 4 (Approvals) rewritten for eComm Release 5 from `ANALYSIS-2026-10-26-customer-groups-release-5.md`, the owner decisions in `ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` and the cross-spec review `ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md`.
- **§5.3** — four new nullable, inherited terms: `terms_currency_code` (D-R5-4), `approval_policy` (D-R5-1), `allow_quote_requests` (D-R5-20), `requires_po_number` (D-R5-28). `default_credit_limit` only pre-fills (D-R5-5); thresholds use the cart's goods-gross basis.
- **D-R5-37 (owner, after the revision review).** `terms_currency_code` resolved through the chain falls back to the organization's base currency (`sources.termsCurrencyCode = 'base_currency'`); `null` remains only for an organization without a base currency.
- **§5.4** — `organization_id` NOT NULL, account belongs to the company (G11, D-R5-22), operator-only provisioning and banner (D-R5-5), `hold_reason` required and encrypted.
- **§5.5** — `related_entry_id`, write-once `linked_order_id` (C6), `created_by_actor_type`, key unique per `(tenant_id, idempotency_key)` (G2), open amount, 2-dp decimal money (G14).
- **§5.6** — two decision slots with actor-typed columns, policy snapshot, `subject_type: cart | quote` with `checkout_session` removed and `quote` reserved (D-R5-1, D-R5-3, D-R5-23), 14-day default expiry (D-R5-27), one pending request per subject (G8), compare-and-set as the guard (G6). `CustomerEntityRole` / `purchase_approver` is no longer the approver model (G4).
- **§6** — `customerCreditService` and `customerPurchaseApprovalService` as separate DI keys with their own interfaces; `CustomerGroupsService` unchanged (G26). Scoped inputs (G2), decimal strings (G14), `reserveCredit` amount is the caller's full payable total (D-R5-24), `linkCreditReservationToOrder` (C6), approval contract (G3). `ResolvedTerms` gains the four new fields.
- **§6.3** — the `SERIALIZABLE` + retry-helper strategy is replaced by a `PESSIMISTIC_WRITE` row lock joining the caller's transaction (G1, G25).
- **§6.5 (new)** — identity rule (G11, D-R5-22), hybrid settlement (D-R5-2), idempotency rules (G12), commands and undo (G20).
- **§6.6 (new)** — approval lifecycle table with actor, guard and event per transition (G6, G24, D-R5-1, D-R5-3).
- **§7.3–§7.5** — terms-form warnings (D-R5-12, D-R5-29, D-R5-4), credit panel and banner; what cart and checkout rely on (D-R5-18, D-R5-20, D-R5-23, D-R5-32). §7.3's picker source path corrected (G17).
- **§8.4 (new)** — Phases 3–4 backward compatibility: DI keys, frozen events and notification ids, ACL sync commands (D-R5-7), behaviour change of stored thresholds.
- **§9** — real route prefix `/api/customer_groups/customer-groups/` on every row (G17), credit-account detail and `missing` routes, portal approval routes (G5), feature `dependsOn`, portal features and the grant plan (G16, D-R5-7). **§9.2 (new)** error-code catalogue.
- **§10** — `credit.adjusted` and `approval.withdrawn` added; payload types with `tenantId`/`organizationId` (G18, D-R5-32); `portalBroadcast` on approval events; notification type ids and e-mail with a per-tenant switch (G15, D-R5-6).
- **§11** — `expire-approvals` uses compare-and-set; `credit-exposure-audit` defined as a queue worker (G21); `sales.order.cancelled` subscriber (D-R5-2).
- **§12** — R1 and R8 rewritten for the row lock and compare-and-set; new R9 (settlement), R10 (duplicate approvals), R11 (no eligible decider).
- **§13** — coverage for every new staff and portal route and the G23 cases, with tenant and company isolation fixtures.
- **§14** — Phase 3 starts with the lock path and its N=20 and nested-transaction tests; Phase 4 gate; Release 5 status.
- **§15** — decisions recorded as closed; per-approver limits and the cross-currency cap stay deferred.
- **§16** — concurrency, encryption (G22), optimistic locking (G19), commands/undo, portal RBAC and notification rows revised.
- **§17** — US-C1 and US-C2 cover the new terms and the default-group warning; US-E1 revised; new US-E2 (banner) and US-F2 (portal approver); US-F1 covers the two slots; US-B3 (checkout) wording per D-R5-20.
- **TLDR, §3, §4.3** — aligned with the above.

### 2026-10-12 (sales tax resolution pointer)
- **§7.2 names where the rest of tax-rate matching is specified.** Which `SalesTaxRate` row applies by address, date and the row's other columns (channel, priority, compound, validity) is specified by the `sales-tax-rates` provider of the tax-providers roadmap (`2026-10-03-tax-providers-roadmap.md`, in review as #6918; its Spec 2, still to be written) and applies once the organization selects that provider; this spec's set-membership substitution and group precedence (§3.2) stay its rules; `resolveGroups` is that provider's input; the group picker of §7.3 is not shipped for the tax-rate form (its injection spot cannot resolve while `TaxRatesSettings` renders its `CrudForm` without an `entityId`); wiring it is tracked as issue #6414 and coordinated with that provider's admin UI. The TLDR, §7.3, §14 Phase 1 and §17 say the same.

### 2026-10-08 (terms price kind picker, #7077)
- §10: new read-only `GET /api/customer_groups/customer-groups/price-kinds` (`customer_groups.terms.view`) lists the tenant's catalog price kinds as `{ id, code, title }` (`search`, `ids`, `pageSize` ≤ 100; empty when `catalog` is absent). The terms price kind picker and the explain-terms panel read it instead of `/api/catalog/price-kinds`, which requires `catalog.settings.manage` — without that feature the picker was empty and its 403 flash replaced the "terms saved" message.

### 2026-10-05 (storefront release decisions)
- §6 / new §6.0: service inputs show the shipped `tenantId`, and gain an additive `customerIds: string[]` (person first, then company) for `resolveGroups`, `resolveTerms` and `resolveAssortmentScope`. Groups are the union of every id's memberships, ordered by priority, then person before company, then newest. This applies owner decision D3/D3a; the suite-wide shape is in roadmap ADR-7 and SPEC-029 v4.6. Recorded that shipped `ResolvedTerms` uses a per-field `sources` map instead of a single `sourceGroupId`.
- §5.3: recorded that #6709 did not ship `assortment_scope`, that `resolveAssortmentScope()` is a stub returning `null` (its "Phase 5 scope" comment is wrong), and that the column ships with the storefront release (D13).
- §10: listed the event IDs actually shipped. `membership.expired` is declared but never emitted, and `terms.updated`/`group.*` carry no `customerId`, which per-buyer caches must handle with a per-group tag plus a TTL.
- §14: release status.

### 2026-09-30 (review fixes on PR #6709)
- §9: group create returns `{ id, isDefault }` and never fails after commit when the default promotion loses a race.
- §10: new `customer_groups.terms.updated` event, emitted on terms writes together with the group's cache-tag invalidation. Full command/undo support for terms remains tracked in #6728.

### 2026-09-29 (nullable `allow_purchase_on_account`)
- §5.3: `allow_purchase_on_account` is now nullable. `null` means "not set on this group": the value is inherited from the parent chain, falling back to the tenant default `false`. Before, a terms row always carried an explicit `true`/`false`, so saving a child group's terms to change any other field silently switched off purchase-on-account inherited from its parent. The admin form offers Inherit / Allow / Do not allow. Migration `Migration20260929083000_customer_groups` drops the column's `NOT NULL` and default, keeping stored values.

### 2026-09-16 (per-customer assortment overrides)

- **§17** — added **US-C3** for the new entity, and extended US-C2's assortment-scope acceptance criterion so the explain-terms panel names the customer's own override beside the contributing groups. Without it the story map described a panel that would attribute a customer-specific rule to the groups, which is the one answer that panel must not give.

Applied from [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §3.6, where the user raised per-customer visibility as a requirement in both directions and the algebra, cache rule and storage decisions were taken.

- **New entity §5.7 `CustomerAssortmentOverride`** — one optional, sparse row per customer with `grant_scope` (widens) and `restrict_scope` (narrows), a validity window and a notes field. Declared as an **entity extension** of `customers:customer_entity` in `customer_groups/data/extensions.ts` per root `AGENTS.md`, not as columns on the customer entity.
- **§6 / §6.4** — `resolveAssortmentScope()` resolves the override in the same call and returns `sourceCustomerOverrideId`; the grant joins the union as one more branch, the restriction is intersected over every branch. No new operator, and no change to any consumer: the method already returned a finished `EffectiveAssortmentScope`.
- **§10** — new `customer_groups.assortment_override.*` events with an explicit invalidation duty (buyer context, the override-existence probe, `assortmentScopeHash`-keyed entries) and a stated obligation on `cart`'s trigger-2 re-visibility pass, so an override lapsing cannot reach checkout unchecked.
- **§14** — new Phase 5, sequenced after the visibility spec's cart-enforcement phase.

### 2026-09-06 (sibling amendments applied)

Applied the amendments [Buyer-Scoped Catalog Visibility](./2026-08-21-buyer-scoped-catalog-visibility.md) §0 records against this document, rather than leaving them pending in a sibling file — both documents ship together, so a deferred amendment would have left an implementer building from §6 alone shipping a field a neighbouring spec calls withdrawn.

- **`ResolvedTerms.assortmentScope` withdrawn** (§6), replaced by `resolveAssortmentScope()` returning an `EffectiveAssortmentScope` plus `sourceGroupIds`. Added §6.4 stating why a visibility grant cannot follow §6.1's highest-priority-wins rule. Every other `ResolvedTerms` field is unchanged.
- **`CustomerGroupTerms.assortment_scope`** (§5.3) retyped to the shared `AssortmentScope` from `packages/shared/src/lib/catalog-visibility/`, gaining `excludeCategoryIds` / `excludeTagIds`. Additive jsonb keys inside an already-planned column — no migration change.
- §17 US-C2 updated: the explain-terms panel shows assortment scope in its own row naming every contributing group, not as a `sourceGroupId` scalar.

Also recorded the `PricingContext` ownership split with [Pricing Engine](./2026-08-21-pricing-engine.md) — see §7.1.

### 2026-08-31 (story map)
- Added §17 User Story Map to support the `om-mockup-prototype` backend click-through: 6 epics, 8 stories, UX acceptance criteria (empty/permission/error/optimistic-lock/keyboard/default-value states) derived from §13's UI-path list and §5–§9's data/API contracts. No scope change.

### 2026-08-17 (rev 2)
- Removed `CustomerGroupTerms.tax_display_mode`: found by the `/om-pre-implement-spec` audit on the sibling `SPEC-029-2026-02-17-ecommerce-storefront-module.md` (v4) to be an unreconciled second source of truth alongside `price_kind_id` — the only real gross/net computation path in this codebase (`catalog`'s `LineItemDialog.tsx`) always derives display mode from the price kind's own `displayMode`, never from an independent buyer-level field. Added §6.1a documenting the fix: gross/net is derived downstream by `ecommerce` from the resolved `priceKindId`, not carried in `ResolvedTerms`.

### 2026-08-17 (rev 1)
- Fixed three Critical gaps found by a `/om-pre-implement-spec` audit (see `ANALYSIS-2026-08-14-customer-groups-and-b2b-terms.md` in the upstream repo): removed the functionally-inert `version` optimistic-locking column from `CustomerCreditAccount` (§5.4) and `CustomerPurchaseApproval` (§5.6) in favor of this platform's actual `updated_at` + header-protocol mechanism; added §6.3 Concurrency Strategy specifying that the `SERIALIZABLE`-retry helper for `reserveCredit` has no reference implementation and must be built independently; resolved §7.3's admin-picker coupling direction as `crud-form:<entityId>:fields` widget injection, confirming `catalog`/`sales` gain no new `requires` entry.
- Updated R8 and §16 accordingly.

### 2026-08-14
- Initial specification.
- Grounded in a survey of `customer_group_id` consumers: `catalog/lib/pricing.ts` (lines 65–66 matching, 83–84 scoring), `catalog/api/prices/route.ts`, `catalog/commands/prices.ts`, `catalog/commands/variants.ts`, `catalog/ai-tools/prices-offers-pack.ts`, `catalog/data/entities.ts`, `sales/data/entities.ts` (`SalesTaxRate`) — none of which is backed by an owning table.
- Existing B2B surface reused rather than replaced: `CustomerCompanyProfile`, `CustomerCompanyBilling.payment_terms`, `CustomerEntityRole`, `CustomerPersonCompanyRole`.
