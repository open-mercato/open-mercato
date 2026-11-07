# Notify — 2026-10-26-ecommerce-release-5-conversion

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-10-26T00:00:00Z — run started
- Brief: implement eComm Release 5 — Conversion on fork PR #16 (adeptofvoltron/open-mercato),
  against the revised specs on `feat/release-5-conversion` + the Release 5 analysis/decisions
  docs. Unattended; all Ask First items in scope pre-approved via D-R5 decisions.
- External skill URLs: none
- Worktree: created fresh at `.ai/tmp/release-5-conversion-impl` (none existed for this branch).
  `fork` remote already configured. Branch confirmed at `c92470d8d5`, matching the brief.

## 2026-10-26T12:00:00Z — checkpoint 1 (Steps 1.1–1.5)
- Range: `cc618cce9c`..`f619ac8d4d`. Summary: shared trusted-context helper; `ecommerce`
  `resolveForBuyer`; `wms` `wmsReservationService` extraction (no behavior change); availability
  Phase-2 sellable-quantity alignment; `customer_groups` credit entities/ledger/migration + new
  `CustomerGroupTerms` columns.
- Checks: forced full typecheck (40/40, 0 cached) pass; scoped tests pass (shared 20/20 suites,
  core customer_groups+wms+ecommerce 160/160 suites). No UI touched, UI verification skipped.
- Decisions/problems: none. All five tracks landed exactly as planned, no rescues needed.

## 2026-10-26T13:00:00Z — Step 1.7 landed
- `customer_groups`: credit admin API (`GET/PUT /api/customer_groups/customer-groups/credit-accounts`,
  list keyed by `customerId`/`id`/`currencyCode`/`isOnHold`, update edits `creditLimit`/`isOnHold`/
  `holdReason` with the hold-reason invariant re-validated against the MERGED entity state, not the
  raw partial payload — see `credit-accounts/crud.ts`), a widget tab (`customer_groups.injection.
  credit-panel`) on `detail:customers.person:tabs`/`.company:tabs`, 3 new ACL features
  (`credit.view`/`.manage`/`.adjust`), `employee` grant for `credit.view` (D-R5-7), and
  `encryption.ts` registering `hold_reason`/`note` (G22).
- Scope narrowed deliberately versus the full spec §9 route table: no account-creation route (G13/
  D-R5-5 provisioning), no ledger-listing route, no `/adjust` command route — none of these are in
  this Step's own Implementation bullet list; a future Step should pick them up alongside the
  credit-exposure-audit job (1.8) or its own dedicated Step. The ACL feature ids for all three
  (`credit.view`/`.manage`/`.adjust`) ARE declared now per the task's explicit instruction, ahead of
  the routes that will use `.adjust`.
- `approvals.view`/`.decide` ACL features deliberately deferred to Step 2.6 — `CustomerPurchaseApproval`
  doesn't exist until Step 2.4, so declaring the feature id now would have nothing behind it. See
  PLAN.md "Decisions taken without the owner".
- No new events/notifications/jobs in this Step (Step 1.8's scope) — a hold toggle does not yet emit
  `customer_groups.credit_account.put_on_hold`/`.released_from_hold` (unshipped in the spec's own
  "Shipped on develop" line); Step 1.8 should decide whether to add that emission alongside the
  notification wiring.
- Verified `customerCreditService.ts` (Step 1.6) never reads `hold_reason`/`note` back for business
  logic — only writes them — so no encryption-driven bug fix was needed there; added a doc comment
  only, no logic change.

## 2026-10-26T13:30:00Z — dispatcher: appended Step 1.11 to close a real gap
- Step 1.7's executor correctly scoped out account creation (not in its bullet list) but flagged
  that without ANY provisioning route, `CustomerCreditAccount` can never be created (G13/D-R5-5
  says "operator only", which presupposes an operator-facing create route exists). Left unfixed,
  this blocks checkout B.4/B.5's on-account path (Phase 4/5) at the end of the release, far from
  where the gap was introduced. Appended Step 1.11 (admin-create + ledger-listing routes) to the
  end of Phase 1 rather than stopping the run — a same-module, additive, low-risk fix with an
  unambiguous spec basis (G13/D-R5-5), not a scope change requiring the owner.

## 2026-10-26T14:00:00Z — Step 1.8 landed
- `customer_groups`: declared the `customer_groups.credit.limit_exceeded` notification type
  (`notifications.ts`, in-app only, per G15 — approval notifications stay Step 2.7's scope),
  wired as a persistent subscriber (`subscribers/credit-limit-exceeded-notification.ts`) on a new
  `customer_groups.credit.limit_exceeded` domain event. `reserveCredit` (`customerCreditService.ts`,
  Step 1.6) now emits that event after its transaction commits when it refuses with reason
  `limit_exceeded` — this is the event's only trigger, consistent with spec §10.1's own wording
  ("emitted on a refused reserveCredit"); the sibling `credit.reserved/.released/.settled/.adjusted`
  and `credit_account.put_on_hold/.released_from_hold` events (G18) stay undeclared — nothing in
  this Step's scope consumes them, and declaring events with no subscriber felt like the same kind
  of premature ACL-surface mistake Step 1.7 flagged for `approvals.*`.
- Recipient resolution (G15): the company's `account_manager` via `customers.CustomerEntityRole`
  (direct SQL on `customer_entity_roles`, FK-id only — no ORM import of `customers`, same coupling
  rule `lib/creditIdentity.ts` already used for the company-first resolution), falling back to any
  staff holding `customer_groups.credit.manage` in the organization. Factored into
  `lib/creditNotifications.ts` so the exposure-audit job's own over-limit finding can reuse it
  without duplicating the recipient lookup.
- `sales.order.cancelled` subscriber (`subscribers/order-cancelled-credit-release.ts`, persistent):
  finds `CustomerCreditLedgerEntry` rows with `entryType: 'reserve'` and `linkedOrderId = orderId`
  in the event's own tenant/organization, and calls `releaseCredit` for each. Idempotent by
  construction — `releaseCredit` (Step 1.6) already keys its release entry as
  `release:{reserveIdempotencyKey}` and no-ops on redelivery, so no dedupe was added here. Note:
  `linkCreditReservationToOrder` (the thing that actually WRITES `linked_order_id`) is Step 4.2's
  scope and does not exist yet, so this subscriber is a correct no-op until checkout Phase 4 lands
  — verified by reading `linkedOrderId`'s only writer in the current tree (none).
- `credit-exposure-audit` worker (G21): tenant-scoped queue worker
  (`customer_groups.credit_exposure_audit`), paginated over `CustomerCreditAccount`, recomputing
  `SUM(amount)` per account and comparing it against the latest entry's `balance_after` (exported
  `toMinorUnits`/`formatMinorUnits` from `customerCreditService.ts` so the rounding is identical,
  G14). Every drift is logged and sent through `reportError`; the `limit_exceeded` notification is
  reused ONLY when the drifting account's recomputed exposure is also over its limit (a genuine
  over-limit case), never for drift alone — per this Step's own instruction not to invent a new
  notification type. Registered a daily (`0 3 * * *` UTC) per-tenant schedule in `setup.ts`, same
  `schedulerService.register` pattern as `warranty_claims`' SLA sweep. Accepts an optional
  `progressJobId` in its payload and reports through `ProgressService` when present, so a future
  "run now" UI trigger can enqueue it as a `ProgressJob` (G21) without the worker changing — no such
  trigger route is built in this Step; it wasn't named in the Step's own bullet list.
- **Gap identified and deferred, not built here**: `/adjust` (manual settlement route, D-R5-2/§6.5/
  §9) is still unshipped after this Step. Checked PLAN.md Phase 1/2 — Step 1.11's gap-fill covers
  account-creation and ledger-listing only, not `/adjust`; no Step names it. Appended Step 1.12
  (same gap-fill pattern as 1.11) to the end of Phase 1 for a future executor — see PLAN.md
  "Decisions taken without the owner" for the full reasoning. Without it, exposure can be lowered
  automatically (cancel-release) but never manually, which is a real functional hole for a tenant
  with no payments integration calling `settleCredit`.

## 2026-10-26T14:30:00Z — Step 1.9 landed
- `promotions`: found that `CodeUsage` (`promotion_code_usages`) stored none of `code_id`,
  `customer_id`, `organization_id`, `tenant_id`, `used_at` that could key a reversal to a specific
  cart or order — `useCode`'s own `em.create(CodeUsage, {...})` call wrote none of `cartId`,
  `orderId`, or which `GeneratedCode` a dynamic use deactivated. `revertCodeUse({ cartId?,
  orderId? })` had nothing to look up without one. Added additive, nullable columns `cart_id`,
  `order_id`, `generated_code_id`, `reverted_at` to `CodeUsage` (migration
  `Migration20261026161603_promotions`) and an additive, optional `orderId` on `UseCodeInput` so a
  future checkout caller (Phase 4, which calls `useCode` AFTER document creation per the C5
  finding) can record it immediately — see PLAN.md "Decisions taken without the owner" for the
  full reasoning and the alternative considered.
- `revertCodeUse` (new, `lib/code-service.ts`) reverses the exact inverse of `useCode`'s own flip
  under the same row-lock pattern (`LockMode.PESSIMISTIC_WRITE` on `Code`/`GeneratedCode` inside
  `withAtomicFlush`): reactivates the specific `GeneratedCode` for a dynamic use, or decrements
  `Code.used` and reactivates the code once `hasRemainingGlobalUses` is true again for a static
  use. Marks the `CodeUsage` row `reverted_at` — never deletes (append-only log, same precedent as
  `PromotionUsage.reverted_at`). Idempotent (only unreverted rows match) and tenant/organization-
  scoped on every lookup and lock, proven by a dedicated cross-tenant-id-collision test. Registered
  as command `promotions.code.use.revert` (additive sixth command to §A.2a's own five) and exposed
  on the `promotionsService` facade, mirroring `releaseCode`/`revertUsage`.
- `subscribers/order-cancelled-usage-revert.ts` (new, persistent): on `sales.order.cancelled`,
  resolves `promotionUsageService`/`promotionCodeService` directly from the container (no `auth`/
  command-bus wrapping needed — same direct-service-call idiom as `customer_groups`'s own
  `order-cancelled-credit-release.ts` subscriber for this exact event) and calls `revertUsage`
  then `revertCodeUse`, both keyed by the event's `orderId`. Reads only `orderId`/`tenantId`/
  `organizationId` off the payload; never imports a `sales` entity. Both calls are independently
  idempotent on redelivery; the subscriber adds no dedupe of its own.
- SPEC-055 did not document `revertCodeUse` or a cancellation subscriber anywhere (confirmed by
  grep — the only prior mention of reversal was `revertUsage`'s own, and §3.3's withdrawn "`sales`
  calls `revertUsage`" line). Added an additive amendment (v2.3.0): §Code Lifecycle diagram +
  prose, the `CodeUsage` data-model table, the Commands & Events table, the Public TypeScript
  Contract, and a Changelog row — no full rewrite.
- Did NOT touch checkout (no caller exists yet) or cart's `codeService.releaseCode` wiring in the
  expire/mark-abandoned sweepers (that is Step 2.11/K11's separate reservation-release mechanism,
  not this Step's use-time reversal).

## 2026-10-26T17:00:00Z — checkpoint 2 (Steps 1.6–1.10)
- Range: `e94c9305dc`..`9a6703e162`. Summary: customer_groups credit service (row-lock concurrency,
  mutation-tested) + admin widget/ACL/encryption + notifications/exposure-audit/cancel-release;
  promotions revertCodeUse + cancellation subscriber + un-hidden delivery promotions.
- Checks: forced full typecheck (40/40, 0 cached) pass; scoped tests pass (core
  customer_groups+promotions+cart 79/80 suites, 910/912 tests — 1 expected skip, Postgres-gated).
  No dev-server/browser UI smoke pass yet for the two UI surfaces touched (1.7, 1.10) — deferred,
  not skipped silently; logged in checkpoint-2-checks.md.
- Decisions/problems: two gap-fill Steps appended (1.11 credit-account provisioning, 1.12
  manual /adjust settlement) — both logged in PLAN.md's "Decisions taken without the owner".

## 2026-10-26T18:00:00Z — Step 1.11 landed
- Rescue attempt: the first executor for this Step failed mid-implementation on a provider rate
  limit; nothing had been committed, so no code was lost. This is an infrastructure retry on the
  next tier up, not a quality escalation.
- `customer_groups`: `POST /api/customer_groups/customer-groups/credit-accounts` (operator
  provisioning, `credit.manage`, `.strict()` body `{ customerId, currencyCode, creditLimit,
  isOnHold?, holdReason? }`) on the existing `makeCrudRoute` instance; duplicate customer+currency
  answers `409` with `code: credit_account_exists` (pre-check plus `withCreateConflictRecheck` for
  the concurrent race against the Step 1.5 partial unique index). `GET …/credit-accounts/:id/ledger`
  (`credit.view`, newest first, `pageSize ≤ 100`, `note` decrypted via
  `findAndCountWithDecryption`, account looked up inside the caller's organization scope — foreign
  ids answer 404). Credit panel widget: "Create credit account" dialog (gated by `credit.manage`)
  and a per-account read-only ledger toggle with prev/next paging.
- `creditLimit` is required (no server-side `default_credit_limit` fallback); a create for a
  customer outside the caller's selected organization answers 400. Both logged in PLAN.md
  "Decisions taken without the owner".
- Not in this Step: `GET …/credit-accounts/missing` (the D-R5-5 banner, US-E2) and the form pre-fill
  from the group default that rides on it — no Step names them yet; worth a gap-fill decision
  before Phase 6. TC-CGRP-032's ledger rows are inserted through `pg` with plaintext notes (no
  ledger-writing route exists until Step 1.12), so ciphertext decryption on that route is first
  exercised end to end once `/adjust` writes notes through the ORM.

## 2026-10-26T17:30:00Z — dispatcher: Step 1.11 rescue landed; one item deferred, not gap-filled
- Step 1.11's rescue executor flagged the US-E2 "orphan banner" (customers whose resolved terms
  allow purchase-on-account but have no credit account in the terms currency) as unbuilt. Unlike
  the 1.11/1.12 provisioning gaps, nothing in Phases 2-6 depends on this banner existing — it is
  an admin-UX nicety, not a functional blocker for on-account checkout (which only needs the
  create route, now shipped, and `checkCredit`'s `no_account` refusal path, already correct).
  Deferred to Phase 6 polish rather than appending a dedicated Step now; revisit only if the final
  integration-coverage pass (Step 6.1) finds a spec test case that actually requires it.

## 2026-10-26T18:40:00Z — Step 1.12 landed
- `customer_groups`: `POST /api/customer_groups/customer-groups/credit-accounts/:id/adjust`
  (`credit.adjust`, `.strict()` body `{ amount: string, note: string }`, amount signed/non-zero/≤2dp)
  closes the last D-R5-2 gap: the operator-facing half of hybrid settlement. The account is
  resolved inside the caller's organization scope (same shape as the sibling `[id]/ledger` route);
  the route dispatches the new `customer_groups.credit.adjust` command through `commandBus.execute`.
- `customerCreditService.adjustCredit` (new method, `services/customerCreditService.ts`) appends a
  signed `adjust` entry under the SAME account-row lock (`LockMode.PESSIMISTIC_WRITE` inside
  `withAtomicFlush`) as `reserveCredit`/`releaseCredit`/`settleCredit`, with the same idempotency-key
  lookup pattern — the command mints its own key (`` `adjust:${randomUUID()}` ``) per execution since
  the HTTP body carries none (§9's literal `{ amount, note }`). Rejects a zero amount
  (`invalid_amount`).
- `commands/adjustCredit.ts`: the command (`customer_groups.credit.adjust`, `isUndoable: true`).
  `buildLog` snapshots everything undo needs (account/tenant/org/customer/currency ids, the entry id
  and its amount); `undo` calls `adjustCredit` a SECOND time with the negated amount,
  `relatedEntryId` = the original entry, and the key `` `undo:${entryId}` `` — appending the inverse
  entry, never deleting the original (G20). The route sets the `x-om-operation` response header
  (same convention as every other command-backed route, e.g. `staff/leave-requests/accept`) so the
  generic `/api/audit_logs/audit-logs/actions/undo` route can actually reach this `undo` handler.
- Declared and emit `customer_groups.credit.adjusted` (`events.ts`, G18/§10.1) after the write
  commits, gated to fire once per genuinely new entry — never on an idempotent replay.
- Admin UI: credit panel widget (`widgets/injection/credit-panel.tsx`) gained an "Adjust" icon
  button (gated by `credit.adjust`, independent of `credit.manage`) opening a dialog with `amount`
  (signed decimal string) and a required `note`, posted via `apiCallOrThrow` directly against the
  `/adjust` route (not `createCrud`/`updateCrud` — this isn't a CRUD write on the account entity,
  it appends a ledger entry).
- Tests: `services/__tests__/customerCreditService.test.ts` (7 new cases: positive/negative
  adjustment, zero rejection, no-account, idempotent replay, the `.adjusted` event, and the
  undo shape appending an inverse entry while the original survives);
  `commands/__tests__/adjustCredit.test.ts` (8 new cases: scope resolution, zero-amount validation,
  cross-tenant/cross-org 404, missing-tenant 400, `buildLog` payload shape, undo negation both
  directions); `__integration__/TC-CGRP-033-credit-account-adjust.spec.ts` (full HTTP path: post,
  exposure math, `.strict()`/zero/decimal-places validation, undo via the generic audit-logs undo
  route confirming the reversal entry appears and the original survives, ACL —
  `credit.adjust` required, `credit.view`/`.manage` alone insufficient — and tenant/organization
  isolation). Typecheck and the `customer_groups` jest suite (378 tests) pass; `i18n:check-sync` and
  `i18n:check-hardcoded` are clean for this module. The Playwright suite itself was not executed in
  this run (no live app/DB server available in this worktree) — verified by typecheck plus the unit
  tests exercising the same service/command code paths the route calls.
- Scope calls made without the owner (all logged in PLAN.md "Decisions taken without the owner"):
  the command-minted idempotency key, reusing one method for both the forward write and its undo,
  the `.adjusted` event's emission-once-per-write gate, and adding the `x-om-operation` header so
  undo is actually reachable.

## 2026-10-26T18:00:00Z — checkpoint 3 (Steps 1.11–1.12, closes Phase 1)
- Range: `9c35d9af44`..`122ee35173`. Summary: credit account creation + ledger-listing routes
  (rescued once after an unrelated provider rate limit, no code lost); manual /adjust settlement
  route as a real command with inverse-entry undo (G20).
- Checks: forced full typecheck (40/40, 0 cached) pass; full Phase-1 retrospective module sweep
  (customer_groups+promotions+cart+wms+ecommerce) 214/215 suites, 2254/2256 tests, 1 expected skip.
- Phase 1 is complete. All 12 Steps landed; one rescue needed (infrastructure, not quality); two
  gap-fills appended and closed within the same phase. No fix-forward Steps needed.

## 2026-10-26T19:00:00Z — Step 2.1 landed (Phase 2 opens)
- `availability`: `AvailabilityReservation` entity (`availability_reservations`) per §5.3/A3 —
  `id`, `tenant_id`/`organization_id`, `idempotency_key`, `source_type` (narrowed to the literal
  `'checkout'`, A16's system-only rule), `source_id`, `status` (`active|committed|released|expired`,
  default `active`), `expires_at` (nullable), `items` (jsonb snapshot: `catalogProductId`,
  `catalogVariantId`, `requested`, `outcome`, `heldQuantity`, `backorderQuantity`),
  `wms_reservation_ids` (jsonb `string[]`, default `[]`), `order_id` (nullable uuid, FK-id only, no
  ORM relation into `sales`), `status_reason` (nullable), `created_at`/`updated_at`. No
  `deleted_at` (§5.3: never soft-deleted, the hold's own audit trail) and no optimistic-lock
  header (§5.3: not user-editable, `updated_at` exists only for the Step 2.2 CAS transitions).
- Indexes: unique `(tenant_id, organization_id, idempotency_key)` over ALL statuses (A15 — a key
  is never reused for different content even once terminal); partial `(expires_at) WHERE status =
  'active'` for the Step 2.3 expiry sweep (A11); `(tenant_id, organization_id, source_type,
  source_id)` for session lookups.
- `data/validators.ts`: zod schemas for the persisted `items` snapshot shape
  (`availabilityReservationItemSnapshotSchema`/`...ItemsSnapshotSchema`, non-empty array,
  five-member outcome enum), plus `sourceType`/`status` schemas. Entity-only Step — no
  `reserve`/`release`/`commit` service or command code (Step 2.2's scope).
- Test: `data/__tests__/reservation.test.ts` (7 cases) — entity/validator round-trip for a `held`
  and a `backorder` line, null-variant product-rollup line, negative-quantity rejection, outcome
  enum rejection, empty-items rejection, source-type/status enum bounds.
- Scope call (logged in PLAN.md "Decisions taken without the owner"): the spec's richer
  `AvailabilityReservationLine` type (`key`/`available`) lives in `lib/reservationCommands.ts`,
  which is Step 2.2's own deliverable and doesn't exist yet. Declared the narrower, persisted-
  snapshot status/outcome/source-type types in `data/entities.ts` instead, next to the entity —
  mirrors `wms/data/entities.ts`'s `InventoryReservationSourceType`/`Status` precedent. Step 2.2
  should import these rather than redeclare a divergent set.
- Checks: `yarn typecheck` in `packages/core` clean (tsc --noEmit, no output). `yarn db:generate`
  produced exactly one migration (`availability: generated Migration20261026185450_availability.ts`,
  a pure `create table` + 3 indexes + 1 unique constraint). Re-ran a second time to confirm
  `availability: no changes`. Pre-existing, unrelated drift in `forms` and `wms` (an old consent
  unique-index drop and a wms FK/idempotency-key backfill, both predating this Step) appeared on
  both runs regardless of this Step's own changes — discarded both times per the root AGENTS.md
  coding-agent exception, snapshots reverted via `git checkout`. `yarn jest` in `packages/core`:
  new test file 7/7 pass; full `src/modules/availability` suite 108/108 pass (11 suites), no
  regressions.

## 2026-10-26T20:00:00Z — Step 2.2 landed (the release's core mechanism)
- `availability`: `reserveAvailability`/`releaseAvailability`/`commitAvailability`
  (`lib/reservationCommands.ts`, new) built on `wmsReservationService` (Step 1.3), one
  transaction per call via `em.transactional()`, CAS on `status = 'active'`, per-line outcome
  classification (`held|not_tracked|preorder|backorder|shortfall`, D-R5-9 backorder holds
  `min(requested, sellable)`), warehouse allocation preferring the primary warehouse (A7),
  key-mismatch `409 idempotency_key_mismatch` (A15), `isUndoable: false` (A14/D-R5-10) on the
  thin `commands/reservations.ts` command-bus wrappers (`availability.reserve`/`.release`/
  `.commit`).
- `wms`: `wmsReservationService` (Step 1.3) gained the gate itself —
  `reserveLinesForCheckout` (locks every balance row of every variant in one statement,
  re-derives sellable with the §4.2 shared builder, allocates across warehouses, inserts
  `wms` rows per `(variant, warehouse)` bucket), a real `convertInTransaction` (was a stub —
  this Step is its first real caller, converting a `'checkout'` hold to an `'order'` hold in
  place with a rebuilt idempotency key, per §4.4), and `emitSideEffects` (A19 cache
  invalidation parity with the existing `wms.inventory.reserve`/`.release` commands).
  `InventoryReservationSourceType` gained `'checkout'` (additive); the public
  `wms.inventory.reserve` command/route now explicitly reject it with `400
  checkout_reservation_is_system_only` (A16's functional half — the cosmetic i18n label and
  `UPGRADE_NOTES.md` entry are Step 6.2's named scope, not duplicated here).
- **Correctness bug found and fixed in this same commit, not shipped broken**: the first
  implementation of the gate's row lock used raw SQL (`em.getConnection().execute('...FOR
  UPDATE')`) reusing the A2 shared SQL builder as instructed. Against a REAL Postgres
  instance under N=20 real concurrent `reserve` calls for a single unit of stock, this
  oversold the unit — every caller saw the same pre-consumption snapshot, because this
  installed MikroORM version's raw `.execute()` never binds to the ambient ORM transaction
  unless its `ctx` parameter is passed explicitly, which `em.getConnection()` never supplies.
  Root-caused by reproducing the failure with verbose logging, then fixed by switching the
  lock AND the aggregate read to the same proven ORM-level pattern (`findWithDecryption(...,
  { lockMode: LockMode.PESSIMISTIC_WRITE }, ...)`) `wmsReservationService`'s own existing,
  tested `reserveInTransaction` path already relies on — computing the sellable arithmetic
  client-side from the now-correctly-locked entities (still calling the A2 builder's PURE
  `computeSellableQuantities` function, just fed from locked entities instead of a second raw
  query). Proved the fix is real, not a coincidence, by temporarily removing the lock mode and
  re-running the same N=20 pg test: it reproduced the exact oversell, confirming the test is
  not vacuous; the lock was restored immediately after and the full pg suite re-verified green
  before committing. Full reasoning in PLAN.md "Decisions taken without the owner".
- Tests: a new real-Postgres concurrency suite,
  `availability/lib/__tests__/reservationCommands.concurrency.pg.test.ts` (gated on
  `OM_AVAILABILITY_PG_URL`, 9 cases) — N=20 parallel reserve for the last unit (exactly one
  succeeds), multi-line all-or-nothing, backorder `min(requested,sellable)`, not_tracked for a
  non-stock-managed line, idempotency-key mismatch 409 + same-content replay, release
  idempotency (A21: second release / committed-hold release / unknown-key release are all
  no-ops), commit racing the expiry sweep (both the `recovered` and `stock_lost` branches,
  simulated by setting the hold's status to `expired` directly since the real sweep is Step
  2.3's scope), and cross-tenant/organization isolation. Plus a new unit test in
  `wms/commands/__tests__/inventory-actions.reserve-release.test.ts` for the A16 guard, and
  `wms/lib/__tests__/wmsReservationService.test.ts`'s `convertInTransaction` stub test
  rewritten to exercise the real conversion (the stub itself is gone).
- Checks: `yarn typecheck` in `packages/core` clean. Full `src/modules/wms` (65 suites, 429
  tests) and `src/modules/availability` (12 suites, 117 tests incl. the new pg suite skipped
  without the env var) pass — zero regressions. The gated pg suite itself: 9/9 pass against a
  throwaway `postgres:18-alpine` container (via the existing `colima` runtime), confirmed via
  mutation testing per the run brief's own instruction. `yarn build:packages` (`@open-mercato/
  core` et al.) green.
- Scope calls (all logged in PLAN.md "Decisions taken without the owner"): product-pool
  allocation (A7's pool check) deferred — not in this Step's 8-test gate, named explicitly as
  A20/Step 6.1 scope; §4.4's confirmed-first collision handling in `convertInTransaction`
  deferred — checkout never takes that path (D-R5-8); the service/command split (plain
  DI-resolved lib functions + thin `isUndoable: false` command wrappers) mirrors Step 1.3/1.6's
  own precedent rather than the spec's abbreviated single-argument pseudocode.

## 2026-10-26T21:00:00Z — Step 2.3 landed (closes Phase 2's availability track)

- `availability.reservation.expired` declared in `events.ts` (`availability/events.ts`) — the
  last of the four lifecycle ids Step 2.2 left undeclared for this Step; `.created`/`.released`/
  `.committed`/`shortfall.detected` were already emitted by Step 2.2's `reserve`/`release`/
  `commit` and are untouched here.
- `lib/reservationSweep.ts`: `expireAvailabilityReservations` (A11) — one-minute, tenant-scoped
  tick; pages `active` holds past `expires_at` (the §5.3 partial index), CAS to `expired` +
  `wmsReservationService.releaseInTransaction` in one transaction per hold, `emitSideEffects`
  then `.expired` after commit; a lost CAS (another transition already won) is skipped, never
  double-processed.
- `reconcileAvailabilityReservations` (A12) — hourly, tenant-scoped; repairs all three redefined
  drift cases per their own transaction + CAS: (a) active hold whose wms rows are released or
  missing → release the rest, CAS the hold to `released` (`reason: 'reconciled'`), emit
  `.released`; (b) an active `'checkout'` wms row no hold's `wmsReservationIds` references,
  older than the 3600 s max TTL → release it directly; (c) a committed hold whose wms rows are
  still `'checkout'` → `convertInTransaction` to `'order'`. Every repair is logged AND
  `reportError`-ed (never silent), same convention Step 1.8's exposure-audit job established.
- `wmsReservationService` gains two additive read methods (`findReservationsByIds`,
  `listActiveReservationsBySourceType`) — the reconciliation job's only way to see a hold's own
  wms rows, or every active cross-organization `'checkout'` row for a tenant, without a static
  `wms` entity import. See PLAN.md "Decisions taken without the owner" for the cross-org scope
  reasoning.
- Scheduling: `lib/scheduling.ts#registerAvailabilityReservationSweeperSchedules` (60 s / 3600 s
  interval schedules, tenant-scoped, mirrors `cart`'s own sweeper registration exactly), wired
  into `setup.ts#seedDefaults` (new tenants) and a new `availability.register-reservation-
  sweep-schedules` upgrade action (existing tenants, `configs/lib/upgrade-actions.ts`, version
  `0.10.0`) plus its 5-locale i18n keys — see PLAN.md for why the upgrade action was added
  despite not being named explicitly in this Step's own brief.
- Tests: new `availability/lib/__tests__/reservationSweep.test.ts` (7 cases) — the expiry job's
  false-positive guard (only a past-due `active` hold transitions and releases its wms row;
  active-not-due/committed/released/already-expired holds are untouched) plus a genuine lost-CAS
  race simulation; each of the three reconciliation drift cases with a concrete fixture, plus a
  clean-state no-op case; and an explicit A13 discipline test asserting every event these jobs
  emit is `availability.reservation.expired`/`.released`, carries `tenantId`/`organizationId`
  (X11), and is never `availability.shortfall.detected` (reserve/commit's own signal, a
  different trigger) nor anything resembling `wms.inventory.reservation_shortfall` (a different
  module's order-automation signal).
- Checks: `yarn workspace @open-mercato/core typecheck` clean. Full `src/modules/wms` +
  `src/modules/configs` (78 suites, 524 tests) and the targeted `src/modules/availability`
  suites pass — zero regressions from Step 2.2's work. `yarn i18n:check-hardcoded` shows no new
  findings under `core/availability` (the two pre-existing hits are Step 2.1/2.2's `commands/
  policies.ts`, untouched here).
- Phase 2's `availability` track is now feature-complete per PLAN.md's Phase 2 heading, pending
  the run's final gate (Step 6.4).

## 2026-10-26T21:30:00Z — Step 2.4 landed (customer_groups: `CustomerPurchaseApproval` entity + migration)

- `data/entities.ts`: `CustomerPurchaseApproval` (`customer_purchase_approvals`), exact column
  set per spec §5.6 — `organizationId`/`tenantId`/`customerId` (company, FK-id only),
  `requestedByActorType`/`requestedByActorId` (D-R5-1; `staff_user` reserved/unused for the
  REQUESTER per X7), `subjectType` (`cart | quote`, `quote` reserved for acceptance per
  D-R5-23/X6, `checkout_session` not in the enum at all), `subjectId`, `amountGross` (numeric
  16,2 decimal string) + `currencyCode`, `approvalPolicy` (the `CustomerGroupTerms.approvalPolicy`
  snapshot at creation), `status` (5-value lifecycle), the two decision slots
  (`buyerDecision`/`buyerDecidedByActorType`/`buyerDecidedByActorId`/`buyerDecidedAt`/
  `buyerDecisionNote` and the `merchant*` mirror, each slot `pending|approved|rejected|
  not_required`), `decidedAt`, `withdrawnReason`, `expiresAt`, `createdAt`/`updatedAt` (no
  `deletedAt` — an approval always transitions `status` instead of being soft-deleted).
  Constraints exactly as spec'd: partial unique `(tenant_id, subject_type, subject_id) WHERE
  status = 'pending'`, two `@Check` constraints pinning each decider's actor-type column to its
  side, plus the two named indexes for the status lookup and the expiry job.
- `data/validators.ts`: five new zod enum schemas mirroring the entity's TS unions
  (`customerPurchaseApprovalActorType/SubjectType/Status/SlotDecision/WithdrawnReason`). No
  create/update/delete trio — the spec names no public create route (service-only, Step 2.5)
  and this is not a `makeCrudRoute` entity.
- New test: `data/__tests__/purchaseApproval.test.ts` (9 cases) — entity/validator round-trip
  for all three policies (`both`/`buyer`/`merchant`), a withdrawn-with-reason case, and an enum
  rejection case per schema. Mirrors the `availability`/Step 2.1 `data/__tests__/reservation.test.ts`
  convention.
- Migration: `yarn db:generate` produced exactly one `customer_groups` migration
  (`Migration20261026201625_customer_groups.ts`, create-table only, no `down()` — matches this
  module's own create-table precedent) plus unrelated `forms`/`wms` drift (a stale index rename
  and a pre-existing `wms` idempotency-column gap, reproduced on a second bare `db:generate` run
  with zero `customer_groups` changes left) — discarded per the established coding-agent-
  exception pattern (Steps 1.5/1.9/2.1).
- Scope calls: none beyond the established discard pattern above — spec §5.6 names every column
  literally, so no "two decision slots" design ambiguity to resolve (not logged in PLAN.md's
  Decisions section for that reason). One minor implementation choice, not escalated: `status`/
  `buyerDecision`/`merchantDecision` have no entity-level default and must be set explicitly by
  every writer (Step 2.5's service) — a single hard-coded default would be wrong for some
  `approvalPolicy` values (e.g. `not_required` vs. `pending` depends on which side the policy
  requires), so leaving them required-with-no-default is safer than guessing one.
- Checks: `yarn typecheck` (`packages/core`) clean. `yarn jest` in `packages/core` for the full
  `customer_groups` suite: 36/37 suites pass (394/396 tests), 1 suite with 2 DB-dependent tests
  skipped (no live Postgres in this environment, pre-existing, unrelated to this Step).

## 2026-10-26T22:00:00Z — Step 2.5 landed (customer_groups: approval service + expire-approvals job)

- Blocking gap found and fixed first: `customerGroupsService#resolveTerms` never resolved
  `approvalPolicy` (Step 1.5 added the DB column only, not the resolution-loop plumbing) —
  `requestApproval` cannot snapshot a policy that never resolves. Added `approvalPolicy` to
  `TERMS_FIELD_NAMES`/`ResolvedTerms`/`tenantDefaultTerms`/`termsFieldIsSet`/`applyTermsField`
  (tenant default `'buyer'`, D-R5-1), deliberately NOT the other three new §6.0 fields
  (`termsCurrencyCode`/`allowQuoteRequests`/`requiresPoNumber` — no caller in this Step). Updated
  `resolveTerms.test.ts`'s two exact-object snapshots and added one inheritance test. Full
  reasoning and the explain-terms route's own non-exhaustive `satisfies` check: PLAN.md
  "Decisions taken without the owner".
- `services/customerPurchaseApprovalService.ts` (new): `requestApproval`/`getApproval`/
  `getActiveApprovalForSubject`/`withdrawApproval`/`decideApproval` per spec §6's authoritative
  contract (G3's floor). Every transition (`decideApproval`'s slot CAS + the dependent overall-
  status CAS, `withdrawApproval`'s CAS) is a plain `em.nativeUpdate` inside `em.transactional`,
  never `enforceCommandOptimisticLock` — G6's exact SQL pattern, with the overall-status flip
  computed from a same-transaction re-read (`computeOverallStatus`, generic over all three
  policies via a `not_required`-is-always-satisfied rule) so a `both`-policy race between the two
  sides lands correctly regardless of commit order. `requestApproval` is idempotent per
  `(subjectType, subjectId)` while pending (pre-check + `isUniqueViolation` race fallback, same
  pattern Step 1.6's `reserveCredit` established for G12). `decideApproval` enforces G24
  (self-decision refused; a `customer_user` actor's REAL company re-derived from
  `customer_accounts.CustomerUser` by actor id via a new `lib/creditIdentity.ts#
  resolveCustomerUserCompanyId` helper — never trusted from the caller-supplied
  `ApprovalActor.customerEntityId` field alone, per the task brief's explicit defense-in-depth
  instruction) — both violations answer the SAME `approval_not_found` shape spec §9.2 requires
  (no disclosure). `buyer_decision_note`/`merchant_decision_note` are registered in
  `encryption.ts` (G22) and read back through `findOneWithDecryption`/`findWithDecryption` since
  (unlike credit) the spec requires notes to round-trip to callers.
- `lib/expireApprovals.ts` + `workers/expire-approvals.worker.ts` (new): hourly, tenant-scoped,
  the SAME CAS pattern (`status = 'pending' AND expires_at <= now()` → `expired`), a lost race to
  a concurrent decide/withdraw is skipped silently (never reported as an error, §11 "safe to
  re-run"). Reads the already-stored `expires_at` only — never re-resolves the tenant's expiry
  window. Registered an hourly tenant-scoped schedule in `setup.ts#seedDefaults` (no upgrade
  action added for existing tenants — see PLAN.md).
- `events.ts`: declared and emit all five `customer_groups.approval.*` ids now
  (`requested`/`approved`/`rejected`/`expired`/`withdrawn`), each `portalBroadcast: true`
  (D-R5-6) — unlike the sibling `credit.*` events, which Steps 1.8/1.12 left undeclared absent a
  consumer. Reasoning for the asymmetry: PLAN.md.
- `di.ts`: new `customerPurchaseApprovalService` key (G26), soft-resolving an optional
  `moduleConfigService` (same `softCradle` pattern `catalog/di.ts` uses for
  `catalogOmnibusService`) for D-R5-27's per-tenant expiry-days override, default 14.
- Tests: `services/__tests__/customerPurchaseApprovalService.test.ts` (29 cases, fake EM) —
  every policy transition (`both`/`buyer`/`merchant`), G24's two guards (self-decision,
  cross-company incl. a forged-`customerEntityId` case), G8 idempotency incl. a simulated
  unique-violation race, withdraw's requester/system/non-pending rules, tenant/org isolation, the
  error body's `details` shape. `services/__tests__/customerPurchaseApprovalService.concurrency.
  pg.test.ts` (new, gated on `OM_CUSTOMER_GROUPS_PG_URL`, 6 cases) — ran for real against a
  disposable local Postgres (`om_cgrp_approval_test`, dropped after): N=20 concurrent decides on
  a single-slot policy AND N=20 on one slot of a `both`-policy approval (the harder case, since a
  lone slot decision leaves the overall `status` at `pending`, so only the slot-specific CAS
  condition — not the overall-status one — can be what excludes a second decider) both land
  exactly one winner; simultaneous buyer+merchant approvals and a simultaneous approve/reject
  pair, both from real, independent connections; decide-vs-expire at the boundary; N=20 concurrent
  `requestApproval` for the same subject create exactly one row. Mutation-tested the `both`-policy
  same-slot race specifically (not the single-slot one, which the overall-status guard alone
  already protects): temporarily removed just the `[fields.decision]: 'pending'` WHERE condition,
  re-ran — all 20 concurrent calls "won" and overwrote each other's slot, confirming the test is
  not vacuous; restored immediately and re-verified the full pg suite green before committing.
  `lib/__tests__/expireApprovals.test.ts` (new, fake EM, 4 cases) — the false-positive guard, a
  lost-CAS-race skip with no error report, tenant isolation, a clean no-op tick.
- Checks: `yarn workspace @open-mercato/core typecheck` clean. Full `src/modules/customer_groups`
  jest suite: 38/40 suites pass (428 tests; 2 suites skipped — 1 pg-gated suite intentionally run
  separately above then re-skipped by default, 1 pre-existing unrelated DB-dependent skip from
  Step 2.4), zero regressions. No UI touched — no browser verification needed.

## 2026-10-26T20:30:00Z — dispatcher: tracked follow-up from Step 2.5
- Step 2.5 found and fixed that `resolveTerms` never resolved `approvalPolicy` (added in Step 1.5
  but never wired in). It fixed only that one field (needed for its own Step). `termsCurrencyCode`,
  `allowQuoteRequests`, `requiresPoNumber` are STILL unresolved by `resolveTerms` as of `5db46425d1`.
  Flagging for the Steps that need each one, so they check and fix `resolveTerms` rather than
  re-deriving the value some other way:
  - `termsCurrencyCode` — needed by Step 3.1 (cart approval gate, K1/D-R5-4 currency-match rule)
    and by checkout's `min_order_value` check (Step 5.1).
  - `allowQuoteRequests` — needed by checkout B.5 (Step 5.1, D-R5-20 request_quote method gating).
  - `requiresPoNumber` — needed by checkout B.5 (Step 5.1, D-R5-28 PO-on-quote).

## 2026-10-26T21:00:00Z — checkpoint 4 (Steps 2.1–2.5)
- Range: `04f87ab424`..`5db46425d1`. Summary: availability reservation entity + reserve/release/
  commit service (bug found+fixed during concurrency testing: raw SQL FOR UPDATE wasn't binding
  to the ambient transaction, switched to ORM lockMode) + expiry/reconciliation jobs; customer
  purchase approval entity + CAS service (mutation-tested double-decide race) + expiry job.
- Checks: forced full typecheck (40/40, 0 cached) pass; scoped tests pass (availability+wms+
  customer_groups 115/118 suites, 973/990 tests — 3 expected Postgres-gated skips).
- Decisions/problems: none blocking. One tracked follow-up already logged above (resolveTerms
  gaps). availability track is now fully complete for this release.

## 2026-10-26T22:00:00Z — Step 2.6 landed
- `customer_groups`: staff routes — `GET /api/customer_groups/customer-groups/approvals` (list,
  `approvals.view`, filters `status`/`customerId`/`subjectType`/`ids`, organization-scoped via the
  same `resolveOrganizationScopeForRequest` the credit routes use), `GET …/approvals/:id` (detail,
  same feature), `POST …/approvals/:id/decide` (`approvals.decide`, body `{ decision, note? }`,
  optimistic-lock header via `enforceCommandOptimisticLock` since the service itself does not read
  it, G6/§5.6). The staff actor is always `{ actorType: 'staff_user', actorId: auth.sub }` — no
  `side` input exists on `decideApproval` (Step 2.5 derives the slot from `actor.actorType`
  directly, simpler than the brief's own framing).
- Portal routes (new `api/portal/approvals/` tree) — `GET /api/customer_groups/portal/approvals`
  (list, pending-first, `…portal.approvals.view`), `GET …/:id` (detail), `POST …/:id/decide`
  (`…portal.approvals.decide`, buyer slot), `POST …/:id/withdraw` (`…portal.approvals.view`,
  requester-only enforced by the SERVICE's own actor comparison). Every portal route resolves the
  customer session via `customer_accounts/lib/customerAuth` (static import, same convention as
  `workflows/api/portal/tasks/route.ts` — both are `packages/core` modules, no extractability
  concern like `staff`'s dynamic import). A request for another company's approval answers 404,
  the same body as an unknown id (`lib/portalApprovalAccess.ts`'s `isApprovalVisibleToPortalPrincipal`
  — one pure predicate, reused by list/detail/decide/withdraw, no second copy of the rule).
- ACL (`acl.ts`): added `customer_groups.approvals.view`/`.decide` (staff) and
  `customer_groups.portal.approvals.view`/`.decide` (portal), `dependsOn` the sibling `.view` each,
  closing the deferral Step 1.7 logged. `setup.ts`: `employee` → `approvals.view` (D-R5-7);
  `defaultCustomerRoleFeatures.portal_admin` → both portal features, `.buyer` → view only (own
  requests/withdraw enforced by route scoping, not feature withholding — per the Step brief's own
  explicit instruction).
- `services/customerPurchaseApprovalService.ts`: exported `toApprovalView` (was private) so the
  new list/detail routes serialize through the exact same mapping `getApproval`/`decideApproval`/
  `withdrawApproval` already return — additive, no behavior change.
- Tests: `lib/__tests__/portalApprovalAccess.test.ts` (8 cases) for the pure visibility
  predicate/list-`WHERE` builder; `data/__tests__/purchaseApprovalRoutes.test.ts` (9 cases) for the
  new decide/list-query zod schemas (`.strict()` body, pageSize cap, filter validation). New
  Playwright integration spec `TC-CGRP-034-purchase-approval-routes.spec.ts` (2 tests): staff
  decide feature-gating + tenant/organization isolation + re-decide-409; portal company scoping
  (buyer sees/withdraws only their own requests, a `…decide` holder sees the whole company,
  self-decision 403, cross-company 404 on every route, viewer gets 403 with no portal feature at
  all) — written against the live-DB `withClient` fixture convention this suite's siblings already
  use (no create route exists for approvals, so every fixture row is inserted directly), NOT
  executed in this sandboxed worktree (no live Postgres/dev server here) — same situation as every
  prior `__integration__` spec in this run; run it via the project's normal QA/CI pipeline.
- Checks: `yarn workspace @open-mercato/core typecheck` clean (0 errors). Full
  `src/modules/customer_groups` jest suite: 40/42 suites pass, 445/453 tests (8 skipped — the two
  pg-gated concurrency suites, expected without a live Postgres), zero regressions. `eslint` clean
  on every new/changed file. No UI touched — no browser verification needed.

## 2026-10-26T21:52:32Z — Step 2.7 landed
- `customer_groups`: approval notifications — in-app to merchant deciders (`customer_groups.
  approval.requested`, new type in `notifications.ts`, fan-out via `createForFeature` +
  `restrictRecipientsToOrganization: true` to every staff holder of `customer_groups.approvals.
  decide` in the organization, idempotent on redelivery for free via the notification system's own
  `groupKey` dedupe); e-mail to buyer-side deciders/requesters through the shared `sendEmail`
  pipeline, gated by a new per-tenant switch (`ModuleConfigService` key `customer_groups.
  approval_emails_enabled`, default ON, same call shape `resolveApprovalExpiryDays` already
  established in this module).
- Did NOT declare `customer_groups.approval.decided` — the authoritative, REVISED spec text
  (§10.2's own closing line) explicitly says it is not declared in Release 5 (no path creates a
  staff-requested approval, X7), directly contradicting the pre-decision G15 wording the Step brief
  quoted. Did NOT e-mail the requester on `.withdrawn` — §10.2's e-mail trigger table names only
  `.approved`/`.rejected`/`.expired`. Both are genuine conflicts between the Step brief (which
  quotes the ANALYSIS doc, written BEFORE the owner's decision pass) and the spec (written AFTER
  it, and the explicitly authoritative text per PLAN.md's own "Implementation Plan" preamble) — see
  PLAN.md "Decisions taken without the owner" for the full reasoning and code citations.
- Idempotency for the e-mail sends (no platform primitive exists for this — persistent subscribers
  are only at-least-once, and `sendEmail` has no dedup of its own): added two additive, nullable
  timestamp columns to `CustomerPurchaseApproval` (`requested_email_sent_at`,
  `decided_email_sent_at`) as CAS markers, migration `Migration20261026213913_customer_groups`
  (generated via `yarn db:generate`; two unrelated migrations it also emitted for `forms`/`wms`
  were deleted and their snapshots reverted per the coding-agent exception in root AGENTS.md).
- New files: `lib/approvalNotifications.ts` (merchant in-app fan-out), `lib/approvalEmails.ts`
  (buyer e-mail fan-out + requester e-mail + the per-tenant switch + the CAS markers), `lib/
  approvalEmailRecipients.ts` (FK-id-only raw-SQL reads against `customer_accounts.customer_users`,
  no ORM import — same convention `lib/creditIdentity.ts` already set), `lib/
  approvalDecidedSubscriberHandler.ts` (shared dispatch behind the three decided subscribers),
  `emails/ApprovalEmail.tsx` (shared buyer-facing e-mail layout, modelled on `customer_accounts/
  emails/CustomerInvitationEmail.tsx`), four subscribers (`subscribers/approval-{requested,
  approved,rejected,expired}-notification.ts`, one event id per file per the `events` module's own
  registry contract).
- `customer_accounts` (`customerRbacService`, for the portal-decide feature check) and `configs`
  (`moduleConfigService`, for the switch) are both resolved via a local `tryResolve` helper and
  degrade to "skip the e-mail" when absent — optional peers, per `packages/core/AGENTS.md` → Cross-
  Module Coupling, same pattern `customer_groups/di.ts`'s own `softCradle` already established for
  `moduleConfigService`.
- No deep link on the new in-app notification — no staff admin UI page for approvals exists yet
  (Step 2.6 shipped API routes only); left `linkHref` unset rather than inventing one, same
  restraint `customer_groups.credit.limit_exceeded` took in Step 1.8.
- Tests: `lib/__tests__/approvalNotifications.test.ts` (merchant fan-out + groupKey + feature id),
  `lib/__tests__/approvalEmails.test.ts` (all three policies' routing, the per-tenant switch, the
  CAS-marker idempotency on redelivery for both the requested batch and the decided single-send,
  the never-staff-requester guard, requester exclusion from the buyer-decider list),
  `lib/__tests__/approvalDecidedSubscriberHandler.test.ts` (status binding, payload parsing),
  `subscribers/__tests__/approval-requested-notification.test.ts` (policy-gated dispatch, one
  channel's failure not blocking the other).
- Checks (local mode, no Docker `app` container running): `yarn db:generate` (customer_groups
  migration reviewed, unrelated forms/wms output discarded); `yarn generate` (clean, 381 generated
  artifacts refreshed); `npx tsc --noEmit` scoped to `packages/core` clean (0 errors); `npx jest
  src/modules/customer_groups` from `packages/core` (root `yarn jest` fails on every suite here,
  known issue) — 44/46 suites pass, 467/475 tests, 2 suites skipped (pg-gated concurrency, expected
  without a live worker harness), zero regressions; `eslint` clean on every new/changed file. No UI
  touched — no browser verification needed.

## 2026-10-26T22:06:30Z — Step 2.8 landed
- `cart`: lock contract (C1/X15). `cart.lock` gains a bounded, optional `lockTtlMs` (`60_000..
  86_400_000`, default unchanged — `resolveCartLockTimeoutMs()`, the existing env-configurable 30
  min). A second `cart.lock` call carrying the SAME `checkoutSessionId` the cart is already locked
  under is now an idempotent EXTEND: it moves `lockExpiresAt` forward and returns the cart with a
  new `extended: true` flag, running neither the forced re-price nor the whole-cart visibility pass
  (both confirmed skipped by a dedicated test asserting `cart.reprice` is never dispatched a second
  time). A re-lock attempt with a DIFFERENT or ABSENT `checkoutSessionId` is completely unchanged —
  still the ordinary 423 `cart_locked` — covered by a new regression test for the no-session case
  alongside the pre-existing different-session one.
- `cart.unlock`/`cart.markConverted` both gain an OPTIONAL `checkoutSessionId` input: when the
  caller supplies it, a mismatch against the cart's own stored session is refused with the uniform
  404 (same no-oracle body every other refusal in this module already uses); when omitted, both
  commands behave exactly as before this Step — no session check runs at all. Decision (logged in
  PLAN.md): optional rather than mandatory, because these commands already shipped in Release 4
  (this fork's own develop, PR #7592) and root AGENTS.md/`BACKWARD_COMPATIBILITY.md` treat a
  shipped command's signature as frozen regardless of whether an in-repo caller exists yet — even
  though `commands/lock.ts`'s own header comment confirms none of the three commands has a real
  caller in this worktree today (no `checkout` module exists). No DB migration needed —
  `Cart.checkout_session_id` already existed as a column since Release 4.
- New event `cart.lock.extended` (alongside the pre-existing `cart.lock.acquired`/`.released`/
  `.timed_out` family) for the `locked -> locked` transition, same "no real consumer yet" posture
  its siblings already have.
- Files: `packages/core/src/modules/cart/commands/lock.ts` (bounds validation, the extend branch
  and its own `extendCartLock` helper, session-match guards on `unlock`/`markConverted`),
  `packages/core/src/modules/cart/events.ts` (new event id), `packages/core/src/modules/cart/
  commands/__tests__/lock.test.ts` (10 new tests: bounds validation on both fresh-lock and extend,
  explicit `lockTtlMs` honoured on a fresh lock, the extend's TTL bump + no-reprice-dispatch
  guarantee + event, the env-default fallback on an extend, the no-session-still-423 regression
  guard, and matched/mismatched `checkoutSessionId` for both `unlock` and `markConverted`).
- Checks (local mode): `npx tsc --noEmit` scoped to `packages/core`, clean (0 errors). Full
  `src/modules/cart` jest suite from `packages/core`: 18/18 suites, 226/226 tests, zero regressions
  outside this Step's own new tests (one existing test's expected-error log line, `currentCartRoute.
  error-mapping.test.ts`, prints "boom" to stderr by design — not a failure). No UI touched, no
  `yarn generate`/`yarn db:generate` needed (no new auto-discovered files, no schema change).

## 2026-10-26T22:26:13Z — Step 2.9 landed

- **Behavior change (D-R5-21, UPGRADE_NOTES-ready description for Step 6.2):** every
  `/api/cart/current/*` route (`current`, `current/lines`, `current/lines/[lineId]`,
  `current/lines/bulk`, `current/promotions`, `current/promotions/[id]`, `current/merge`,
  `current/undo-merge`) now refuses an IDENTIFIED basket (one with `customer_user_id` set) to
  any request that does not also carry that buyer's own customer session (`X-Cart-Token` plus
  a valid `customer_auth_token` cookie or `Authorization: Bearer <customer JWT>` whose subject
  equals the basket's `customer_user_id`). A request with no session, or with a DIFFERENT
  customer's valid session, now gets the exact same `404` body as an unknown/wrong token — no
  re-price, no re-identification, no activity stamp runs. `POST /current/merge`'s `sourceToken`
  body field follows the identical rule for the SOURCE (guest) cart it names. A GUEST basket
  (`customer_user_id` null) is completely unaffected and stays fully token-only, exactly as
  before. Before this change, an anonymous `GET /current` presenting an identified basket's
  token silently re-identified that basket to "guest" (`customerUserId` rewritten to `null` by
  the whole-cart re-price trigger), disclosing B2B contract pricing and re-pricing the basket to
  list — the storefront integration must now forward the buyer's customer session alongside the
  cart token on every request, and must start a brand-new guest cart after logout rather than
  reusing the old token (a later login still merges it normally). No cart/API contract fields
  changed — only the authorization outcome for this one case.
- **Non-breaking addition (D-R5-22):** a trusted `pos`/`pay_link`/`agent`/`api` cart created
  via `cart.create`'s authenticated path for a known buyer (`customerId` or `customerUserId`
  supplied by the trusted caller, never from request input) now resolves that buyer's REAL
  company/group/price-kind identity through `storeContextService.resolveForBuyer` when
  `ecommerce` is registered — `customerId`, `customerIds` (person AND company), `customerUserId`,
  `customerGroupIds`, `priceKindId`, `taxMode` and `buyerDigest` all come from the resolved
  identity instead of the old placeholder (`customerIds = [customerId]`, no groups, no price
  kind). `currencyCode` is unaffected — it stays the trusted caller's own required input, per
  the spec's own fill list. A guest trusted cart (no buyer named) or a deployment with
  `ecommerce` disabled behaves exactly as before (documented fallback, not silent).
- Files: `packages/core/src/modules/cart/lib/currentCartRoute.ts` (the identity-binding check,
  centralized once in `resolveCurrentCart`'s own `peekCartCustomerUserId` pre-check — runs
  BEFORE `cart.get` so the old bypass's own write path, trigger 2's `applyCartRepriceTriggerFields`,
  can never fire for a mismatched/anonymous request against an identified basket);
  `packages/core/src/modules/cart/commands/merge.ts` (the SAME check applied to `sourceToken`'s
  resolved guest cart); `packages/core/src/modules/cart/commands/cart.ts` (the trusted-path
  `resolveForBuyer` fill, `resolveTrustedCartBuyerIdentity`/`tryResolveStoreContextService`).
  Tests: `packages/core/src/modules/cart/lib/__tests__/currentCartRoute.identity-binding.test.ts`
  (new, 6 cases), `packages/core/src/modules/cart/commands/__tests__/merge.test.ts` (+3 cases),
  `packages/core/src/modules/cart/commands/__tests__/cart.test.ts` (+3 cases).
- Two scope calls made without the owner, both logged in PLAN.md "Decisions taken without the
  owner": (1) extended Part A to also cover `cart.merge`'s `sourceToken`, which the task brief's
  own bullet list did not name but §8.4's text explicitly lists as a consequence of the same
  rule; (2) followed the spec's literal seven-field `resolveForBuyer` fill list over the task
  brief's broader field list, which named `currencyCode` — the spec text and the trusted
  caller's own required-field validator both confirm the omission is deliberate.
- Checks (local mode, no Docker `app` container running): `npx tsc --noEmit` scoped to
  `packages/core`, clean (0 errors). Full `src/modules/cart` jest suite from `packages/core`:
  19/19 suites, 238/238 tests — zero regressions (226 pre-existing + 12 new: 6 identity-binding
  + 3 merge sourceToken + 3 trusted-path identity fill). `eslint` clean on every changed/new
  file. The X1 regression test (`resolveCurrentCart`'s "an identified basket refuses a
  token-only anonymous request" case) and the guest/token-only preservation test both pass,
  proving the old bypass path can no longer be reached and guest baskets are unaffected. No UI
  touched, no `yarn generate`/`yarn db:generate` needed (no new auto-discovered files, no schema
  change).

## 2026-10-27T00:00:00Z — Step 2.10 landed

- `cart`: `markConverted` additive `salesOrderId`/`salesQuoteId`/`lineMap` inputs (K8/D-R5-26),
  and the FIRST admin UI this module ships — `GET /api/cart/carts` + `/carts/[id]` + `POST
  /carts/[id]/reprice` (K6) with a `DataTable` list, a read-only detail page, and i18n in all 5
  locales.
- `cart.markConverted`: `lineMap` entries are `{ cartLineId, salesOrderLineId }` under
  `salesOrderId`, or `{ cartLineId, salesQuoteLineId }` under `salesQuoteId` — never both ids in
  one call (D-R5-26). Validated before any write: every entry's `cartLineId` must be a live line
  of the cart, every live line must appear exactly once (bijection), and every entry must match
  the SAME discriminant the call named — any violation throws `400
  cart_convert_line_map_invalid` with nothing written. A caller naming none of the three fields
  behaves exactly as before this Step (regression-tested). `cart.cart.converted`'s payload grows
  additively to the full §11 rev-10 shape: `{ cartId, tenantId, organizationId,
  checkoutSessionId, salesOrderId, salesQuoteId, lineMap }` (all three new fields `null` when
  omitted).
- Admin `GET /api/cart/carts` (`makeCrudRoute`, `cart.carts.view`): filters
  `status`/`channel`/`storeId`/`customerId`/`requiresApproval`/`lastActivityFrom`/
  `lastActivityTo`/`ids`; `kind` defaults to, and can ONLY be, `basket` (the §7a proposal seam
  stays unreachable, K12's "pin the inert seam" posture, until Step 3.4); sorts by
  `lastActivityAt` (default) or the new `grandTotalGrossAmount` generated column;
  `pageSize ≤ 100`; `email` decrypted through the query engine with no free-text search on it
  (search by `customerId`); `lineCount` batched in one `CartLine` query per page.
- Admin `GET /api/cart/carts/[id]` (hand-written, `cart.carts.view`): reuses
  `buildCartResponseEnvelope` for lines/totals/warnings, layered with admin-only fields
  (`kind`/`channel`/`storeId`/`customerId`/`customerUserId`, decrypted `email`/`note`,
  `proposedToCartId`), the LIVE approval via `customerPurchaseApprovalService.getApproval`
  (soft `tryResolve`, both branches tested — present and absent), and `CartMergeLog` entries.
  404s on an unknown cart, another organization, another tenant, or a proposal cart.
- Admin `POST /api/cart/carts/[id]/reprice` (hand-written, `cart.carts.manage`, trigger 7):
  REQUIRES the optimistic-lock header (`400` if missing, not merely fail-open —
  `enforceCommandOptimisticLock`'s own default); accepts `active` OR `abandoned` carts (`423`
  locked, `409 cart_not_active` otherwise); refreshes the buyer's identity via `ecommerce`'s
  `storeContextService.resolveForBuyer` from the cart's OWN stored identity (soft peer, never
  from the staff caller's request) before dispatching `cart.reprice` with the new
  `trigger: 'admin_reprice'`; returns the §10.1 envelope with `versionBumpReason: 'repricing'`.
- `commands/cart.ts` changes backing the admin reprice action: `cart.reprice`'s status guard now
  accepts `'active' | 'abandoned'` (the command never writes `Cart.status`, so this can never
  reactivate a basket); `applyCartRepriceTriggerFields` gained a dedicated `'admin_reprice'`
  branch that only overwrites a buyer-identity field when the admin route actually resolved one
  (never wipes an existing field on a partial/absent refresh, unlike trigger 2's always-full
  overwrite); the §6a.2 whole-cart re-visibility pass now also runs for `admin_reprice`.
- New generated column `Cart.grandTotalGrossAmount` (`grand_total_gross_amount`, Postgres STORED
  GENERATED from `totals->>'grandTotalGrossAmount'`, same declarative pattern as
  `CartLine.configurationHash`/`wms.InventoryBalance.quantityAvailable`), backing the admin
  list's `grandTotalGrossAmount` sort — mirrors how `sales/data/entities.ts` already stores its
  own grand total as a flat column. Migration + `.snapshot-open-mercato.json` hand-authored
  (documented in PLAN.md's decisions log — a local Postgres exists in this sandbox but holds
  unrelated prior-session schema state, so `yarn db:generate` was skipped in favor of a two-
  statement `alter table` matching this module's own existing generated-column precedent).
- Route-enumeration test (`api/carts/__tests__/routeEnumeration.test.ts`) asserts every admin
  cart route file exports exactly the one HTTP method it needs (`GET`/`GET`/`POST`) and nothing
  that could mutate a line — closing §10.2/§14's "no admin route adds, updates or removes a
  line" guarantee at the HTTP layer.
- Files: `packages/core/src/modules/cart/commands/lock.ts` (`markConverted` inputs + validation),
  `packages/core/src/modules/cart/commands/cart.ts` (status guard, `admin_reprice` field
  branch + revisibility gate), `packages/core/src/modules/cart/lib/reprice.ts` (new
  `'admin_reprice'` reason), `packages/core/src/modules/cart/data/validators.ts` (lineMap +
  admin list/reprice schemas), `packages/core/src/modules/cart/data/entities.ts`
  (`grandTotalGrossAmount` generated column + index), `packages/core/src/modules/cart/migrations/
  Migration20261026231500_cart.ts` + `.snapshot-open-mercato.json`, `packages/core/src/modules/
  cart/lib/adminCartScope.ts` (new — org-scope + approval-service tryResolve helpers),
  `packages/core/src/modules/cart/api/carts/{route.ts,[id]/route.ts,[id]/reprice/route.ts}` (new),
  `packages/core/src/modules/cart/backend/cart/carts/{page.tsx,page.meta.ts,[id]/page.tsx,
  [id]/page.meta.ts}` (new), `packages/core/src/modules/cart/i18n/{en,pl,es,de,ko}.json` (+71
  keys each, real per-locale translations, not English placeholders). Tests: `commands/
  __tests__/lock.test.ts` (+8 markConverted cases: backward-compat no-op, order/quote lineMap,
  both-ids rejection, foreign-line rejection, incomplete-bijection rejection, wrong-shape
  rejection), `commands/__tests__/cart.test.ts` (+4 reprice cases: abandoned acceptance, merged
  rejection, partial-refresh non-destructive, full-refresh), `api/carts/__tests__/route.test.ts`
  (buildFilters + kind rejection + lineCount afterList), `api/carts/[id]/__tests__/route.test.ts`
  (401/404×3/200, approval present/absent, merge-log mapping), `api/carts/[id]/reprice/
  __tests__/route.test.ts` (ACL metadata, missing/stale optimistic-lock header, 404×2, 423, 409,
  abandoned acceptance, trigger/routeContext shape, envelope shape), `api/carts/__tests__/
  routeEnumeration.test.ts` (new).
- Checks (local mode): `npx tsc --noEmit` scoped to `packages/core`, clean (0 errors). Full
  `src/modules/cart` jest suite from `packages/core`: 23/23 suites, 280/280 tests — zero
  regressions (238 pre-existing + 42 new). `eslint` clean on every new/changed file.
  `i18n-check-sync`: all 5 locales in sync (69 modules). `i18n-check-hardcoded`: zero hits under
  `modules/cart/` (advisory, exit 0 either way). `yarn generate`: completed (exit 0, 383
  generated artifacts refreshed, cart's own `api-route-shard.*.cart.generated.ts` picked up the
  three new routes) — every generated output lives under the gitignored `.mercato/generated/`
  tree, so nothing new is tracked by git. No `yarn db:migrate` run (hand-authored migration per
  the documented decision above).
- Scope calls made without the owner (full reasoning in PLAN.md's decisions log): the new
  `grandTotalGrossAmount` generated column + migration (root-causing the admin list's sort
  requirement rather than dropping it); `checkoutSessionId` added to the `cart.cart.converted`
  payload (§11's own literal shape, not explicitly named in the brief); `cartMarkConverted
  LineMapEntrySchema`'s plain-string (not `uuid()`) id fields; the admin reprice status guard's
  blanket (not trigger-scoped) `'active' | 'abandoned'` relaxation; a dedicated
  `'admin_reprice'` field-application branch; `tryResolveCustomerPurchaseApprovalService` kept
  despite `customer_groups` being a hard dependency; and `lib/adminCartScope.ts` duplicating
  (never importing) `customer_groups`' own module-private scope helper.

## 2026-10-27T00:30:00Z — Step 2.11 landed (closes Phase 2's `cart` track)

- `cart.cart.abandoned` (K9, §11 as revised) grows from `{ cartId }` to the full Release 5
  shape: `{ cartId, tenantId, organizationId, storeId, channel, customerId, customerUserId,
  hasEmail, currencyCode, grandTotalGrossAmount, lineCount, lastActivityAt }`. `hasEmail` is a
  derived boolean (`Boolean(cart.email)`) — the decrypted `email` string itself never appears on
  the payload (no PII leak, this run's established redaction discipline). `grandTotalGrossAmount`
  reads Step 2.10's generated column directly rather than recomputing from the `totals` jsonb.
  `lineCount` is batched in ONE `CartLine` query per sweep page (never N+1), mirroring the exact
  pattern `api/carts/route.ts`'s own `afterList` hook already established for the same field
  (Step 2.10). `cart.cart.expired`'s own payload is unchanged — K9 only names `.abandoned`.
- K11: `mark-abandoned-carts` and `expire-carts` now release every distinct code reservation a
  transitioned basket holds, by `cartId` — closing the Release 4 deferral `lib/sweepers.ts`
  carried at this exact spot since Step 4.8/7.2. Implemented as a new local helper,
  `releaseCartCodeReservations`, which enumerates the basket's `CartPromotionApplication.codeId`
  values (deduped — a code referenced by more than one promotion's rule tree gets exactly one
  release call, mirroring `commands/promotions.ts#removePromotionCommand`'s own pattern) and
  calls `codeService.releaseCode(em, codeId, cartId, scope)` for each, immediately after that
  cart's own lifecycle-event emission in the same per-cart loop (no extra transaction — matches
  this file's existing "the DB transition already committed, side effects run after" shape).
  Best-effort: a release failure is logged and swallowed, never re-thrown to retry an already-
  landed status transition — the exact same reasoning this file's own `emitCartLifecycleEvent`
  already documents for itself, now applied identically to the new call; `promotions`' own
  `code-reservation-sweeper.ts` (TTL-based, independent) is the safety net for whatever this
  call does not reach.
- `codeService` is injected, never DI-resolved inside `lib/sweepers.ts` itself — a new exported
  duck type, `CartCodeServiceLike` (`releaseCode(em, codeId, cartId, scope): Promise<void>`),
  matching `promotions/lib/code-service.ts#PromotionCodeService.releaseCode`'s exact signature
  with zero static `promotions` entity import. Both `sweepAbandonedCarts`/`sweepExpiredCarts`
  gained a new required `codeService: CartCodeServiceLike` parameter (ahead of the existing
  `now` default), and both workers (`mark-abandoned.worker.ts`/`expire.worker.ts`) now resolve
  it via `ctx.resolve<CartCodeServiceLike>('promotionCodeService')` — `promotions`' own frozen DI
  token (§Release 4 Contract Freeze) — before calling the sweep. `cart`'s `index.ts` already
  lists `promotions` as a hard `requires`, so this resolve can never fail for "module not
  installed" the way a soft `tryResolve` would need to guard against.
- **Verified, not a gap:** `expire-carts`/`mark-abandoned-carts` are the only two sweepers K11
  names, and they are also the only two `kind = 'basket'` transitions that ever set `resolvedAt`
  BEFORE `purge-expired-carts` can see a cart — `release-stale-locks` doesn't touch `resolvedAt`
  at all (a `locked -> active` row stays non-terminal). So neither of K11's two targets is a
  real gap for `purgeExpiredCarts` to additionally cover.
- **Gap found and deliberately left open (not silently expanded into this Step's scope):**
  `purgeExpiredCarts`'s own `WHERE` (`kind: 'basket'`, `resolvedAt` past the 90-day cutoff) has
  no `status` filter, and TWO other transitions write `resolvedAt` directly without ever passing
  through `expire`/`mark-abandoned` first — `cart.markConverted` (`commands/lock.ts:~506-507`,
  `status = 'converted'`) and `cart.merge`'s absorbed-cart finalization (`commands/merge.ts:
  ~595-597`, `status = 'merged'`). A converted or merged basket that still held an open
  `CartPromotionApplication`/`CodeReservation` pair at that moment (today: always true for
  `markConverted`, since no caller in this worktree calls `promotions.code.use` before it —
  that lands in checkout's own Phase 4 submit, Steps 4.1–4.2) will reach `purgeExpiredCarts`'s
  90-day cutoff with that reservation never released by THIS file's mechanism. K11's own text
  names only `expire`/`mark-abandoned`, not `purge`, `markConverted`, or `merge` — extending the
  release call to either of those two commands, or to `purgeExpiredCarts` itself, is a materially
  different change (a NEW call site in `commands/lock.ts`/`commands/merge.ts`, not a sweeper
  the brief already named) than this Step was asked to make, so it was left alone rather than
  silently grown. In practice this is non-fatal today: `promotions`' own
  `code-reservation-sweeper.ts` is an independent, TTL-based safety net that releases a lapsed
  `CodeReservation` row regardless of the cart's own state, and once checkout's real submit
  sequence lands (Phase 4) a converted cart's codes will already be consumed via
  `promotions.code.use` (which deletes the `CodeReservation` row itself, same transaction) before
  `markConverted` is ever called — so the gap is real today but time-bound, not a correctness
  defect in what K11 asked for. Flagged here per the task brief's own instruction rather than
  expanding scope to fix it.
- Files: `packages/core/src/modules/cart/lib/sweepers.ts` (`CartCodeServiceLike`,
  `releaseCartCodeReservations`, both sweepers' new `codeService` parameter, the K9 payload,
  the purge doc-comment), `packages/core/src/modules/cart/workers/mark-abandoned.worker.ts` +
  `expire.worker.ts` (resolve `promotionCodeService`, pass it through). Tests:
  `lib/__tests__/sweepers.test.ts` — rewrote the `cart.cart.abandoned` assertions to the full K9
  shape, added a dedicated full-field-coverage test (non-default values on every field, asserts
  `email` itself never appears on the payload), added K11 coverage for both sweepers (releases
  every distinct code once each, a reservation-free basket calls `releaseCode` zero times, a
  `releaseCode` rejection never blocks the transition or the event), and a tenant-isolation
  regression check for `sweepExpiredCarts`. `makeEm`'s stub grew two new read-only in-memory
  tables (`CartLine`, `CartPromotionApplication`) and two new fixture builders.
- Checks (local mode, from `packages/core`): `TMPDIR=/tmp yarn jest src/modules/cart/lib/
  __tests__/sweepers.test.ts` — 27/27 passing. Full `src/modules/cart` jest suite — 23/23
  suites, 287/287 tests, zero regressions (260 pre-existing + 27 new/changed). `src/modules/
  promotions` jest suite — 28/28 suites, 333/333 tests, unaffected (confirms `PromotionCodeService
  .releaseCode`'s own signature/behavior was read, never edited). `TMPDIR=/tmp yarn typecheck`
  (scoped to `packages/core`) — clean, exit 0. `npx eslint` on all four touched files — clean.

## 2026-10-27T19:40:00Z — checkpoint 5 (Steps 2.6–2.11)
- Range: `38149dcb0a`..`7443c78d16`. Summary: approval portal/staff routes + ACL/grants +
  notifications (customer_groups approval track complete); cart lock extend, D-R5-21/22 identity
  binding (recorded behavior change, UPGRADE_NOTES-ready description already logged above by
  Step 2.9 itself), markConverted lineMap + first cart admin UI, abandonment payload + K11
  code-release.
- Checks: forced full typecheck (40/40, 0 cached) pass; scoped tests pass (customer_groups+cart+
  promotions 95/97 suites, 1087/1095 tests — 2 expected Postgres-gated skips).
- Process note: this checkpoint covers 6 Steps, not 5 — a pacing slip (dispatched 2.10→2.11
  without pausing). No quality impact; resuming strict every-5 pacing from Step 2.12.
- Decisions/problems: none blocking. One non-blocking gap from 2.11 (purge sweeper / converted
  baskets' code reservations) already logged above.

## 2026-10-27T20:30:00Z — Step 2.12 (checkout B.1: session entity, step machine, C14 minimum)
- First `checkout`-module Step in this run. `checkout` was Phase-A-only before this Step (pay
  links/templates/transactions, `/pay/[slug]`); `index.ts` declared NO `requires` at all.
- Shipped: `CheckoutSession` + `CheckoutSessionEvent` entities + hand-authored migration
  (`Migration20261027120000.ts`) + `.snapshot-open-mercato.json` edit (local Postgres holds
  unrelated QA-session schema drift, same reasoning Step 2.10 already gave — ran `yarn generate`
  only, not `yarn db:generate`, against this worktree); `checkout.session.create`/`.update`
  commands; `POST /api/checkout/sessions` (buyer, from `{ source: 'cart' }` + `X-Cart-Token`
  only — `{ source: 'link' }`/B.2 is Step 3.5's own scope and fails zod validation, not a
  silent no-op); `GET`/`PATCH /api/checkout/sessions/current` (`X-Checkout-Session-Token`,
  D-R5-33 binding, C21 scope); admin `GET /api/checkout/sessions` + `/sessions/[id]`
  (`checkout.sessions.view`); `checkout.sessions.view`/`.manage` ACL + `employee`/`admin` grants
  (D-R5-34); `checkout:checkout_session` encryption map (email/phone/shipping_address/
  billing_address); `CheckoutSessionEvent.payload` allowlist-redaction at write time;
  `enforceCheckoutRateLimit` extended with an additive `keyOverride` + three new rate-limit
  configs (create 20/min/IP, mutate 60/min/session + 120/min/IP, all fail-closed per §13's own
  table); `lib/session-status-machine.ts` (the §4.1 status enum + this Step's own synthesized
  legal-transition table, CAS-enforced via `nativeUpdate`, same pattern as `checkout.transaction
  .updateStatus`'s `VALID_CHECKOUT_TRANSITIONS`).
- **Decision — scope cut on session creation's cross-module cart lookup (not in the task brief,
  found during implementation):** `cart.get`'s own command input REQUIRES `tenantId`/
  `organizationId` upfront, which checkout cannot know before resolving a bare `X-Cart-Token`
  (a guest buyer's only credential, §9.0 — no store/host-mapped tenant resolution is reliable for
  every channel: `storeContextService.resolve` ALWAYS requires a resolvable store-by-host, which
  would make `POST /sessions` unusable for the agent/API-only selling model the spec's own
  Executive Summary names as a release invariant). Resolved by a SCOPE-FREE lookup
  (`lib/cartPeer.ts#lookupCartPeerByToken`) against `cart`'s globally-unique `carts.token_hash`
  column via a raw Kysely select on the table name — never an import of `cart`'s `Cart` entity or
  any `cart/lib` function (the spec's own "checkout imports nothing from cart/lib" rule, §6),
  mirroring `ecommerce/lib/storeContextService.ts#lookupStoreTenantId`'s own precedent for this
  exact "FK-id + snapshot" coupling style (`packages/core/AGENTS.md` § Cross-Module Coupling).
  The found row's own `tenantId`/`organizationId` become the session's ground truth. Alternative
  considered: require `storeContextService.resolve` for every session creation — rejected as
  making link/API/agent-channel session creation impossible with no ecommerce store configured,
  contradicting the module's own stated release invariant.
- **Decision — §7.1 check 4 (store/channel/currency consistency, C9) is NOT enforced at session
  CREATE in this Step.** The task's own Implementation list scopes this Step to the session
  entity + skeleton + security baseline, explicitly excluding B.3/B.4 business logic; C9 is a
  SUBMIT precondition (Step 4.1) that the spec ALSO names at creation (§7.1), but implementing
  the request-host-resolved-store comparison requires the same `storeContextService.resolve`
  call this Step deliberately avoids making mandatory (see above). The session instead copies the
  cart's own `storeId`/`channel`/`currencyCode` verbatim — correct as a snapshot, just not yet
  cross-checked against a request-resolved store. **Follow-up needed**: Step 3.5 (B.2) or a
  dedicated gap-fill must add the `storeContextService.resolve(request, { fresh: true })` +
  `cart_store_mismatch` check at `POST /sessions` before B.3/B.4 can rely on it being pre-verified.
- **Decision — exact state-enum adjacency table (the spec gives prose, not a table).** Built
  `VALID_CHECKOUT_SESSION_TRANSITIONS` as: `open -> {awaiting_approval, submitting, canceled,
  expired}`; `awaiting_approval -> {open, failed, canceled, expired}`; `submitting ->
  {awaiting_payment, completed, failed, open}`; `awaiting_payment -> {completed, failed}`;
  `completed`/`failed`/`canceled`/`expired` terminal. Same-state transitions are idempotent
  no-ops (mirrors `isValidCheckoutStatusTransition`'s own convention for `CheckoutTransaction`).
  Full per-row citation to the spec section it derives from is in `lib/session-status-machine.ts`'s
  own doc comment. Only `open -> canceled` (cancel route skeleton via the "one live session per
  cart" supersede rule, §9.0) is actually EXERCISED by code this Step ships — every other row is
  untested-by-business-logic until Steps 2.13/3.5/4.1/4.2 land, but is unit-tested directly as a
  legal transition via the table itself.
- **Decision — exact rate-limit numbers for `POST /sessions` (C14 doesn't name them).** §13's own
  table in the REVISED spec actually DOES name them explicitly (20/min per IP, fail-closed;
  60/min per session + 120/min per IP for `/current` mutations) — read §13 directly rather than
  guessing, since the task brief's own framing ("C14 doesn't name them explicitly") pre-dated the
  spec revision pass. Used the spec's literal numbers, not invented ones.
- **Decision — `/sessions/current/step` and `/sessions/current/cancel` are NOT built in this
  Step**, despite the spec's own §17 Phase B.1 scope naming both. The task brief's own
  Implementation bullet list enumerates only `POST /sessions` (create) and `GET`/`PATCH /sessions/
  current` as this Step's route surface, and none of the 9 test priorities names either route.
  Building them now would mean inventing the step-navigation validation (`/step`) and the
  approval-interaction rule ("the cart's approval is kept") for `/cancel` ahead of any Step that
  actually needs them. **Follow-up needed**: a later checkout Step (2.13 or a gap-fill) should
  add both, reusing `lib/currentSessionRoute.ts#resolveCurrentSession` and `lib/session-status-
  machine.ts` exactly as this Step's `current/route.ts` already does.
- **Decision — `expire-checkout-sessions` background job is NOT built in this Step**, though §17
  Phase B.1 names it. Not in the task brief's own Implementation list or test-priority list;
  `CheckoutSession.expiresAt` is written (1-hour placeholder TTL, documented in `commands/
  session.ts`) so a later Step can build the sweep without a further migration. **Follow-up
  needed**: register the job + its `setup.ts` schedule when a Step actually needs sessions to
  stop accumulating as `open` forever.
- Files: `packages/checkout/src/modules/checkout/data/entities.ts` (+`CheckoutSession`,
  `CheckoutSessionEvent`), `data/validators.ts` (+create/update schemas), `migrations/
  Migration20261027120000.ts` + `.snapshot-open-mercato.json`, `encryption.ts`, `acl.ts`,
  `setup.ts`, `events.ts` (+`.created`/`.canceled`), `commands/session.ts` (+`commands/index.ts`
  wiring), `lib/tryResolve.ts`, `lib/sessionToken.ts`, `lib/cartPeer.ts`, `lib/currentSessionRoute.ts`,
  `lib/session-status-machine.ts`, `lib/sessionEvents.ts`, `lib/sessionView.ts`, `lib/rateLimiter.ts`
  (additive `keyOverride` + 3 new configs), `api/sessions/route.ts`, `api/sessions/[id]/route.ts`,
  `api/sessions/current/route.ts`. Tests added: `lib/__tests__/session-status-machine.test.ts`,
  `lib/__tests__/sessionEvents.test.ts`, `lib/__tests__/currentSessionRoute.identity-binding.test.ts`,
  `commands/__tests__/session.test.ts`, `api/sessions/__tests__/route.test.ts`,
  `__tests__/phase-a-non-regression.test.ts`, `__tests__/encryption.test.ts` (extended).
- Checks (local mode, from repo root): `yarn generate` — clean. `yarn workspace @open-mercato/
  checkout run typecheck` — clean, exit 0. `yarn workspace @open-mercato/checkout test` — 37/37
  suites, 272/272 tests, ZERO regressions on the pre-existing 36/270 Phase-A suite (C10
  guarantee). `yarn build:packages` — 40/40 tasks successful (incl. `@open-mercato/core` and
  `@open-mercato/checkout`).

## 2026-10-27T21:15:00Z — Step 2.13 (checkout B.3: delivery rate quoting, delivery promotions,
payment methods listing)
- Second `checkout`-module Step, building directly on Step 2.12's `CheckoutSession`/step-
  machine/security baseline. Read Step 2.12's own NOTIFY entry closely per the task brief —
  confirmed `/sessions/current/step`/`/cancel` genuinely do not exist yet (irrelevant to this
  Step's own route surface) and that store/channel/currency match is NOT enforced at session
  creation (irrelevant here too — this Step reads the session's own snapshot fields, never
  re-resolves the store).
- Shipped: `GET /api/checkout/sessions/current/delivery-options` (rate quote + cache),
  `POST /api/checkout/sessions/current/delivery` (method selection + delivery-promotion
  evaluation, `checkout.session.selectDelivery` command), `GET /api/checkout/sessions/current/
  payment-methods` (gateway listing). All three reuse Step 2.12's `resolveCurrentSession`
  (D-R5-33 binding + C21 cross-tenant check) and rate-limit helpers verbatim.
- **Route path decision:** the task brief's prose named `POST .../delivery-method`; the revised
  spec's own §9 route table literally names `POST /sessions/current/delivery`. Built the spec's
  literal path — the task brief itself says the spec is authoritative for "shapes", and this is
  exactly that kind of discrepancy (paraphrase vs. the owning document).
- **`delivery-options` (C13 §5.3).** Origin: gated behind `tryResolve('wmsReservationService')`,
  reads the organization's primary `wms_warehouses` row via a raw-Kysely peer read (the same
  "FK-id + snapshot" style `lib/cartPeer.ts` established in Step 2.12 — never an ORM import of
  another module's entity). **Found during implementation:** `ecommerce.EcommerceStore` has NO
  structured address at all (`settings.contact.address` is one free-text string) and no "tenant
  default address" concept exists anywhere in the codebase — so C13's own three-tier origin
  fallback (store → warehouse → tenant default) collapses to two reachable tiers here (warehouse
  → unavailable). Flagged as a follow-up: a later Step should add a structured store address if
  the owner wants tier 1 to ever be real. Packages: one parcel per cart, built from `cart_lines`
  joined (via three flat raw-Kysely queries, never a cross-module join, for easy unit-testing)
  against `catalog_products`/`catalog_product_variants` for weight/dimensions, variant overriding
  product when present, the single-parcel default (1kg/30x20x10cm) substituted per missing line.
  **Judgment call:** weight is summed per-line-times-quantity (physically correct — more units
  really do weigh more); dimensions take the largest single-unit value per axis across lines (a
  bounding box), NOT a literal sum — summing lengths across unrelated products would produce a
  parcel no carrier could ever quote, and the spec's "one parcel per cart" framing only makes
  sense as a bounding box. Documented in `lib/cartLinesPeer.ts`'s own doc comment. Carriers:
  every adapter `listShippingAdapters()` returns is tried via `shippingCarrierService
  .calculateRates`; a single adapter's failure is caught and logged, never surfaced — falls
  through to the flat-rate fallback (R10) exactly like "no provider configured" does. Cached 5
  min per `(address hash, cart hash)` via `@open-mercato/cache` (`lib/deliveryRateCache.ts`,
  mirroring `promotions/services/promotion-cache.ts`'s own best-effort get/set shape) — a cache
  read/write failure degrades to a recompute, never a failed request.
- **Flat-rate fallback location (D-R5-35) — the one genuinely new data-model gap.** Neither
  `ecommerce.EcommerceStore` nor `checkout.CheckoutLink` had ANY field for a flat-rate amount
  before this Step; D-R5-35 names the SOURCE per channel but the spec never specifies the field's
  shape. Added: an additive `shipping.flatRate: { amount, currencyCode } | null` key on
  `ecommerceStoreSettingsSchema` (jsonb `settings` column, `.prefault(null)`, zero migration —
  confirmed zero regressions: ran the FULL `@open-mercato/core` typecheck, 40/40 build tasks, and
  the ecommerce module's own jest suite, 68/68 suites / 891/891 tests, all green; the existing
  hand-written `mergeStoreSettings()` merge function in `api/stores/crud.ts` does not even pass
  the new key through today, so no admin-facing write path exists yet — a follow-up gap, not a
  blocker for this Step's own reads); and two additive nullable columns on
  `CheckoutLinkTemplate`/`CheckoutLink` (`flat_rate_shipping_amount`/`flat_rate_shipping_currency
  _code`, `Migration20261027180000.ts` + snapshot update, mirroring how `gateway_provider_key`
  was added originally) for the link tier, read directly via `em.findOne(CheckoutLink, ...)`
  since `CheckoutLink` is checkout's own entity (no cross-module peer-read needed there). Branch
  is exact: `channel === 'pay_link' && linkId` reads the link; everything else with a `storeId`
  reads the store; neither reads the other. Note: no live route can create a `channel: 'pay_link'`
  session yet (B.2/Step 3.5 hasn't landed — `{source:'link'}` still 400s per Step 2.12), so the
  link branch is unit-tested directly against a synthetic session input
  (`lib/__tests__/deliveryRateQuote.test.ts`), not through a full HTTP fixture.
- **`POST .../delivery` + delivery-promotion evaluation (C8/D-R5-17).** The command (`checkout.
  session.selectDelivery`) never trusts a client-supplied price: it RE-resolves the real options
  through the same cached `computeDeliveryOptions` call and 422s `delivery_unavailable` when the
  requested `deliveryMethodCode` isn't among them (§13 Entitlement's "never trusted" rule, applied
  here even though §13 only names it for payment methods explicitly). `promotionsService.evaluate`
  is called with the cart's buyer context (customerId/customerIds/customerGroupIds, re-read via a
  new `lookupCartPeerById` on `lib/cartPeer.ts`) plus `deliveryMethodCode`/`deliveryCost`, mirroring
  `cart/commands/cart.ts`'s own `ctx.container.register({ auth: asValue(...) })` precedent for
  resolving `promotionsService`'s scope. **Scoped decision:** `codes: []` is sent — this Step's
  call never re-derives the cart's currently-entered codes (`CartPromotionApplication` rows),
  since doing so properly would mean either importing `cart/lib` (forbidden, §6) or re-deriving
  that table cross-module, and the only rule type this Step's own scope needs working is
  `delivery_method`, which `rule-evaluators.ts` gates purely on `context.deliveryMethodCode`, not
  on `codes`. A combined code+delivery rule is therefore a gap — flagged for Step 4.1's own
  submit-time re-evaluation (§7.2 step 2) to close for real, since THAT call sits inside the
  authoritative submit path and already has to get this right. Only the `DELIVERY_DISCOUNT`
  effect is extracted from the result; `LINE_DISCOUNT`/`CART_DISCOUNT`/`ADD_FREE_ITEM` are ignored
  (cart-stage effects, already applied by `cart.reprice`, never this Step's to re-apply). On a
  match, writes a PARTIAL `quoted_totals` (`deliveryMethodCode`/`deliveryCost`/`deliveryDiscount`/
  `currencyCode`/`evaluatedAt` only) — `goodsGross`/`payableGross` are deliberately NOT written;
  §4.1's full shape is submit's own concern (Step 4.1), which this Step's brief explicitly
  excludes. A promotions evaluation failure (exception) degrades to "no discount shown", never a
  failed delivery-method selection — showing no discount is always safe, silently charging one
  that errored is not.
- **`GET .../payment-methods` (§5.5 gateway half only).** Lists every `isConfigured`,
  currency-compatible `paymentGatewayDescriptorService.listResolved(scope)` descriptor for a
  non-link session — `ecommerce` has no per-store gateway selection any more than it has a
  flat-rate-fallback field (a parallel gap, not fixed here, since fixing it is out of this Step's
  named scope). A link session restricts to the link's own single `gatewayProviderKey`, unchanged
  from Phase A's one-provider-per-link model. `on_account`/`request_quote` are not offered at
  all — expected per the task brief, since both need `customer_groups` terms
  (`allow_purchase_on_account`/`allow_quote_requests`) not yet wired into checkout (B.5).
- **Not built in this Step (named by §9/§17 B.3 but out of the task brief's own route list):**
  `POST /sessions/current/payment` (method selection + PO capture) — a later B.5-adjacent Step
  should add it, reusing this Step's `listCheckoutPaymentMethods` for server-side entitlement
  checking before storing the choice.
- Files: `packages/checkout/src/modules/checkout/lib/cartLinesPeer.ts` (+tests),
  `lib/warehousePeer.ts`, `lib/storeSettingsPeer.ts`, `lib/linkFlatRate.ts`, `lib/deliveryAddress.ts`
  (+tests), `lib/deliveryRateCache.ts` (+tests), `lib/deliveryRateQuote.ts` (+tests),
  `lib/promotionsDeliveryEvaluation.ts` (+tests), `lib/paymentMethods.ts` (+tests), `lib/
  cartPeer.ts` (+`lookupCartPeerById`, +`customerIds`/`customerGroupIds`), `lib/constants.ts`
  (package defaults, cache TTL), `lib/rateLimiter.ts` (+`checkoutDeliveryOptionsRateLimitConfig`,
  +`checkoutSessionOtherGetRateLimitConfig`), `data/validators.ts`
  (+`checkoutSessionDeliverySelectSchema`), `data/entities.ts` (+`CheckoutLinkTemplate` flat-rate
  columns), `commands/delivery.ts` (+tests) + `commands/index.ts` wiring,
  `migrations/Migration20261027180000.ts` + `.snapshot-open-mercato.json`,
  `api/sessions/current/delivery-options/route.ts` (+tests), `api/sessions/current/delivery/
  route.ts` (+tests), `api/sessions/current/payment-methods/route.ts` (+tests). Cross-module:
  `packages/core/src/modules/ecommerce/data/validators.ts` (+`ecommerceStoreShippingSchema`,
  additive jsonb field on `ecommerceStoreSettingsSchema`).
- Checks (local mode, from repo root): `yarn generate` — clean (first attempt caught a genuine
  duplicate `currencyCodeSchema` declaration in the edited `ecommerce/data/validators.ts`, fixed,
  re-ran clean). `yarn workspace @open-mercato/checkout run typecheck` — clean, exit 0.
  `yarn workspace @open-mercato/core run typecheck` — clean, exit 0. `yarn workspace
  @open-mercato/checkout test` — 47/47 suites, 328/328 tests, ZERO regressions on Step 2.12's own
  37/272 Phase-A-plus-B.1 baseline. `yarn workspace @open-mercato/core test -- src/modules/
  ecommerce` — 68/68 suites, 891/891 tests, ZERO regressions from the additive settings-schema
  field. `yarn build:packages` — 40/40 tasks successful (incl. `@open-mercato/core` and
  `@open-mercato/checkout`).

## 2026-10-27T20:30:00Z — dispatcher: tracked note from Step 2.13
- Step 2.13 listed available payment methods but did not build a `POST /sessions/current/payment`
  method-SELECTION route (not in its named scope). Flagging for Step 4.1 (B.4 submit) to check: if
  submit itself accepts the chosen payment method as a direct input, no separate selection route
  is needed; if the spec's step machine expects the method to be SET on the session before submit
  is called, Step 4.1 must add that route itself before building the submit sequence on top of it.

## 2026-10-27T21:00:00Z — checkpoint 6 (Steps 2.12–2.13, closes Phase 2)
- Range: `09e6d489bb`..`aac84cb6ad`. Summary: checkout session entity + step machine + B.1
  security baseline (first checkout Step this run, C10's requires-unchanged guarantee verified by
  a dedicated Phase-A-non-regression test); delivery rate quoting + delivery promotions + payment
  methods listing.
- Checks: forced full typecheck (40/40, 0 cached) pass; full core retrospective sweep across every
  Phase-2-touched module (240/243 suites, 2523/2540 tests, 3 expected Postgres-gated skips); full
  checkout package suite (47/47 suites, 328/328 tests).
- Decisions/problems: none blocking. Flagged explicitly: no dev-server/browser UI pass has run yet
  across the entire run (3 UI surfaces accumulated). Committing the next UI-touching Step, or
  Step 6.1 at the latest, to actually do this.
- Phase 2 is complete. All 13 Steps landed; no rescues needed this phase.

## 2026-10-27T22:00:00Z — Step 3.1 landed (cart: approval gate — K1-K5/§9a, Phase 3 opens)

- Closed the tracked `resolveTerms` gap first (flagged after Step 2.5): `termsCurrencyCode`
  was still unresolved as of `5db46425d1`. Added it to `customerGroupsService.ts`'s per-field
  resolution loop the same way Step 2.5 added `approvalPolicy`, PLUS one extra, field-only
  step (`applyTermsCurrencyFallback`) implementing D-R5-37: when no group in the chain sets
  it, fall back to the buyer's organization's base currency. Found and reused an EXISTING
  `currencies.BaseCurrencyService`/`baseCurrencyService` DI key (nobody in this run had
  wired it up yet) rather than writing a second raw-SQL lookup — threaded in via the same
  `softCradle` shape `customerPurchaseApprovalService` already uses for
  `moduleConfigService`, since `currencies` stays a soft peer of `customer_groups`.
  `ResolveTermsInput.organizationId` is new, optional and additive. Still did NOT resolve
  `allowQuoteRequests`/`requiresPoNumber` — no caller yet; Step 5.1 owns those.
- `cart/lib/approvalGate.ts` (new): the gate's pure math and its one soft-DI read, shared by
  the totals phase and `cart.lock` — `computeGoodsGrossAmount` (K1: parses
  `totals.grandTotalGrossAmount`), `computeRequiresApproval` (§9a.2's literal formula),
  `tryResolveCustomerGroupsService`, `resolveCartRequiresApproval` (orchestrates
  `resolveTerms` + the formula, degrading to `false` when `customer_groups` cannot be
  resolved — documented degrade, same precedent Step 2.10 set for the approval-service
  sibling).
- `cart/lib/reprice.ts#buildRecomputeCartTotalsPhase`: now also sets `cart.requiresApproval`
  on every call, right after `cart.totals` is written. This ONE function is already the
  universal hook every totals-changing command funnels through (`commands/lines.ts`'s line
  writes directly; `commands/cart.ts`'s `cart.reprice` for everything that DISPATCHES it —
  merge, promotions apply/remove, admin reprice, and `cart.lock`'s own forced re-price) — so
  this single change satisfies §9a.2's "whenever totals change" AND "recomputes it from fresh
  terms at `cart.lock`" (the lock's forced reprice IS a totals-change event, strictly before
  the gate ever reads the flag back) without a second `resolveTerms` call anywhere.
- `cart/commands/lock.ts`: added `purpose?: 'order' | 'quote'` to `CartLockInput` (default
  `'order'`). The gate sits between the visibility-pass check and `withAtomicFlush`, per
  §9.1's own "order of checks." `purpose === 'quote'` skips it entirely (D-R5-23). Otherwise,
  when `cart.requiresApproval` (freshly read post-reprice): a guest (`customerUserId` null)
  gets `409 approval_requires_identified_buyer` (D-R5-12) instead of the generic gate
  refusal; an identified buyer's `Cart.approvalId` is read LIVE through
  `customerPurchaseApprovalService.getApproval` (soft-resolved via the existing
  `tryResolveCustomerPurchaseApprovalService` in `lib/adminCartScope.ts`) and must be
  `approved`, same-currency, and `amountGross >= current goods gross` to qualify; otherwise
  `409 cart_requires_approval` with `{ approval, amountGross, currencyCode }`. No channel
  branch anywhere in this logic (D-R5-29) — `pay_link`/`api`/`agent` carts hit the exact same
  code path as `storefront`.
- i18n: added REAL `cart.errors.cart_requires_approval`/
  `cart.errors.approval_requires_identified_buyer` keys to all 5 locales (per this Step's own
  explicit instruction) — English text duplicated into the non-English files, matching the
  existing `cart.errors.store_context_unavailable` precedent (no `cart.errors.*` key is
  actually localized today). The command's thrown message itself stays `[internal]`-prefixed
  (no public route calls `cart.lock` yet), same convention `cart_has_unavailable_lines`/
  `invalid_lock_ttl_ms` already follow.
- Did NOT build `/current/request-approval` (Step 3.2's scope) or the §7a proposal seam
  (Steps 3.3/3.4) — this Step is the gate mechanism only, exactly as scoped.
- Did NOT implement `min_order_value` anywhere in `cart` — confirmed via grep it does not
  exist in this module today, and §9a.6 is explicit that it is checkout's own concern (Step
  5.1), not the cart's.
- Tests (TC-CART-APR-01..09, one extra for the documented `customer_groups`-absent degrade):
  `cart/lib/__tests__/approvalGate.test.ts` (new, 11 cases) — pure-function coverage for
  `computeGoodsGrossAmount`/`computeRequiresApproval`/the soft-DI helpers.
  `cart/lib/__tests__/reprice.test.ts` — 2 new cases: `requiresApproval` recomputed on every
  call (above AND below a threshold, in the SAME test, proving it is not cached), and the
  absent-service degrade. `cart/commands/__tests__/lock.test.ts` — 14 new cases under a new
  `describe('cart.lock — approval gate ...')`: refusal without a qualifying approval,
  success with one, refusal when the total rose above the approved amount (D-R5-3), BOTH
  currency-mismatch sub-cases (no usable currency at all → fail-closed; a resolved
  `termsCurrencyCode` matching the cart → passes), guest refusal with the distinct error
  code, `purpose: 'quote'` skipping the gate for a guest-over-threshold cart, the same
  refusal across `pay_link`/`api`/`agent` channels (`it.each`), and the `customer_groups`-
  absent degrade. All pre-existing tests in `reprice.test.ts`/`lock.test.ts` (36 + 13 before
  this Step) pass UNMODIFIED — the new DI tokens are optional and default to the same
  `Unexpected DI token` throw every other unlisted token already got, caught internally.
- Checks: `yarn workspace @open-mercato/core typecheck` — one pre-existing, unrelated error
  in `ecommerce/api/stores/crud.ts` (confirmed present on a clean `git stash` of this Step's
  changes too; from Step 2.13's `shipping` settings addition, not touched here). Full
  `src/modules/cart` suite: 24/24 suites, 312/312 tests, zero regressions. Full
  `src/modules/customer_groups` suite: 44/46 suites (2 pre-existing pg-gated skips),
  472/472 tests, zero regressions. Full `src/modules/currencies` suite: 27/27, 203/203,
  zero regressions (unaffected — `baseCurrencyService` itself was not touched, only
  consumed).

## 2026-10-27T21:30:00Z — dispatcher: fix-forward Step 3.1-fix
- A forced full `yarn typecheck` run immediately after Step 3.1 landed found a real TS error
  (`TS2741`/later `TS2322`) at `packages/core/src/modules/ecommerce/api/stores/crud.ts`'s
  `mergeStoreSettings`: Step 2.13 added a required `shipping` field to `EcommerceStoreSettings`
  (and a separate omission — `shipping` was never added to `EcommerceStoreSettingsPatchSchema`
  either, meaning there was previously no way to ever SET it via `PUT /stores/:id`) but never
  updated this pre-existing merge function or the patch schema. Oddly, Checkpoint 6's own forced
  typecheck (run right after Step 2.13, before Step 3.1) reported this exact file tree as clean
  (`40 successful, 40 total, 0 cached`) — re-confirmed by inspecting the committed source at
  `aac84cb6ad` directly: the bug was present in that commit's source. The checkpoint's green result
  for this specific check cannot be explained from the committed diff alone and is not reproduced
  on a second forced run against the same commit; logged here as an unresolved discrepancy rather
  than asserted as a known cause, so it isn't mistaken for a resolved explanation.
- Fixed directly (small, well-understood, one-line-class fix): moved `currencyCodeSchema`/
  `ecommerceStoreShippingSchema` above `ecommerceStoreSettingsPatchSchema` (declaration-order
  fix), added `shipping: ecommerceStoreShippingSchema.optional()` to the patch schema (full-object
  replace, matching contact/seo/branding), and `shipping: patch.shipping ?? current?.shipping ?? {
  flatRate: null }` to `mergeStoreSettings`. Added two regression tests (set via patch; preserved
  when the patch doesn't touch it) plus updated one pre-existing test's assertion that had been
  silently relying on the missing field. Full monorepo forced typecheck (40/40, 0 cached) and the
  full `ecommerce` suite (68/68 suites, 893/893 tests — 2 new) now pass.
- Lesson for future checkpoints in this run: treat a clean forced typecheck as strong evidence, not
  absolute proof — if a later Step's own typecheck disagrees with a prior checkpoint's result for
  the same committed tree, trust the fresh run and fix forward, as done here, rather than assuming
  the fresh run is wrong.

## 2026-10-27T22:45:00Z — Step 3.2 landed (cart: request-approval route + K3/K4/K5/K7 lifecycle wiring)

- `commands/approval.ts` (new): `cart.approval.request` — the ONLY way a cart's approval is
  created (§9a.4). Local `loadMutableCart` (same shape as `commands/promotions.ts`'s own):
  `423 cart_locked` → `409 cart_not_active` → abandoned-reactivates. Then K4's guest refusal
  (`409 approval_requires_identified_buyer`), the soft-resolved `customerPurchaseApprovalService`
  (`503` when absent), a fresh `resolveCartRequiresApproval` recompute, and §9a.4 step 2's
  "an already-qualifying current approval is ALSO `approval_not_required`" rule (reuses the
  new `lib/approvalGate.ts#approvalQualifies` shared formula — see PLAN.md's own decision for
  why `cart.lock` was refactored onto the same helper). Step 3: a still-pending, still-covering
  approval returns as-is (idempotent, G8 is the service's authority); a stale pending one is
  withdrawn FIRST (REQUESTER actor, `withdrawnReason: 'requester'`, not the `system` actor the
  lifecycle sweepers use) before a fresh `requestApproval` call. Writes `approvalId`/
  `awaitingApprovalSince` in one `withAtomicFlush`, emits `cart.cart.updated` + (only on a
  genuinely new approval) `cart.approval.requested` with the full 8-field §11 payload (see
  PLAN.md's K7 decision — the brief's own 6-field paraphrase is stale against the revised spec).
- `api/current/request-approval/route.ts` (new): structurally identical to `current/undo-merge/
  route.ts` — empty `.strict()` body, standard optimistic-lock + mutation-guard + `CART_MUTATE`
  rate limit, `buildCartResponseEnvelope` re-read on success. Did NOT wire the generic
  `Idempotency-Key` replay cache (PLAN.md decision — out of that helper's own documented scope,
  redundant with G8).
- `data/entities.ts`: additive `Cart.awaitingApprovalSince` (nullable `timestamptz`), migration
  `Migration20261027190000_cart.ts` + hand-edited `.snapshot-open-mercato.json` (same
  "local Postgres holds unrelated drift" reasoning Step 2.10 gave for its own hand-authored
  migration — not regenerated via `yarn db:generate`).
- `lib/approvalGate.ts`: added `approvalQualifies` (the one qualification formula — approved +
  same currency + amount covers goods gross), extracted out of `commands/lock.ts`'s own inline
  check (refactored to call it) so `cart.lock`'s gate, `cart.approval.request`'s pre-check, and
  `lib/cartView.ts`'s `CartView.approval.qualifies` field all share one implementation.
- `lib/cartView.ts`: `CartApprovalView` was still a Step-5.2-era stub (`{ id, status: 'pending'
  }` for ANY non-null `approvalId` — written before `CustomerPurchaseApproval` existed). Now
  reads the approval LIVE through `customerPurchaseApprovalService.getApproval` (soft-resolved,
  `null` on absence) per §9a.4's own "`CartView.approval` is read live" text, and returns the
  full §10.1 shape (`amountGross`/`currencyCode`/`qualifies`). Added `awaitingApprovalSince`
  to the envelope too. `commands/cart.ts`'s `CartSummary`/`toCartSummary` grew the same field.
- `lib/approvalLifecycle.ts` (new): `withdrawPendingCartApproval` — the ONE system-actor,
  idempotent-on-`approval_not_pending` withdrawal shared by `commands/merge.ts` (source side,
  §7.4), and `lib/sweepers.ts`'s `sweepExpiredCarts`/`purgeExpiredCarts` (§12). `commands/
  merge.ts`: on `absorbedCart.status = 'merged'`, withdraws a pending approval and clears
  `awaitingApprovalSince` in the same flush as the rest of that cart's transition.
  `lib/sweepers.ts`: `sweepAbandonedCarts` gained the K5 skip filter (`awaitingApprovalSince:
  null` on both the candidate `find` and the `nativeUpdate` WHERE); `sweepExpiredCarts`/
  `purgeExpiredCarts` gained a new `approvalService` parameter (soft-resolved by their worker
  files, `expire.worker.ts`/`purge-expired.worker.ts`, mirroring the existing `codeService`
  injection pattern) and withdraw-before-transition/delete logic, best-effort (caught, logged,
  never re-thrown — same discipline as the existing code-reservation release).
- Four new thin subscriber files (`subscribers/approval-{approved,rejected,expired,withdrawn}.ts`)
  share `lib/approvalDecidedSubscriber.ts#createCartApprovalDecidedHandler` — filters
  `subjectType === 'cart'`, then a single `nativeUpdate` keyed on `(id, tenantId,
  organizationId, approvalId)` clearing ONLY `awaitingApprovalSince` (never `approvalId` — see
  PLAN.md's K5 decision for why the task brief's own instruction to clear it too was NOT
  followed). Mirrors `customer_groups/lib/approvalDecidedSubscriberHandler.ts`'s own
  one-handler-per-event-id shape.
- NOT done (see PLAN.md's own decisions for the full reasoning on each): the K3 fifth
  lifecycle row ("Converted, pending, a `purpose: 'quote'` conversion → withdrawn") — no
  caller reaches `cart.markConverted` with `salesQuoteId` set in this worktree yet (Step 5.1's
  own scope); the admin list's `awaitingApproval` filter (§10.2 names it, Step 2.10's own
  route file untouched here, since this Step never had a reason to open that file); any
  `yarn db:generate`-based migration (hand-authored, same reasoning Step 2.10 gave).
- Tests (priority order from the task brief, all passing): `commands/__tests__/approval.test.ts`
  (new, 13 cases) — idempotent-while-pending, guest refusal, `approval_not_required` (both the
  "no threshold" and "already qualifies" sub-cases), `423`/`409` lock-state `it.each`, the
  full K7 payload assertion, stale-pending withdrawal-then-fresh-request, the
  `approval_not_pending` race swallow, abandoned-reactivation, and the `503` absent-service
  case. `lib/__tests__/approvalDecidedSubscriber.test.ts` (new, 16 cases via `describe.each`
  over the four event ids) — clears-when-matching, no-op-when-moved-on, `approval_id` never
  touched, ignores `subjectType: 'quote'`, incomplete-payload no-op. `commands/__tests__/
  merge.test.ts` — 3 new cases: source-side withdrawal + `awaitingApprovalSince` clear,
  no-approvalId no-op, and the undo-merge regression guard (approval stays withdrawn,
  `approvalId` unchanged, `customerPurchaseApprovalService` never called by undo at all).
  `lib/__tests__/sweepers.test.ts` — 7 new cases across `sweepAbandonedCarts`/
  `sweepExpiredCarts`/`purgeExpiredCarts` (K5 skip; withdraw-and-clear; already-settled
  race; no-approvalId no-op; failed-withdrawal-does-not-block-the-sweep, ×2).
  `lib/__tests__/cartView.test.ts` — replaced the stale stub assertion with a live-read test
  (`qualifies: true`), added the pending/unavailable-service and
  `approvalId`-null/`awaitingApprovalSince`-passthrough cases.
  Checks: `yarn workspace @open-mercato/core typecheck` clean (0 errors). Full
  `src/modules/cart` suite: 26/26 suites, 354/354 tests (42 new), zero regressions. Full
  `src/modules/customer_groups` suite: 44/46 suites (2 pre-existing pg-gated skips),
  472/472 tests, zero regressions (unaffected — only its already-public
  `CustomerPurchaseApprovalService`/`CustomerPurchaseApprovalServiceError` exports and
  frozen `customer_groups.approval.*` event payload shape were consumed, nothing in that
  module itself was touched).

## 2026-10-27T02:36:00Z — Step 3.3 landed (cart: §7a proposal seam commands — create/reject, supersede/re-author on merge)

**Scope.** Two commands only, per the Step's own brief: `cart.proposal.create` (§7a.2) and
`cart.proposal.reject` (§7a.5). No HTTP route, no acceptance flow (`cart.merge { strategy:
'manual' }`), no sweeper branches — all Step 3.4's scope (K15/S15, plus D-R5-25's undo-merge
refusal). The re-author/supersede mechanism (D-R5-14) is built as a provisional, cart-only
subscriber (see below) since `assisted_selling` does not exist as code yet.

**Reject-command-vs-route question, resolved by re-reading the spec closely.** The task
brief's own "WAIT, re-check" question asked whether `reject` is a route-level concern or a
real command. The spec's §7a.5 answers directly: "The buyer rejects through `POST
/proposals/:proposalId/reject`... The author's side ends a proposal in-process:
`assisted_selling` withdraw, supersede and re-author call `cart.proposal.reject`..." — there is
**no** separate `cart.proposal.withdraw`/`.supersede` command anywhere in the spec. Every
author-side ending of a proposal IS a call to `cart.proposal.reject`, distinguished only by a
`rejectedBy: 'buyer' | 'author'` input field the CALLER supplies (never inferred from a request
body): the buyer-facing route (Step 3.4) passes `'buyer'`; every author-side caller (the
subscriber below, and eventually `assisted_selling`'s own withdraw/supersede/reauthor routes)
passes `'author'`. So `cart.proposal.reject` is built now, as a real command, exactly as the
task's implementation bullets originally asked — the "withdraw" and "supersede" language in
the brief's own bullet list map onto this ONE command, not three.

**The re-author/supersede subscriber lives in `cart` as a provisional mechanism, NOT
`assisted_selling` — and this is a deliberate, documented divergence from the authoritative
spec's own placement.** `.ai/specs/2026-09-22-assisted-selling.md` §8.1/§6.4 states plainly
that the login-merge re-author/supersede subscriber is `assisted_selling`'s own code ("a
`kind = 'basket'` subscriber on `cart.cart.merged`... re-authored as its original author...
through `buildTrustedCommandContext`"). That module is this run's own Phase 4 (Steps
4.3–4.5) and does not exist yet. The Step 3.3 task brief explicitly instructed building this
mechanism NOW anyway, using only what `cart` itself can see ("re-run CART's own
visibility/pricing/line-add logic equivalently... do not attempt to call into a non-existent
assisted_selling module"). Built as `lib/proposalRetarget.ts` +
`subscribers/cart-merged-proposal-retarget.ts` (persistent, event `cart.cart.merged`). It does
NOT touch anything `assisted_selling` owns (no thread, no `superseded_by_proposal_id`, no
`live_proposal_count`) — only `cart`'s own `Cart`/`CartLine` rows and its own two new commands.
When Phase 4 builds the real `assisted_selling` module, this subscriber should most likely be
REMOVED (or narrowed to a no-op) in favor of that module's own, spec-authoritative one — flagged
explicitly for whichever Step does that, so the two mechanisms never double-process the same
merge.

**"Supersede-on-merge" and "re-author" are ONE mechanism here, not two — and the task brief's
own literal test requirement ("supersede-on-merge leaves exactly one live proposal targeting a
cart after acceptance") was read against the authoritative spec rather than followed literally
for its "after ACCEPTANCE" framing.** Re-checked `.ai/specs/2026-09-22-assisted-selling.md`
directly: "Both proposals are live. They are separate carts and separate rows; neither blocks
the other; the buyer may accept both, either or neither." (§6.1) — sibling proposals targeting
the SAME basket are explicitly **never** superseded by one another's acceptance. So there is no
"supersede siblings when one is accepted" logic to build, and building it would contradict the
spec directly. What IS built, and satisfies the literal test sentence under its most natural
reading (two proposals live, one is accepted, exactly one remains live afterward): acceptance
itself (Step 3.4's `cart.merge`) transitions the accepted proposal's own `status` out of
`active` into a terminal one — the sibling's `status` is simply never touched by anything in
this Step, so "exactly one live proposal remains" falls out of the ordinary lifecycle, not a
new cross-proposal rule. Added a regression test (`commands/__tests__/proposal.test.ts`,
"supersede-on-merge...") that simulates this exact scenario directly (two proposals targeting
one cart, one manually marked `merged` as Step 3.4's future acceptance would do) and asserts the
sibling is both present and untouched. The "Supersede-on-merge"/"re-author" bullets in the task
brief are, on this reading, two facets of the SAME login-merge mechanism (`lib/
proposalRetarget.ts`): the fallback branch IS the supersede, the success branch is the
re-author-then-supersede-the-old-one. Flagged as a genuine scope-interpretation call, not a
silent skip.

**Re-author mechanics (D-R5-14).** `handleCartMergedForProposalRetarget` (`lib/
proposalRetarget.ts`) finds every `kind: 'proposal'`, `status: 'active'` cart whose
`proposedToCartId` names the cart that `cart.cart.merged`'s `sourceCartId` says just got
absorbed, and for each one: reads the author off the proposal's own `CartLine.addedByActorType`/
`_id` (§4.1 — `Cart` has no `authored_by_*` column); if the author is not `'rep'` (Release 5
never writes `'ai_agent'`, S10) or has no id, supersedes immediately (no re-author attempted);
otherwise calls `cart.proposal.create` against the NEW target under
`buildTrustedCommandContext({ actorType: 'user', actorId: <author>, reason:
'cart.proposal.reauthor' })` (Step 1.1's helper) with the old proposal's own lines and a
TTL clamped to its remaining time (bounded to the same 3600–1,209,600s window); on success OR
on a caught failure (the create call's own `cart.proposals.author` check refuses — the only
eligibility signal `cart` can check without `assisted_selling`'s store-mode concept), the OLD
proposal is rejected (`cart.proposal.reject`, `rejectedBy: 'author'`) under a bare SYSTEM
context (no re-check of the ACL feature a second time — the create call already proved or
disproved it). Both branches tested explicitly in `lib/__tests__/proposalRetarget.test.ts`
(re-author-succeeds, ineligible-actor-type, create-throws-403), plus a no-pending-proposals
no-op, a missing-scope no-op (S3/D-R5-32), and two-siblings-processed-independently.

**Known gap, documented not closed:** a crash between a successful `cart.proposal.create` and
the matching `cart.proposal.reject` leaves the OLD proposal still `active`, so a redelivery of
the same `cart.cart.merged` event can re-author a SECOND time before finally rejecting the
first old row. No idempotency key exists at this layer (that is `assisted_selling`'s own S23
concern, keyed on its own `AssistedSellingProposal.idempotency_key`, not available to this
provisional cart-only mechanism). Acceptable for Release 5 per the same risk class this run's
own precedent already accepts elsewhere (assisted-selling's own S23 finding: "a
double-submitted authoring call creates two proposal carts", bounded, not eliminated).

**`cart.cart.merged`/`.adopted` gained `tenantId`/`organizationId` (additive, S3/D-R5-32)** —
both were missing them entirely (confirmed by reading `commands/merge.ts` directly); the new
subscriber needs them to filter before loading anything by id, and D-R5-32 already calls for
this exact fix on every Release 5 event payload. Existing `expect.objectContaining(...)`
assertions in `commands/__tests__/merge.test.ts` are unaffected (additive fields never break a
partial-match assertion).

**Reused, never duplicated, the existing per-line pricing/visibility machinery.** Exported
(additive `export` keyword, zero behavior change — same precedent Step 2.6 set for
`CustomerPurchaseApprovalService.toApprovalView`) eleven previously-private helpers from
`commands/lines.ts` (`buildCartPricingRowFilterContext`, `fetchPriceRowsBatch`,
`groupRowsByProduct`, `resolveLinePricing`, `applyPriceSnapshot`, `computeLineTotals`,
`resolveSnapshotFields`, `computeStartingLineNumber`, `resolveQuantityRulesForProduct`,
`buildCartPromotionsAndTotalsPhases`, `emitCartPromotionsAndTotalsSideEffects`) rather than
re-implementing a second pricing/totals path in `commands/proposal.ts`. `cart.proposal.create`
could NOT reuse `cart.lines.bulkAdd` wholesale the way a first instinct suggests — that
command's own `loadMutableCart` filters `kind: 'basket'` unconditionally, which a brand-new
`kind: 'proposal'` cart (not yet persisted at line-build time) can never satisfy — so it builds
its own line loop directly on the freshly-created `Cart` entity, calling the SAME exported
pricing/quantity-rule helpers bulkAdd itself calls.

**`addedByActorType` is always `'rep'` in Release 5.** The spec's own caller list for `POST
/proposals` names "a staff `auth.User`, or an AI agent principal (`users.kind = 'agent'`)", but
S10 (assisted-selling) restricts Release 5 to `mode: rep | off` with NO AI agent participant
ever created — so `'ai_agent'` is unreachable in this release regardless of what `cart` itself
might otherwise support. `cart.proposal.create` hard-codes `'rep'` for any authenticated
`ctx.auth.sub`-bearing caller rather than trying to detect `users.kind` (a query this command
has no documented need for yet, and no caller in this release ever supplies an agent
principal). Revisit if/when Phase 3 (AI actor) actually ships.

**`cartProposalCreateLineInputSchema`'s `productId`/`variantId` are plain non-empty strings,
not `uuid()`** — same precedent `cartMarkConvertedLineMapEntrySchema` already set two Steps ago
("this is the command's own internal input shape... not an HTTP body validator"): no public
route exists yet, the real guard is the batched catalog lookup resolving to
`product_unavailable`, and every `CatalogProduct.id` fixture across this module's own test
suite (`lines`/`cart`/`merge`.test.ts) is a plain string like `'product-1'`, never a real UUID.
The public `POST /proposals` body (Step 3.4) gets its own `.strict()`, `uuid()`-validated
schema, matching `cartLineAddRequestSchema`'s existing split.

**Files touched:**
- `commands/proposal.ts` (new) — `cart.proposal.create`, `cart.proposal.reject`.
- `commands/lines.ts` — eleven `export` additions (listed above), plus `'proposal_create'`
  added to `CartVisibilityRejectionTrigger` (additive enum member, S13/K13).
- `commands/merge.ts` — `tenantId`/`organizationId` added to `cart.cart.merged`/`.adopted`
  payloads (additive, S3/D-R5-32).
- `lib/proposalRetarget.ts` (new) — the re-author/supersede mechanism.
- `subscribers/cart-merged-proposal-retarget.ts` (new) — thin wiring.
- `data/validators.ts` — `cartProposalCreateLineInputSchema`/`cartProposalCreateLinesSchema`/
  `cartProposalCreateTtlSecondsSchema` + the three TTL bound constants.
- Tests: `commands/__tests__/proposal.test.ts` (new, 18 cases), `lib/__tests__/
  proposalRetarget.test.ts` (new, 7 cases).

**Checks:** `yarn workspace @open-mercato/core typecheck` clean (0 errors). Full
`src/modules/cart` suite: 28/28 suites, 379/379 tests (25 new), zero regressions. Every
pre-existing basket-only command (`cart.get`, `cart.lines.*`, `cart.merge`, `cart.lock`, the
sweepers) is untouched and still filters `kind: 'basket'` — confirmed by grep and by this
Step's own `cart.get` regression test.

## 2026-10-27T04:10:00Z — Step 3.4 landed (cart: §7a proposal routes, sweeper branches, undo-merge refusal — K13–K16/S13–S15/D-R5-13/D-R5-21/D-R5-25)

**Scope.** The HTTP route family under `/api/cart/proposals/*` (`GET /proposals`,
`POST /proposals`, `GET /proposals/:id`, `POST /proposals/:id/preview`,
`POST /proposals/:id/accept`, `POST /proposals/:id/reject`), the third proposal command
(`cart.proposal.accept`, §7a.4), `commands/merge.ts`'s new `proposalCartId`/`lines` manual-
acceptance input variant, the three §12 sweeper branches for `kind = 'proposal'` (K15/S15),
and the D-R5-25 `409 merge_undo_not_supported_for_proposal` refusal on `/current/undo-merge`.

**`cart.proposal.accept` is a real third command, delegating to `cart.merge`.** §3.1a's own
command list names `cart.proposal.create · cart.proposal.accept · cart.proposal.reject` as
the module's three proposal commands — so "the route delegates to the existing merge
command" (this Step's own brief) means `cart.proposal.accept`'s OWN `execute` verifies the
two-step §7a.4 `acceptanceToken` contract and then calls `commandBus.execute('cart.merge',
...)`, not that the HTTP route calls `cart.merge` with no wrapper at all. Full reasoning in
PLAN.md's own Step 3.4 decision entry.

**The two-step `preview` → `acceptanceToken` → `accept` dance, built per §7a.4's literal
text (re-read closely, as instructed — this was NOT in the task brief's own bullet list in
as much detail, which only said "price the proposal's lines... build the minimal version").**
`POST /proposals/:id/preview` re-prices every proposal line against the TARGET's CURRENT
buyer context (`lib/proposalPreview.ts#buildProposalAcceptancePreview`, reusing
`cart.proposal.create`'s own exported pricing helpers from `commands/lines.ts` — creates
nothing, no `em.persist`/`flush` anywhere in that file) and returns `{ acceptancePreview,
acceptanceToken }`. The `acceptanceToken` (`lib/acceptanceToken.ts`) is a `signAudienceJwt`/
`verifyAudienceJwt`-signed token (audience `cart_proposal_acceptance`, reusing the SAME
shared primitive `customer_accounts` already uses for session JWTs, 15-minute TTL) binding
BOTH the target's and the proposal's current `updatedAt`. `POST /proposals/:id/accept`
verifies the token's signature AND freshness (`isAcceptanceTokenFresh`); a stale or
malformed token gets `409 proposal_changed` carrying a FRESH preview+token built the same
way, never a bare error. "Single-use" (TC-CART-PROP-11) is a consequence of the freshness
check alone — a successful accept moves both carts' `updatedAt`, so replaying the same
token fails the identical comparison a genuinely-stale token would.

**`commands/merge.ts`'s manual-acceptance branch is a fully separate code path, not woven
into the existing §7.1 guest-merge flow.** `CartMergeInput` is now a discriminated union
(`CartMergeAutoInput | CartMergeManualInput`); `mergeCartCommand.execute` branches to a new
`executeProposalAcceptance` function at the very top when `proposalCartId` is present. That
function reuses the EXISTING `buildMergeOutcome`/`resolveMaxOrderQuantities`/
`filterCustomerLines` helpers (treating the proposal's SELECTED lines as "source," the
target's customer-origin lines as "target," the target always as survivor — never
`strategy: 'replace'`) and the existing mandatory whole-cart reprice dispatch, but has its
own target/proposal resolution, its own lock/status gates (`423 cart_locked` with the
session id, `409 cart_not_active` for either cart), its own `declined`-disposition pass for
every unselected proposal line, and writes `CartMergeLog.proposalCartId` — the ONE field
D-R5-25's undo refusal keys off. Zero changes to the pre-existing, heavily-tested §7.1
guest-merge path itself — confirmed by running the full pre-existing `merge.test.ts` suite
unchanged alongside the new tests.

**D-R5-25's refusal lives in `restoreCartMerge`, checked BEFORE the survivor/absorbed cart
lookups (which would otherwise 404 for a proposal-sourced merge, since the absorbed row's
`kind` is `'proposal'` and both lookups filter `kind: 'basket'`).** `cart.mergeUndo`
(buyer-facing) throws the `409` straight through; the generic command-undo-log `undo`
handler (the admin "Undo" action) now ALSO swallows this code silently, alongside the
pre-existing `merge_already_undone`/`cart_not_active` swallows — same "no HTTP consumer to
show an error to" reasoning those two already established.

**Sweeper branches (K15/S15).** `sweepAbandonedCarts` needed NO change — its own
`kind: 'basket'` filter already excluded every proposal (confirmed by the pre-existing
regression test, still green). `sweepExpiredProposals` (new function, `lib/sweepers.ts`)
runs on the SAME hourly `cart:expire` tick as `sweepExpiredCarts` (no new schedule —
`workers/expire.worker.ts` now calls both in sequence, separate try/catch per branch):
`kind = 'proposal' AND status = 'active' AND expires_at < now()` → `expired`, `resolved_at`
set, `cart.proposal.expired` with scope, code reservations released by `cartId` (finds
nothing in Release 5, S14, but the rule stays correct). `purgeExpiredCarts`'s `base` filter
simply DROPPED its `kind: 'basket'` restriction — the `CartMergeLog` exclusion logic already
checked `ref.proposalCartId` (written ahead of time by Step 2.11/K11, confirmed by reading
that Step's own NOTIFY.md entry), so widening the base query was the ONLY change needed; an
accepted proposal stays excluded via the exact same `excludedIds` set a still-referenced
basket already used.

**Identity binding reused verbatim, not reinvented.** `lib/currentCartRoute.ts` gained
`resolveIdentifiedBasketByToken` — the SAME `getCustomerAuthFromRequest` session-vs-
`customerUserId` check `resolveCurrentCart` already enforces for every `/current/*` route,
duplicated at this file's own small scope (same precedent `lib/reprice.ts`'s own duplication
note already sets) rather than refactoring the heavily-tested `resolveCurrentCart` to share
it — zero risk to that existing seam. Every buyer `/proposals/*` route calls it before
touching anything.

**Decisions flagged in PLAN.md (not repeated here in full):** `cart.proposal.accept` built
as a real third command, not route-inline merge dispatch; the acceptanceToken's JWT-based
design; `GET /proposals` filters to `status: 'active'` ("live") while `GET /proposals/:id`
stays readable at any status; the STAFF admin `/api/cart/carts` list/detail is **NOT**
widened to `kind: 'proposal'` in this Step (Step 2.10's own pre-existing, explicitly-flagged
deferral — a separate file family from this Step's `/api/cart/proposals/*` scope; `cart.
proposals.view` is already declared and sits unused, waiting for whichever Step closes that
gap); no dedicated rate-limit bucket for the staff-authored `POST /proposals` (no cart token
to key by; reusing a token-keyed bucket would conflate two different abuse surfaces);
`cart.cart.merged`'s `kind` field is read as "the source's kind" (`'proposal'` for this
branch); token rotation on acceptance mirrors the existing unconditional guest-merge
rotation.

**Files touched:**
- `commands/proposal.ts` — new `cart.proposal.accept` command; exported `resolveProposalAuthor`.
- `commands/merge.ts` — `CartMergeInput` is now `CartMergeAutoInput | CartMergeManualInput`;
  new `executeProposalAcceptance` function; D-R5-25 refusal in `restoreCartMerge`; the
  generic `undo` handler's swallowed-code list grows by one.
- `lib/acceptanceToken.ts` (new) — sign/verify/freshness for the §7a.4 acceptanceToken.
- `lib/proposalPreview.ts` (new) — the dry-run preview builder.
- `lib/currentCartRoute.ts` — new exported `resolveIdentifiedBasketByToken`.
- `lib/sweepers.ts` — new `sweepExpiredProposals`; `purgeExpiredCarts`'s `kind` filter widened.
- `workers/expire.worker.ts` — calls `sweepExpiredProposals` after `sweepExpiredCarts`.
- `data/validators.ts` — new public `/proposals/*` request-body schemas.
- `api/proposals/route.ts` (new) — `GET` (list) + `POST` (author).
- `api/proposals/[id]/route.ts` (new) — `GET` (detail).
- `api/proposals/[id]/preview/route.ts` (new) — `POST`.
- `api/proposals/[id]/accept/route.ts` (new) — `POST`.
- `api/proposals/[id]/reject/route.ts` (new) — `POST`.
- `api/current/undo-merge/route.ts` — `openApi` error-doc update (new 409 code mentioned).
- Tests (new/extended): `lib/__tests__/acceptanceToken.test.ts` (new, 9 cases),
  `lib/__tests__/proposalPreview.test.ts` (new, 5 cases), `commands/__tests__/proposal.test.ts`
  (+6 cases, `cart.proposal.accept`), `commands/__tests__/merge.test.ts` (+12 cases: manual
  acceptance branch, D-R5-25 refusal, regression guards), `lib/__tests__/sweepers.test.ts`
  (+9 cases, replacing the one stale "never purges a proposal" test that this Step's own
  purge-widening superseded).

**Checks:** `yarn workspace @open-mercato/core typecheck` clean (0 errors), run twice
(once after a full `tsconfig.tsbuildinfo` wipe to rule out a stale incremental cache). Full
`src/modules/cart` suite: 30/30 suites, 417/417 tests (38 new), zero regressions — every
pre-existing guest-merge/undo/sweeper test passes unchanged.

## 2026-10-27T23:30:00Z — checkpoint 7 (Steps 3.1–3.4 + 3.1-fix)
- Range: `4a056a7764`..`469bd19c17` (incl. `efc2335eb9`). Summary: cart approval gate; resolveTerms
  termsCurrencyCode fix; a real ecommerce typecheck regression found and fixed (3.1-fix);
  request-approval route + K3 lifecycle; §7a proposal seam commands; §7a proposal routes +
  sweepers + undo-merge refusal.
- Checks: forced full typecheck with tsbuildinfo wiped (40/40, 0 cached) pass; full cart suite
  (30/30 suites, 417/417 tests); customer_groups+ecommerce regression sweep (112/114 suites,
  1365/1373 tests, 2 expected gated skips).
- Decisions/problems: the Checkpoint 6 vs. post-3.1 typecheck discrepancy remains unexplained
  (logged, not papered over); mitigated going forward by wiping tsbuildinfo before every forced
  checkpoint typecheck. `cart`'s Phase 3 scope (approval gate + proposal seam) is now complete.

## 2026-10-27T22:00:00Z — Step 3.5 (checkout B.2: cart-backed links — trusted pay-link cart
seeding D-R5-19 + store/channel/currency mismatch check C9)
- Third `checkout`-module Step, building on Step 2.12's `CheckoutSession`/step-machine
  baseline and Step 2.13's delivery/payment listing. Read Step 2.12's own flagged gap
  closely ("C9 is NOT enforced at session CREATE ... Step 3.5 or a dedicated gap-fill must
  add the storeContextService.resolve(request, { fresh: true }) + cart_store_mismatch
  check") and Step 2.9's trusted-path identity fill (`cart/commands/cart.ts`'s
  `resolveTrustedCartBuyerIdentity`) — this Step's pay-link seeding reuses that exact
  mechanism for buyer identity, and Step 1.1's `buildTrustedCommandContext` for the audit.
- **Genuine gap found during implementation, not anticipated by the task brief:** the
  checkout spec's §4.3 names a brand-new entity, `CheckoutLinkCartTemplate`
  (`checkout_link_cart_templates`) — "merchant-defined lines that seed a cart on first
  visit" — which did not exist in code at all (confirmed: zero hits for
  `unit_price_override`/`CheckoutLinkCartTemplate` anywhere outside the spec/analysis
  docs). The task brief's own Read-first list implied `CheckoutLink`/`CheckoutLinkTemplate`
  already carried "the template's line definitions, including whether a line has
  `unit_price_override`" — they do not; Phase A's `CheckoutLinkTemplate` only ever had
  `pricingMode` (fixed/custom_amount/price_list), never a lines concept. Built the entity
  now (additive migration + snapshot), scoped tightly to what seeding needs — see PLAN.md
  "Decisions taken without the owner" for the full reasoning (product_id required, no
  freeform line, no admin write route yet).
- **A second genuine gap, on the `cart` side (D-R5-19, Ask First already approved):** the
  checkout/cart specs' own "rev 10" text describes a `systemActor` bypass in
  `cart.create`'s `requireChannelFeature` (accepted for `channel: 'pay_link'` ONLY, R22)
  and a `CartLine.unitPriceOverride` field — neither existed in the shipped `cart` code
  through Step 3.4. Closed both, minimally: `requireChannelFeature` now short-circuits for
  `ctx.systemActor === true && channel === 'pay_link'`, rejecting every other channel the
  identical way an unauthenticated caller would (new `it.each` test: pos/agent/api all
  403). `cart.create`'s authenticated-path schema gained an optional `tenantId` field,
  honored ONLY when `ctx.systemActor` is true (there is no `ctx.auth` to derive tenant
  scope from otherwise) — `resolveAuthenticatedScope` falls back to it. `CartLine` gained
  `unitPriceOverride: { amount, basis } | null` (additive migration), and
  `cart.lines.add` accepts it as an input field gated by the identical `systemActor` +
  `pay_link` check (`assertUnitPriceOverrideAllowed`) — when present, it bypasses catalog
  price-row resolution entirely via a synthetic `ResolvedLinePrice` fed through the
  EXISTING `applyPriceSnapshot` (no duplicated pricing logic). `lib/reprice.ts`'s
  `buildCartLineRepricePhases` excludes an override line from re-pricing with the exact
  same one-line pattern already used to exclude gift (`origin: 'promotion'`) lines — "never
  silently overwrite a deliberately non-catalog price."
- **Pay-link cart seeding (`lib/payLinkCartSeed.ts`), wired into `checkout.session.create`
  for `{ source: 'link', slug }`:** only a `checkoutType: 'simple_checkout'` link reaches
  this branch — a `checkoutType: 'pay_link'` link 404s at this command (identical body to
  an unknown slug), leaving Phase A's `/pay/[slug]` + `/submit` completely untouched and
  unaware this code exists. Phase A's own availability checks (active, usage limit,
  password cookie) are reproduced here, at session-creation time. On success: builds a
  trusted, request-less context via `buildTrustedCommandContext({ actorType: 'system',
  reason: 'checkout:pay_link_seed:<linkId>' })` from the LINK's own tenant/organization
  (never request input); when a customer session is present AND its tenant/organization
  equal the link's, resolves the buyer's real identity via `storeContextService
  .resolveForBuyer({ tenantId, organizationId, customerUserId })` with no store (D-R5-13/
  D-R5-22) and passes it to `cart.create`; calls `cart.create` (channel `pay_link`) then
  `cart.lines.add` once per template line — both over the REAL command bus, never a direct
  entity write. A template line's `unitPriceOverride` (merchant-fixed) is passed through
  as `{ amount, basis: 'gross' }` (judgment call — Phase A's pricing is gross-oriented, and
  the template entity has no `basis` column of its own); a line with none is omitted,
  pricing the buyer at their own catalog rate.
- **C9 (`lib/cartSessionConsistency.ts`), ONE reusable guard wired at session creation for
  BOTH `source` branches, left ready for Step 4.1 to call again at submit without
  duplicating the comparisons:** `assertCartMatchesCheckoutScope` (pure — tenant/
  organization, channel, currency always compared; the store compared only when
  `cart.storeId` is non-null, X13) plus `resolveRequestStoreIdForConsistencyCheck` (resolves
  "the store from the request" via soft `storeContextService.resolve(request, { fresh:
  true })`, `503 checkout_sessions_unavailable` — not `409` — when a non-null-store cart has
  no resolvable store context at all, matching §3.4's own documented behavior for an absent
  `ecommerce`). At creation, three of the four comparisons are tautological by construction
  (the session copies the cart's own fields verbatim) — the store check is the one with
  real teeth, and it is NEWLY enforced here (Step 2.12's own flagged gap, closed). The link
  path's cart always has `storeId: null`, so it never even attempts a store resolution —
  verified by a test with NO `storeContextService` registered at all (would hard-throw if
  ever consulted).
- **Regression check (one pre-existing test needed an update, not a design change):**
  `commands/__tests__/session.test.ts`'s "copies the cart scope and identity onto the new
  session" test used a `store_id: 'store-1'` cart peer with no `storeContextService` mocked
  — correctly caught by the new store-resolution requirement. Added a matching
  `storeContextService.resolve` mock returning `store.id: 'store-1'` (a real match, so the
  test's own assertions are otherwise unchanged) and a `request` on the input. Every OTHER
  pre-existing test in that file uses the default `store_id: null` cart peer and needed no
  change at all. `api/sessions/__tests__/route.test.ts`'s "rejects an unsupported source"
  test (encoding "B.2 is not built yet") was replaced with a "dispatches { source: 'link',
  slug } to the command" test plus a narrower 400-on-malformed-body test.
- **Re-verified, not assumed: the Phase-A-only pay-link flow is completely unaffected.**
  `index.ts` was not touched (no new `requires`) — the existing
  `__tests__/phase-a-non-regression.test.ts` (C10's own static-contract guard from Step
  2.12) ran as part of the full suite below and passed unchanged; no file under
  `api/pay/**` was touched; `checkout.session.create`'s `source: 'link'` branch is reachable
  only for `checkoutType: 'simple_checkout'`, which no admin surface can create yet (no
  write route for `CheckoutLinkCartTemplate` either) — so no LIVE `checkoutType: 'pay_link'`
  link's behavior changes in any way.
- Files: `packages/checkout/src/modules/checkout/data/entities.ts` (+`CheckoutLinkCartTemplate`),
  `data/validators.ts` (+`{ source: 'link', slug }` on `checkoutSessionCreateSchema`,
  discriminated union), `migrations/Migration20261027220000.ts` + `.snapshot-open-mercato
  .json`, `commands/session.ts` (`source: 'link'` branch, C9 wiring for both branches),
  `lib/payLinkCartSeed.ts` (new), `lib/cartSessionConsistency.ts` (new),
  `api/sessions/route.ts` (link slug dispatch). Cross-module: `packages/core/src/modules/
  cart/commands/cart.ts` (`requireChannelFeature` systemActor bypass,
  `resolveAuthenticatedScope` trusted tenantId fallback), `cart/data/validators.ts`
  (+`tenantId` on `cartCreateInputSchema`), `cart/data/entities.ts`
  (+`CartLine.unitPriceOverride`), `cart/commands/lines.ts` (override bypass +
  `assertUnitPriceOverrideAllowed`), `cart/lib/reprice.ts` (override-line exclusion),
  `cart/migrations/Migration20261027210000_cart.ts` + `.snapshot-open-mercato.json`. Tests
  added: `checkout/commands/__tests__/session.link-seed.test.ts` (12 cases — seeding,
  override pricing, buyer identity, cross-tenant guest fallback, X13 store skip, link-not-
  found/not-simple-checkout/not-active/usage-limit/password/no-template-lines), `checkout/
  lib/__tests__/cartSessionConsistency.test.ts` (12 cases — the full C9 matrix plus
  availability-vs-mismatch degradation), plus extensions to `cart/commands/__tests__/
  cart.test.ts` (+4), `cart/commands/__tests__/lines.test.ts` (+4), `cart/lib/__tests__/
  reprice.test.ts` (+1), `checkout/commands/__tests__/session.test.ts` (+1, the storeId
  regression fix), `checkout/api/sessions/__tests__/route.test.ts` (updated for the new
  `source: 'link'` dispatch).
- Checks (local mode, from repo root): `yarn generate` — clean. `yarn workspace
  @open-mercato/core run typecheck` — clean, exit 0. `yarn workspace @open-mercato/checkout
  run typecheck` — clean, exit 0. `yarn jest src/modules/cart` (from `packages/core`) —
  30/30 suites, 427/427 tests, ZERO regressions on Step 2.9's own 30/423 baseline. `yarn
  workspace @open-mercato/checkout test` — 49/49 suites, 353/353 tests, ZERO regressions on
  Step 2.13's own 47/328 baseline (re-verified explicitly, including the C10 Phase-A-boot
  non-regression test). `eslint` clean (0 errors; 1 pre-existing anonymous-default-export
  style warning on `checkout/data/entities.ts`, unrelated to this Step's own additions) on
  every changed/new file.

## 2026-10-28T00:00:00Z — checkpoint 8 (Step 3.5, closes Phase 3)
- Range: `5bcf30e047` (single Step, phase-close trigger). Summary: checkout B.2 trusted pay-link
  cart seeding (D-R5-19) + reusable C9 consistency guard, ready for Step 4.1.
- Checks: forced full typecheck with tsbuildinfo wiped (40/40, 0 cached) pass; core sweep
  (cart+customer_groups+ecommerce, 142/144 suites, 1792/1800 tests, 2 expected gated skips); full
  checkout suite (49/49 suites, 353/353 tests, incl. re-verified C10 Phase-A guard).
- Decisions/problems: none blocking. Two non-blocking gaps logged (CheckoutLinkCartTemplate admin
  write route; catalog-only template lines) — neither blocks Phase 4.
- Phase 3 is complete. All 5 Steps landed plus one fix-forward; no rescues needed this phase.

## 2026-10-28T01:30:00Z — Step 4.1 landed (checkout B.4 submit, steps 1-5 of C19/§7.2 —
preconditions, cart.lock, availability.reserve, on-account reserveCredit, idempotent document
creation + the C7 equality check — STOPS there, Step 4.2 continues)

- First real caller of nearly every mechanism built in Phases 1-3 at once (cart lock,
  availability reserve, credit reserve, the C9 guard) — built as ONE new command,
  `checkout.session.submit` (`commands/submit.ts`), that performs steps 1-5 of the revised
  §7.2 sequence and intentionally stops after document creation + the C7 check (session left
  `submitting`, `submitProgress: 'document_created'`, `salesQuoteId`/`salesOrderId` written —
  never `completed`/`failed`). Each of steps 1-5 is its own, separately-committing call
  (`cart.lock`, `availability.reserve`, `customerCreditService.reserveCredit`,
  `sales.quotes.create`, `sales.quotes.convert_to_order`); this orchestrating function is NOT
  itself one outer transaction, matching §7.2's own "each step is a separate transaction."
- **Payment-method-selection question (tracked after Step 2.13), resolved:** submit takes
  `paymentMethodCode` as a direct, required input field — no `POST /sessions/current/payment`
  selection route is built anywhere in this run. `purpose` stays `'order'` unconditionally;
  `paymentMethodCode === 'request_quote'` is refused outright (`422
  payment_method_unavailable`), since the quote branch is Step 5.1's own scope.
- **Genuine gap found during implementation, not anticipated by the task brief (C7):**
  `cartService.getSalesSnapshot` — the cart module's own spec (§3.1a/§9.1 rev 10) names this
  as the ONE source checkout must use to build its quote — did not exist anywhere in `cart`
  before this Step. Built `cart/lib/toSalesSnapshots.ts` (the spec's own named file path) plus
  a new `getSalesSnapshot` method on the existing `cartService` DI key (additive, per the cart
  spec's own BC table). Per-line mapping reuses `lib/reprice.ts#toCartTotalsLineSnapshot`
  verbatim; order-scope adjustments are reconstructed from persisted `CartPromotionApplication`
  (`scope: 'order'`) rows. See PLAN.md's own decision entries for the full reasoning on this
  and the four other cross-module gaps this Step closed (`cart.lock`'s deferred storefront-
  routeContext assertion, C2; `sales`'s missing `externalReference`/`customerReference` create
  inputs, C3/D-R5-30; the C7-vs-D-R5-24 totals-comparison design; the idempotent-retry test
  scoping decision; the availability-absence compensation gate).
- **§7.2 step 2 (delivery re-evaluation) closed for real, per Step 2.13's own NOTIFY flag:**
  re-validates the stored shipping rate (via the SAME `getOrComputeDeliveryOptions` cache Step
  2.13's own `/current/delivery` command uses) and re-runs `evaluateDeliveryDiscount` with the
  cart's CURRENTLY-entered codes, re-derived from `cart_promotion_applications`
  (`lib/cartPeer.ts#lookupCartEnteredCodes`, new) — `evaluateDeliveryDiscount` itself gained an
  additive, optional `codes` param (default `[]`, so Step 2.13's own `/current/delivery` call
  site is completely unaffected). A mismatch against `session.quotedTotals` aborts `409
  price_changed` with `reason: 'delivery_changed' | 'promotion_newly_eligible'`.
- **C9 re-fires at submit, not just at session creation (Step 3.5's own documented gap, now
  closed):** reuses `lib/cartSessionConsistency.ts`'s SAME `assertCartMatchesCheckoutScope` +
  `resolveRequestStoreIdForConsistencyCheck` functions Step 3.5 left ready for exactly this —
  no second implementation of the four comparisons.
- **Preconditions built, per the task's own explicit scope:** C9 (above); K1/K2 approval and
  D-R5-12 guest are enforced authoritatively INSIDE `cart.lock` itself (Step 3.1), so this
  command does not duplicate them — only calls `cart.lock` with the right inputs. C15 PO
  number/`min_order_value` are confirmed NOT implemented anywhere yet (grep-verified, same as
  Step 3.1's own confirmation) and are correctly deferred to Step 5.1, per that Step's own
  scope. Also added, not explicitly named by the brief but needed for a coherent sequence: cart
  non-empty (`409 cart_empty`, checked via the snapshot read since nothing earlier can prove
  it), a delivery method already selected (`422 steps_incomplete`).
- **Compensation (§7.3):** a central `compensate()` helper releases credit/stock/unlocks the
  cart per-step per the spec's own table, then CASes the session back to `open` — UNLESS the
  compensation itself fails, in which case the session is deliberately left `submitting`
  (recoverable by Step 4.2's own `recover-stuck-submits` job, C24) rather than silently
  returning to `open` while a reservation may still be live (§7.3: "never swallowed"). The
  created quote is never deleted on a totals-mismatch abort — left as an ordinary, visible,
  unconverted quote, exactly per §7.3's own text.
- **D-R5-24 vs. C7 — kept as two distinct comparisons, per the task's own explicit warning not
  to conflate them:** C7 compares GOODS totals (cart vs. an independent, goods-only
  `calculateDocumentTotals` call using the identical snapshot lines/adjustments — not the
  persisted quote row's own totals, which also carry the shipping/delivery-discount
  adjustments this command adds and are therefore not key-for-key comparable, since the
  calculation engine folds a `shipping` adjustment into `subtotalNet/GrossAmount` by design).
  D-R5-24 compares the FULL PAYABLE amount (goods gross + delivery cost − delivery discount)
  against the reserved credit amount, ON-ACCOUNT ONLY (there is no "reserved amount" to compare
  against on the gateway path). Either mismatch aborts the SAME `500 totals_mismatch`.
- **Idempotent document creation (C3):** looks up an existing `SalesQuote` by `(tenant_id,
  external_reference)` before ever calling `sales.quotes.create`; `convert_to_order` runs only
  if no `SalesOrder` already exists for that id (the order's id defaults to the quote's own id,
  the existing `documents.ts` convention — `orderId: payload.orderId ?? quote.id`). Both
  lookups exclude a soft-deleted row (`deleted_at IS NULL`).
- Files: `packages/checkout/src/modules/checkout/commands/submit.ts` (new, +tests),
  `commands/index.ts` (registration), `events.ts` (+`checkout.session.submitted`,
  `.compensation.executed`, `.compensation.failed`), `lib/cartPeer.ts`
  (+`lookupCartEnteredCodes`), `lib/promotionsDeliveryEvaluation.ts` (+optional `codes` param).
  Cross-module: `packages/core/src/modules/cart/lib/toSalesSnapshots.ts` (new, +tests),
  `lib/cartService.ts` (+`getSalesSnapshot`, `lock()` gains an additive `request` field,
  +tests), `commands/lock.ts` (+storefront routeContext assertion, +tests in `lock.test.ts`);
  `packages/core/src/modules/sales/data/validators.ts` (+`externalReference`/
  `customerReference` on `quoteCreateSchema`), `commands/documents.ts` (wired into
  `createQuoteCommand`, +test), `data/entities.ts` (+index on `SalesQuote`),
  `migrations/Migration20261028010000_sales_quotes_external_reference_idx.ts` +
  `.snapshot-open-mercato.json`.
- Checks (local mode, from repo root, `tsconfig.tsbuildinfo` wiped first per this run's own
  Checkpoint-7 standard): forced full `yarn typecheck` — 40/40 tasks, 0 cached (core and
  checkout genuine cache misses), clean. `yarn build:packages` — 40/40 successful. `yarn
  generate` — clean, no unexpected diffs. `eslint` on every changed/new file — clean. Full
  `checkout` suite: 50/50 suites, 370/370 tests (+1 suite, +17 tests on Step 3.5's own 49/353
  baseline), zero regressions. Full `cart` suite: 32/32 suites, 443/443 tests (+2 suites, +16
  tests on Step 3.5's own 30/427 baseline), zero regressions. Full `sales` suite: 133/133
  suites, 1068/1068 tests (+1 suite, +2 tests), zero regressions. Full `customer_groups` +
  `availability` suites: 56/59 suites (3 pre-existing pg-gated skips), 587/587 non-skipped
  tests, zero regressions.
- Not built in this Step, by its own explicit scope: `availability.commit`, credit linkage
  (`linkCreditReservationToOrder`), code usage (`useCode`/`registerUsage`), the gateway step,
  `markConverted`'s `lineMap`, and the `recover-stuck-submits` recovery job — all Step 4.2. No
  public HTTP route calls `checkout.session.submit` yet (same precedent `cart.lock`/
  `.markConverted` set for a whole release before a real caller existed) — a route would need
  to call the FULL sequence (steps 1-8) to ever reach a terminal session status, so building a
  half-finished route in this Step would strand a session in `submitting` with no way to
  complete. Flagging for whichever Step builds it (likely alongside or after Step 4.2).

## 2026-10-28T02:30:00Z — Step 4.2 landed (checkout B.4 submit, steps 6-8 of C19/§7.2 —
commit, credit link, codes/usage, gateway, lineMap, recovery — plus the public submit route)

- Continued Step 4.1's `checkout.session.submit` IN PLACE (its own `execute()` now runs the
  full 1-8 sequence via a new tail call into `continueOrderOutcome`, exported alongside
  `compensate` from `commands/submit.ts`) rather than building a second, standalone command
  — per the task brief's own conditional ("check Step 4.1's actual code structure... follow
  whatever shape it already committed to") and confirmed by reading Step 4.1's code: it is
  ONE function, not the §11 table's separately-named sub-commands. The full reasoning (and
  the resulting test-suite rewrite this forced) is in PLAN.md's "Decisions taken without the
  owner".
- **Steps 6-8, in order:** 6a `availability.commit` (right after document creation, before
  payment, D-R5-8) with a `404 reservation_not_found` treated as a no-op (nothing was ever
  reserved); 6b `customerCreditService.linkCreditReservationToOrder` on-account only — this
  method did NOT exist on the Step 1.6 service (confirmed missing) and was added here,
  additive, writing `linked_order_id` on the `reserve` ledger entry; 6c `useCode` per entered
  code then `registerUsage` for EVERY promotion that discounted the cart (not just code-
  triggered ones — `cart_promotion_applications.effect` already stores the real
  `ResolvedEffect` the evaluation engine produced, read back via two new `lib/cartPeer.ts`
  helpers), a refusal or non-empty `budgetExceeded` compensating via order cancellation and
  aborting `409 promotion_unavailable`; step 7 gateway — extends the cart lock through the
  payment window (C1), creates one session-keyed `CheckoutTransaction` (new nullable
  `session_id`/`order_id`/`quote_id` columns, `link_id` now nullable too — migration
  `Migration20261028020000`), calls `paymentGatewayService.createPaymentSession`, and
  branches on the gateway's own immediately-reported status: terminal success completes
  inline (confirm order, build the C18 `lineMap` from `sales_order_lines.metadata.cartLineId`,
  `cart.markConverted`, session `completed`), terminal failure compensates (cancel order,
  session `failed`), still-pending leaves the session at `awaiting_payment`; step 8 on-account
  skips the gateway and completes directly.
- **Compensation is uniform from step 6 onward, exactly as instructed:** every failure
  compensates by CANCELLING THE ORDER (`sales.orders.update` to the `canceled`/`cancelled`
  dictionary entry, resolved via a new raw-SQL helper since `sales` has no plain `status`
  input — only `statusEntryId` against a per-tenant/org dictionary) — never a hand-rolled
  parallel release. The three `sales.order.cancelled` subscribers this release already shipped
  (`wms`'s order-hold release, `customer_groups`'s `order-cancelled-credit-release` via C6's
  `linkedOrderId`, `promotions`'s `order-cancelled-usage-revert` via `CodeUsage.orderId`) do
  the actual releasing; this Step's own `compensateByCancellingOrder` helper only additionally
  unlocks the cart (nothing else reacts to cancellation that way) and fails the session.
- **Genuine unclaimed gap, flagged (not fixed in this Step):** a session that reaches
  `awaiting_payment` because the gateway answered asynchronously (the common case for most
  real redirect-based providers, as opposed to this Step's own test-gateway mocks, which
  report a terminal status immediately) has NO mechanism anywhere in this run that ever moves
  it to `completed`/`failed` afterward — §12's own `expire-awaiting-payment` job is the
  obvious owner and is not part of this Step's Tasks-table title. A future Step should build
  it (or a payment-gateway webhook subscriber), reusing `confirmOrderAndComplete`/
  `compensateByCancellingOrder`, both exported by `commands/submit.ts`.
- **`recover-stuck-submits` (C24), scoped to the `submitting`-only half of §12's job table**
  (`awaiting_payment` recovery is the SAME `expire-awaiting-payment` gap named above, not this
  Step's). A genuine implementation discovery reshaped the decision table itself: Step 4.1's
  own steps 1-5 never persist `submit_progress` as `locked`/`stock_reserved`/`credit_reserved`
  on the session row — only `null` and `document_created` are ever written, so the worker
  collapses those three C24 rows into one: whenever progress precedes `document_created`,
  release stock AND credit by the session's own stored keys (both release primitives already
  no-op safely when nothing was actually reserved) plus a best-effort cart unlock that
  swallows a "never actually locked" 404. `document_created`/`finalized` resume forward by
  calling `continueOrderOutcome` again — the SAME function, re-deriving every input from the
  session's own columns, proven idempotent by the same keys. A resume stuck past a 30-minute
  give-up window compensates and fails with `submit_recovery_failed`, per §12.1's own final
  row. Scheduled every minute via `setup.ts`'s `seedDefaults` (same `schedulerService.register`
  pattern every sibling Release-5 sweeper already uses).
- **Quote-outcome `lineMap` (D-R5-26) confirmed still deferred to Step 5.1**, not built here:
  `request_quote` is refused outright at the top of `checkout.session.submit` (Step 4.1's own,
  unchanged code), so the quote branch of §7.2 is unreachable from this command. Only the
  order-outcome `lineMap` was built.
- **Public route, `POST /api/checkout/sessions/current/submit`:** thin HTTP adapter over the
  now-full `checkout.session.submit`, same shape every sibling `/sessions/current/*` route
  already follows — D-R5-33 identity binding and cross-tenant scope collapse are inherited
  from the shared `resolveCurrentSession` helper (not re-implemented); C14's 10/min-per-session
  + 60/min-per-IP pair is enforced via the existing `checkoutSubmitRateLimitConfig` (session-
  scoped by `keyOverride`) plus a new `checkoutSessionSubmitIpRateLimitConfig` for the IP half;
  `Idempotency-Key` header validated (16-128 chars) before the command is ever dispatched.
- Files: `packages/checkout/src/modules/checkout/commands/submit.ts` (+519 lines: `paymentMethodCode`
  now persisted on the CAS write, `compensate` exported, `continueOrderOutcome` + 5 new helper
  functions), `commands/__tests__/submit.test.ts` (harness extended for `availability.commit`/
  `sales.orders.update`/the order-status dictionary/`cartService.markConverted`/
  `paymentGatewayService`/`promotionsService`; 8 new tests for steps 6-8), `workers/
  recover-stuck-submits.worker.ts` (new, +test), `api/sessions/current/submit/route.ts` (new,
  +test), `data/entities.ts` (`CheckoutTransaction`: `link_id` nullable, +`session_id`/
  `order_id`/`quote_id`), `data/validators.ts` (+`checkoutSessionSubmitSchema`), `events.ts`
  (+5: `.session.completed`/`.session.failed`/`.payment.initiated`/`.succeeded`/`.failed`),
  `lib/cartPeer.ts` (+`codeString` on `CartEnteredCodeRef`, +`lookupCartAppliedPromotionEffects`,
  +`lookupPromotionNames`), `lib/rateLimiter.ts` (+`checkoutSessionSubmitIpRateLimitConfig`),
  `setup.ts` (+schedule), `migrations/Migration20261028020000.ts` + `.snapshot-open-mercato.json`;
  two Phase-A call sites fixed for `linkId` now being nullable (`api/transactions/route.ts`,
  `commands/transactions.ts`). Cross-module: `packages/core/src/modules/customer_groups/
  services/customerCreditService.ts` (+`linkCreditReservationToOrder`, +tests) — confirmed
  missing from Step 1.6's shipped service, as the task brief itself anticipated.
- Checks (local mode, from repo root, every `tsconfig.tsbuildinfo` wiped repo-wide first):
  `yarn tsc --noEmit` on both `checkout` and `core` packages — clean, 0 errors. `eslint` on
  every changed/new file — clean (one pre-existing, untouched warning in `checkout/data/
  entities.ts`). `yarn generate` — clean, no unexpected diffs, new route/worker picked up by
  auto-discovery. Full `checkout` suite: 52/52 suites, 397/397 tests (+2 suites, +27 tests on
  Step 4.1's own 50/370 baseline), zero regressions. Full `cart` + `customer_groups` +
  `availability` + `promotions` suites together: 116/119 suites (3 pre-existing pg-gated
  skips), 1366/1383 tests, zero regressions.
- Not built in this Step, by its own explicit scope or the gaps flagged above:
  `expire-awaiting-payment` (§12's own separate job — the async-webhook-completion gap),
  quote-outcome `lineMap` (D-R5-26, Step 5.1), B.5's `request_quote` payment method itself
  (Step 5.1), `checkout.sessions.view`/`.manage` admin viewer UI (B.6).

## 2026-10-28T01:30:00Z — dispatcher: appended Step 4.2-fix for a real, in-scope gap
- Step 4.2's executor flagged that no mechanism in this run completes a session that reaches
  `awaiting_payment` via an asynchronous gateway (webhook/polling) — the submit command extends
  the cart lock to the "intent TTL" entering that state (C1) but nothing ever follows up if the
  gateway never calls back or times out. Finding C1 EXPLICITLY names the owner: "checkout extends
  the lock on entering `awaiting_payment` to the intent TTL, and `expire-awaiting-payment` (§12)
  compensates before the lock can lapse." This is NOT the B.6-deferred "stalled-instance monitor"
  (a workflow concept) — it's C1's own stated mechanism, in scope. Appended Step 4.2-fix to close
  it before moving on to assisted_selling (Steps 4.3-4.5 don't depend on it, so no reordering
  needed beyond inserting the row) — a same-module, additive, spec-named fix, not a scope change
  requiring the owner.

## 2026-10-28T02:10:00Z — executor: Step 4.2-fix landed, `expire-awaiting-payment` built
- New worker `workers/expire-awaiting-payment.worker.ts` (queue
  `checkout-expire-awaiting-payment`, `concurrency: 1`, matching the sibling jobs' own
  idiom), scheduled every 5 min per (tenant, organization) in `setup.ts`, mirroring
  `transaction-expiry`/`recover-stuck-submits`'s own registration pattern exactly.
- Authoritative clock: `CheckoutSession.paymentExpiresAt` (§12's own table entry, verbatim —
  see PLAN.md's "Decisions taken without the owner" for the full reasoning and the one
  pre-existing Step 4.2 deviation this Step found and deliberately left alone, the fixed
  75-min lock-extension margin not being derived from the real `payment_expires_at`).
- Probe: `paymentGatewayService.findTransactionBySessionId(session.paymentIntentRef, scope,
  session.paymentMethodCode)` then `.getPaymentStatus(gatewayTransaction.id, scope)` — Phase
  A's own idiom (`api/pay/[slug]/status/[transactionId]/route.ts`), generalized because a
  session-backed `CheckoutTransaction` never gets a `gatewayTransactionId` (that field is
  only ever written by the link-only `checkout.transaction.updateStatus` command — confirmed
  by reading `commands/transactions.ts:159-165`, which 404s without a `CheckoutLink`). No
  match, no answer, or a thrown probe all collapse to "no definitive answer" → compensate,
  per §12's own "otherwise compensate" wording — never defaulted to success.
- Resume/compensate: calls `confirmOrderAndComplete`/`compensateByCancellingOrder` directly —
  both exported from `commands/submit.ts` by this Step (the prior NOTIFY.md entry's claim
  that they were "already exported" was stale; corrected here). No parallel reimplementation
  of either "confirm the order + markConverted + complete" or "cancel the order + fail the
  session" exists anywhere in this job.
- Tests: `workers/__tests__/expire-awaiting-payment.worker.test.ts` (10 cases: tenant-scoped
  query, gateway success resumes without a duplicate order, gateway failure/no-match/thrown-
  probe all compensate with `failureCode: 'payment_expired'`, a session missing required
  fields is skipped, a single session failure doesn't stop the batch, a session still within
  its deadline is never selected) plus one new `setup-schedules.test.ts` case for the
  schedule registration itself. Full `checkout` suite: 53/53 suites, 407/407 tests (+1 suite,
  +10 tests over Step 4.2's own 52/397), zero regressions. `yarn tsc --noEmit` on `checkout`
  clean after wiping every `tsconfig.tsbuildinfo` repo-wide first.

## 2026-10-27T06:18:18Z — executor: Step 4.3 landed, `assisted_selling` module scaffold + store settings
- New module `packages/core/src/modules/assisted_selling/`: `index.ts` (no hard `requires` —
  `cart`'s proposal seam and `ecommerce`'s `storeContextService.resolveForBuyer` are Step
  4.4/4.5's own soft-dependency reads, nothing in this Step touches either), `acl.ts` (single
  feature `assisted_selling.settings.manage`, matching §6.1's literal route table which names
  no separate `.settings.view`), `setup.ts` (`admin: ['assisted_selling.*']` only — least
  privilege, D-R5-7's precedent, no `employee` grant since there's no `.view` feature to split
  off), `data/entities.ts` (`AssistedSellingStoreSettings`: full `ai|rep|both|off` mode enum
  reserved per S10, `proposal_ttl_seconds`/`max_proposal_lines`/`conversation_retention_days`/
  `idle_close_days`/`ai_proposals_require_rep_approval`/`ai_max_proposals_per_thread_per_hour`/
  `ai_max_turns_per_thread_per_hour`/`ai_agent_user_id` all shipped now per §5.6's own "ship
  with their defaults so Phase 3 is additive" instruction; unique `(tenant_id, organization_id,
  store_id)`), `data/validators.ts` (`.strict()` update schema over exactly the five Release
  5-exposed fields — a body naming any `ai_*` field is a `400`; `assistedSellingReleaseModeSchema
  = z.enum(['rep', 'off'])` is the actual write-path refusal of `ai`/`both`), `lib/settings.ts`
  (plain `loadAssistedSellingStoreSettings`/`resolveEffectiveAssistedSellingSettings`, no DI
  service — mirrors `warranty_claims`'s own settings precedent), `commands/shared.ts` +
  `commands/settings.ts` (`assisted_selling.settings.save`, upsert with the SAME
  create-then-retry-on-unique-violation pattern `warranty_claims.settings.save` uses, optimistic-
  locked via `enforceCommandOptimisticLockWithGuards`), `api/settings/[storeId]/route.ts`
  (`GET`/`PUT`, both gated on `assisted_selling.settings.manage`; returns §5.6 defaults when no
  row exists; `storeId` is an opaque FK — no `ecommerce.EcommerceStore` existence check, mirrors
  `availability.AvailabilityPolicy.storeId`'s own precedent), `i18n/{en,de,es,ko,pl}.json`
  (7 error keys, English text duplicated across locales per the `cart.errors.*` precedent),
  `migrations/Migration20261027120000_assisted_selling.ts` + `.snapshot-open-mercato.json`
  (hand-authored — the sandbox's local Postgres holds unrelated prior-session schema state,
  same risk Step 2.10 already flagged for `yarn db:generate`). No `events.ts` (nothing to
  declare yet — 15 other core modules ship with none either) and no `di.ts` (no cross-module DI
  consumer exists yet; see PLAN.md's "Decisions taken without the owner" for the full reasoning
  on both, plus the ACL/store-existence calls above).
- Module registration: `apps/mercato/src/modules.ts` gets an active `{ id: 'assisted_selling',
  from: '@open-mercato/core' }` right after `cart`. The create-app template stays commented out
  via the MAINTAINER-AUTHORED mechanism (`scripts/template-sync.ts`'s `TEMPLATE_COMMENTED_
  MODULES` map, applied by `yarn template:sync:fix`) — hand-editing the template file directly
  does not survive a sync-fix run (verified: a first fix attempt before adding the map entry
  silently uncommented it). Added the `assisted_selling` entry to that map (same shape/rationale
  as `availability`'s own entry) and re-ran the fix; `template-modules-parity.test.ts`'s two
  cases and `yarn template:sync` both pass clean.
- Tests: `__tests__/validators.test.ts` (9 cases — mode refuses ai/both at both the bare-enum
  and the scoped-save-schema level, `.strict()` refuses an `ai_*` field, TTL bounds), `commands/
  __tests__/settings.test.ts` (6 cases — create-with-defaults, partial update, the first-save
  optimistic-lock race mirrored from `warranty_claims`'s own concurrency test, cross-tenant and
  cross-organization scope refusal before any DB read). 13/13 new tests pass
  (`yarn jest src/modules/assisted_selling` in `packages/core`).
- Checks (local mode, every `tsconfig.tsbuildinfo` wiped repo-wide first): `yarn generate` —
  clean, new module/route/command discovered (`api-route-shard.002.assisted_selling.generated.ts`,
  `assisted_selling:commands:settings` in `command-loaders.generated.ts`); fixed one real
  mistake this surfaced (the OpenAPI bundler's static-import resolution caught a route importing
  `ASSISTED_SELLING_STORE_SETTINGS_RESOURCE_KIND` from the wrong file — the constant is defined
  in `commands/shared.ts`, not re-exported by `commands/settings.ts`; fixed the route's import
  before the second `yarn generate` ran clean at 714/714 OpenAPI paths). `yarn tsc --noEmit` on `core`
  clean. `eslint` on every changed/new file clean (exit 0; the "Pages directory cannot be
  found" line is Next's own informational noise, unrelated). `yarn template:sync` clean.
- Not built in this Step, by its own explicit scope: threads/participants/messages/proposals
  (Step 4.4), buyer routes + retention/erasure (Step 4.5), the rep console (Step 5.3),
  attribution (Step 5.4) — nothing in this Step's module reads or writes `cart`/`ecommerce` at
  all yet.

## 2026-10-27T07:05:17Z — executor: Step 4.4 landed, thread/participant/message/proposal entities + staff author routes

- Entities (`data/entities.ts`, §5.1-§5.4): `AssistedSellingThread` (partial unique
  `(tenant_id, buyer_cart_id)` where `status = 'open'`), `AssistedSellingParticipant`
  (encrypted `display_name`; partial unique `(thread_id, actor_type, actor_id)` where
  `deleted_at is null`), `AssistedSellingMessage` (encrypted `body`; nullable Phase-3
  `ai_input_flagged_at`/`ai_read_by_turn_id` columns per S10), `AssistedSellingProposal`
  (encrypted `rejection_reason`; the metadata row pointing at the `cart.Cart` with
  `kind: 'proposal'`, NOT a line/price duplicate — see PLAN.md's decision entry resolving the
  brief's own flagged S23/S1 tension). `encryption.ts` declares the three fields — entity ids
  are `assisted_selling:assisted_selling_message`/`_participant`/`_proposal` (the REAL
  generator output, confirmed against `packages/core/generated/entities.ids.generated.ts`
  after `yarn generate`), not the literal `assisted_selling:message` etc. strings §5.7's prose
  shows — a mismatch here would have encrypted nothing. `events.ts` declares exactly the six
  events this Step's own commands emit (`thread.opened`, `participant.joined`,
  `message.posted`, `proposal.published`/`.withdrawn`/`.superseded`) — the §6.6 terminal-state
  events (`.accepted`/`.rejected`/`.expired`) and `.attribution.degraded` stay undeclared; see
  the gap this Step's own decisions entry documents. `acl.ts`/`setup.ts` add `threads.view`,
  `threads.participate`, `proposals.author` (`employee` gets the first two; `proposals.author`
  stays admin-or-hand-granted, matching §6.9's least-privilege line). `index.ts` promotes `cart`
  to a hard `requires` (`apps/mercato/src/modules.ts` comment updated to match).
- Commands (`commands/threads.ts`, `commands/proposals.ts`): `assisted_selling.thread.open`
  (S9-scoped cart read via two new additive `cartService` methods, §6.1's "creates the thread,
  adds the rep as a participant and posts an opening message"), `assisted_selling.proposal.
  author`/`.withdraw`/`.reauthor`. `author`/`.reauthor` share one `performAuthorProposal`
  helper running §6.3's full sequence (live-mode check, `resolveForBuyer` fail-closed,
  `cart.proposal.create` by command id, local persist, `.proposal.published`); `.withdraw`/
  `.reauthor` both call `cart.proposal.reject` in the same action per §6.4, never only the
  local row. Every feature check goes through `requireAssistedSellingFeatures`
  (`rbacService.userHasAllFeatures`, S21) — authoring/reauthor require BOTH
  `assisted_selling.proposals.author` and `cart.proposals.author`, matching §6.1's
  two-feature-by-design rule.
- `cart` module changes (additive, 443/443 pre-existing cart tests stayed green after both):
  `lib/cartService.ts` gained `getForOrganizations` (a `kind: 'basket'` cart scoped to a LIST
  of `organizationIds`, S9 — no existing read supported a multi-org list without a direct
  `Cart` import) and `getProposalCartLines` (a `kind: 'proposal'` cart's own lines, for
  `/proposals/:id/reauthor`). `commands/proposal.ts`'s `CartProposalCreateInput.routeContext`
  narrowed from the full `ResolvedCartRouteContext` to `Pick<…, 'assortmentScope'>` — the one
  field the command actually reads; the full type could never have been constructed by this
  Step's non-HTTP trusted caller in the first place. Both are additive/widening; see PLAN.md's
  decision entries for the full reasoning.
- Routes: `POST /api/assisted_selling/threads` (open), `GET /api/assisted_selling/threads`
  (list), `POST /api/assisted_selling/threads/:id/proposals` (author), `POST /api/
  assisted_selling/proposals/:id/withdraw`, `POST /api/assisted_selling/proposals/:id/
  reauthor` — route prefix matches S4 exactly (underscore, no `/storefront` segment on these
  staff paths).
- S23 idempotency resolution (documented in full in PLAN.md's decisions): the unique key lives
  on `AssistedSellingProposal.idempotency_key` (`(tenant_id, thread_id, idempotency_key)`),
  checked BEFORE the mode check and before any `cart` call, exactly as §6.3 specifies. The
  concurrent-race branch (two first-calls, one key) is handled by letting both reach
  `cart.proposal.create` (each its own transaction), then having the LOSER of the local unique
  insert explicitly compensate — calling `cart.proposal.reject` on the proposal cart it just
  orphaned — before answering as a replay of the winner's row. This is the closest achievable
  simulation of §6.3's literal "the other's transaction... rolls back" wording given that two
  separately-dispatched commands cannot share one database transaction.
- Known, deliberately scoped-out gaps (both flagged in PLAN.md's decisions, not silently
  dropped): (1) Step 3.3's provisional `cart.cart.merged` re-author/supersede subscriber is
  UNCHANGED — the real migration into this module needs its own bookkeeping updates
  (`superseded_by_proposal_id`, `live_proposal_count`, `.proposal.superseded`) and is sized for
  its own Step. (2) The §6.6 terminal-state subscriber (`cart.proposal.accepted/.rejected/
  .expired` → local `AssistedSellingProposal.status`) and the §5.1 thread-identity subscribers
  (`cart.cart.merged`/`.adopted`) are NOT built — no Step in PLAN.md's Phase 4/5 names them
  explicitly; a buyer's own accept/reject/expiry of a proposal currently updates only `cart`'s
  side. Recommend the run insert a dedicated Step for both before Phase 4/5 is called complete.
- Tests (`packages/core`, `yarn jest src/modules/assisted_selling` style — command-level jest,
  matching this codebase's own convention of no dedicated route-level tests for `cart`'s
  sibling proposal routes either): `commands/__tests__/threads.test.ts` (8 cases — S9
  cross-organization refusal, wildcard ACL grant, missing-feature refusal, cross-tenant
  refusal, cart-not-active, mode-off, thread-already-open race), `commands/__tests__/
  proposals.test.ts` (13 cases — note-as-encrypted-message-body with no `note` field reaching
  `cart.proposal.create`'s own input, idempotency replay/mismatch, wildcard ACL, withdraw/
  reauthor including the `proposal_already_accepted` D-R5-25 refusal), `__tests__/
  encryption.test.ts` (2 cases — the exact entity-id regression this Step's own header comment
  documents). 35/35 new tests pass.
- Checks (local mode, every `tsconfig.tsbuildinfo` wiped repo-wide first): `yarn generate`
  clean (confirmed the real entity-id strings via the regenerated
  `entities.ids.generated.ts`). `yarn typecheck` — 40/40 package tasks green (`@open-mercato/
  core` and `@open-mercato/app` both cache-miss-executed clean). `eslint` on every
  changed/new file clean (exit 0). `yarn jest src/modules/assisted_selling` — 35/35. `yarn
  jest src/modules/cart` (packages/core) — 443/443, zero regressions from the `cartService`/
  `routeContext` type changes. Hand-authored
  `migrations/Migration20261027150000_assisted_selling.ts` + a hand-built
  `.snapshot-open-mercato.json` update (same stale-local-Postgres risk Step 4.3/2.10 already
  documented) — built the snapshot fragment programmatically (not by hand-typing JSON) and
  diffed its shape against the existing `cart`/`assisted_selling` snapshot entries, including
  the exact partial-unique-index `expression` shape `cart_lines_unique_line_key` already uses.

## 2026-10-28T03:00:00Z — dispatcher: appended Step 4.4-fix for a real, in-scope gap
- Step 4.4's executor flagged two real gaps: (1) nothing updates `assisted_selling`'s own
  thread/proposal rows when a buyer accepts/rejects a proposal, or when it expires — only `cart`
  reflects these transitions; the rep console (Step 5.3) would show stale thread state without
  this. (2) Step 3.3's provisional `cart`-side re-author subscriber (built before this module
  existed, explicitly flagged by its own author for migration) still lives in `cart` instead of
  `assisted_selling`, where it belongs now that the module's thread/participant bookkeeping
  exists to support it properly. Both are additive, same-module-pair fixes with clear spec basis
  (§6.4/§6.6, §8.1) — appended Step 4.4-fix rather than stopping the run.

## 2026-10-28T03:30:00Z — checkpoint 9 (Steps 4.1–4.4 + 4.2-fix)
- Range: `4e97db75cd`..`008238bd42` (incl. `2c25fb7bbf`). Summary: checkout's entire B.4 submit
  sequence (lock → reserve → credit → document → commit → codes → gateway → lineMap), its
  recovery jobs for both `submitting` and `awaiting_payment` stuck states; assisted_selling module
  opened (settings, threads, proposals).
- Checks: forced full typecheck with tsbuildinfo wiped (40/40, 0 cached) pass; core sweep across
  5 modules (121/124 suites, 1401/1418 tests, 3 expected gated skips); full checkout suite (53/53
  suites, 407/407 tests).
- Decisions/problems: two real gaps found and tracked this window, not papered over —
  expire-awaiting-payment (already fixed, 4.2-fix) and assisted_selling's terminal-state
  subscriber + re-author migration (appended as 4.4-fix, next up).

## 2026-10-28T04:15:00Z — executor: Step 4.4-fix landed, terminal-state subscriber + re-author migration

- **Part 1 — §6.6 terminal-state subscriber.** Three thin subscriber files on `cart.proposal.
  accepted|.rejected|.expired` (`subscribers/cart-proposal-{accepted,rejected,expired}.ts`),
  sharing one handler factory (`lib/terminalStateSubscriber.ts`). Each resolves the local
  `AssistedSellingProposal` by `(tenantId, organizationId, proposalCartId)` (reading scope from
  the payload first, `ctx.tenantId/organizationId` as fallback — the sweeper-emitted `.expired`
  carries scope only in `emitOptions`, never in the payload body itself), writes the target
  status + `resolved_at` (+ `merge_log_id` for `.accepted`), decrements the thread's
  `live_proposal_count`, and emits `assisted_selling.proposal.accepted|.rejected|.expired`
  (newly declared in `events.ts` — Step 4.4 had deferred them). Idempotency: a proposal whose
  local `status` is already non-`published` is left untouched entirely (no double-resolve).
  New events are `clientBroadcast: true` per §6.8.
- **A real correctness gap found and fixed while building Part 1, not part of the original
  ask but required for it to work at all:** `withdrawProposalCommand` and `reauthorProposal
  Command`'s own supersede branch order their local status write and their `cart.proposal.
  reject` dispatch OPPOSITELY (reject-then-write vs. write-then-reject). A subscriber that
  decides whether to decrement by reading "is this proposal still `published`" at delivery
  time would therefore decrement correctly for withdraw and silently MISS it for reauthor's
  supersede (and would have missed it for this Step's new merge-retarget supersede too).
  Fixed by making every author-initiated ending decrement `live_proposal_count` itself,
  synchronously, in its own transaction, and having the `.rejected` subscriber unconditionally
  skip every `rejectedBy: 'author'` payload (the one ordering-independent signal on that
  event). This touches `withdrawProposalCommand`/`reauthorProposalCommand`, both shipped under
  Step 4.4 in this same PR — flagged in PLAN.md's decisions rather than silently folded in.
- **Part 2 — re-author-on-merge migration.** New `lib/reauthorOnMerge.ts` +
  `subscribers/cart-merged-reauthor.ts`, subscribing to `cart.cart.merged` with the same
  `kind: 'basket'`-only filter §8.1 specifies (the OTHER `cart.cart.merged` emission — the
  acceptance-merge inside `cart.proposal.accept`, `kind: 'proposal'` — is explicitly skipped).
  Candidates are this module's OWN `AssistedSellingProposal` rows with `status: 'published'`
  and `target_cart_id = sourceCartId` (the denormalized column Step 4.4 already added "so the
  console can list by target without reaching into `cart`") — no `cart.Cart`/`CartLine` scan
  at all, unlike the removed cart-side version, because this module's own rows already carry
  `authored_by_actor_*` and `thread_id` directly. For each candidate: the same D-R5-14
  eligibility/no-lines/thread-missing fallback checks as the original mechanism, then a new
  exported `commands/proposals.ts#reauthorProposalForMergeRetarget`, which re-runs §6.3 IN
  FULL (mode check, `resolveForBuyer` against the MERGED-INTO cart's own identity from the
  event payload, `cart.proposal.create`) by reusing `performAuthorProposal` via two new
  additive overrides (`targetCartId`, `targetBuyerIdentity`) — every existing caller
  (`.author`, `.reauthor`) is unaffected and keeps using `thread.buyerCartId`/`.customerId`/
  `.customerUserId` as before. On success it also applies the old row's own bookkeeping
  (`superseded_by_proposal_id`, `superseded`, the synchronous decrement, the `rejectedBy:
  'author'` reject dispatch, `.proposal.superseded`) — the SAME transition `.reauthor`'s own
  HTTP command already applies, shared rather than duplicated a third time. The idempotency
  key is derived from the old proposal's id (`reauthor-on-merge:<id>`), so a redelivered
  `cart.cart.merged` replays through `performAuthorProposal`'s own idempotency lookup instead
  of re-creating.
- **Removed, not stubbed:** `cart/lib/proposalRetarget.ts`,
  `cart/subscribers/cart-merged-proposal-retarget.ts` and their test file are deleted outright.
  Unshipped, self-labeled provisional in its own header, nothing outside itself referenced it
  except the ephemeral generated registry (`yarn generate` cleanly dropped it), and
  `packages/events/AGENTS.md`'s subscriber contract only constrains a KEPT subscriber's
  metadata shape, not removal. Full reasoning in PLAN.md's decisions.
- **Tests (`packages/core`):** `lib/__tests__/terminalStateSubscriber.test.ts` (8 cases —
  accepted/rejected-buyer/rejected-author-skip/expired, idempotency on redelivery, missing
  payload scope, ctx-fallback scope, no-matching-proposal no-op). `lib/__tests__/
  reauthorOnMerge.test.ts` (8 cases — ports every one of Step 3.3's original 6 cases from
  `cart/lib/__tests__/proposalRetarget.test.ts` against the new location: re-author success,
  supersede-on-create-refusal, supersede-on-ineligible-author, no-op-when-none-pending,
  ignores-payload-missing-scope, two-siblings-independent — plus 2 new: no-lines fallback,
  and the `kind: 'proposal'` emission is ignored). `commands/__tests__/proposals.test.ts`
  gained 4 cases: withdraw's synchronous decrement, withdraw's graceful no-thread no-op,
  reauthor's net-zero decrement/increment assertion added to its existing success test, and a
  new `reauthorProposalForMergeRetarget` describe block (2 cases — full bookkeeping on
  success including the identity-override assertion, and replay-skips-bookkeeping-twice).
  61/61 new assertions across 20 new test cases, all green.
- **Checks (local mode, every `tsconfig.tsbuildinfo` wiped repo-wide first):** `yarn generate`
  clean (confirmed zero `cart:proposal-retarget-on-merge` references anywhere post-regen, and
  the three new subscriber ids present). `yarn typecheck` — 40/40 package tasks green
  (`@open-mercato/core` cache-miss-executed clean). `eslint` on every changed/new file clean
  (exit 0). `yarn jest src/modules/assisted_selling` (packages/core) — 55/55 (35 pre-existing
  + 20 new). `yarn jest src/modules/cart` (packages/core) — 437/437 (443 minus the 6 deleted
  with `proposalRetarget.test.ts`), zero regressions.

## 2026-10-27T08:12:01Z — Step 4.5 landed

- `assisted_selling`: buyer thread routes under `/api/assisted_selling/storefront/thread`
  (§6.2, S4) — `GET`/`POST /thread`, `POST /thread/messages`, `GET /thread/events` — plus the
  three §5.10 event-driven erasure subscribers (`cart.cart.purged`, `customer_accounts.
  user.deleted`, `auth.user.deleted`).
- **Identity binding (D-R5-13/D-R5-21), the THIRD application of this run's own mechanism.**
  Added `cartService.resolveBasketByToken` to `cart`'s own `CartService`/`CartServiceImpl`
  (§5.1 names this exact call) — a scope-free, `kind: 'basket'`-only lookup by the globally
  unique `token_hash`, no `cart.get` dispatch, no re-price. `lib/cartAccess.ts` duck-types it
  the same way it already duck-types `getForOrganizations`/`getProposalCartLines`. The
  identity check itself (`lib/buyerIdentity.ts#resolveIdentifiedBuyerBasket`) lives in THIS
  module, via the same static `getCustomerAuthFromRequest` import `cart/lib/
  currentCartRoute.ts` and `checkout/lib/currentSessionRoute.ts` already use — a guest basket
  resolves on the token alone; an identified basket additionally requires the matching
  customer session, collapsing every refusal (unknown token, wrong session, no session) to
  the same `404` as an unknown thread.
- **Buyer routes/commands** (`commands/buyerThread.ts`): `assisted_selling.thread.
  openAsBuyer` (creates a thread with a `buyer`-typed participant, `actorId` = the
  identified `customerUserId` or `null` for a guest — never a staff-authored shape; returns
  the existing open thread unchanged when one already exists) and `assisted_selling.
  message.postAsBuyer` (404s when the basket has no open thread; no live-mode check, per
  §8.4 — an already-open conversation stays usable after the store turns `off`). Both run
  with `ctx.auth: null`, mirroring `cart`'s own `/current/*` buyer-route convention — trust
  comes from the already-identity-bound basket, never a staff principal.
- **`GET /thread/events` (§6.2, S25).** Server-side `ETag`/`304` only — `cursor` is the
  thread's own `updatedAt` ISO string (bumped by any message, participant or proposal-status
  change that touches the thread row); `If-None-Match` (preferred) or `?since=` matching the
  current cursor short-circuits to `304` with no body before any proposal read; otherwise
  `200` with `{ cursor, changed: true, threadUpdatedAt, proposalIds }` — `proposalIds` is
  every live proposal id when `since` is absent/invalid, or only those whose `updatedAt` is
  newer than `since` otherwise. Asserted (test) that the 200 response carries exactly those
  four keys — no message body, line, price or participant name ever appears in it. No client
  polling cadence is implemented (S25: that is the integrator's own documented contract).
- **Rate limiting.** New `lib/rateLimit.ts`, this module's own copy of `cart/lib/
  rateLimit.ts`'s shape (own `ASSISTED_SELLING_*` env prefixes), §6.2's own four buckets:
  `read` 120/min, `open` 10/min, `message` 30/min, `events` 240/min, keyed `ip:token`,
  fail-open on an unavailable limiter.
- **Retention/erasure — scope narrowed to the three event-driven triggers the Step's own
  brief named**, not the two time-based sweepers (`idle_close_days`/
  `conversation_retention_days`) §5.10 also specifies. `lib/retention.ts#
  eraseAssistedSellingThread` is the ONE erase routine (hard-delete messages/participants,
  clear proposal `rejectionReason`, soft-delete the thread) both this Step's `cart.cart.
  purged` trigger and a later Step's sweepers should share. `lib/retention.ts#
  anonymizeAssistedSellingRepParticipants` replaces a deleted rep's `display_name` with the
  spec's own literal label, `'Former team member'`. All three subscribers
  (`subscribers/cart-purged-erasure.ts`, `customer-accounts-user-deleted-erasure.ts`,
  `auth-user-deleted-erasure.ts`) are `persistent: true`, scope by the payload's own
  `tenantId`(/`organizationId` when carried), and are idempotent on redelivery by construction
  (the erase routine's own `deletedAt: null` read-guard; the anonymize routine's own
  already-labeled skip). Flagged in PLAN.md's decisions as an open gap for Phase 6.1 or a
  dedicated follow-up.
- **Tests (`packages/core`):** `cart/lib/__tests__/cartService.test.ts` gained 3 cases for
  `resolveBasketByToken`. `assisted_selling/commands/__tests__/buyerThread.test.ts` (11
  cases), `lib/__tests__/buyerIdentity.test.ts` (8 cases), `lib/__tests__/retention.test.ts`
  (6 cases), `lib/__tests__/erasureSubscribers.test.ts` (11 cases), and three route-level
  suites — `api/storefront/thread/__tests__/route.test.ts` (12 cases),
  `api/storefront/thread/messages/__tests__/route.test.ts` (8 cases),
  `api/storefront/thread/events/__tests__/route.test.ts` (9 cases) — covering identity
  binding, tenant/organization isolation, the buyer-authored entity shapes, ETag/304
  mechanics and the signal-only response shape, and rate-limit wiring.
- **Checks (local mode, every `tsconfig.tsbuildinfo` wiped repo-wide first):** `yarn generate`
  clean (new routes/subscribers discovered, no unrelated diffs). `yarn typecheck`
  (`packages/core`) clean. `eslint` on every changed/new file clean (exit 0). `yarn jest
  src/modules/assisted_selling` (packages/core) — 116/116 (14 suites). `yarn jest
  src/modules/cart` (packages/core) — 440/440 (31 suites, +3 against this Step's own
  `cartService.resolveBasketByToken` cases). 556/556 combined, zero regressions.

## 2026-10-28T04:30:00Z — checkpoint 10 (Step 4.4-fix..4.5, closes Phase 4)
- Range: `dd0093c3e0`..`33aa208ad5`. Summary: assisted_selling terminal-state subscriber +
  re-author migration from cart; buyer thread routes + signal-only polling + retention/erasure.
- Checks: forced full typecheck with tsbuildinfo wiped (40/40, 0 cached) pass; core sweep
  (cart+customer_groups+availability+promotions+assisted_selling, 129/132 suites, 1479/1496
  tests, 3 expected gated skips); full checkout suite (53/53 suites, 407/407 tests).
- Decisions/problems: none blocking. One non-blocking deferral (time-based retention sweepers)
  carried to Step 6.1.
- Phase 4 is complete. All 5 planned Steps + 2 fix-forwards landed; no rescues needed this phase.

## 2026-10-28T05:00:00Z — Step 5.1 landed (checkout B.5 B2B — PO number, min_order_value,
on-account/request_quote payment methods, quote branch — C15-C17/D-R5-20/23/26/28, opens Phase 5)

- **`resolveTerms` gap, verified then fixed:** re-grepped `customer_groups/services/
  customerGroupsService.ts` at the top of this Step — Step 2.5/3.1's own NOTIFY note
  ("`allowQuoteRequests`/`requiresPoNumber`... still no caller in this run") was confirmed
  still accurate (both fields existed on the `CustomerGroupTerms` entity, Step 1.5, but were
  absent from `TERMS_FIELD_NAMES`/`ResolvedTerms`). Fixed the SAME way `approvalPolicy` was
  added: both appended to `TERMS_FIELD_NAMES`, `tenantDefaultTerms()`, `termsFieldIsSet()`,
  `applyTermsField()`; tenant default `false` for both, no base-currency-style fallback step
  of their own (unlike `termsCurrencyCode`). `resolveTerms.test.ts`'s two full-object
  `toEqual` assertions (tenant-default cases) updated for the two new fields; four new
  inheritance/override tests added mirroring the existing `allowPurchaseOnAccount` pattern.
- **PO number input location (genuine scope call — the spec names a dedicated `POST
  .../current/payment` route for it, §9's route table and §8.4, but no such route exists
  anywhere in this worktree).** Rather than reopening Step 4.1's own resolved "no selection
  route, submit takes the method directly" decision for one more field, `poNumber` is an
  additive, optional field on `checkout.session.submit`'s own input (`data/validators.ts`,
  `commands/submit.ts`, the submit route) — the SAME resolved shape `paymentMethodCode`
  already uses. Required (`422 purchase_order_number_required`) only when the resolved
  `requiresPoNumber` term is `true`; written to `SalesQuote.customer_reference` whenever
  supplied, regardless of outcome.
- **`min_order_value` currency-mismatch semantics — corrected against this Step's own task
  brief, per the authoritative spec.** The brief characterized D-R5-4 as a uniform
  "fail-closed-on-mismatch rule, same as K1's currency rule." The revised spec's own §7.1
  precondition 8 and §8.5 are explicit and unambiguous that a cart in a currency OTHER than
  `terms_currency_code` is simply **not checked** for `min_order_value` — D-R5-4 deliberately
  gives the approval gate (fail-closed) and `min_order_value` (skip) OPPOSITE postures for the
  same mismatch, not the same one. Implemented per the spec (root AGENTS.md: the spec is the
  authoritative contract; same class of brief-vs-spec call Step 3.2 made for K5). Reused the
  SAME currency-equality comparison pattern K1 established (`terms.termsCurrencyCode ===
  session.currencyCode`), just gated the opposite way on a mismatch. Flagging this correction
  explicitly in case a later Step's own brief repeats the same mischaracterization.
- **Quote branch (§7.2's "QUOTE OUTCOME" block, §8.6, C16/C17, D-R5-20/23/26):**
  `cart.lock`'s `purpose` is now `isQuotePurpose ? 'quote' : 'order'` (previously hardcoded
  `'order'`); `request_quote` is re-verified against the resolved `allowQuoteRequests` at
  submit (entitlement never trusted from the client, §5.5), not just at the payment-methods
  listing. After document creation (step 5a/5b, including the C7 goods-totals equality
  check, which still applies to the quote outcome), a new `completeQuoteOutcome` (exported,
  sibling of `confirmOrderAndComplete`/`compensateByCancellingOrder`) releases the stock hold
  immediately via `availability.release(..., reason: 'quote')` — never `availability.commit`
  — builds the quote's own `lineMap` (`buildQuoteLineMap`, reading `sales_quote_lines`
  instead of `sales_order_lines`, D-R5-26), calls `cart.markConverted({ salesQuoteId,
  lineMap })`, and moves the session straight to `completed`/`outcomeKind: 'quote'`. No
  credit was ever reserved for `request_quote` (`isOnAccount` is always false for it — the
  two payment method codes are mutually exclusive), no codes are consumed, no gateway is
  ever called. `sales.quotes.convert_to_order` is never reached for this outcome.
  `CheckoutSessionSubmitStageResult.salesOrderId` widened to `string | null` (the backing
  `CheckoutSession.salesOrderId` column was already nullable; this is the first caller that
  can genuinely return `null`). Two additive `SessionEventKind` members added
  (`stock_released`, `quote_completed`) — plain TS union growth, no migration, no existing
  kind repurposed for a semantically different action.
- **`recover-stuck-submits` extended for the quote outcome's own narrow crash window.** A
  `request_quote` submit normally completes synchronously within one call and never reaches
  a `submitting`+stuck observation; the only way this job ever sees one is a crash between
  document creation and `completeQuoteOutcome` returning. Added a `paymentMethodCode ===
  'request_quote'` branch (checked before the pre-existing order-outcome branch) that resumes
  through `completeQuoteOutcome` instead of `continueOrderOutcome` — the latter would
  wrongly try to confirm/commit/gateway an order that, for a quote outcome, never exists.
- **On-account/request_quote listing (`lib/paymentMethods.ts`, `GET .../payment-methods`
  route).** `listCheckoutPaymentMethods` now also resolves the cart's buyer identity (via
  `lookupCartPeerById`, when the session has a `cartId`) and lists `{ kind: 'on_account' }`
  when `allowPurchaseOnAccount` is true AND `customerCreditService.checkCredit` (amount
  `'0'`, since the real payable amount is unknown this early) does not refuse with
  `no_account`/`on_hold`/`not_permitted` (a `limit_exceeded` reason is NOT excluded from the
  listing — it is not amount-aware at this point, matching §5.5's own three-reason
  catalogue), and `{ kind: 'request_quote' }` when `allowQuoteRequests` is true — two fully
  independent gates, neither offered to a guest cart (no buyer identity at all). No
  per-method `label`/translation added (unlike the gateway entries' merchant-configured
  `label`) — these are reason-code-style machine identifiers, same precedent `checkCredit`'s
  own `reason` field already sets for this response surface; a future storefront client
  i18n's them by `kind` client-side.
- **NOT implemented in this Step, flagged forward again:** PLAN.md's own Step 3.2 entry
  (K3's fifth row) asks "whichever Step first makes `cart.markConverted` reachable with
  `salesQuoteId` set" to withdraw the cart's still-pending approval on that conversion. This
  Step is that Step, but the fix belongs inside `cart` (`commands/lock.ts#markConverted` or a
  subscriber on `cart.cart.converted`), outside this Step's `checkout`-only module boundary
  and its own explicit Implementation bullet list. Left exactly as PLAN.md already flagged
  it — no caller in this worktree reaches `markConverted({ salesQuoteId })` with a cart that
  ALSO has a pending approval (the quote branch's own happy-path tests use carts with no
  approval at all), so there is nothing to regress by deferring it again.
- Files: `packages/core/src/modules/customer_groups/services/customerGroupsService.ts`
  (+`allowQuoteRequests`/`requiresPoNumber`), `__tests__/resolveTerms.test.ts` (+4 tests, 2
  updated). `packages/checkout/src/modules/checkout/lib/paymentMethods.ts` (+on_account/
  request_quote), `lib/__tests__/paymentMethods.test.ts` (+8 tests); `api/sessions/current/
  payment-methods/route.ts` (+buyer identity via `lookupCartPeerById`); `data/validators.ts`
  (+`poNumber`); `api/sessions/current/submit/route.ts` (+`poNumber` passthrough);
  `commands/submit.ts` (terms resolution, PO/min_order_value preconditions, quote `purpose`,
  `completeQuoteOutcome`/`buildQuoteLineMap`, widened `salesOrderId` type), `commands/
  __tests__/submit.test.ts` (+13 tests, 1 updated); `lib/sessionEvents.ts` (+`stock_released`/
  `quote_completed`); `workers/recover-stuck-submits.worker.ts` (+quote-outcome resume
  branch).
- Opens Phase 5.

## 2026-10-28T06:00:00Z — Step 5.2 landed (checkout approval-resume subscriber C11 +
session-route identity binding audit D-R5-33, opens the final Phase 5 pair)

- **`POST /sessions/current/request-approval` (`commands/approval.ts`, new).** A thin
  adapter, as §8.2 step 1 itself frames it: it never creates an approval or stores an
  approval id, it delegates to `cart.approval.request` (Step 3.2) via the command bus with
  a plain object input (no compile-time `cart` import, the SAME cross-module shape `lib/
  payLinkCartSeed.ts` already established), then CASes the session `open -> awaiting_
  approval` (same-state no-op tolerated for a double-submitted button) behind the standard
  optimistic-lock guard (`enforceCommandOptimisticLockWithGuards`, matching `selectDelivery
  Command`'s own precedent, not `submit`'s CAS-by-idempotency-key exception). Confirmed by
  reading `cart/commands/approval.ts` directly: `cart.approval.request`'s own `loadMutable
  Cart` already throws `423 cart_locked` for a locked cart (K5), so this command never calls
  `cart.unlock` itself — by construction (submit's own precondition 7 runs BEFORE `cart.
  lock`), there is nothing to unlock when this route is reached. Any cart-side refusal (`409
  approval_requires_identified_buyer`, `409 approval_not_required`, `503 approval_service_
  unavailable`) propagates unchanged.
- **Approval-resume subscriber family (C11, §8.2 step 3) — four new subscriber files sharing
  `lib/approvalResumeSubscriber.ts`.** Mirrors `cart/lib/approvalDecidedSubscriber.ts`'s own
  one-event-id-per-file shape. Finds the live `awaiting_approval` session for the event's
  cart/tenant/organization (checkout stores no approval id on the session at all, §8.2's own
  opening line, so this IS the spec's sole mechanism, not a shortcut) and CASes it: `approved
  -> open` (`quoted_totals` cleared) + `checkout.session.approval_approved`; `rejected ->
  failed` (`failure_code: 'approval_rejected'`) + `checkout.session.approval_rejected`;
  `expired`/`withdrawn -> open` (quoted_totals left as-is — nothing about the cart changed)
  + `checkout.session.approval_rejected` carrying the real outcome in the payload. See
  PLAN.md's "Decisions taken without the owner" for the three-way-vs-two-way correction
  against the task brief's own paraphrase. The CAS `WHERE status = 'awaiting_approval'`
  (plus the `em.find` prefilter on the same status) makes an at-least-once redelivery safe —
  a session already resumed simply matches zero rows on either the find or the nativeUpdate.
- **D-R5-33 audit: no compliance gap found.** Every `/api/checkout/sessions/current/*` route
  this worktree actually ships (`route.ts`, `delivery`, `delivery-options`, `payment-
  methods`, `submit`) already calls `lib/currentSessionRoute.ts#resolveCurrentSession` —
  verified by direct read of each file, not by trusting prior NOTIFY claims. `cancel`/`step`/
  `payment` are named by §9's route table but were explicitly deferred by Steps 2.12/2.13
  (confirmed in their own NOTIFY entries) and do not exist in this worktree at all — nothing
  to audit there. The new `request-approval` route follows the SAME helper.
- **Test "not just the subscriber in isolation" (C11's own test-priority item): a glue test
  in `submit.test.ts`'s own harness** proves three things with the REAL `approval-approved`
  subscriber handler and the REAL `checkout.session.submit` command, not two separate unit
  tests: (1) a session parked in `awaiting_approval` cannot reach `cart.lock` at all — submit
  refuses `409 session_not_open` before any precondition read; (2) firing the real subscriber
  against the SAME fake `em`/`seededSessions` reopens the session to `open`, and a resubmit
  now reaches `cartService.lock` with the right args; (3) re-approval on a price rise is
  exactly `cart.lock`'s own `409 cart_requires_approval` (Step 3.1's already-tested gate,
  mocked here only to stand in for that gate, not re-derive its threshold logic), surfaced by
  submit UNCHANGED. Added `em.find` support to the harness's fake `em` (additive — nothing
  else in `submit.ts` calls it) so the real subscriber could run against the exact same
  session row rather than a second, parallel fake.
- Files: `packages/checkout/src/modules/checkout/commands/approval.ts` (new),
  `api/sessions/current/request-approval/route.ts` (new), `lib/approvalResumeSubscriber.ts`
  (new), `subscribers/approval-{approved,rejected,expired,withdrawn}.ts` (new, 4 files),
  `events.ts` (+3 `checkout.session.approval_*` ids); tests: `commands/__tests__/
  approval.test.ts` (new, 7 tests), `lib/__tests__/approvalResumeSubscriber.test.ts` (new,
  parametrized over 4 outcomes, 20 tests incl. tenant/org isolation + redelivery safety),
  `commands/__tests__/submit.test.ts` (+3 glue tests, +`em.find` harness support). `yarn
  generate` run — new route/command/subscribers confirmed present in `apps/mercato/.mercato/
  generated/*` (gitignored, not committed).
- Full `checkout` suite: 55/55 test suites, 462/462 tests green. Full `cart`+`customer_groups`
  suites (`packages/core`): 75/77 passed, 2 pre-existing skips, 918/926 tests green, zero
  regressions. `packages/checkout` typecheck clean after a full `tsconfig.tsbuildinfo` wipe.
- Closes Phase 5's checkout half; 5.3/5.4 (`assisted_selling`) remain.

## 2026-10-27T09:45:01Z — executor: Step 5.3 landed, assisted_selling rep console (inbox, thread, composer, proposal builder)

- **The missing staff routes the console needs, built here (not claimed by any other Step).**
  Steps 4.4/4.4-fix/4.5 explicitly deferred `GET /threads/:id`, `POST /threads/:id/{join,leave,
  assign}` and `POST /threads/:id/messages` to "the rep console (Step 5.3)" — built all five,
  with three new commands (`assisted_selling.thread.{join,leave,assign}` in `commands/
  threads.ts`, `assisted_selling.message.post` in a new `commands/messages.ts`). `assign` is
  optimistic-locked on the thread's `updated_at` (§6.1); `join`/`leave` are idempotent no-ops
  on a repeat call, and a rep who left and rejoins re-emits `.participant.joined` (a left
  participant is not "already joined"). Added the `assisted_selling.messages.post` ACL feature
  §6.9 names (Step 4.4 deferred it) and granted it to `employee` per `setup.ts`'s own
  already-written anticipation of this. `GET /threads/:id` requires BOTH `assisted_selling.
  threads.view` AND `cart.proposals.view`, per §6.1's two-feature discipline for exactly this
  route (proposals carry the buyer's priced lines).
- **S22 price provenance: a fourth additive `cartService` method, read back verbatim.** The
  console's proposal cards must show "the buyer's resolved unit price... labelled as the
  buyer's" with `price_row_id` provenance (§7.2). The existing `getProposalCartLines` (Step
  4.4) carries no pricing columns by design (it only feeds reauthor). Added `cartService.
  getProposalCartPricedLines` (`cart/lib/cartService.ts`) — reads the proposal cart's own
  `CartLine` rows back through the SAME `toCartLineSnapshot` mapper `cart`'s command layer
  already uses, never recomputing. This makes S22's "byte-identical to the buyer's own `GET
  /api/cart/current` pricing" true by construction: the columns were written by `cart.
  proposal.create` pricing AS THE BUYER (§6.3 step 3) and are read back unchanged. Tested at
  the `cartService` layer (2 new cases in `cart/lib/__tests__/cartService.test.ts`); a full
  buyer-`/current`-vs-console comparison belongs to the Playwright suite this run's own
  instructions placed out of this Step's scope (no dev server, no browser here).
- **Four screens, exactly the task brief's own list** (inbox, thread page, composer, proposal
  builder) — the settings page UI and attribution report UI are deliberately NOT built here;
  see PLAN.md's decisions for why (settings has no claiming Step at all; attribution is Step
  5.4's own scope).
  - **Inbox** (`backend/assisted-selling/page.tsx`): `DataTable` over `GET /threads`,
    additively extended with `assignedActorId` (`me`/`unassigned`/a uuid) and
    `hasLiveProposals` query filters (backward compatible with Step 4.4's own shape). Row
    actions: open, assign to me. Live-updates via `useAppEventCoalesced('assisted_selling.*',
    ...)` — no custom polling.
  - **Thread page** (`backend/assisted-selling/threads/[id]/page.tsx`): participants,
    message/proposal timeline (decrypted via the route's own `findWithDecryption`), join/
    leave/assign-to-me, a composer, withdraw/re-propose per proposal, each proposal line
    showing its buyer price + `price_row_id` provenance. Live-updates via `useAppEvent*`
    filtered to this `threadId`.
  - **Proposal builder** (`ProposalBuilderDialog.tsx`): a dialog (not literally `CrudForm` —
    see PLAN.md's decision on why) with a line-item array (product via `ComboboxInput` against
    `GET /api/catalog/products?search=`, variant id, quantity), a note, Cmd/Ctrl+Enter submit,
    `rejectedLines` surfaced after submit. No client-side pricing — the server prices as the
    buyer.
  - **Composer**: plain-text only (S24), inline in the thread page, Cmd/Ctrl+Enter to send.
- **Route-enumeration test** (`api/__tests__/routeEnumeration.test.ts`, 5 cases): statically
  reads every `route.ts` this module ships (no import/mock graph to keep in sync) and asserts
  no route exports `PATCH`/`DELETE` anywhere, `PUT` exists only on the settings route, and
  neither a route nor a command file ever references `cart.lines.{add,update,remove,bulkAdd}`
  — the §7.2/§10.5 "no console affordance writes to the buyer's cart" guarantee, enumerated
  rather than inspected in the UI.
- **i18n**: 77 new keys in `en.json`; `yarn i18n:check-sync --fix` propagated them to de/es/
  ko/pl with EN values as placeholders — the SAME convention this module's own locale files
  already used before this Step (every locale carried identical English text already;
  `i18n:check-hardcoded`/`i18n:check-values` stay advisory in Phase 1 per root AGENTS.md).
- **Tests** (`packages/core`, `yarn jest src/modules/assisted_selling` style): `commands/
  __tests__/threadActions.test.ts` (new, 10 cases — join/rejoin/idempotent-join, mode-off
  refusal, S9 cross-org 404, S21 missing-feature 403; leave idempotent no-op; assign-to-me,
  assign-a-named-rep, and the real two-concurrent-assigns-one-409 race test using a SHARED
  fake-EM row reference so the second call observes the first's write exactly like two
  requests racing a real row would); `commands/__tests__/messages.test.ts` (new, 6 cases).
  `cart/lib/__tests__/cartService.test.ts` (+2 cases for `getProposalCartPricedLines`).
  `api/__tests__/routeEnumeration.test.ts` (new, 5 cases). 140/140 `assisted_selling` tests
  green (116 pre-existing + 24 new); 442/442 `cart` tests green (zero regressions from the
  additive `cartService` method).
- **Checks (local mode, every `tsconfig.tsbuildinfo` wiped repo-wide first):** `yarn generate`
  clean (727 OpenAPI paths, up from 714 at Step 4.3; new routes/commands discovered, no
  unrelated diffs). `yarn typecheck` — 40/40 package tasks green (`@open-mercato/core`
  cache-miss-executed clean after fixing one real `useGuardedMutation` generic-type mismatch
  this Step's own build caught). `eslint` on every changed/new file clean (exit 0; the "Pages
  directory cannot be found" line is Next's own informational noise). `yarn jest src/modules/
  assisted_selling src/modules/cart` — 582/582. `yarn i18n:check-sync` clean. `yarn i18n:
  check-hardcoded` — zero `assisted_selling` findings (advisory gate, exit 0 regardless).
  One DS violation caught and fixed before commit: an arbitrary `text-[11px]` in the thread
  page's price-provenance label, replaced with the DS `text-xs` scale token.
- **Known, deliberately scoped-out gaps** (all flagged in PLAN.md's decisions, not silently
  dropped): (1) no settings-page UI — the API has existed since Step 4.3 with no claiming
  Step for its console surface; (2) the proposal builder's product picker is a bare
  `ComboboxInput` against `catalog`'s product search, not a richer merchandising picker, and
  assumes the authoring rep also holds `catalog.products.view` (not newly required by this
  Step, but a real-world precondition worth naming); (3) `EmailThreadsPanel`/`MessageComposer`
  reuse named by §7.1 was not literally wired — their backend shape (many email threads;
  the generic `messages` module's own entity) does not fit one conversation with embedded
  priced proposal cards; built from DS primitives instead, same interaction conventions.
  Recommend a dedicated Step — or Step 5.4/6.1 — pick up the settings page if the full
  Release-5 console scope (D-R5-15) is still the bar.

## 2026-10-27T10:21:14Z — executor: Step 5.4 landed, assisted_selling Phase 4 attribution — entity, converted-cart subscriber, attributions route and console report

- **Closes Phase 5 and this run's main scope** (PLAN.md Tasks row 5.4 -> done). Phase 6
  (6.1-6.4, integration-coverage completion + UPGRADE_NOTES + template-sync + full gate)
  is the only remaining work.
- **`AssistedSellingAttribution`** (`data/entities.ts`, migration
  `Migration20261027180000_assisted_selling.ts`): append-only (no `updated_at`/`deleted_at`,
  same shape as `cart.CartMergeLog`), columns per §5.5 — `sales_order_id`/`sales_order_line_id`
  XOR `sales_quote_id`/`sales_quote_line_id` (DB check constraint), `cart_id`/`cart_line_id`
  (the latter nullable — degraded rows carry none), `actor_type`/`actor_id` (mirrors
  `CartLine.added_by_actor_type`/`_id`), `thread_id`/`proposal_id` (local to this module,
  nullable), `line_net_amount`/`line_gross_amount`/`currency_code` (snapshots), `converted_at`.
  Partial unique indexes on `(tenant_id, sales_order_line_id)` and `(tenant_id,
  sales_quote_line_id)` where not null; a plain `(tenant_id, cart_id)` index doubles as the
  subscriber's own redelivery guard.
- **`cart.cartService.getAttributionLines`** (new, additive, 5th method on the existing
  Step-4.4/4.5/5.3 facade): reads a basket's live `CartLine` rows (actor, snapshot amounts
  from `lineTotals`) plus every `CartMergeLog` that ever targeted it with a `proposal_cart_id`
  set, resolving each target line's originating proposal cart through `outcome`'s own
  `targetLineId` map (§6.7's "target cart line -> outcome entry -> proposal_cart_id" path) —
  all `cart`-internal reads, exposed as one more module-boundary-respecting service method
  (no cross-module entity import). 3 new unit tests in `cart/lib/__tests__/cartService.test.ts`.
- **Subscriber** (`subscribers/cart-converted-attribution.ts` + `lib/attribution.ts`,
  persistent, mirrors Step 4.4-fix's terminal-state-subscriber precedent exactly): on
  `cart.cart.converted`,
  - **attributed** — a populated, line-covering `lineMap` writes one row per cart line,
    `threadId`/`proposalId` resolved per line via `getAttributionLines`' `proposalCartId` and
    this module's own `AssistedSellingProposal` lookup; buyer-added lines get NULL
    thread/proposal (correct, not degraded);
  - **degraded** — a missing or incomplete `lineMap` (on a conversion that DOES name an order
    or a quote) writes one document-level row per distinct actor (line id NULL, amounts
    summed) and emits `assisted_selling.attribution.degraded` (not broadcast — an operator
    signal, §6.7's own reasoning repeated from `cart.line.visibility_rejected`);
  - **nothing** — a conversion naming neither `salesOrderId` nor `salesQuoteId` (the
    pre-Release-5 call shape) has no document to attribute against; skipped silently, not
    degraded.
  Idempotent on redelivery via the `(tenant_id, cart_id)` existence check before any read.
  **Scope decision, flagged in PLAN.md:** attribution is NOT gated on "did this cart ever have
  an accepted proposal" — the spec's own §6.7/§10.4 text is unconditional ("writes one row per
  cart line"; "a mixed cart... produces the correct split"), so every converted basket cart
  with an order/quote outcome gets fully attributed, including ones this module never touched
  (buyer-only lines, `actor_type: 'buyer'`, `thread_id`/`proposal_id` NULL) — this is what lets
  the report answer "% of revenue assisted," not just list the assisted slice. The task brief's
  own "no proposal -> do nothing" framing was not followed; see PLAN.md's decision entry for
  the full reasoning.
- **`GET /api/assisted_selling/attributions`**: staff route, `assisted_selling.attributions.view`
  (new ACL feature, §6.9's last one — `admin` wildcard only, not granted to `employee`, matching
  §6.9's own least-privilege text), tenant/organization-scoped (S9 precedent), filters by
  `proposalId`/`threadId`/`cartId`/`salesOrderId`/`salesQuoteId`/`convertedAt` range, `pageSize`
  <= 100.
- **Console report** (`backend/assisted-selling/attributions/page.tsx`): a plain `DataTable`
  list (converted-at, outcome badge + id, attributed-to, cart line or "document-level
  (degraded)" badge, net amount) with text/date-range filters — no sorting UI (the route only
  ever sorts `convertedAt DESC`), deliberately minimal per the task's own "a list, not a
  dashboard" instruction.
- **i18n**: 14 new keys, added identically to en/de/es/ko/pl (every locale in this module
  already carries identical English placeholder text pre-dating this Step — Phase 1 of the
  i18n remediation plan stays advisory).
- **Tests**: `lib/__tests__/attribution.test.ts` (new, 9 cases — order outcome mixed-actor
  split, quote outcome, missing-lineMap degrade, incomplete-lineMap degrade, no-prior-proposal
  still-attributed, redelivery no-op, neither-id skip, incomplete-payload skip, cross-tenant
  redelivery-guard isolation); `api/attributions/__tests__/route.test.ts` (new, 5 cases — 401,
  org-scoping, filter-to-where mapping, serialized response shape, empty-orgs short-circuit);
  `cart/lib/__tests__/cartService.test.ts` (+2 cases for `getAttributionLines`).
- **Checks (local mode, every `tsconfig.tsbuildinfo` wiped first):** `yarn generate` clean
  (new route/page/migration discovered, no unrelated diffs). `yarn typecheck` — 40/40 package
  tasks green. `yarn build:packages` — 40/40 green (`@open-mercato/core` built the new
  entity/subscriber/route/page cleanly). `eslint` on every changed/new file — clean (exit 0).
  `yarn jest src/modules/assisted_selling` — 154/154 (140 pre-existing + 14 new). `yarn jest
  src/modules/cart` — 444/444 (zero regressions from the additive `cartService` method).
  `yarn jest` in `packages/checkout` — 462/462 (zero regressions; this is the first real
  consumer tying `assisted_selling`/`cart`/`checkout` together via the converted-cart event,
  per the task's own framing). `yarn i18n:check-hardcoded` — zero `assisted_selling`/`cart`
  findings (advisory gate either way).

## 2026-10-28T06:45:00Z — checkpoint 11 (Steps 5.1–5.4, closes Phase 5)
- Range: `db87581207`..`a17a1c94ba`. Summary: checkout B.5 B2B (quote branch, PO, min_order_value,
  spec-corrected fail-open currency rule); approval-resume subscriber + D-R5-33 audit (no gap
  found); assisted_selling rep console; Phase 4 attribution.
- Checks: forced full typecheck (40/40, 0 cached) pass; core sweeps (75/77 + 127/128 suites, both
  expected-skip counts resolved separately below); full checkout suite (55/55, 462/462).
- MAJOR FINDING: discovered a real local Postgres (Homebrew @17) running on 127.0.0.1:5432.
  Created two disposable throwaway DBs, re-ran all three gated real-Postgres concurrency suites
  (credit/availability/approval) — all passed (3/3 suites, 17/17 tests) — then dropped both DBs.
  This closes the "accepted risk, no live Postgres" caveat carried since Step 1.6. New standard
  practice: re-verify each new .pg.test.ts at its own checkpoint from now on.
- Phase 5 is complete. All 4 planned Steps landed; no rescues needed this phase. The release's
  entire main implementation scope (Phases 1-5, 44 Steps total incl. fix-forwards) is now built.

## 2026-10-27T07:35:00Z — Step 6.1 (integration-coverage completion pass)

Picked up a prior attempt's pre-gathered gap inventory (research only, no commits landed) and
acted on it. Four commits landed, pushed to `fork/feat/release-5-conversion`. Full disposition
of every item in the handed-off inventory:

1. **G21 (credit-exposure-audit has no test proving zero drift after N concurrent reserves) —
   fixed now.** `bc8d54f8e8`. Added a mocked-EM scenario (20 sequential `reserveCredit` calls
   plus a mixed reserve/release variant against the same account) and ran the audit job against
   the resulting ledger, asserting zero drift. Confirms the audit job itself was already correct
   — this closed a test gap, not a behavior gap.

2. **Cart K3 (a quote-purpose `cart.markConverted` never withdrew the cart's pending approval)
   — fixed now.** `b43d5bd6a1`. Added `cart_converted_as_quote` to
   `CartApprovalWithdrawReason`/`CustomerPurchaseApprovalWithdrawnReason` (both plain `text`
   columns, no migration) and wired `withdrawPendingCartApproval` into `markConverted` when
   `salesQuoteId` is present, clearing `awaitingApprovalSince` in the same flush as the status
   write. Verified the ORDER outcome (`salesOrderId`) does NOT trigger withdrawal (regression
   guard test) — matches K3's own table (an approved order conversion is correct as-is).

3. **Code reservations never released on cart conversion or merge-absorption — fixed now.**
   Same commit `b43d5bd6a1`. Exported `releaseCartCodeReservations` from `lib/sweepers.ts` and
   added a `tryResolveCartCodeService` soft-DI resolver (`lib/adminCartScope.ts`, mirroring the
   existing `tryResolveCustomerPurchaseApprovalService`); wired both into
   `commands/lock.ts#markConverted` and `commands/merge.ts`'s absorbed-cart finalization, same
   by-`cartId` release every sweep already applies. Tests added at both call sites.

4. **`GET /api/customer_groups/customer-groups/credit-accounts/missing` (US-E2 orphan banner)
   — accepted-with-reason, confirmed (no code change).** Re-confirmed: no route exists anywhere
   under `credit-accounts/`. Nothing downstream depends on it across all 44 Steps; it is an
   admin-UX convenience, not a correctness or security gap. Known, deliberate Release-5
   limitation — carry into Step 6.2's `UPGRADE_NOTES.md`.

5. **No admin write route for `CheckoutLinkCartTemplate` — accepted-with-reason, confirmed.**
   Re-confirmed by grep: the entity is read-only in product code
   (`checkout/lib/payLinkCartSeed.ts`), and its own integration/unit test fixtures seed it
   directly at the mock-EM level, never through a route. No Release-5 code path needs an admin
   UI to create one. Distinct from the EXISTING `CheckoutLinkTemplate` admin CRUD
   (`api/templates/*`), which is a different entity (the reusable named template, not a
   specific link's seeded cart lines) and already has full admin routes.

6. **`assisted_selling` idle-close/retention sweepers — fixed now, built as MANDATORY.**
   `1050cb0cb4`. Read the spec's own text (`2026-09-22-assisted-selling.md` §5.10, S7): "Release
   5 ships all of §5.10 together with the first route that stores text about a buyer... the
   staff message route of Phase 1 and the buyer routes of Phase 2 item 1 do not ship without the
   two sweepers." Both routes already shipped (Steps 4.1/4.5) without them — not a soft SLA,
   a compliance gap. Added `lib/sweepers.ts` (`sweepIdleThreads`, `sweepRetention`), two worker
   wrappers, per-organization scheduler registration in `setup.ts` (idle-close hourly, retention
   daily — same org-scoped granularity `customer_groups`'s `credit-exposure-audit` already
   uses), and declared+emitted `assisted_selling.thread.closed` (§6.8) — the one thread-lifecycle
   event id Step 4.4 itself deferred pending this sweeper. `sweepRetention` reuses the existing
   `eraseAssistedSellingThread` routine so all four erasure triggers (3 event-driven + this one)
   stay behaviorally identical. 9 new tests in `lib/__tests__/sweepers.test.ts`.

7. **A7 (availability): product-pool allocation not implemented in the reservation gate —
   still-open, confirmed real, deliberately deferred (no code change).** Traced
   `wms/lib/wmsReservationService.ts#reserveLinesForCheckout` (line ~857): it calls
   `computeSellableQuantities` with `productRollups: []`, always — the gate never applies a
   product-level `safety_stock` pool, confirmed by Step 2.2's own PLAN.md decision log entry,
   which is accurate and NOT stale. The READ path (`availabilityCalculation.ts#resolveAvailability`)
   only applies `productRollups` for product-level query items (no `catalogVariantId`), never for
   variant-level items either — `computeSellableQuantities`'s own module docstring confirms this
   is the shared builder's INTENDED contract ("product-level pool subtracted exactly once, at
   the rollup"), not something the reservation gate forgot to call. Closing this properly would
   require locking every OTHER active variant of a pooled product on every reservation call (not
   just the ones in the request) — Step 2.2's own words, "a materially larger change" — which
   this pass did not attempt, to avoid shipping an under-tested half-built feature under the same
   time pressure Step 2.2 itself flagged as the risk. Recommend a dedicated follow-up Step scoped
   around: (a) a new loader for product-level pool profile rows adjacent to the reserved variants,
   (b) locking every sibling active variant of a pooled product in the SAME `FOR UPDATE` as
   today's candidate set, (c) deciding how a pool's shared budget is allocated across multiple
   lines of the same product within one reservation call (today's per-line loop has no concept
   of a shared remaining budget to decrement across lines). Real risk if left open: a
   product-pool-backed variant could be oversold across its sibling variants, though never
   within a single variant (the per-variant last-unit guarantee is unaffected either way).

8. **A16 cosmetic items (i18n label + UPGRADE_NOTES entry) — i18n fixed now; UPGRADE_NOTES stays
   Step 6.2's job.** `0f291f0264`. Confirmed the behavior-level guard (rejecting `'checkout'` on
   the public `wms.inventory.reserve` route with `400 checkout_reservation_is_system_only`) was
   already in place and tested (Step 2.2) — nothing to add there. The i18n label WAS missing and
   was trivial: added a `checkout` fallback entry to `RESERVATION_SOURCE_TYPE_FALLBACKS`
   (`lib/inventoryDisplayUi.ts`) and the translated key across all 5 locales, reusing the exact
   wording `checkout/i18n` already settled on for `notifications.categories.checkout`.

- **Confirmed NOT gaps (no action, matches prior Steps' own audits):** D-R5-33 identity binding
  across every checkout session route; `resolveTerms`'s three tracked fields; `.attribution.degraded`;
  `expire-awaiting-payment`; `cart.cart.merged` thread-identity/terminal-state subscribers.

- **Lower-priority items — accepted-with-reason, documented, no code change:** `POST
  /sessions/current/payment` method-selection route (intentional architectural consistency
  choice across Steps 2.13/4.1/5.1 — additive field on submit, not a dedicated route, chosen
  identically every time); `ecommerce.EcommerceStore` has no structured address (documented
  2-tier vs 3-tier delivery-origin fallback limitation); `assisted_selling` settings-page admin
  UI and `CrudForm` array-field/`EmailThreadsPanel` component-choice deviations (cosmetic,
  equivalent behavior ships via DS-primitive custom components, not functional gaps).

- **Integration-level gap (cart `/api/cart/proposals/*` + assisted_selling thread/console
  routes have zero real-HTTP Playwright coverage, only mocked-EM Jest units) — still-open,
  NOT attempted this pass.** Confirmed real: grepped every test file under
  `cart/commands/__tests__/proposal.test.ts` and `assisted_selling/api/**/__tests__/*.test.ts` —
  all mock `EntityManager`, none hit a real HTTP server. This is this run's own highest-value
  remaining coverage gap per its own framing. NOT attempted here: building and — critically —
  VERIFYING a real-HTTP Playwright spec needs the ephemeral integration harness
  (`yarn test:integration:ephemeral`, Docker; confirmed Docker was reachable in this pass's
  environment, but the harness itself was not exercised) and a materially larger time investment
  than the rest of this Step combined. Writing a spec without running it against a live server
  risks landing a broken test, which `.ai/qa/AGENTS.md`'s "Never leave broken tests" explicitly
  forbids — so none was written, rather than guessing. Concrete scope for a follow-up Step:
  model `packages/customer_groups/__integration__/TC-CGRP-034-purchase-approval-routes.spec.ts`'s
  own shape (shared `helpers.ts` for fixtures/tenant provisioning) against
  `cart/__integration__/helpers.ts`'s existing cart-token fixtures; cover staff `POST
  /api/cart/proposals` (requires `cart.proposals.author`) → buyer `GET /api/cart/proposals`
  (token-scoped) → `GET /api/cart/proposals/:id/preview` → `POST /api/cart/proposals/:id/accept`,
  once for a guest cart token and once for an identified buyer, exercising the D-R5-13/21
  identity-binding refusal paths (a mismatched/foreign token gets the uniform 404) alongside the
  happy path.

## 2026-10-28T07:50:00Z — Step 6.1-fix (two bugs found by the orphaned research threads' trailing echoes)
- While reviewing the checkout C26 research echo (reporting a side finding, not in the original
  Step 6.1 inventory), two genuine bugs surfaced and were fixed directly by the dispatcher
  (small, well-understood, surgical — no sub-agent dispatch needed):
  1. `checkout/commands/submit.ts:1392` — a SYNCHRONOUS gateway payment failure (mappedStatus
     'failed'/'cancelled'/'expired') correctly compensated by cancelling the order and emitting
     `checkout.payment.failed` with `failureCode: 'payment_failed'`, but then threw its HTTP
     error with `code: 'credit_refused'` — the WRONG code, already used distinctly (line 611)
     for the actual on-account credit-reservation refusal. An API consumer checking the error
     code could not tell "the gateway declined the payment" apart from "credit was refused",
     two failure modes needing different buyer-facing handling. Fixed: `code: 'payment_failed'`,
     matching the already-emitted event's own `failureCode`. Added a regression assertion to the
     existing `submit.test.ts` "a gateway failure compensates..." test.
  2. `checkout/workers/recover-stuck-submits.worker.ts` — the order-outcome give-up branch
     (reached when `continueOrderOutcome` keeps failing past `RECOVERY_GIVE_UP_MS`) only
     unlocked the cart and marked the session `failed`; it never cancelled the order that, by
     this point, DOES exist (`session.salesOrderId` is checked and present before entering this
     code path). The code's OWN comment even said "Compensate per §7.3" but never did — stock,
     credit and promotion releases only fire via `sales.order.cancelled` subscribers, so a
     dangling uncancelled order meant none of them ever ran. Fixed: the branch now calls
     `compensateByCancellingOrder` (the exact primitive the live submit path and
     `expire-awaiting-payment` already use for this), which cancels the order, unlocks the cart,
     marks the session failed, and emits the signal event — removing the duplicate hand-rolled
     version of the same steps. The QUOTE-outcome give-up branch (same file, a few lines up) was
     checked and does NOT have this bug — a quote's stock was already released at document
     creation and no credit was ever reserved for it, so there is genuinely nothing further to
     compensate there; left unchanged. Updated the existing "gives up and compensates..." test in
     `recover-stuck-submits.worker.test.ts` to assert `compensateByCancellingOrder` is called
     with the order id and `submit_recovery_failed`, and added the missing mock for it (the test
     file's `jest.mock('../../commands/submit', ...)` factory was already missing a mock for
     `completeQuoteOutcome` too — a PRE-EXISTING gap, noted but not fixed here since it's outside
     this fix's scope: the quote-outcome give-up/resume branch has zero test coverage currently,
     a candidate for a future Step).
- Checks: scoped `yarn workspace @open-mercato/checkout typecheck` clean; targeted
  `submit`+`recover-stuck-submits` test files 4/4 suites, 72/72 tests; full `checkout` package
  suite 55/55 suites, 462/462 tests, zero regressions.

## 2026-10-28T08:10:00Z — Step 6.2 (UPGRADE_NOTES.md)
- Added three entries to the existing `## 0.9.0 → 0.9.1 (unreleased)` section (no new version
  header — the doc's package.json version (0.10.0) is already ahead of this section's header,
  a pre-existing inconsistency not touched here; appended to the existing unreleased section
  rather than guessing a new version number):
  1. D-R5-21 behaviour change — identified cart/checkout-session/thread routes now require the
     matching customer session, not just the token; closes the X1 re-identification bypass.
     Full before/after, the Sylius precedent, and the storefront-integration action item.
  2. A16 — `InventoryReservationSourceType` gains `'checkout'`; exhaustive-switch compile/runtime
     break for downstream code, with the exact action (add a case, treat like `'order'`).
  3. G26 — `customer_groups` credit/approval methods ship on new DI keys
     (`customerCreditService`/`customerPurchaseApprovalService`), never added to
     `customerGroupsService`; the `entry.overrides.di` breakage this avoids, and the resolve-key
     guidance for callers.
- No dedicated validator exists for this file (plain markdown, only the standard pre-commit
  i18n/template-sync hooks run on every commit).

## 2026-10-28T08:15:00Z — Step 6.3 (template:sync:fix verification)
- `yarn template:sync:fix` clean — app and template already in sync for every synced src folder
  and root file, package dependencies clean. Each Step across the run that touched
  `apps/mercato/src/**` (notably Step 4.3's `assisted_selling` registration) already ran this
  check itself; this pass re-confirms the cumulative state.
- Checked `apps/mercato/.env.example`/`packages/create-app/template/.env.example` for any new env
  var introduced across the whole release (`git diff fc5f8d04ca..HEAD --stat` on both paths) —
  empty diff, no new env vars anywhere. All new Release 5 configuration (per-tenant email switch,
  approval expiry window, PO/quote terms, etc.) lives in DB-backed `ModuleConfigService`/
  `CustomerGroupTerms` settings, never process env — nothing to add here.

## 2026-10-28T08:35:00Z — Step 6.4 full gate, running (fix-forward #1: 5 missing i18n keys)
- Running the full `.ai/agentic.config.json` validation.commands gate in order, in the
  foreground, verifying each command's real exit code from its own log (never through a pipe).
  Steps 1-3 (build:packages --force, generate, build:packages --force) all passed cleanly
  (EXIT=0 each; generate reported "outputs unchanged", no drift to commit).
- Step 4 (`yarn i18n:check-sync`) passed cleanly first try (EXIT=0, all 5 locales in sync).
- Step 5 (`yarn i18n:check-usage`) FAILED first try: EXIT=1, "5 missing keys" — all 5 genuinely
  introduced by this release's new cart proposal seam, not pre-existing:
  `cart.audit.proposal.{create,reject,accept}` (audit-log action labels, Step 3.3's
  `commands/proposal.ts`) and `cart.errors.{unauthorized,tenant_required}` (Step 3.4's
  `api/proposals/route.ts` defense-in-depth checks). The 8000 "unused keys" in the same report
  is pre-existing and advisory-only (does not fail the gate on its own) — confirmed by checking
  the summary line's own wording and by this exact count/wording recurring unchanged after the
  fix below. Fixed: added all 5 keys to `cart`'s `en.json` (alongside the existing
  `cart.audit.*`/`cart.errors.*` entries, exact English text already given as each call site's
  own fallback argument) and to pl/es/de/ko with the SAME English text, matching every other key
  in those 4 files (100% English placeholders, Phase 1 of the i18n remediation plan, same
  convention this entire run has followed). Re-ran both checks: `check-sync` EXIT=0, `check-usage`
  EXIT=0 with zero `MISSING KEYS`, same 8000 advisory-unused count.
- Continuing the gate with steps 6-8 (`yarn typecheck`, `yarn test`, `yarn build:app`) next.
- Step 6.4 complete, all 8 gate commands green on `fork/feat/release-5-conversion`:
  - `build:packages` x2, `generate`: clean (unchanged outputs).
  - `i18n:check-sync` / `i18n:check-usage`: EXIT=0, zero missing keys, ~8000 advisory-unused
    (pre-existing, not a gate signal).
  - `typecheck --force` (tsbuildinfo wiped first): 40/40 packages, EXIT=0.
  - `test --env-mode=loose`: the aggregate run aborts turbo on the first package failure
    ([[yarn-test-aborts-remaining-packages]]), which cost 4 full aggregate passes before every
    package was individually confirmed green. Found and fixed 2 real regressions beyond the
    i18n/bc-guard fixes already landed:
    1. `open-mercato-docs#test` — the 3 new Release 5 notification types
       (`availability.stock_lost_after_payment`, `customer_groups.approval.requested`,
       `customer_groups.credit.limit_exceeded`) were never added to
       `notification-delivery.mdx`'s registered-types map or the no-channels ratio
       (76 -> 79). Fixed, commit `5f911df618`.
    2. `@open-mercato/cli#test`'s `module-facts.bc-guard.test.ts` — the Release 5 module union
       pushed the generated module-facts JSON/markdown past the existing BC-budget caps
       (measured: completeJson 5,575,796 vs cap 5,550,000; legacy delta, markdown and
       directory-markdown all similarly over). Re-measured and confirmed uniform ~15-16% growth
       across all four measures (the guard's own signature for "additive module set", not a
       blow-up) before raising the caps with the same ~1.15 headroom the file's own prior raises
       used. Commit `0347d285bd`.
    3. `@open-mercato/core#test` never got far enough to run in ANY aggregate pass (turbo kept
       aborting on an earlier package first) — ran it standalone (`yarn workspace @open-mercato/core
       test`, ~38min) and found 5 more real regressions this release introduced, invisible until
       then:
       - `optimistic-lock-command-coverage.test.ts`: 4 new direct `enforceCommandOptimisticLock`
         sites (cart reprice/request-approval, customer_groups approval-decide x2) needed a
         `record_locks` decision in the allowlist. Allowlisted as OSS-only/exempt (terminal
         one-shot CAS transitions / single-admin actions, not collaborative edits), same pattern
         as the file's existing entries.
       - `command-interceptor-http-coverage.test.ts`: 5 routes (3 cart, 2 assisted_selling) already
         correctly delegate to their module's own error mapper (which does call
         `getCommandInterceptorHttpRejection`) but weren't added to the guard's
         `ROUTES_WITH_MODULE_LEVEL_MAPPER` allowlist yet — the guard's AST walk is file-scoped and
         cannot see across the helper-function boundary into `currentCartRoute.ts` /
         `buyerIdentity.ts`.
       - `backend-page-route-params.test.ts`: the cart admin detail page and the assisted_selling
         thread detail page read their `[id]` route param via `useParams()` instead of the `params`
         prop. Fixed both to the `{ params }: { params?: { id?: string } }` convention every other
         backend detail page in this repo uses.
       - `acl-feature-catalog.i18n.test.ts`: 15 ACL feature titles (`checkout.sessions.*`,
         `assisted_selling.*` x6, `customer_groups.credit.*`/`approvals.*`/`portal.approvals.*`)
         were missing from `auth`'s English i18n catalog. Added to all 5 locales — real Polish
         translations for `pl.json` (that file already carries real ACL-feature translations, not
         English placeholders, for the surrounding keys), English placeholder for de/es/ko
         (matching the existing convention for those 3 locales in this file).
       - `category-labels-coverage.test.ts`: `notifications.categories.availability` and
         `.customer_groups` were missing from those modules' own i18n files in all 5 locales
         (would have fallen back to the raw module id as the settings-page group heading, #7089).
         Added real translations to all 5 locales for both modules (both modules' i18n files are
         already fully translated, not placeholders).
       All 5 fixed in one commit (`32291eb8d7`) with targeted + full-package verification
       (21/21 on the 5 specific files, then a second full `core` standalone run: 2545/2545 suites,
       24873/25099 tests, 0 failures, confirming nothing else broke).
    The only test failure surviving across every attempt is `@open-mercato/cli`'s
    `dev-env-reload.test.ts` ("watches generated runtime files when explicitly requested") — an
    fs.watch timing flake under this machine's heavy concurrent-worktree load, confirmed by a
    standalone re-run passing 3/3 outside the aggregate run's contention. Pre-existing, unrelated
    to this release; left alone per DYSCYPLINA.
  - `build:app`: EXIT=0, 7m54s, all routes compiled.
  Gate runner: local (no Docker `app` container running), `TMPDIR=/private/var/tmp` +
  `--env-mode=loose` required for every turbo-driven command in this cezar worktree
  ([[tsx-scripts-need-short-tmpdir]]).
- Step 6.4 done. Moving to the completion checklist: om-auto-review-pr-style review pass with
  autofix, then UI QA with screenshots for the new admin screens, then PR #16 description update,
  draft->ready, final handoff, notify.

## 2026-10-28T09:30:00Z — pre-ready review pass (7 priority-area audit)

Dispatched 7 parallel deep-dive reviews against `fork/develop...HEAD`, one per the PR's own
acceptance-gate priority areas, each reading the actual lock/CAS/guard code and actual test
assertions rather than trusting that a test file exists. Disposition of each:

1. **Concurrency (availability + credit reservations) — CLEAN.** Verified no raw
   `em.getConnection().execute(...)` participates in any check-then-write path in
   `availability/lib/reservationCommands.ts` or `wms/lib/wmsReservationService.ts` — every
   lock is `findWithDecryption(..., { lockMode: LockMode.PESSIMISTIC_WRITE })`, confirming the
   earlier-documented oversell fix holds. `reservationCommands.concurrency.pg.test.ts` (real
   Postgres, N=20, asserts exactly 1 winner) and `customerCreditService.concurrency.pg.test.ts`
   (real Postgres, N=20 against a $300/$100 limit, asserts exactly 3 winners and a ledger sum
   equal to 3×100) both hold under real concurrency. Idempotent retry confirmed via the
   `@Unique(['tenantId','idempotencyKey'])` constraint on `CustomerCreditLedgerEntry`.

2. **Security (D-R5-21/22 session binding: cart/checkout-session/thread) — CLEAN.** Every
   `/api/cart/current/*`, `/api/checkout/sessions/current/*` and `assisted_selling`
   `storefront/thread/*` route funnels through a shared `resolveCurrentCart` /
   `resolveCurrentSession` / `resolveIdentifiedBuyerBasket` helper that peeks
   `customerUserId` before any PII read and requires the caller's own auth subject to match
   it, else a uniform 404. `resolveForBuyer` is only ever called with a trusted-source buyer
   id (session, RBAC-gated channel actor, or the resource's own stored identity), never raw
   request input. Regression suites (`currentCartRoute.identity-binding.test.ts`,
   `currentSessionRoute.identity-binding.test.ts`) pass.

3. **Money correctness (cart/order/quote totals, resolveForBuyer) — CLEAN.** Cart and
   order/quote totals are produced by the SAME `salesCalculationService.calculateDocumentTotals`
   call, not two independent re-pricings, and `checkout/commands/submit.ts` additionally
   recomputes and compares totals key-by-key with a sub-cent epsilon before submit, rejecting
   with `500 totals_mismatch` on any drift rather than silently accepting a new number.
   `resolveForBuyer` re-derives customer group/price kind/tax mode/assortment fresh from the
   buyer's own identity via the same service calls the buyer's own session path uses.

4. **Approval gate (threshold on every channel, double-decision conflict) — CLEAN for carts
   and double-decision; ONE FLAGGED GAP for quotes, not fixed.** `cart.lock`'s gate has no
   channel branch — storefront/pay_link/api/agent carts all pass through the identical check,
   and `decideApproval` is a CAS (`nativeUpdate ... WHERE status='pending' AND <slot>='pending'`)
   proven race-safe at N=20 real-Postgres concurrency. However, `purpose: 'quote'` locks skip
   the gate by design (D-R5-23, an explicit, owner-signed-off Release-5 scope deferral — "approval
   of a quote belongs to quote acceptance, outside Release 5"), and the pre-existing, public,
   unauthenticated `packages/core/src/modules/sales/api/quotes/accept/route.ts:34,138` converts
   an accepted quote straight to a `SalesOrder` with **no** reference anywhere to
   `customerPurchaseApprovalService`. Net effect: an over-threshold purchase CAN reach a
   finalized order with zero approval check, via request-quote → accept. This matches the
   spec's own documented, owner-approved deferral to a future release, so it is **not** treated
   as an oversight and **not fixed** here — flagging because it technically contradicts the
   review brief's "no channel exempt" framing and is worth a maintainer's explicit go/no-go
   before this ships, not because the implementation diverges from its own spec.

5. **Visibility (buyer-hidden product reaching submit / proposal_create) — CLEAN.**
   `checkout/commands/submit.ts` calls `cartService.lock()` (which forces a fresh
   `cart.reprice` + `buildWholeCartRevisibilityPhase` re-check against the buyer's live
   assortment scope) before ever reading lines into the order/quote document, for both the
   order and the `request_quote` branches; a newly-hidden line 409s `cart_has_unavailable_lines`
   before any document is built. `assisted_selling`'s `proposals.ts#performAuthorProposal`
   resolves the TARGET buyer's own scope (never the authoring rep's) and routes hidden lines
   into `rejectedLines`, 422ing `proposal_empty` if every line is rejected. Bulk-add, proposal
   accept and cart merge all re-run the same shared `evaluateCartVisibility` primitive.

6. **Checkout submit compensation (killed-process rollback) — CLEAN mechanism, ONE BUG FOUND
   AND FIXED.** The mechanism is a hybrid saga: each submit step commits independently, backed
   by two cron-scheduled reconciliation workers (`recover-stuck-submits.worker.ts` every 1 min,
   `expire-awaiting-payment.worker.ts` every 5 min) that resume via the SAME idempotent
   `compensate`/`continueOrderOutcome`/`completeQuoteOutcome` functions the live path uses,
   keyed off `stockReservationKey`/`creditReservationKey` stored on the session row.
   Availability and credit reservations both tag `sourceType: 'checkout', sourceId: session.id`
   so they're traceable even with no order ever created; availability additionally has an
   independent TTL self-expiry backstop (credit does not, but is still a closed loop via the
   session-level recovery worker alone — noted as an asymmetry, not a gap). **Bug found:**
   `promotions/lib/code-service.ts#useCode` (around line 386) was NOT idempotent on retry — no
   check for an existing `CodeUsage` before re-running eligibility and incrementing `code.used`.
   Because `continueOrderOutcome` resumes from scratch on every recovery-worker retry, a crash
   between a successful `useCode` and session completion caused the retry to either
   double-consume a code with remaining uses, or — for an exhausted/single-use code — fail
   eligibility on the second call and **wrongly cancel an otherwise-already-redeemed, valid
   order** (`compensateByCancellingOrder` with `code: 'promotion_unavailable'`). **Fixed**: added
   an idempotency check at the top of `useCode` that looks up a prior, non-reverted `CodeUsage`
   for the exact `(codeId, cartId, orderId)` tuple and short-circuits with `{ ok: true }` before
   any lock, re-eval or counter increment; made the `CodeUsage` creation set `revertedAt: null`
   explicitly so the lookup is unambiguous. Added 2 regression tests to
   `code-service.test.ts` (retry-is-idempotent; a reverted usage does NOT block re-use). Verified
   `yarn workspace @open-mercato/core test -- src/modules/promotions/lib/__tests__/code-service.test.ts`
   (43/43), `yarn workspace @open-mercato/core typecheck` (clean), and
   `yarn workspace @open-mercato/checkout test -- src/modules/checkout/commands/__tests__/submit.test.ts`
   (39/39, zero regressions).

7. **Tenant/organization scoping + optimistic locking on every new route/entity — CLEAN.**
   Every hand-rolled new route derives `tenantId` from `auth.tenantId` and resolves
   `organizationIds` via the shared `resolveOrganizationScopeForRequest` helper, applied before
   any decrypted read; unknown-org lookups uniformly 404 (no existence leak).
   `makeCrudRoute`-based entities enforce scoping generically via `orgField`/`tenantField`.
   Every new user-editable entity (`CustomerCreditAccount`, `CustomerPurchaseApproval`,
   `assisted_selling` store settings) carries `updatedAt` and enforces
   `enforceCommandOptimisticLock`; `AvailabilityReservation`/`CodeUsage` are correctly exempt
   (no admin edit form exists for either). No BC violation found in the 2 modified pre-existing
   routes (purely additive changes).

- **Other finding, non-blocking, not fixed:** `compensate()` on a `totals_mismatch`/quote-branch
  failure releases stock/credit and unlocks the cart but does not delete/cancel the already-
  created `SalesQuote` row (unlike the order branch's `compensateByCancellingOrder`) — an
  orphaned-record hygiene issue (the quote's own totals are still correct), not a money-
  correctness bug. Flagging for a future cleanup pass, not fixing here (out of this review's
  fix-only-confirmed-blockers/majors scope).
- **Fix commit:** promotions `useCode` idempotency, see git log for the SHA.
- Verdict: approve-worthy once the quote-acceptance approval-gate deferral (item 4) gets an
  explicit maintainer go/no-go — everything else in the 7 priority areas is clean or already
  fixed.

## 2026-10-27 — Browser UI QA attempt for the 6 new admin screens (pre-ready-for-review gate)

**Environment setup (all real, all completed):** Fixed `apps/mercato/.env` for QA (fresh
`openssl rand -hex 32` `JWT_SECRET`, `DEMO_MODE=false`), created disposable Postgres DB
`om_qa_r5`, ran `yarn build:packages --force` and `yarn build:app --force` (confirmed
`Cached: 0 cached` on both — fresh build against current source), ran migrations
(`cart`: 4, `customer_groups`: 9, `assisted_selling`: 3, plus every other module) and
`yarn mercato init` against `om_qa_r5` via the workspace form (bypassing turbo's env-stripping),
seeded admin credentials (`admin@acme.com` / `secret`, confirmed working via
`DEMO_MODE=false` init output — no separate password reset needed this time). Booted the app
with `node ./scripts/dev.mjs --classic` (nohup + `node_modules/.bin` on `PATH`, per the
"mercato server start dies when backgrounded" lesson) on port 3000.

**Blocker — could not reach the browser-QA step.** Once booted, every route (`/api/healthz`,
`/login`, `/api/auth/login`) compiled successfully per the server's own log
(`○ Compiling /api/healthz ...` followed by a real response time, not a hang) but then either
404d or, on later attempts, timed out completely (curl `000` after 45–60s). This matches a known
prior pattern on this machine (memory: "fresh QA dev server 404s under heavy contention"):
`uptime` showed load average 2.8–4.3 throughout, and `sysctl vm.swapusage` showed 35+ GB of a
36 GB swap file in use with under 2 GB free — severe machine-wide memory pressure from many
concurrent agent sessions/worktrees, not a defect in this branch. Postgres itself was healthy
and idle (`pg_stat_activity` showed only 1 connection to `om_qa_r5`), ruling out DB-pool
exhaustion as the cause. Retried the health endpoint repeatedly over ~6+ minutes with
increasingly generous timeouts (including after the dev supervisor auto-restarted its
`next-server` child once); the server never became responsive enough to drive a real browser
against it. Did not sink further time per the established playbook for this failure mode.

**Result: none of the 6 screens could be screenshotted this pass** — blocked before Playwright
ever got to open a page, not because of anything specific to the cart/credit/assisted-selling
UI. No screenshot files were produced; no fabricated/hypothetical screenshots were substituted.

**Fixture-seeding plan (researched, not executed — blocked by the above):** confirmed via code
reading that an admin-authenticated API path exists for every fixture needed:
- Cart + approval + line: `cart.create`'s storefront path (`POST /api/cart/current` with a
  `Host` header resolving through a domain mapping → store → channel chain, same shape as
  `packages/core/src/modules/cart/__integration__/helpers.ts#createCartStorefrontFixture`),
  `POST /api/cart/current/lines`, a `customer_groups` terms `approvalRequiredAbove` threshold
  set below the line's gross total, then `POST /api/cart/current/request-approval`. The
  "identified buyer" gate (`cart.customerUserId` must be set) only reads the persisted `carts`
  row at call time — no FK constraint ties it to a real `customer_accounts.CustomerUser` row
  (plain `uuid` column, consistent with this codebase's no-cross-module-FK rule) — so a direct
  SQL patch of that one column on the freshly-created cart, before calling the real
  `request-approval` endpoint, was the planned (not yet executed) way to get a `pending`
  approval row without standing up a full portal buyer-login flow.
- `customer_groups` credit account: straightforward, `POST /api/customer_groups/customer-groups/credit-accounts`
  then `POST .../credit-accounts/{id}/adjust` for a non-zero balance/exposure.
- `assisted_selling` thread + message + proposal: straightforward,
  `POST /api/assisted_selling/threads` (seeded with an opening message) then
  `POST /api/assisted_selling/threads/{id}/proposals`, reusing the cart from the first fixture.
A seed script implementing this (`/tmp/seed-release5.mjs`, outside the repo) was written and
partially run; it failed at the first `fetch` because the server was already unresponsive, not
because of a logic error in the plan.

**Purchase-approvals admin UI — confirmed finding: NO dedicated staff admin UI exists.**
Checked `packages/core/src/modules/customer_groups/backend/` (no approvals references — only
CRUD pages for the groups themselves), `widgets/injection-table.ts` (registers the credit-panel
and person-groups tabs, nothing approvals-related), and every menu/ACL registration file in the
module (`acl.ts` only declares the `customer_groups.approvals.view`/`.decide` feature strings,
never wires a page/menu). The only API routes are
`packages/core/src/modules/customer_groups/api/customer-groups/approvals/{route.ts,[id]/route.ts,[id]/decide/route.ts}`
(staff: list/detail/decide) and the symmetric `api/portal/approvals/...` (buyer: list/detail/
decide/withdraw) — neither side has a `.tsx` page consuming them. A repo-wide grep for any
`backend/` page with "approval" in its path turned up only unrelated domains (AI agent
auto-approval settings, staff HR leave-request approvals). The cart admin detail page
(`cart/backend/cart/carts/[id]/page.tsx`) is the only staff-facing UI that even references an
approval, and it is read-only (status + amount display, no approve/reject action — the only
button on that page is "Re-price"). This is an accurate confirmation of a gap, not a bug to fix
in this QA pass — reported as-is per instructions.

**Fallback evidence for the areas this pass could not screenshot:** the branch's own review
pass already exercised the same 7 priority areas (concurrency, security/tenant-scoping,
money-correctness, visibility, compensation/idempotency) with real Postgres-backed
unit/integration tests — see the review notes immediately above this entry in this file,
including the one real bug found and fixed there (`promotions/lib/code-service.ts#useCode`
non-idempotency on checkout-recovery retry, fixed with a regression test, both suites green).
That test evidence stands independently of this UI-QA attempt.

**Cleanup — completed:** killed the dev server (`dev.mjs` supervisor + its `next-server` child,
confirmed port 3000 free via `lsof`), dropped `om_qa_r5` (confirmed absent from `psql -l`). No
git changes were made to the worktree (only the gitignored `apps/mercato/.env` was edited, plus
a throwaway `/tmp/seed-release5.mjs` outside the repo) — `git status --short` is clean.

**Recommendation:** re-run this browser-QA pass once the machine is under lighter load; the
seeding plan above is ready to execute as soon as the dev server stays responsive long enough
for Playwright to drive it.
- Completion checklist finished: PR #16's description rewritten (scope, waves, gates, deviations
  including the D-R5-23 quote-channel approval-gate scope limitation, the UI-QA machine-
  contention gap, and the real useCode bug fixed during review), PR flipped from draft to ready
  (`gh pr ready 16 --repo adeptofvoltron/open-mercato`, confirmed `isDraft: false`, no labels/
  assignees to release — this run never held a claim lock since PR #16 was reused per the
  brief's own override, not claimed via the normal auto-skill flow). HANDOFF.md rewritten to
  reflect the finished state. Run complete.
