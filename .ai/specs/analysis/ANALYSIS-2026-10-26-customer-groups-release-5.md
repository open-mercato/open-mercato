# Pre-Implementation Analysis: Customer Groups & B2B Terms — Phases 3 (Credit) and 4 (Approvals), eComm Release 5

> **Spec**: `.ai/specs/2026-08-14-customer-groups-and-b2b-terms.md` (Status: Specification; Phases 1–2 shipped in #6709).
> **Scope of this analysis**: Phase 3 (Credit) and Phase 4 (Approvals) only. Phase 5 is out of scope.
> **Verified against**: branch `feat/release-5-conversion` @ `fc5f8d04ca` (Release 4 merged, #7592). Every claim about the code below cites the file it was read from.
> **Consumers checked**: cart Phase 4 (`2026-08-14-cart-module.md` rev 9) and checkout B.4/B.5 (`2026-03-19-checkout-simple-checkout.md` v2.1), the two callers this release adds.
> **Issue prefix**: G. Release scope and ordering: `ANALYSIS-2026-10-26-ecommerce-release-5-scope.md`.

## Executive Summary

The credit ledger design (append-only entries, exposure derived as `SUM(amount)`) is sound. The phase contracts are not ready to build against. Six Critical issues block implementation:

1. **Concurrency.** The §6.3 concurrency strategy (`SERIALIZABLE` + a new 40001 retry helper) does not work when called the way checkout calls it. Release 4 already replaced the same pattern with a row lock in promotions (G1).
2. **Scoping.** The credit methods carry no tenant or organization scope, and `releaseCredit` cannot identify its row (G2).
3. **Approval API.** Approvals have no service contract or create path, although both cart F4 and checkout B.5 must create them (G3).
4. **Approver identity.** The approver model contradicts the code: `CustomerEntityRole` holds one **staff** user per role per company, not `CustomerUser` approvers (G4).
5. **Buyer-side API.** No buyer-facing approval API exists, but the release sells API-only, without a storefront of its own (G5).
6. **Double decision.** The `updated_at` lock alone does not prevent a double decision (G6).

**Recommendation: needs spec updates first.** Seven of the fixes below are owner decisions (listed under Remediation). The rest can be written straight into the spec.

## Code baseline (what exists on the branch)

| Surface | State on branch | Source |
|---|---|---|
| Entities | `CustomerGroup`, `CustomerGroupMembership`, `CustomerGroupTerms` only. No credit or approval tables. | `customer_groups/data/entities.ts` |
| Service | `resolveGroups`, `resolveTerms`, `resolveAssortmentScope`; inputs carry an explicit `tenantId` and `customerIds?`. No credit or approval methods. | `customer_groups/services/customerGroupsService.ts:56-110` |
| DI | `customerGroupsService` (request-scoped `em`, `.singleton().proxy()` per request container) | `customer_groups/di.ts` |
| ACL | 6 features (`groups`, `memberships`, `terms` × view/manage). No `credit.*` / `approvals.*`. | `customer_groups/acl.ts` |
| Role grants | `admin: customer_groups.*`. `employee` gets an explicit view-only list. No `defaultCustomerRoleFeatures`. | `customer_groups/setup.ts` |
| Events | 7 shipped (`group.*`, `membership.*`, `terms.updated`). No `credit.*` / `approval.*`. | `customer_groups/events.ts` |
| Real route prefix | `/api/customer_groups/customer-groups/...` | `__integration__/TC-CGRP-0xx` (`GROUPS_PATH`) |
| Concurrency precedent | promotions `registerUsage` / `useCode`: `LockMode.PESSIMISTIC_WRITE` row lock, explicitly **replacing** SERIALIZABLE (D-R4-12) because `withAtomicFlush` joins an ambient transaction and ignores `isolationLevel`. cart: `pg_advisory_xact_lock` per cart. | `promotions/lib/promotion-usage-service.ts:16-22,180-190`; `promotions/lib/code-service.ts:375-414`; `cart/commands/lines.ts:943` |
| `withAtomicFlush` isolation | Joins an existing transaction without applying `isolationLevel`. Applied only when it opens the transaction itself. | `packages/shared/src/lib/commands/flush.ts:166-178` |
| Advisory lock helper | `withAdvisoryXactLock` exists (bounded wait, holder cap) | `packages/shared/src/lib/db/advisoryLock.ts` |
| `CustomerEntityRole` | `userId` is an **auth staff `User`** (the factory joins `auth` `User` for name/email). Unique `(entity_type, entity_id, role_type)` among live rows, so one holder per role per entity. Role types are dictionary-backed; seeded: `sales_owner`, `service_owner`, `account_manager`. No `purchase_approver`. | `customers/data/entities.ts:1060-1100`; `customers/api/entity-roles-factory.ts:12,277-306`; `customers/lib/customerRoleTypes.ts` |
| Portal RBAC | `CustomerRole`/`CustomerRoleAcl` with `portal.*` features; modules contribute via `defaultCustomerRoleFeatures` (roles `portal_admin`, `buyer`, `viewer`) | `customer_accounts/setup.ts:92-196`, `customer_accounts/data/entities.ts` |
| Notifications | `recipient_user_id` only, i.e. staff users. No in-app channel for `CustomerUser`. | `notifications/data/entities.ts:9-20` |
| Cart approval surface | `Cart.requiresApproval` (always written `false` today) and `Cart.approvalId` columns exist; `cartView` notes "no approval ENTITY or status" yet. Cart carries `customerIds` (person + company). | `cart/data/entities.ts:180-185`; `cart/commands/cart.ts:297`; `cart/lib/cartView.ts:425`; `cart/lib/routeContext.ts:80,159` |
| Sales money | `numeric(18,4)`; events `sales.invoice.*`, `sales.payment.*` are CRUD events only | `sales/data/entities.ts:1434-1437,1731-1740`; `sales/events.ts:41-58` |
| Optimistic-lock helper | `enforceCommandOptimisticLock` compares the request header against the loaded `updated_at`. It is fail-open when the header is missing or `OM_OPTIMISTIC_LOCK=off`. | `packages/shared/src/lib/crud/optimistic-lock-command.ts:166-177` |

## Backward Compatibility

All 13 surfaces were checked. Phases 3–4 are almost entirely additive: new tables, events, features, routes and a CLI-free background job set. Nothing that ships today is renamed or removed.

### Violations Found

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| G26 | 2 Types / 9 DI | §6 adds `checkCredit`/`reserveCredit`/`releaseCredit`/`settleCredit` (and, per G3, approval methods) to the exported `CustomerGroupsService` interface. That is additive for callers but **breaking for any implementer** that replaces `customerGroupsService` through `entry.overrides.di`: its object no longer satisfies the interface. It also puts transactional money operations on a request-scoped resolver service. | Warning | Register two new DI keys, `customerCreditService` and `customerPurchaseApprovalService`, with their own exported interfaces. Leave `CustomerGroupsService` unchanged. Checkout §3.3 ("DI `customerGroupsService`: `resolveTerms`, `checkCredit`, …") is updated to name the new keys. |
| — | 1 Auto-discovery | New `notifications.ts`, `subscribers/`, `workers/`, `encryption.ts` (per G22) are new files, not renames | OK | — |
| — | 3 Signatures | Shipped `resolveGroups`/`resolveTerms`/`resolveAssortmentScope` untouched | OK | — |
| — | 4 Import paths | None moved | OK | — |
| — | 5 Event IDs | Only new ids. They become FROZEN on ship, so the payload gaps in G18 must be closed before Phase 3 merges. | OK (see G18) | — |
| — | 6 Spot IDs | New injection (credit tab on `detail:customers.company`/`.person`) is additive | OK | — |
| — | 7 API routes | New routes only; but §9 names them with a stale prefix (G17) | OK (see G17) | — |
| — | 8 DB schema | 3 new tables; no change to shipped tables. `cart.approval_id` already exists (D-R4-19) | OK | — |
| — | 10 ACL IDs | 5 new staff features + portal features (G16); ids frozen on ship | OK | — |
| — | 11 Notification IDs | New types (G15) must be declared; frozen on ship | OK | — |
| — | 12 CLI | None added for Phases 3–4 | OK | — |
| — | 13 Generated | Regenerated registries only | OK | — |

### Missing BC Section

§8 covers Phases 1–2 (no FK, reconciliation). It says nothing about Phases 3–4. Add §8.4 covering:

- the new DI keys (G26);
- the frozen event payloads (G18);
- the frozen notification ids (G15);
- the `sync-role-acls` and `sync-customer-role-acls` steps existing tenants need for the new features (G16).

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| Approval service contract (§6) | Cart F4 and checkout B.5 have nothing to call (G3) | Add `CustomerPurchaseApprovalService` with typed inputs and outputs |
| Approval lifecycle / state machine | `pending → approved/rejected/expired/withdrawn` transitions, who may trigger each, and what happens to an approved approval when its subject changes are not stated | State table with actor, guard and emitted event per transition (G6, G8, G24) |
| Settlement and release triggers | Nothing in Release 5 ever lowers exposure except a manual adjust (G7) | §6.5 "Credit lifecycle": who calls `releaseCredit`/`settleCredit`, on which event |
| Event payloads (§10) | Subscribers in cart/checkout cannot be written against bare ids (G18) | Payload type per new event |
| Portal API (§9) | Buyer-side approvers cannot act without a storefront (G5) | Portal route table |
| Error codes | Checkout aborts with `402 credit_refused`. The credit and approval error codes (`no_account`, `on_hold`, `limit_exceeded`, `not_permitted`, `idempotency_key_mismatch`, `approval_not_pending`) have no catalogue. | §9.2 error-code table, in the same style as cart §15a |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| §5.4 `CustomerCreditAccount` | No `organization_id` rule (groups are tenant-scoped, customers organization-scoped); no provisioning rule (G13) | `organization_id` = the customer's organization, NOT NULL; provisioning per G13 |
| §5.5 ledger | Idempotency key unique per account, while `releaseCredit` addresses it by key alone (G2); no `reservation_entry_id` to tie a release or settle back to its reserve | Add `related_entry_id uuid null`; key unique per `(tenant_id, idempotency_key)` |
| §5.6 approval | `requested_by_customer_user_id` NOT NULL and `decided_by_customer_user_id` assume buyer-side actors only (G4); `subject_type` includes `checkout_session` though every session has a cart (G8); no currency rule for the threshold (G10) | Actor-typed columns; canonical subject; currency per G10 |
| §6.3 Concurrency | Prescribes a mechanism that the codebase showed does not work (G1) | Replace with the row-lock strategy |
| §11 Jobs | `expire-approvals` is not race-safe with `/decide` (G6); `credit-exposure-audit` has no worker/queue/progress definition | CAS-based expiry; define the worker per `packages/queue/AGENTS.md` |
| §12 Risks | R1 mitigation and R8 mitigation rely on the mechanisms G1 and G6 replace | Rewrite R1/R8; add risks for G7 and G8 |
| §13 Coverage | Approvals barely covered (G23) | Extend |
| §16 Compliance | "Concurrency strategy: SERIALIZABLE…" and "Encryption: no field encryption" both need revisiting (G1, G22) | Update after the decisions |

## AGENTS.md Compliance

### Violations

| Rule | Location | Fix |
|---|---|---|
| Never skip tenant/organization scoping (root `AGENTS.md` § Never) | §6 credit methods: no `tenantId`/`organizationId` in any input; `releaseCredit({ idempotencyKey, reason })` | G2 |
| New `acl.ts` features must be in `setup.ts` `defaultRoleFeatures`; portal features in `defaultCustomerRoleFeatures` (`packages/core/AGENTS.md` → ACL Grant Sync) | §9.1 adds 5 features; no grant plan; no portal features at all | G16 |
| Implement domain writes through commands with audit/undo (`packages/core/AGENTS.md` → Command Side Effects) | §6 credit methods and decide are described as service calls; undo semantics for an append-only ledger are unstated | G20 |
| Free-text notes about people must be encrypted via `encryption.ts` | `hold_reason`, `decision_note`, ledger `note`; §16 says "no field encryption" with monetary columns as the only reasoning | G22 |
| Notification types declared in `notifications.ts`, i18n under `<module>.notifications.*` | §10 "drives an in-app notification" with no type ids | G15 |
| Optimistic locking on every new user-editable entity | Satisfied for `CustomerCreditAccount`; for approvals the stated mechanism is insufficient on its own | G6, G19 |
| Integration tests ship with the feature, covering every API path | §13 omits approval API behaviours and the portal paths | G23 |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **G1** Credit overshoot. `SERIALIZABLE` requested via `withAtomicFlush` is silently dropped when checkout's submit already holds a transaction (`flush.ts:166-172`). | Spec R1 returns at full severity: unsecured credit the tenant never approved | Lock the `CustomerCreditAccount` row with `PESSIMISTIC_WRITE` inside the (possibly ambient) transaction, re-sum, append. This is the D-R4-12 precedent and needs no retry loop. The N=20 test must include a nested-transaction variant. |
| **G7** Exposure never decreases. Release 5 has no settlement or release trigger. | Every on-account customer eventually hits `limit_exceeded`; support tickets; operators "fix" it with manual adjusts that break the audit story | Owner decision on the settlement trigger (see Remediation); at minimum ship release on order cancellation and document manual settlement |
| **G6** Double decision. Two approvers both pass a header check made before write; the expiry job sends no header; `OM_OPTIMISTIC_LOCK=off` disables the check. | An approval decided twice (approve then reject, or the reverse); a resumed checkout acting on a stale state | Conditional transition (CAS) on `status = 'pending'` |
| **G8** Duplicate approvals for one purchase. Cart F4 and checkout both create approvals for the same cart. | Two pending requests for one purchase; one approved, one rejected; the subject resumes on whichever event arrives last | One canonical subject (the cart) and request idempotent per subject |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **G10** Threshold compared across currencies | A EUR cart checked against a PLN threshold either routes everything to approval or nothing | Threshold currency rule |
| **G11** Credit attached to the wrong identity (person vs company) | A buyer's personal account is charged instead of the company's line, or two parallel limits exist for one company | Identity resolution rule in the contract |
| **G14** Float money in the contract (`amount: number`) against `numeric(16,2)` and sales `numeric(18,4)` | Rounding drift between ledger sum and order totals; audit drift reports false positives | Decimal strings, 2-dp half-up at the boundary (promotions precedent) |
| **G13** Lazy account creation racing at first reserve | Unique-violation 500 at checkout on a customer's first on-account order | Admin-provisioned accounts in Release 5, or `insert … on conflict do nothing` before the lock |
| **G26** DI interface growth breaking overrides | A downstream app overriding `customerGroupsService` fails typecheck or throws at runtime | Separate DI keys |
| **G9** Resume depends on workflows, whose seeded definitions are B.6 (out of scope) | Approved sessions never resume in Release 5 | Event-driven resume owned by cart/checkout subscribers |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Lock contention: one account row locked per reserve | On-account checkouts for the same company serialize | Acceptable: these are rare, short transactions. Lock only around the re-sum and append, never across gateway calls (checkout step 3 is before payment). |
| Lock ordering with availability reservations (checkout step 2 then 3) | Deadlock only if another path locks credit before stock | State the order "stock, then credit" in checkout §7 and keep every caller to it |
| Admin lowers `credit_limit` below current exposure | Account immediately refuses new reservations | Allowed. The admin UI shows `available < 0` explicitly. |

## Gap Analysis

Each item: problem, then the concrete fix.

### Critical Gaps (Block Implementation)

- **G1: replace §6.3's concurrency strategy.**
  - *Problem.* §6.3 requires a new SERIALIZABLE retry-on-40001 helper, built first. On this branch:
    - `withAtomicFlush` ignores `isolationLevel` when a transaction is already active (`flush.ts:166-172`);
    - checkout submit runs reservation steps inside its own sequence;
    - promotions in Release 4 explicitly abandoned the identical design for a row lock (D-R4-12, `promotion-usage-service.ts:16-22`).

    §6.3 also says "zero production use of SERIALIZABLE… no reference implementation". The second half is now false: a reference exists, and it is the row lock.
  - *Fix.* `reserveCredit` runs this inside `withAtomicFlush(..., { transaction: true })`, joining an outer transaction if present:
    1. `findOne(CustomerCreditAccount, { id, tenantId, organizationId }, { lockMode: PESSIMISTIC_WRITE })`;
    2. `SUM(amount)` over the account's entries;
    3. compare against `credit_limit`, honoring `is_on_hold`;
    4. append the entry with `balance_after` computed under the lock.

    No 40001 helper. Drop §6.3's "build and merge the helper first". R1's gate becomes N=20 parallel reserves, plus the same test with each reserve called inside an outer transaction. Checkout §8.3 and R7 ("serializable transaction (spec 1 §6)") are updated to point at the row lock.
- **G2: scope every credit call; make `releaseCredit` addressable.**
  - *Problem.* None of the four inputs carries `tenantId`/`organizationId`, although every shipped method in this service takes `tenantId` explicitly for exactly this reason (`customerGroupsService.ts:46-62`). `releaseCredit({ idempotencyKey, reason })` must find its reserve row, but the key is unique only per `credit_account_id` (§5.5). The lookup is then either cross-account (ambiguous) or cross-tenant.
  - *Fix.*
    1. Every method takes `scope: { tenantId; organizationId }`.
    2. Ledger uniqueness becomes `(tenant_id, idempotency_key)`.
    3. `releaseCredit({ scope, reserveIdempotencyKey, reason })` returns `{ released: boolean; entryId: string | null }`.
    4. `settleCredit` likewise returns its entry.
- **G3: add the approval contract.**
  - *Problem.* §6 has no approval method. §9 has `GET /approvals` and `POST /approvals/:id/decide` and no create. Callers that need it:
    - cart F4: command `cart.approval.request`, route `/current/request-approval`, `Cart.approvalId`;
    - checkout B.5: §8.2 "creates a `CustomerPurchaseApproval`", route `/sessions/:token/request-approval`, `CheckoutSession.approval_id`.
  - *Fix.* `customerPurchaseApprovalService` with:

    ```typescript
    requestApproval(input: {
      scope: { tenantId: string; organizationId: string }
      customerId: string                 // resolved per G11
      requestedBy: { actorType: 'customer_user' | 'staff_user'; actorId: string }
      subjectType: 'cart' | 'quote'      // per G8
      subjectId: string
      amountGross: string                // decimal string, per G14
      currencyCode: string
      expiresAt?: Date
    }): Promise<{ approval: ApprovalView; created: boolean }>   // idempotent per (subject_type, subject_id) while pending
    getApproval(input: { scope; approvalId }): Promise<ApprovalView | null>
    getActiveApprovalForSubject(input: { scope; subjectType; subjectId }): Promise<ApprovalView | null>
    withdrawApproval(input: { scope; approvalId; actor }): Promise<ApprovalView>
    decideApproval(input: { scope; approvalId; decision: 'approved' | 'rejected'; actor; note?; expectedUpdatedAt? }): Promise<ApprovalView>
    ```

    There is **no** public create route: the amount must come from the server-side cart totals, never from a client body. Creation happens only inside the cart and checkout commands.
- **G4: resolve the approver model (owner decision).**
  - *Problem.* §5.6 says approvers come from `CustomerEntityRole (roleType = 'purchase_approver')`, while the requester and decider are `CustomerUser` ids. In the code:
    - `CustomerEntityRole.userId` is an auth staff `User` (`entity-roles-factory.ts:12,277-306`);
    - the live-row unique index `(entity_type, entity_id, role_type)` allows exactly **one** holder per role per company (`customers/data/entities.ts:1063-1067`);
    - `purchase_approver` is not a seeded role type (`customerRoleTypes.ts`).

    So "the buyer's own manager approves" cannot be expressed through `CustomerEntityRole` at all. Two separate needs are conflated:
    - *buyer-side approval*: a person at the customer company signs off;
    - *merchant-side approval*: the account manager or credit desk signs off.

    The proposal seam also lets a staff rep author a cart (cart §7a), so `requested_by_customer_user_id NOT NULL` fails for staff-initiated requests.
  - *Recommended fix.*
    1. Buyer-side deciders are `CustomerUser`s of the same company (`CustomerUser.customer_entity_id = approval.customer_id`) holding a portal feature `customer_groups.portal.approvals.decide`, granted through `defaultCustomerRoleFeatures` to `portal_admin`.
    2. Merchant-side deciders are staff holding `customer_groups.approvals.decide`.
    3. `CustomerEntityRole` is used only to route notifications to the company's `account_manager` (G15), which is its real meaning.
    4. Columns become `requested_by_actor_type`/`_id` and `decided_by_actor_type`/`_id`.
    5. Which side(s) decide is a per-group term, or Release 5 ships one side only. **Owner decision.**
- **G5: buyer-facing approval API.**
  - *Problem.* The release invariant is API-only selling without a storefront of its own. With §9 as written, a buyer-side approver has no API.
  - *Fix.* Portal routes with `requireCustomerAuth` + `requireCustomerFeatures`:
    - `GET /api/customer_groups/portal/approvals` (own company, pending first);
    - `GET .../portal/approvals/:id`;
    - `POST .../portal/approvals/:id/decide`;
    - `POST .../portal/approvals/:id/withdraw` (requester only).

    Each route has an `openApi` export and a tenant + company isolation test.
- **G6: make decide, withdraw and expire race-safe.**
  - *Problem.* `enforceCommandOptimisticLock` compares the client header against the row it loaded (`optimistic-lock-command.ts:166-177`). Two approvers who loaded the same version both pass if each check precedes the other's write. The check is fail-open without a header, and the `expire-approvals` job has no header. R8's mitigation therefore does not hold.
  - *Fix.* Every transition is a conditional update:

    ```sql
    UPDATE customer_purchase_approvals
    SET status = ?, decided_* = ?, updated_at = now()
    WHERE id = ? AND tenant_id = ? AND status = 'pending' AND expires_at > now()
    ```

    Zero rows means 409 `approval_not_pending`, with the current status and decider in the body. The `updated_at` header stays as the UX layer that drives `surfaceRecordConflict`. The expiry job uses the same CAS.

### Important Gaps (Should Address)

- **G7: settlement and release triggers (owner decision).**
  - *Problem.* Checkout §8.3 says the reservation "stands as exposure until invoicing settles it via `settleCredit`". Nothing in Release 5 scope calls `settleCredit`, and `sales` emits only CRUD events for invoices and payments (`sales/events.ts:41-58`). Settling at invoice time would also be wrong for a credit limit: an unpaid invoice *is* exposure.
  - *Options.*
    - **(a)** A `customer_groups` subscriber on `sales.payment.created|updated` settles the captured delta. Key `payment:{paymentId}:{capturedAmount}` keeps it idempotent; customer and currency come from the payment's order. It also releases on order cancellation.
    - **(b)** Release 5 ships settlement as the manual `/adjust` path plus `settleCredit` for integrators, and documents it.

    Recommend (a) for cancel-release and payment-settle. Either way, §6.5 states it.
- **G8: one canonical approval subject per purchase.**
  - *Problem.* Every checkout session has a cart (B.2 seeds a cart even for template links), so `subject_type: 'checkout_session'` duplicates `'cart'`.
  - *Fix.*
    - The cart is the subject. Checkout reads and reuses `Cart.approvalId`, and `checkout_session` is dropped from the enum, or kept reserved and unused.
    - Request is idempotent per `(subject_type, subject_id)` while pending.
    - A subject merged into another cart, converted, or abandoned withdraws its approval (cart subscribers emit; `withdrawApproval`).
    - Approval is by amount and currency only. Same-or-lower totals with changed lines pass; a higher total re-requests (checkout §8.2, R8). State this explicitly. If the owner wants line-level re-approval, add `subject_digest`.
- **G9: event-driven resume in Release 5.**
  - *Problem.* Checkout resumes `awaiting_approval` via workflows (§5.1.2), but the seeded workflow definitions are B.6, out of scope.
  - *Fix.*
    - `customer_groups` emits `approval.approved|rejected|expired|withdrawn` with the G18 payload.
    - Persistent, idempotent subscribers in `cart` and `checkout` resume or clear their subject.
    - `customer_groups` imports neither (§4.2 holds).
- **G10: currency of `approval_required_above` and `min_order_value` (owner decision).**
  - *Problem.* Both are unitless `numeric`; only credit has `credit_currency_code`. Cart F4 must compute `requiresApproval`, which is always `false` today (`cart/commands/cart.ts:297`).
  - *Options.*
    - **(a)** Add `terms_currency_code`. A cart in another currency gets `requiresApproval = true` (fail-closed) for approval and no `min_order_value` check.
    - **(b)** Reuse `credit_currency_code` for all three.

    Promotions precedent: D-R4-27 requires a single `eligible_currency`.
- **G11: identity resolution for credit and approvals.**
  - *Problem.* Cart and checkout carry `customerIds` = [person, company] (`cart/lib/routeContext.ts:80`). The contract takes one `customerId`.
  - *Fix.*
    - The credit account and the approval `customer_id` resolve to the company entity (`CustomerUser.customer_entity_id`, i.e. `customerIds[last]` when it is a company), falling back to the person.
    - The resolution is done inside the service from `BuyerIdentityInput`, and the resolved `creditAccountId`/`customerId` is returned so the caller snapshots it.
    - `checkCredit`'s `not_permitted` reason comes from `resolveTerms` over the same ids.
- **G12: idempotency semantics.** State all four rules:
  - same key with the same `(amount, currency, sourceType, sourceId)` returns the original entry;
  - same key with any difference returns 409 `idempotency_key_mismatch` (checkout re-price between attempts must mint a new key);
  - a key whose reservation was released is not reusable: it returns the original with `reserved: false, released: true`;
  - release writes its own entry keyed `release:{reserveKey}`, is a no-op the second time, and releases `reserved − already settled`.
- **G13: account provisioning (owner decision).**
  - *Problem.* `default_credit_limit` is "applied to new credit accounts", but nothing says when an account is created.
  - *Options.*
    - **(a)** Admin-created only in Release 5; a missing account returns `no_account`. This is the simplest and has no race.
    - **(b)** Lazy creation at first `checkCredit` via `insert … on conflict (tenant_id, customer_id, currency_code) do nothing`, before the lock.
- **G14: money as decimal strings.** The contract's `number` becomes `string` (2 dp), using the minor-unit math promotions already uses (`promotion-usage-service.ts:29-50`). Sales amounts (`numeric(18,4)`) round half-up to 2 dp at the settle and reserve boundary. Document this so the exposure audit cannot report rounding as drift.
- **G15: notification types and channels.**
  - *Problem.* In-app notifications reach staff only (`recipient_user_id`). There is no `CustomerUser` channel.
  - *Fix.*
    - Declare in `notifications.ts`:
      - `customer_groups.credit.limit_exceeded` (to the company's `account_manager` via `CustomerEntityRole`, falling back to staff holding `credit.manage`);
      - `customer_groups.approval.requested` (staff deciders);
      - `customer_groups.approval.decided` (staff requester, when the requester is staff).
    - Buyer-side approvers and requesters are reached by email (customer_accounts email pipeline) and/or `portalBroadcast: true` on the approval events. Choose and state which.
- **G16: ACL and grants.**
  - Add the 5 staff features to `acl.ts` with `dependsOn` (`credit.manage → credit.view`, `credit.adjust → credit.view`, `approvals.decide → approvals.view`).
  - `admin` is covered by `customer_groups.*`. Decide whether `employee` gets `credit.view`/`approvals.view`.
  - Add `defaultCustomerRoleFeatures`:
    - `portal_admin`: `customer_groups.portal.approvals.view|decide`;
    - `buyer`: `customer_groups.portal.approvals.view` (own requests).
  - Existing tenants run both sync commands.
- **G17: route paths in §9 are stale.** Shipped routes live under `/api/customer_groups/customer-groups/...` (`TC-CGRP` `GROUPS_PATH`), not `/api/customer-groups/...`. Write the new rows with the real prefix.
- **G18: event set and payloads.**
  - Add `customer_groups.credit.adjusted` and `customer_groups.approval.withdrawn`.
  - Declare payloads:
    - credit events: `{ tenantId, organizationId, creditAccountId, customerId, currencyCode, entryId, amount, exposureAfter, sourceType, sourceId }`;
    - approval events: `{ tenantId, organizationId, approvalId, customerId, subjectType, subjectId, amountGross, currencyCode, status, decidedBy? }`.
  - The payload has no PII, consistent with checkout's redaction rule.

### Nice-to-Have Gaps

- **G19: optimistic-lock table per entity.**
  - `CustomerCreditAccount`: `CrudForm`, `updated_at`; returns `updatedAt` in list/detail. Reservations lock the row but do not bump `updated_at`, so admin edits are not falsely 409'd.
  - `CustomerCreditLedgerEntry`: append-only, exempt (AGENTS.md exemption list). Confirm it is not added to `optimistic-lock-editable-entities.test.ts`'s curated list.
  - `CustomerPurchaseApproval`: CAS (G6) plus header.
  - `hold` toggle: `hold_reason` is required when `is_on_hold = true` (validator).
- **G20: commands and undo.**
  - `adjust` is a command whose undo appends the inverse entry, never a delete.
  - `reserve`, `release` and `settle` are service operations with audit-log entries and no UI undo.
  - `decide` is non-undoable: a recorded decision is authoritative, and a mistaken approve is followed by a new request.
  - State all of this in the spec.
- **G21: job definitions.**
  - `credit-exposure-audit`: queue worker, tenant-scoped, a `ProgressJob` when triggered from the UI. It compares `SUM(amount)` with the latest `balance_after`, which is meaningful only because G1 writes `balance_after` under the lock.
  - `expire-approvals`: emits `.expired` per transition.
- **G22: encryption.** `hold_reason`, `decision_note` and the ledger `note` are free text and can hold personal data. Declare them in `customer_groups/encryption.ts` and read through `findWithDecryption`. Revise §16, whose encryption row reasons only about monetary columns.
- **G23: integration coverage to add to §13.** Each test runs with tenant + company isolation fixtures:
  - reserve called inside an outer transaction (the G1 case);
  - key mismatch 409 (G12);
  - release idempotent; release after settle;
  - `on_hold` blocks regardless of exposure;
  - `no_account`; `not_permitted` from terms;
  - approval request idempotent per subject (G8);
  - double decide: one wins, the other 409 (G6);
  - decide versus expiry at the boundary instant;
  - self-approval refused (G24);
  - cross-company portal approver refused (G4/G5);
  - withdraw by a non-requester refused;
  - limit-exceeded notification emitted.
- **G24: decision authority rules.**
  - A requester cannot decide their own request.
  - A portal approver must belong to the approval's company.
  - Per-approver authority limits (approve up to X) are out of scope; say so.
- **G25: final-input revalidation (lesson `authoritative-command-guards-must-validate-final-interceptor-input`).** If `reserve` is exposed as a command with interceptors, the limit check under the lock must use the post-interceptor amount, and a regression test should cover an interceptor changing it.

## Remediation Plan

### Before Implementation (Must Do)

1. **Owner decisions — taken 2026-10-26, see `ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` (D-R5-1…7):**
   - G4/G5: who approves (buyer side, merchant side, or both);
   - G7: settlement trigger;
   - G8: line-level re-approval or amount only;
   - G10: threshold currency;
   - G13: account provisioning;
   - G15: buyer-side notification channel;
   - G16: `employee` grants.
2. **Spec revision of §5.4–5.6, §6, §6.3, §9–§13, §16**, applying G1, G2, G3, G6, G11, G12, G14, G17, G18, G26. Add §6.5 (credit lifecycle), §8.4 (Phases 3–4 BC) and a §9.2 error-code catalogue.
3. **Update the consumers in the same revision pass:**
   - checkout §3.3 (DI keys), §8.2 (event resume, cart as subject), §8.3/R7 (row lock);
   - cart §9/§11 (`requiresApproval` computation and currency, `cart.approval.request` calling `requestApproval`, withdraw on merge/convert).

   Do this together so Phase 4 of cart and B.5 of checkout build against the same text. It is the same discipline as D-R4-29.

### During Implementation (Add to Spec)

1. Build the credit lock path first, with its N=20 test and the nested-transaction test, as its own step before any route (replaces §6.3's helper-first step).
2. Implement approvals ahead of cart F4 approval routing (scope ordering constraint).
3. Record in the changelog any deviation from the revised contract (as cart did for Release 4).

### Post-Implementation (Follow Up)

1. Per-approver authority limits and multi-step approval chains (G24) as a follow-up spec.
2. Aggregate cross-currency credit cap (Open Question 3) remains deferred.
3. Move the spec to `implemented/` only after Phase 5 also ships; Phases 3–4 alone do not complete it.

## Recommendation

**Needs spec updates first.** No Phase 3 or Phase 4 code should start until G1–G6 are fixed in the spec and the owner decisions above are recorded. The fixes are contained: no change to anything shipped in #6709, no FK, no breaking contract. G1 also removes work, because the row lock replaces a retry helper that would otherwise have to be built.
