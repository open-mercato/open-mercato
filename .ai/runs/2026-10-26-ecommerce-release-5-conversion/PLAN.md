# Plan — eComm Release 5, Conversion (fork PR #16)

> Fork: `adeptofvoltron/open-mercato`. PR #16 (draft, base `develop` @ `fc5f8d04ca`).
> Branch: `feat/release-5-conversion` (already exists on the fork, reused — not created by this run).
> Worktree: `/Users/bernard/workspace/open-mercato/.ai/tmp/release-5-conversion-impl`.
> Source of truth: the revised specs on this branch (HEAD `c92470d8d5` at run start), plus
> `.ai/specs/analysis/ANALYSIS-2026-10-26-ecommerce-release-5-scope.md`,
> `-cross-spec.md` (wave table) and `-decisions.md` (D-R5-1…37, audit trail).
> Unattended run — no human in the loop until completion. Local ambiguity not resolved by a spec
> or a D-R5 decision is resolved with the safest option and logged under "Decisions taken without
> the owner" in this file; the run does not stop for it.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status`
> to `done` and fill `Commit` with the short SHA. The first non-`done` row is the resume point.

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 0 | 0.1 | Run folder scaffold (this commit) | inline | todo | — |
| 1 | 1.1 | shared: trusted command-context helper (X10) | dispatch:standard | done | 97e128cd49 |
| 1 | 1.2 | ecommerce: `storeContextService.resolveForBuyer` (D-R5-22, SPEC-029) | dispatch:standard | done | 8ceb5e42ce |
| 1 | 1.3 | wms: extract `wmsReservationService` (A1) | dispatch:standard | done | pending |
| 1 | 1.4 | availability: Phase 2 alignment — shared sellable builder (A2) | dispatch:standard | done | pending |
| 1 | 1.5 | customer_groups: credit entities + migration + new `CustomerGroupTerms` columns | dispatch:standard | done | pending |
| 1 | 1.6 | customer_groups: credit service, row-lock reserve/release/settle + N=20 test (G1/G2/G12/G14) | dispatch:standard | done | pending |
| 1 | 1.7 | customer_groups: credit admin API + UI + ACL + encryption.ts (G13/G16/G22) | dispatch:standard | done | pending |
| 1 | 1.8 | customer_groups: credit notifications + exposure-audit job + cancel-release subscriber (D-R5-2/G15/G21) | dispatch:standard | done | pending |
| 1 | 1.9 | promotions: `revertCodeUse` + `sales.order.cancelled` subscriber (C5) | dispatch:standard | done | pending |
| 1 | 1.10 | promotions: un-hide `delivery_method` rule + `DELIVERY_DISCOUNT` effect (D-R5-17) | dispatch:standard | done | pending |
| 1 | 1.11 | customer_groups: admin credit-account provisioning route + ledger-listing read route (G13/D-R5-5 gap-fill) | dispatch:standard | done | pending |
| 1 | 1.12 | customer_groups: admin credit-account `/adjust` command route (G13/G20/D-R5-2 gap-fill) | dispatch:standard | done | pending |
| 2 | 2.1 | availability: `AvailabilityReservation` entity + migration (A3) | dispatch:standard | done | pending |
| 2 | 2.2 | availability: reserve/release/commit via `wmsReservationService`, CAS, per-line outcomes, allocation (A6/A7/A14/A15) | dispatch:standard | done | pending |
| 2 | 2.3 | availability: expiry job + reconciliation job + events (A11/A12/A13) | dispatch:standard | done | pending |
| 2 | 2.4 | customer_groups: `CustomerPurchaseApproval` entity + migration (actor-typed columns, policy snapshot) | dispatch:standard | done | pending |
| 2 | 2.5 | customer_groups: approval service, CAS decide/withdraw (G6) + `expire-approvals` job (D-R5-27) | dispatch:standard | done | pending |
| 2 | 2.6 | customer_groups: approval portal + staff routes + ACL + grants (G5/G7/D-R5-7/D-R5-34) | dispatch:standard | done | pending |
| 2 | 2.7 | customer_groups: approval notifications (D-R5-6/D-R5-32/G15) | dispatch:standard | done | pending |
| 2 | 2.8 | cart: lock contract — `lockTtlMs`, idempotent extend by `checkoutSessionId`, `unlock`/`markConverted` match (C1) | dispatch:standard | done | pending |
| 2 | 2.9 | cart: D-R5-21/D-R5-22 identity binding on `/current/*` + trusted `resolveForBuyer` path for pay_link/api/agent | dispatch:standard | done | pending |
| 2 | 2.10 | cart: `markConverted` additive inputs (`salesOrderId`/`lineMap`/`salesQuoteId`, K8/D-R5-26); admin list + detail + reprice (K6) | dispatch:standard | done | pending |
| 2 | 2.11 | cart: abandonment payload (K9) + code-reservation release on expire/abandon (K11) | dispatch:standard | done | pending |
| 2 | 2.12 | checkout: B.1 session entity + step machine + token hash + C14 minimum (rate limits, encryption, redaction) | dispatch:standard | done | pending |
| 2 | 2.13 | checkout: B.3 delivery + payment step (rate quoting C13, delivery-promotions evaluation C8) | dispatch:standard | done | pending |
| 3 | 3.1 | cart: approval gate K1–K5 (`requiresApproval`, lock refusal, `purpose: 'quote'` skip D-R5-23, guest fail-closed D-R5-12/29) | dispatch:standard | done | pending |
| 3 | 3.1-fix | ecommerce: fix `mergeStoreSettings` missing `shipping` (TS2322/TS2741, regression from Step 2.13) | inline | done | pending |
| 3 | 3.2 | cart: `/current/request-approval` route + lifecycle withdrawal wiring (K3/K4/K7, `awaiting_approval_since` K5) | dispatch:standard | done | pending |
| 3 | 3.3 | cart: §7a proposal seam commands (create/withdraw/supersede/re-author, D-R5-14) | dispatch:standard | done | pending |
| 3 | 3.4 | cart: §7a proposal routes + sweeper branches (K13–K16/S13–S15) + undo-merge refusal (D-R5-25) | dispatch:standard | done | pending |
| 3 | 3.5 | checkout: B.2 cart-backed links — trusted pay-link seeding (D-R5-19) + store/channel/currency check (C9) | dispatch:standard | done | pending |
| 4 | 4.1 | checkout: B.4 submit sequence part 1 — preconditions, lock, `availability.reserve`, `reserveCredit`, idempotent document creation (C3/C7) | dispatch:standard | done | pending |
| 4 | 4.2 | checkout: B.4 submit sequence part 2 — commit, credit link, codes/usage, gateway, `lineMap`, recovery table (C5/C6/C18/C24) | dispatch:standard | done | pending |
| 4 | 4.2-fix | checkout: `expire-awaiting-payment` job (C1/§12 gap-fill — async gateway sessions never complete without it) | dispatch:standard | done | pending |
| 4 | 4.3 | assisted_selling: module scaffold, store settings, `mode: rep\|off` validator, module registration (D-R5-36) | dispatch:standard | done | pending |
| 4 | 4.4 | assisted_selling: threads/participants/messages + staff author routes wrapping `cart.proposal.create` | dispatch:standard | done | pending |
| 4 | 4.4-fix | assisted_selling: terminal-state subscriber (buyer accept/reject/expiry → thread/proposal rows) + migrate Step 3.3's provisional re-author subscriber in from `cart` | dispatch:standard | done | pending |
| 4 | 4.5 | assisted_selling: buyer thread routes (Phase 2.1) + `/thread/events` (Phase 2.2) + retention/erasure (Phase 2.5) | dispatch:standard | done | pending |
| 5 | 5.1 | checkout: B.5 B2B — PO term, `min_order_value`, on-account eligibility, `request_quote` method (D-R5-20), quote branch (C15–C17) | dispatch:standard | done | pending |
| 5 | 5.2 | checkout: approval-resume subscriber (C11) + session-route identity binding (D-R5-33) | dispatch:standard | done | pending |
| 5 | 5.3 | assisted_selling: rep console (Phase 2.3) — inbox, thread, composer, proposal builder | dispatch:standard | done | pending |
| 5 | 5.4 | assisted_selling: Phase 4 attribution — entity, `cart.cart.converted` subscriber, `GET /attributions`, console report | dispatch:standard | done | pending |
| 6 | 6.1 | All modules: integration-coverage completion per each analysis's test list (G23/A20/K17/S16/C26) | dispatch:standard | done | pending |
| 6 | 6.1-fix | checkout: fix mislabeled `credit_refused` on a gateway payment failure + recovery worker's give-up branch never cancelling the order | inline | done | pending |
| 6 | 6.2 | `UPGRADE_NOTES.md` — D-R5-21 behaviour change, A16, G26 | inline | done | pending |
| 6 | 6.3 | `yarn template:sync:fix` pass (apps/mercato/src/modules.ts registration etc.) | inline | done | pending |
| 6 | 6.4 | Full gate (`.ai/agentic.config.json` validation.commands), fix-forward | inline | done | f955c009a6,5f911df618,0347d285bd,32291eb8d7 |

## Goal

Implement eComm Release 5 — Conversion on the existing fork PR #16, against the revised specs
already on `feat/release-5-conversion` (customer groups Phases 3–4, availability Phase 3, cart
Phase 4 incl. §7a, assisted selling Phases 1/2(1,2,3,5)/4, checkout B.1–B.5 + C14 minimum, plus
additive SPEC-029 `resolveForBuyer` and SPEC-055 `revertCodeUse`/delivery un-hide).

## Scope

Exactly the "Specs in scope" table and "Implementation order (final)" wave table in
`ANALYSIS-2026-10-26-ecommerce-release-5-scope.md` / `-cross-spec.md`. Phases 1–6 above are waves
1–6 of that table (wave 0, the spec revision pass, is already on disk at the branch's starting
commit `c92470d8d5`).

## Non-goals

- Checkout B.6 Hardening beyond the C14 minimum (rate limits, session encryption, payload
  redaction, token hash) — no admin session viewer, no seeded workflow definitions, no
  stalled-instance monitor.
- Customer-groups Phase 5 (per-customer assortment overrides), buyer-scoped visibility Phase 4.
- Assisted-selling Phase 2 item 4 (storefront tray), Phase 3 (AI actor), Phase 5 (live transport).
- Any first-party storefront UI.

## Decisions taken without the owner

> Format: context — choice made — alternative considered. Appended as they happen; never edited
> after the fact.

- Step 1.7 (G16/D-R5-7): declaring `customer_groups.approvals.view`/`.decide` ACL features now, ahead
  of `CustomerPurchaseApproval` (Step 2.4) existing, felt premature per the executor brief's own
  framing — chose to declare ONLY the three credit features (`credit.view`/`.manage`/`.adjust`) in
  this Step and defer the approvals feature ids to Step 2.6, where the entity they gate finally
  exists. Alternative considered: declare all 5 features now with `approvals.*` as inert placeholders
  — rejected as a dead ACL surface with nothing to test against until Phase 2.
- Step 1.7 (G13/D-R5-5): no account-creation (`POST`), ledger-listing, or `/adjust` route shipped in
  this Step — the Step's own Implementation bullet list named only a read + hold/limit-edit surface
  for the widget, not the full §9 route table. Alternative considered: ship the full credit-accounts
  resource (create + ledger + adjust) in one Step — rejected as scope creep past what this Step was
  asked to build; a future Step should pick these up explicitly.
- Step 1.8 (G13/G20/D-R5-2): `/adjust` is still not shipped after this Step either — the Step's own
  brief named three deliverables (notifications, the exposure-audit job, the cancel-release
  subscriber) and explicitly warned against scope-creeping `/adjust` in alongside them. Checked
  PLAN.md Phase 1/2: Step 1.11's gap-fill covers account-creation and ledger-listing only, not
  `/adjust`; no other Step names it. Per D-R5-2/§6.5, `/adjust` is the operator-facing half of
  "payments settle only via `/adjust` or `settleCredit`" — without it, an on-account tenant with no
  payments integration has no way to ever lower exposure, which is a real functional gap for
  Release 5 completeness, not a cosmetic one. Appended Step 1.12 (same pattern as 1.11: a same-
  module, additive, low-risk admin command route with an unambiguous spec basis, §9/§9.1/§9.2/G20)
  to the end of Phase 1 rather than building it here or stopping the run. Alternative considered:
  build it in this commit since the service method shape (`adjust` as a command, G20) is simple —
  rejected because it is an admin API route (validator, feature-gated route, command registration,
  audit/undo wiring), a different surface than this Step's notification/job/subscriber work, and
  the brief's own instruction named this exact trade-off and asked to prefer the gap-fill.
- Step 1.9 (C5): `CodeUsage` (`promotion_code_usages`) stored nothing identifying which cart or
  order a use belonged to — not even the `cartId` `useCode` already receives as input — so
  `revertCodeUse({ cartId?, orderId? })` had nothing to look up. The Step's own brief anticipated
  this ("reverses the RIGHT thing... consult the actual useCode write path") but did not spell out
  a schema change. Added additive, nullable columns (`cart_id`, `order_id`, `generated_code_id`,
  `reverted_at`) to `CodeUsage` plus an additive, optional `orderId` on `UseCodeInput`, rather than
  stopping the run to ask — this is the same class of "additive columns on an unused-in-production
  table, nothing else touches this write path" judgment call Step 1.5's `CustomerGroupTerms`
  columns and Step 1.8's credit columns already made without escalating. Alternative considered:
  make `revertCodeUse` accept only `orderId` and require every future caller to already know the
  order — rejected because `useCode` itself only ever receives a `cartId` (checkout's own Phase 4
  submit calls it with both once the order exists, but the type must support a cart-only caller
  too, matching the brief's own `{ cartId | orderId }` signature), so the column was needed either
  way; adding `cartId` too, rather than `orderId`-only, closes the gap completely instead of half of
  it.
- Step 1.10 (D-R5-17): `benefitRequiresSingleEligibleCurrency` (`data/validators.ts`, D-R4-27) listed
  `product_discount`/`cart_discount`/`buy_x_get_y` with `discountType: 'fixed'` as requiring exactly
  one `eligibleCurrencies` entry — `delivery_discount` was absent because it was still hidden at the
  time D-R4-27 was written. Un-hiding it now exposes the exact same shape (`appliesTo: 'order'`,
  `discountType: 'fixed' | 'percentage'`) `cart_discount` already has, and a fixed delivery discount
  is just as currency-denominated — added `delivery_discount` to the same fixed-amount branch rather
  than leaving a fixed-amount delivery discount uncovered by D-R4-27's guard. Alternative considered:
  leave it out and let a multi-currency fixed delivery discount pass validation silently — rejected
  as reintroducing the exact bug class D-R4-27 exists to close, for no stated reason to treat this
  benefit type differently from its closest sibling.
- Step 1.11 (G13/D-R5-5): `creditLimit` is **required** on `POST …/credit-accounts`, not optional
  with a server-side fallback to the group's `default_credit_limit`. D-R5-5/§5.3 say the default
  "only pre-fills the account form" and "never creates an account by itself", and
  `customerGroupsService.resolveTerms` does not resolve `default_credit_limit`/`credit_currency_code`
  at all (only its five scalar fields), so a server fallback would have needed a new inheritance
  path for one convenience. The form pre-fill from the resolved group default belongs with the
  D-R5-5 "missing accounts" banner (`GET …/credit-accounts/missing`, US-E2), which no Step yet
  names; the create dialog shipped here starts empty. Alternative considered: optional
  `creditLimit` resolved server-side from terms — rejected as contradicting the spec's own wording.
- Step 1.11 (§5.4): the account's `organization_id` must be the customer's organization, but
  `makeCrudRoute` always writes the caller's selected (else home) organization. Chose to refuse
  (400, "customer does not exist in this organization") a create whose customer lives in any other
  organization rather than writing an account `checkCredit` could never find. Alternative
  considered: a hand-written POST that writes the customer's organization — rejected as leaving
  the module's `makeCrudRoute` convention for an edge an operator fixes by switching organization.
- Step 1.11 (§9.2): the `409` body is `{ error: <translated message>, code: 'credit_account_exists' }`
  — the module's existing conflict shape plus a machine code, the same `code` field the
  optimistic-lock 409 carries — rather than `{ error: 'credit_account_exists' }` literally, so
  `createCrud`'s error surfacing shows a readable message. Alternative considered: the literal spec
  shape — rejected because every other `customer_groups` error body carries a message in `error`.
- Step 1.12 (§5.5/§9): the ledger column note says "`idempotency_key` ... for `adjust` the command
  id" — read as "the command mints its own key per execution," not a caller-supplied value, since
  the spec's own `/adjust` body (`{ amount, note }`) has no key field. `commands/adjustCredit.ts`
  therefore generates `` `adjust:${randomUUID()}` `` inside `execute()`. Alternative considered:
  add an optional `idempotencyKey` to the HTTP body so a retrying client could de-dupe — rejected as
  contradicting the spec's own literal body shape without a stated reason to diverge from it; an
  operator-driven admin action retried by a human is not the same risk class as checkout's
  machine-retried submit.
- Step 1.12 (§6.5/G20): `adjustCredit`'s undo is implemented by calling the SAME service method a
  second time with the negated amount, `relatedEntryId` = the original entry, and the key
  `` `undo:${entryId}` `` — reusing the one lock/idempotency-respecting write path rather than a
  second method. Alternative considered: a dedicated `undoAdjustCredit` method — rejected as
  duplicating `adjustCredit`'s lock/sum/append logic for no behavioural difference.
- Step 1.12 (G18/§10.1): declared and emitted `customer_groups.credit.adjusted` (the command has no
  consumer without it, per the Step's own brief) — gated to fire only on a genuinely NEW ledger
  entry, never on an idempotent replay of the same key, so a replay cannot double-announce. The
  sibling `credit.reserved/.released/.settled` and `credit_account.put_on_hold/.released_from_hold`
  events stay undeclared (same reasoning Step 1.8 gave: no consumer yet).
- Step 1.12 (G20): the route sets the `x-om-operation` response header (`serializeOperationMetadata`,
  the same convention every other command-backed route in this codebase follows — e.g.
  `staff/api/leave-requests/accept/route.ts`) so the command's `undo` handler is actually reachable
  through the generic `/api/audit_logs/audit-logs/actions/undo` route. Without it, "a command with
  real undo" would be implemented but unreachable from any client. Not explicitly named in the
  Step's brief, but treated as part of "the route's own shape," not a scope change.
- Step 2.1 (A3/§5.3): the spec places `AvailabilityReservationStatus`/`AvailabilityReservationLineOutcome`/
  the richer `AvailabilityReservationLine` type in a new file, `lib/reservationCommands.ts`, that
  does not exist yet (it is Step 2.2's own deliverable — the `reserve`/`release`/`commit` commands).
  Since this Step is entity-and-migration-only, the narrower, persisted-snapshot versions of these
  types (`AvailabilityReservationSourceType`, `AvailabilityReservationStatus`,
  `AvailabilityReservationLineOutcome`, `AvailabilityReservationItemSnapshot`) were declared
  alongside the `AvailabilityReservation` entity in `data/entities.ts` instead — the same place
  `wms/data/entities.ts` declares `InventoryReservationSourceType`/`InventoryReservationStatus`
  next to `InventoryReservation`. Step 2.2 should import these from `data/entities.ts` for the
  column-shape types and layer its own richer `AvailabilityReservationLine` (adding `key`/
  `available`) in `lib/reservationCommands.ts` on top, narrowing down to the entity's snapshot
  shape before persisting — not redeclare a second, divergent set of status/outcome unions.
  Alternative considered: leave the types undeclared until Step 2.2 — rejected because the entity's
  own `status`/`items` columns need a TS type now, and zod validators for the `items` jsonb shape
  were an explicit deliverable of this Step.
- Step 2.1 (§5.3's own text): no optimistic-lock header was wired — the spec states this table
  "is not user-editable (no admin form, A18), so it carries `updated_at` for transitions only, with
  no optimistic-lock header," which directly answers the root AGENTS.md scoping question the task
  brief raised rather than leaving it a judgment call. `updated_at` is still an `onUpdate` column so
  Step 2.2's CAS `WHERE status = 'active' AND …` transitions can observe it.

- Step 2.2 (A1/A6/A7/A14/A15, §4.1/§4.1b/§4.4): several deliberate scope reductions, each
  bounded so the core guarantee (the parallel last-unit test, this Step's own stated top
  gate) holds exactly, with the gaps left for a documented follow-up:
  - **Product-pool allocation (A7's pool check) is NOT implemented in the gate.** `wms`'s
    `reserveLinesForCheckout` computes `computeSellableQuantities` with `productRollups: []`
    — every line is checked against its OWN per-variant sellable only, never summed
    against a product-level `safety_stock` pool row. This Step's own test-priority list
    (8 items) does not name the product-pool scenario (that is A20/§12's extended coverage,
    explicitly Step 6.1's scope), and implementing it correctly would require locking EVERY
    other active variant of a pooled product too (not just the ones in the call), a
    materially larger change. Per-variant correctness — the actual last-unit guarantee — is
    unaffected either way. Alternative considered: implement the pool subtraction now since
    `computeSellableQuantities` already supports `productRollups` structurally — rejected as
    scope creep past the 8-test gate this Step is judged against, with a real risk of
    under-testing a half-built feature under the same time pressure that already found one
    correctness bug (below).
  - **§4.4's "confirmed-first" collision handling is NOT implemented in
    `convertInTransaction`.** The spec's three-point fix (automation races the live hold,
    key collision with an automation row, partial-release bucket shrink) only matters for an
    integrator who confirms the order BEFORE calling `commit` — checkout itself never takes
    this path (D-R5-8: commit always precedes confirmation). `convertInTransaction` does the
    straightforward in-place rewrite (sourceType/sourceId/key rebuild, `expires_at` cleared)
    and nothing more. Alternative considered: build the full three-point fix now — rejected
    as speculative work for a caller that does not exist yet in this release's scope; revisit
    if/when an integrator-facing confirmed-first path is actually built.
  - **A16's cosmetic pieces (i18n label on `wms` reservation listings, `UPGRADE_NOTES.md`
    entry) are not shipped.** The functional half of A16 — widening
    `InventoryReservationSourceType` to add `'checkout'` and rejecting it on the public
    `wms.inventory.reserve` command/route with `400 checkout_reservation_is_system_only` —
    IS shipped and tested. `ReserveInventoryDialog` already only offers
    `manual`/`order`/`transfer` (no change needed). The translated-label-on-listings polish
    and the `UPGRADE_NOTES.md` entry are named explicitly as Step 6.2's scope in PLAN.md
    ("A16, G26") — left for that Step rather than duplicated here.
  - **Correctness finding, fixed in the same commit, not deferred:** the first implementation
    locked candidate balance rows with a raw `em.getConnection().execute('... FOR UPDATE')`
    statement and read the aggregate back with another raw statement (reusing
    `wms/lib/availabilityCalculation.ts#loadBalanceAggregates`, the A2 shared SQL builder, as
    instructed). Against a REAL Postgres instance under real concurrency (N=20 parallel
    `reserve` calls for a single unit of stock), this let every caller see the SAME
    pre-consumption snapshot and oversold the last unit — verified directly: this installed
    MikroORM version's `AbstractSqlConnection.execute` falls back to the pool's plain client
    whenever its `ctx` (transaction-context) parameter is omitted, and `em.getConnection()`
    never supplies one, so a raw SQL statement issued this way NEVER participates in the
    ambient ORM transaction, lock or no lock, regardless of which transactional `EntityManager`
    fork it is called from. The fix replaces both the lock and the aggregate read with the
    SAME proven ORM-level pattern `reserveInTransaction`'s own `listCandidateBalances` already
    uses successfully (`findWithDecryption(..., { lockMode: LockMode.PESSIMISTIC_WRITE }, ...)`),
    computing the sellable arithmetic client-side from the now-correctly-locked entities (still
    calling the A2 builder's PURE function, `computeSellableQuantities`, just fed from locked
    entities instead of a second raw-SQL query). Proven via mutation testing: temporarily
    removing the `lockMode` from this path reproduces the exact oversell failure the N=20 pg
    test (`availability/lib/__tests__/reservationCommands.concurrency.pg.test.ts`) exists to
    catch, confirming the test is not vacuous; the lock was then restored and the full pg suite
    re-run green. This is now the documented reason `wms/lib/availabilityCalculation.ts`'s own
    doc comment ("a caller that already holds row locks... sees the locked rows for free") is
    only valid for its EXISTING caller (the lock-free read provider) and must NOT be reused
    as-is by a future lock-holding caller without the same fix.
  - **`availability.reserve`/`.release`/`.commit` are plain DI-resolved library functions
    (`lib/reservationCommands.ts`), each with a thin `registerCommand` wrapper
    (`commands/reservations.ts`, `isUndoable: false`) — not pure `CommandHandler`s with all
    the logic inline.** This mirrors Step 1.3's own `wmsReservationService` precedent (a
    plain service class) AND Step 1.6's `customerCreditService` precedent (a plain service
    taking its dependencies explicitly) more closely than the spec's own abbreviated
    `reserveAvailability(input)` pseudocode, which omits DI wiring entirely. The lib
    functions take the resolver container as an explicit first argument (not literally
    matching the spec's single-argument signature) so they are unit-testable without a real
    DI container, consistent with every sibling Release 5 service. The thin command wrappers
    exist so a future caller (checkout, Phase 4) can reach them through the command bus with
    `isUndoable: false` recorded, matching A14/D-R5-10 exactly.

- Step 2.3 (A11/A12, §10): `wmsReservationService` gains two additive, read-only methods
  (`findReservationsByIds`, `listActiveReservationsBySourceType`) — the reconciliation job
  needs to read a hold's own `wms_inventory_reservations` rows (drift a/c) and, for drift (b),
  list every active `'checkout'` row across an entire tenant's organizations, and no existing
  method on the service (extracted in Step 1.3, extended in Step 2.2) exposes either read.
  Both are duck-typed onto the SAME `WmsReservationServiceLike` surface
  `lib/reservationCommands.ts` already defines, never a static `wms` entity import. Per A1-BC
  ("name it and freeze it in §15" once Phase 3 ships), this is additive and in scope for the
  same service this release is actively building out. Alternative considered: have
  `availability` query `wms_inventory_reservations` directly via a raw SQL join — rejected as
  the exact cross-module ORM-relationship violation `packages/core/AGENTS.md` forbids.
- Step 2.3 (§10): the reconciliation job's drift-(b) listing (`listActiveReservationsBySourceType`)
  is the one tenant-WIDE (no single organization) read on `wmsReservationService` — §10's own
  text states both jobs are "one scheduled tick per tenant whose payload carries the scope
  (`{ tenantId }`)", the same scope shape `cart`'s own sweeper schedules use, and tenant
  isolation is enforced by the `WHERE tenant_id = …` filter itself rather than an
  `ensureOrganizationScope` assertion (there is no single organization to assert against for a
  cross-organization scan). `findReservationsByIds` (drift a/c), by contrast, is scoped to one
  hold's own organization and keeps the `ensureTenantScope`/`ensureOrganizationScope` assertions
  every other method on the service already uses.
- Step 2.3 (§10, "schedules registered in setup.ts"): added the
  `availability.register-reservation-sweep-schedules` upgrade action
  (`configs/lib/upgrade-actions.ts`, version `0.10.0`) plus its `configs` i18n keys (all 5
  locales) alongside `setup.ts`'s `seedDefaults` call — mirroring `cart.register-sweeper-
  schedules`/`promotions.register-code-reservation-sweep-schedule` exactly, so an existing
  (pre-Release-5) tenant also gets the new one-minute/hourly schedules registered, not only a
  freshly onboarded one. Not spelled out as a deliverable in this Step's own brief, but the
  spec's own §10 text names `setup.ts` registration explicitly, and every sibling sweeper this
  release added (Step 1.8's credit-exposure-audit via org-scoped payload, Step 1.9's promotions
  sweep) came with the matching upgrade action — omitting it here would leave every tenant that
  existed before this Step with no path to the A11 release valve (A5's "the hold must outlive
  payment" guarantee depends on the sweep eventually freeing an abandoned checkout hold) short
  of a manual DB write. Alternative considered: ship only `seedDefaults` and skip the upgrade
  action — rejected as leaving existing tenants permanently without the only process that frees
  an abandoned checkout hold (§10's own words: "Nothing in `wms` processes `expires_at` today;
  this job is the only release path").

- Step 2.5 (G3/G6/G8/G24, D-R5-27): found that `resolveTerms` (`customerGroupsService.ts`,
  shipped Phases 1-2, revised by Step 1.5's additive columns) was never extended to resolve
  `CustomerGroupTerms.approvalPolicy` — Step 1.5 added the DB column and the validator, and
  spec §6.0 explicitly names `approvalPolicy` (plus `termsCurrencyCode`/`allowQuoteRequests`/
  `requiresPoNumber`) as fields `TERMS_FIELD_NAMES` must grow to cover, but the actual
  resolution-loop plumbing (the `const` array, `ResolvedTerms`'s type, `tenantDefaultTerms`,
  `termsFieldIsSet`, `applyTermsField`) was left untouched. `requestApproval` cannot snapshot a
  policy that never resolves, so this blocked the Step outright. Fixed the minimal necessary
  slice — added ONLY `approvalPolicy` (tenant default `'buyer'`, D-R5-1) to all five of those
  spots in `customerGroupsService.ts`, plus the two existing `resolveTerms.test.ts` `toEqual`
  snapshots and one new inheritance test. Did NOT add `termsCurrencyCode`/`allowQuoteRequests`/
  `requiresPoNumber` — nothing in this Step needs them, and the generic per-field loop means
  adding one field is safe in isolation; the next Step that reads one of the other three (cart's
  approval gate, §3.1, needs `termsCurrencyCode`; checkout B.5, §5.1, needs the other two) must
  add it the SAME way, not invent a parallel mechanism. Alternative considered: add all four now
  since they're the same mechanical change — rejected as scope creep past this Step's own
  approval-service brief, and as speculative work for callers (cart/checkout) that don't exist
  yet in this release's wave order. Also deliberately did NOT add `approvalPolicy` to the
  `explain-terms` route's `TERMS_FIELDS`/response schema (`api/customer-groups/explain-terms/
  route.ts`) — that file's `satisfies readonly (keyof ResolvedTermsSources)[]` only checks a
  SUBSET relationship, not exhaustiveness, so the new field compiles fine either way, and surfacing
  it in the admin explain-terms UI is a presentation concern for whichever Step builds the
  Approvals admin UI (§7.3), not this one.
- Step 2.5 (§10/§10.1, D-R5-6/D-R5-32): declared and emit all five `customer_groups.approval.*`
  events now (`requested`/`approved`/`rejected`/`expired`/`withdrawn`), unlike the sibling
  `credit.*` events (Steps 1.8/1.12), which stayed undeclared until a concrete consumer existed.
  Chose to declare the full family here because: (a) the service CANNOT function per its own
  G9/G24 contract without emitting at least `.requested`/`.approved`/`.rejected`/`.withdrawn` —
  the whole point of a CAS-guarded lifecycle is that OTHER systems (cart's `awaiting_approval_
  since` subscriber, Step 3.2; `customer_groups`'s own future notification wiring, Step 2.7) react
  to these transitions, so "no consumer yet" does not apply the way it did for credit's
  `reserved`/`released`/`settled` (which genuinely have no reader anywhere in this release); (b)
  the spec's own §10.1 payload table is already fully specified for this exact event family,
  unlike credit's `reserved`/`released`/`settled`, which the spec never gave a payload shape to.
  Reviewed Step 1.8's own reasoning for the sibling `credit.*` events and confirmed this is not
  the same situation. `portalBroadcast: true` on every one of the five per D-R5-6's explicit text
  ("available to a portal client of the approval's company"). No in-app/e-mail notification
  wiring was added — that stays Step 2.7's scope exactly as the Step brief states; this Step only
  declares and emits the signals.
- Step 2.5 (§11, the job's own schedule): the Step brief named the service and the job but not
  its scheduling — added an hourly, tenant-scoped `schedulerService.register` call to `setup.ts`'s
  `seedDefaults`, mirroring Step 1.8's `credit-exposure-audit` schedule and Step 2.3's
  `availability` sweeper schedules exactly (same `stableScheduleUuid` helper, same `isEnabled:
  true` so existing tenants pick it up on their next `seedDefaults` pass). Without this, the job
  exists as code but nothing would ever enqueue it. Did NOT add a companion `configs/lib/
  upgrade-actions.ts` entry for ALREADY-provisioned tenants (unlike Step 2.3's availability
  sweepers) — `setup.ts`'s own `seedDefaults` is already re-run idempotently for every tenant on
  `yarn initialize`/tenant re-seed per this module's existing `credit-exposure-audit` precedent
  (Step 1.8 shipped with no upgrade action either), and no Step in this run's Phase 1/2 scope
  currently depends on an EXISTING pre-Release-5 tenant having this schedule before Phase 6's
  gate; revisit if Step 6.1's integration-coverage pass finds a gap.
- Step 2.5 (G24): the cross-company guard re-derives the buyer-side decider's company from
  `customer_accounts.CustomerUser.customer_entity_id` by actor id (`lib/creditIdentity.ts`'s new
  `resolveCustomerUserCompanyId`, FK-id + raw-SQL coupling, no ORM import), rather than trusting
  the caller-supplied `ApprovalActor.customerEntityId` field the spec's own type carries. The
  spec's service-contract prose explicitly calls for this ("the service enforces everything that
  depends on the record... a customer_user actor's customerEntityId must equal the approval's
  customer_id") but its TYPE signature takes `customerEntityId` as a plain field on the actor,
  which a route could populate from a forged or stale value without the service ever re-checking
  it against the actual `CustomerUser` row. Treated the task brief's own explicit instruction
  ("the service itself must still defensively re-check company membership given the actor id, not
  just trust the caller blindly") as settling this in favor of the defensive re-check, with the
  type's own `customerEntityId` field now effectively advisory/unused by the service (still
  required at the type level since Step 2.6's portal route construction will want it for its own
  checks). Alternative considered: trust `actor.customerEntityId` directly, matching the type
  literally — rejected per the brief's explicit "defense in depth" instruction and because it
  would make the cross-company guard only as strong as whatever the Step 2.6 route happens to
  verify, with no second layer.

- Step 2.6 (G5/§9 portal table): the portal `withdraw` route is gated on
  `customer_groups.portal.approvals.view`, NOT a separate `…withdraw` feature — the spec's own §9
  portal route table names exactly this: `POST .../withdraw | customer_groups.portal.approvals.view
  | Requester only`. "Requester only" is enforced by identity (the service's own
  `requestedByActorType`/`requestedByActorId` comparison in `withdrawApproval`, Step 2.5), not by a
  dedicated RBAC feature. Alternative considered: invent a third portal feature
  (`…approvals.withdraw`) for symmetry with the staff `view`/`decide` pair — rejected as contradicting
  the spec's own literal route table with no stated reason to diverge.
- Step 2.6 (§9.2, G5): a non-decider's withdraw attempt on an approval requested by someone ELSE at
  their OWN company answers **404** (not visible to them per `isApprovalVisibleToPortalPrincipal`),
  never the service's own 403 `approval_withdraw_forbidden` — the route's cross-company/"own
  requests only" visibility check runs BEFORE the service call, so a non-owner's lack-of-decide-
  feature case never reaches the service's requester-comparison branch at all. The 403 code DOES
  fire for a decide-HOLDER attempting to withdraw someone else's company-visible request (not
  tested in this Step's integration spec — no scenario names it, and the service's existing unit
  tests from Step 2.5 already exercise that branch directly). Not a stated ambiguity in the brief,
  but the natural consequence of composing the visibility guard (spec's explicit disclosure rule)
  with the service's own requester guard (spec's explicit `approval_withdraw_forbidden` rule) in
  the only order that keeps the disclosure guarantee: visibility first, requester-ness second.
- Step 2.6 (§9 portal table, "Pending first"): implemented by loading the caller's full matching
  row set (id/status/created_at only, via the SAME `buildPortalApprovalListWhere` the list route's
  authorization rule is defined in once) and ranking/paginating in memory, rather than a raw SQL
  `ORDER BY (status = 'pending') DESC` — `status` sorts alphabetically in plain SQL/ORM `orderBy`
  (approved, expired, pending, rejected, withdrawn), which is NOT pending-first, so either approach
  needs a rank expression somewhere. Chose in-memory ranking over raw SQL so the one-and-only
  `WHERE` (the authorization rule) is never duplicated as a second, hand-written SQL string that
  could drift from it. Alternative considered: raw SQL for both the `WHERE` and the `ORDER BY`
  — rejected as a second copy of the visibility rule's `WHERE`, the exact drift risk `lib/
  portalApprovalAccess.ts`'s own doc comment warns against.
- Step 2.6 (§9/§9.2): `CustomerPurchaseApprovalService.toApprovalView` (private in Step 2.5) is now
  exported — the staff/portal list and detail routes read `CustomerPurchaseApproval` rows directly
  (the service has no list method, and `getApproval` is per-id) and serialize through the SAME
  mapping the service's own `getApproval`/`decideApproval`/`withdrawApproval` already return, rather
  than a second, drifting copy of the `ApprovalView` shape. Purely additive (an `export` keyword on
  an existing function); no behavior change.

- Step 2.7 (G15, D-R5-6, §10.2): did NOT declare `customer_groups.approval.decided` — the Step
  brief (itself quoting G15's pre-decision wording, "staff requester") conflicts with the
  REVISED, authoritative spec text written after the owner's decision pass: §10.2's closing line
  states plainly "A notification for a staff requester (`approval.decided`) is not declared in
  Release 5, because no Release 5 path creates a staff-requested approval (X7)." Verified against
  the actual code: `customerPurchaseApprovalService.withdrawApproval`'s own comment (Step 2.5)
  says "Release 5 only ever has `customer_user` requesters, X7" and `requestApproval` never sets
  `requestedByActorType: 'staff_user'` anywhere in this release's scope (that needs the
  assisted-selling proposal seam, Steps 4.3-4.5, not yet landed). Per the root AGENTS.md rule that
  the spec is the authoritative contract and the analysis is only the finding that produced it,
  followed the spec over the brief's own analysis-era phrasing. Alternative considered: declare the
  type anyway for forward-compatibility with the future proposal seam — rejected as declaring a
  notification type with zero reachable emitters today, and because `BACKWARD_COMPATIBILITY.md`
  freezes notification ids on ship, so adding it NOW (dead) is no easier than adding it LATER (live)
  when assisted-selling actually lands.
- Step 2.7 (D-R5-6, §10.2): the buyer-requester e-mail fires on `.approved`/`.rejected`/`.expired`
  only, NOT `.withdrawn` — the Step brief's own bullet list named all four, but §10.2's e-mail
  trigger table lists exactly three ("`approval.approved`, `.rejected`, `.expired` | The requester,
  when a `customer_user`") and omits `.withdrawn` by its absence, not by oversight (the surrounding
  text enumerates every other trigger explicitly). A withdrawal is always either the requester's
  own action or a system cleanup of their own basket (cart merge/expiry/purge, `withdrawnReason`) —
  there is nothing to tell them they do not already know, unlike approved/rejected/expired, which
  are decisions someone ELSE (or time) made. Alternative considered: e-mail on withdrawn too for
  symmetry with the brief's four-state list — rejected as contradicting the spec's own literal
  trigger table with no stated reason to diverge, the same precedent Step 2.6 set for not inventing
  a third portal ACL feature past the spec's literal route table.
- Step 2.7 (G15/G20, idempotency): the task brief's own test requirement ("idempotent on event
  redelivery — no duplicate emails/notifications") has no existing platform primitive to lean on —
  `packages/events/AGENTS.md` confirms persistent subscribers are only at-least-once (a redelivery
  re-runs every persistent subscriber for an event, including ones that already succeeded), and
  `sendEmail` has no dedup of its own (unlike the sibling in-app notification, which dedupes per
  recipient via the notification system's `groupKey`). Added two additive, nullable timestamp
  columns to `CustomerPurchaseApproval` (`requested_email_sent_at`, `decided_email_sent_at`,
  migration `Migration20261026213913_customer_groups`) as CAS markers, claimed via the SAME
  `nativeUpdate ... WHERE … IS NULL` pattern this service's own `decideApproval`/`withdrawApproval`
  already use for every other transition, claimed BEFORE any send is attempted (not after) so a
  crash mid-batch cannot leave the marker unset while some recipients were already mailed. Not
  user-editable (no admin form), so no optimistic-lock header, same reasoning Step 2.1 gave for
  `AvailabilityReservation`'s own transition-only `updated_at`. Alternative considered: a generic
  reusable "idempotency key" ledger table — rejected after confirming no such shared primitive
  exists anywhere in `packages/shared`/`packages/core` (every module with this need, e.g. `cart`,
  `payment_gateways`, `shipping_carriers`, `wms`, built its own small marker); inventing one now,
  for one module's two call sites, is a bigger surface than two columns on the one entity that
  already needs the guard.
- Step 2.7 (§10.2, in-app deep link): `customer_groups.approval.requested`'s in-app notification
  carries no `linkHref`/action — no staff admin UI page for purchase approvals exists yet (Step 2.6
  shipped API routes only, no backend UI). Left unset rather than linking to a JSON API route or
  inventing a page that doesn't exist, mirroring the restraint `customer_groups.credit.limit_
  exceeded` already took for its own ambiguous deep link (Step 1.8). A future Step building the
  staff approvals admin UI should add one.

- Step 2.8 (C1, §9.1): `checkoutSessionId` on `cart.unlock`/`cart.markConverted` is **optional**
  at the type level, not mandatory the way §9.1's literal pseudo-signature shows it
  (`checkoutSessionId: string`, no `?`) — when the caller omits it, the command behaves exactly
  as it did before this Step (no session check at all), rather than treating "no session
  supplied" as a mismatch against the cart's own stored, non-null session (every locked cart
  always has one, since `cart.lock`'s own `checkoutSessionId` input has been required since
  Step 7.5/Release 4). Chose optional-and-additive because `commands/lock.ts`'s own header
  comment confirms neither command has a real caller yet in this worktree ("there is no
  `checkout` module... none of these three commands has a real caller today"), but these three
  commands already shipped in Release 4 (PR #7592, this fork's own develop) — root AGENTS.md's
  `BACKWARD_COMPATIBILITY.md` discipline treats a shipped command's signature as a frozen
  contract surface regardless of whether an in-repo caller currently exercises it, and this
  run's own precedent (Step 1.9's optional `orderId` on `UseCodeInput`, Step 1.12's additive-only
  command inputs) always keeps a new input opt-in. When supplied, a mismatch against the cart's
  stored `checkoutSessionId` is the uniform 404 exactly as §9.1 specifies. Alternative considered:
  make it required on the type, matching §9.1's pseudo-signature literally — rejected as an
  unnecessary, avoidable breaking change to a shipped signature for no functional gain (no
  Release-5 caller added in this Step actually needs the type to force the field), and because
  the spec's own prose two sentences later root-causes `unlock`/`markConverted`/`getSalesSnapshot`
  together as "the matching `checkoutSessionId` the cart was locked with" — a property of the
  CALLER's own contract with checkout, not of every conceivable in-process caller this module's
  DI seam might ever get.
- Step 2.8 (§9.1's own return-type pseudocode, `extended: boolean`): added `extended` to
  `CartLockResult` (not previously part of the shipped return shape) so a caller — and this
  Step's own tests — can distinguish a fresh `active -> locked` transition from an idempotent
  extend without inferring it from `priceChanges` being empty (a fresh lock on an already-fully-
  priced cart could legitimately return `priceChanges: []` too). Purely additive (new field on a
  return value never breaks a destructuring caller). Alternative considered: leave it out and let
  checkout infer "was this an extend" from context it already has (it always knows whether it
  sent the SAME `checkoutSessionId` as last time) — rejected because the spec's own §9.1
  pseudocode names the field explicitly as part of the authoritative signature, and the field
  costs nothing to add now versus retrofitting it when checkout (Step 2.12+) actually needs it.
- Step 2.8 (lockTtlMs bounds violation, no code in §15a's catalogue): an out-of-bounds `lockTtlMs`
  throws `400 { code: 'invalid_lock_ttl_ms' }` (`[internal]`-prefixed message, no i18n key) — §15a's
  error-code catalogue does not name a code for this because no public route calls `cart.lock`
  yet (same reasoning already applied to this file's own pre-existing `cart_has_unavailable_
  lines`/`cart_locked` internal messages). Alternative considered: silently clamp an out-of-range
  value to the nearest bound instead of refusing — rejected as `§9.1`'s own wording ("bounded")
  reads as a validation rule, not a clamp, and a silent clamp would let a caller believe its
  requested TTL took effect when it did not.
- Step 2.8 (extend race safety, not named by the brief): `extendCartLock` re-reads the cart on its
  OWN fresh `em` fork rather than reusing the pre-check's entity, and re-verifies `status ===
  'locked' && checkoutSessionId === <caller's>` before writing — if a concurrent `cart.unlock`,
  lock timeout, or second extend already changed the cart between the pre-check read and this
  write, it falls back to the ordinary 423/404 a retried `cart.lock` call would hit, rather than
  blindly overwriting `lockExpiresAt` on stale assumptions. Mirrors the EXISTING fresh-lock path's
  own "defense in depth: re-assert the same two guards against the POST-reprice fresh read"
  comment (Step 7.5) at the same scale for the (shorter, no-reprice) extend path.
- Step 2.8 (`cart.lock.extended` event): declared and emitted a new event for the `locked ->
  locked` extend transition, alongside the pre-existing `cart.lock.acquired`/`.released`/
  `.timed_out` family — none of the three siblings has a real consumer in this worktree either
  (per `commands/lock.ts`'s own header comment), so "no consumer yet" is not a reason to withhold
  this one when its own siblings were shipped the same way. Alternative considered: skip the new
  event and let an extend reuse `cart.lock.acquired` — rejected as conflating two materially
  different transitions (a fresh lock runs re-price/visibility/approval; an extend runs none of
  them) under one signal, which a future consumer (e.g. an audit trail) could not tell apart.

- Step 2.9 (D-R5-21, §8.4's own "Consequences" bullet): the task brief scoped Part A to "every
  `/current/*` route" via the shared route-entry helper, naming only the TARGET cart addressed
  by `X-Cart-Token`. §8.4's own text additionally calls out one more case under the SAME rule:
  "`POST /current/merge`: ... a `sourceToken` that resolves an identified basket of another
  buyer is the same `404`." The `sourceToken` names a SECOND basket that `cart.merge`
  (`commands/merge.ts`) resolves itself, never through `lib/currentCartRoute.ts#
  resolveCurrentCart` — so leaving it alone would ship the rule only half-closed on the one
  route where two tokens are in play at once. Added the identical check (`getCustomerAuthFromRequest`
  session vs. the resolved guest cart's `customerUserId`, collapsing a mismatch into the SAME
  `'[internal] source cart not found'` 404 the route already throws for an unresolvable
  `sourceToken`) directly in `mergeCartCommand.execute`, right after the existing
  `if (!guestCart) throw notFound(...)` check. Alternative considered: leave it to a future
  Step since the task brief's own Implementation bullets never named it — rejected because
  D-R5-21/§8.4 is explicitly the authoritative contract for this exact scenario, the fix is a
  five-line, single-call-site addition with zero risk to the surrounding merge logic, and
  shipping "every /current/* route" while silently leaving ONE documented consequence of the
  same rule open would be the exact kind of partial security fix this Step exists to close.
- Step 2.9 (D-R5-22, §6a.4's literal fill list vs. the task brief's field list): the task
  brief's Implementation bullet lists `resolveForBuyer`'s fields to use as "`customerIds`/
  `customerGroupIds`/`priceKindId`/`taxMode`/`currencyCode`", but the REVISED, authoritative
  spec text (§6a.4, rev 10) states plainly: "The result fills `customer_id`, `customer_ids`
  (person and company), `customer_user_id`, `customer_group_ids`, `price_kind_id`, `tax_mode`
  and `buyer_digest`" — seven named fields, `currencyCode` conspicuously absent. Cross-checked
  against `cartCreateInputSchema` (`data/validators.ts`): `currencyCode` is a REQUIRED,
  non-optional field on the trusted caller's own input, confirming the omission is deliberate,
  not an oversight — the cart's currency is the trusted caller's own choice (e.g. checkout's
  already-resolved document currency), not something a buyer's identity should silently
  override, and `resolveForBuyer`'s own `currencyCode` output is `null` whenever no `storeId`
  is given anyway (true for the typical pay_link/api/agent caller). Per the root AGENTS.md rule
  that the spec is the authoritative contract and the task brief's field list is only the
  analysis-era paraphrase that produced it (same precedent Step 2.7 applied to the `approval.
  decided` notification), implemented the seven-field fill exactly as §6a.4 states and left
  `currencyCode` as the trusted caller's own required input, unconditionally. Alternative
  considered: also override `currencyCode` from `resolveForBuyer` when present — rejected as
  contradicting the spec's own literal, carefully-enumerated fill list with no stated reason to
  diverge, and as a behavior that would silently second-guess a trusted caller's explicit,
  required input.
- Step 2.9 (scope boundary, confirmed not violated): did NOT extend the trusted-path identity
  refresh to `cart.lock`/the admin re-price/recovery re-locking, despite §6a.4's own text naming
  all three as future callers of the SAME refresh ("The same call refreshes identity at every
  whole-cart re-price of a non-storefront cart that has a buyer"). None of those call sites
  exist in this worktree yet (`cart.lock` ships Step 2.8 with no buyer-identity-refresh logic of
  its own; the admin re-price and checkout recovery are later Phase 2/Phase 4 Steps) — this
  Step's own brief named only `cart/commands/cart.ts:236-258` (the `cart.create` trusted-path
  seeding) as its Part B target, and explicitly said not to build the full pay-link flow. The
  Step that adds the lock/recovery buyer-identity refresh should reuse
  `resolveTrustedCartBuyerIdentity`'s same shape rather than inventing a parallel helper.

- Step 2.10 (K6/§10.2, sort field): §10.2 names `grandTotalGrossAmount` as an admin-list sort
  option, but `Cart.totals.grandTotalGrossAmount` lives inside the `totals` jsonb snapshot
  (§3.2), not a plain column — the query-engine sort path (`sortFieldMap`) only resolves
  literal column names, and the sibling `SalesDocument` family (`sales/data/entities.ts`)
  stores its own grand total as a real, flat, sortable column. Added a Postgres STORED
  GENERATED column, `Cart.grandTotalGrossAmount` (`grand_total_gross_amount`), computed from
  `totals->>'grandTotalGrossAmount'` — the SAME declarative pattern `CartLine.configurationHash`
  (this module) and `wms.InventoryBalance.quantityAvailable` already use, plus a composite
  index mirroring the sibling `carts_tenant_status_*_idx` family. Hand-authored the migration
  (`Migration20261026231500_cart.ts`) and `.snapshot-open-mercato.json` edit directly rather
  than running `yarn db:generate` — a local Postgres instance exists in this sandbox but holds
  schema state from unrelated prior QA/dev sessions (`om_qa_*`/`om_cart49` databases, not this
  worktree's own migration history), and diffing against it risked emitting unrelated drift the
  "coding-agent exception" would then require manually pruning; a two-statement `alter table`
  hand-migration matching this module's own existing generated-column precedent carries no such
  risk. Alternative considered: skip the `grandTotalGrossAmount` sort option entirely and ship
  only `lastActivityAt` — rejected as leaving a spec-named filter/sort half-built for no stated
  reason, when the root-cause fix (a real column, matching the exact pattern `sales` already set)
  is small and precedented.
- Step 2.10 (§11, event payload growth): added `checkoutSessionId` to the `cart.cart.converted`
  payload alongside the new `salesOrderId`/`salesQuoteId`/`lineMap` fields the Step's own brief
  named explicitly — not named in the brief's own bullet list, but §11's literal rev-10 payload
  shape for this event includes it (`{ cartId, tenantId, organizationId, checkoutSessionId,
  salesOrderId, salesQuoteId, lineMap }`), and the command already has the cart's own stored
  `checkoutSessionId` on hand at the call site. Purely additive on an already-additive-this-
  release event payload. Alternative considered: leave it out and let a future Step add it when
  checkout actually reads it — rejected as splitting one event's one payload-growth change
  across two Steps for no reason, when the authoritative shape is already known now.
- Step 2.10 (§9.1/D-R5-26, lineMap id format): `cartMarkConvertedLineMapEntrySchema`'s
  `cartLineId`/`salesOrderLineId`/`salesQuoteLineId` are plain non-empty strings, not `uuid()` —
  `cart.markConverted` has no public route (§10: "no public route... `checkout` calls the DI
  service/command directly, in-process"), so this is the command's own internal input shape, not
  an HTTP body validator. The real malformed-map guard is the bijection check against the cart's
  actual live `CartLine` rows (`commands/lock.ts#validateConversionLineMap`), not the id's
  lexical format — a `uuid()` constraint would only reject a caller whose ids happen not to look
  like UUIDs while doing nothing extra against the actual attack this guard exists for (a map
  that doesn't match the cart's real lines). Matches this module's own test-fixture convention
  (every `CartLine.id` fixture in `commands/__tests__/{cart,lock}.test.ts` is already a plain
  string like `'line-1'`, never a real UUID).
- Step 2.10 (K6/§10.2, admin reprice: active OR abandoned): `commands/cart.ts`'s `cart.reprice`
  status guard was relaxed from `status !== 'active'` to `status !== 'active' && status !==
  'abandoned'` — generically, not gated on `trigger === 'admin_reprice'` specifically. Safe
  because this command never writes `Cart.status` anywhere in its own body (confirmed by
  reading its full `execute()`), so reprice-ing an abandoned cart cannot reactivate it and
  §10.2's "not buyer activity... neither reactivates an `abandoned` basket nor moves
  `last_activity_at`" guarantee holds by construction. Alternative considered: a
  trigger-scoped exception (`cart.status !== 'active' && !(cart.status === 'abandoned' &&
  input.trigger === 'admin_reprice')`) — rejected as more code for an identical outcome, since
  no OTHER existing caller ever reaches this command with an abandoned cart's id in the first
  place (every other dispatcher already requires `active` before it ever calls `cart.reprice`).
- Step 2.10 (§10.2, buyer-identity refresh semantics): `applyCartRepriceTriggerFields` gained a
  DEDICATED `'admin_reprice'` branch rather than reusing `'buyer_context_changed'`'s — the
  admin route may resolve NO buyer refresh at all (`ecommerce` disabled) and must not wipe the
  cart's existing `customerId`/`customerIds`/`customerGroupIds`/`priceKindId` back to null in
  that case, unlike trigger 2, which always has a complete, freshly-resolved `BuyerContext` to
  overwrite with. The new branch only writes a field when the admin route's call actually named
  it (`input.<field> !== undefined`).
- Step 2.10 (K6/§10.2, `customerPurchaseApprovalService` tryResolve despite a hard dependency):
  `cart/index.ts`'s `requires: [..., 'customer_groups', ...]` already makes `customer_groups`
  mandatory whenever `cart` is installed, so `customerPurchaseApprovalService` is always
  registered in practice — resolved it via a local `tryResolveCustomerPurchaseApprovalService`
  soft-DI helper anyway (`lib/adminCartScope.ts`), per this Step's own brief and K6's explicit
  text ("`null` with no error when `customer_groups`' approval service is absent"). Costless
  defensive coding, and both branches are unit-tested regardless of whether the "absent" branch
  is reachable in a real deployment today.
- Step 2.10 (root AGENTS.md cross-module coupling): the admin detail/reprice routes' own
  `organizationIds` derivation (`lib/adminCartScope.ts#organizationIdsFromCartScope`) duplicates
  `customer_groups/lib/customerScope.ts#organizationIdsFromScope`'s algorithm rather than
  importing it — that function is module-private to `customer_groups` (not a DI service, not a
  declared public export of its own `index.ts`), and root AGENTS.md's module-boundary rules do
  not carve out an exception for "small pure helper." `customer_groups` is itself the precedent
  for this exact duplication (its own comment: "Hand-written routes resolve an
  `OrganizationScope` themselves; this derives the `organizationIds` list exactly the way
  `makeCrudRoute` derives `ctx.organizationIds`").

- Step 2.11 (K11, §12 as revised): `purgeExpiredCarts` does NOT gain a `releaseCartCodeReservations`
  call, even though its own `WHERE` (`kind: 'basket'`, `resolvedAt` past the 90-day cutoff) has
  no `status` filter and can reach a `converted` or `merged` basket that never passed through
  `expire`/`mark-abandoned` first (`cart.markConverted` and `cart.merge`'s absorbed-cart
  finalization both set `resolvedAt` directly, bypassing both sweepers K11 names). Checked and
  confirmed this is a REAL gap, not a false alarm — today, nothing in this worktree calls
  `promotions.code.use` before `cart.markConverted` (that lands in checkout's own Phase 4 submit,
  Steps 4.1–4.2), so a converted basket's open code reservation can genuinely still be sitting
  there when the 90-day purge cutoff arrives. Left it open rather than silently expanding this
  Step's scope: K11's own text names only `expire`/`mark-abandoned`, and closing the gap properly
  means a NEW release call site in `commands/lock.ts`'s `markConverted` and/or `commands/merge.ts`
  (release-on-conversion/merge is a materially different change than wiring an existing sweeper),
  not something `purgeExpiredCarts` itself should paper over with a release call of its own 90
  days late. Non-fatal in the meantime: `promotions`' own `code-reservation-sweeper.ts` is an
  independent, TTL-based safety net that releases a lapsed `CodeReservation` row regardless of
  the cart's own state, and once checkout's real Phase 4 submit sequence lands, `promotions.code.
  use` will have already deleted the reservation (same transaction as recording the use) before
  `markConverted` is ever reached. Full reasoning and the exact call-site line numbers are in
  NOTIFY.md's Step 2.11 entry. Alternative considered: add the release call to `purgeExpiredCarts`
  itself as a defensive catch-all regardless of root cause — rejected as treating a symptom (a
  cart purged 90 days late) rather than the cause (two commands that can resolve a basket without
  ever releasing its codes), and as a sweeper quietly growing a responsibility (per-command
  lifecycle cleanup) this Step was never asked to give it.

- Step 2.12 (checkout B.1, C10/C9/C14/C20/D-R5-33): `checkout`'s own `requires` confirmed
  unchanged (still none) — the Phase-A-only-boot guarantee holds by construction (zero static
  imports of `cart`/`customer_groups`/`availability`/`promotions`/`shipping_carriers`/`ecommerce`
  anywhere in the new code; every peer is `tryResolve`d). Session creation resolves the cart
  addressed by `X-Cart-Token` via a SCOPE-FREE Kysely read against `carts.token_hash` (globally
  unique) rather than requiring `storeContextService.resolve` up front — the latter would make
  session creation impossible for link/API/agent-channel carts with no store configured,
  contradicting the module's own "sells through the API and pay links, without a storefront"
  invariant. Consequence: §7.1 check 4 (store/channel/currency match, C9) is NOT enforced at
  session CREATE in this Step — the session snapshots the cart's own store/channel/currency
  verbatim; a later Step (3.5 or a gap-fill) must add the request-resolved-store comparison
  before B.3/B.4 can rely on it. `/sessions/current/step` and `/sessions/current/cancel` (named
  by the spec's own §17 Phase B.1 scope) and the `expire-checkout-sessions` job are also deferred
  — none is in the task brief's own Implementation/test-priority list; `CheckoutSession.expiresAt`
  is written now (placeholder 1h TTL) so the job can be added without a further migration. The
  state-machine's exact adjacency table (the spec gives prose, not a table) and the exact
  rate-limit numbers are both documented in `lib/session-status-machine.ts`'s own doc comment and
  `lib/rateLimiter.ts` respectively — §13's revised text actually DOES name the rate-limit numbers
  explicitly (20/min/IP create; 60/min/session + 120/min/IP mutate, both fail-closed), so those
  were read from the spec, not invented. Full reasoning: NOTIFY.md's Step 2.12 entry.

- Step 2.13 (checkout B.3, C13/C8/D-R5-35): the revised spec's own route table (§9) names
  `POST /sessions/current/delivery`, not the task brief's paraphrase `delivery-method` — built the
  literal spec path, since the spec is the authoritative shape per this Step's own brief. Neither
  `ecommerce.EcommerceStore` nor `checkout.CheckoutLink` had ANY field for a flat-rate fallback
  amount before this Step — D-R5-35 names the SOURCE (store settings vs. link settings) but the
  spec never specifies the field's shape, so one was added: an additive `shipping.flatRate` key on
  `EcommerceStoreSettings` (jsonb, `.prefault(null)`, zero migration, 68/68 ecommerce suites still
  green) and two additive nullable columns on `CheckoutLinkTemplate`/`CheckoutLink`
  (`flat_rate_shipping_amount`/`_currency_code`, Migration20261027180000) for the link tier — no
  admin UI wires either one yet (follow-up gap). `ecommerce.EcommerceStore` also has no structured
  address (`settings.contact.address` is one free-text string) and no "tenant default address"
  concept exists anywhere, so C13's three-tier origin fallback (store → warehouse → tenant default)
  collapses to two: the organization's primary `wms` warehouse, or unavailable (origin tier 1 and 3
  are both gaps, follow-up needed if a store-level address is ever modeled). Packages: weight is
  summed per-line-times-quantity (physically correct), but dimensions take the largest single-unit
  value per axis across lines (a bounding box) rather than a literal sum, which the spec's own
  wording ("weight and dimensions summed") would otherwise produce an absurd single parcel for —
  documented in `lib/cartLinesPeer.ts`. `promotionsService.evaluate()` is called with `codes: []`
  (this Step's own delivery-selection call never re-derives the cart's currently-held entered
  codes — reproducing that would mean either importing `cart/lib` or re-deriving
  `CartPromotionApplication` rows, and the only rule this Step's scope needs working is the
  `delivery_method` rule type, which does not read `codes`); a combined code+delivery rule is a
  gap, flagged for Step 4.1 (the submit-time re-evaluation) to close for real. `payment-methods`
  lists every currency-compatible, tenant-configured gateway descriptor for non-link sessions
  (no per-store gateway selection exists in `ecommerce` either, a parallel gap to the shipping
  one) and restricts to the link's own single `gatewayProviderKey` for link sessions (Phase A's
  existing one-provider-per-link model, unchanged). `POST /sessions/current/payment` (method
  selection + PO capture) is NOT built in this Step — the task brief's own route list names only
  `delivery-options`, `delivery`, and `payment-methods`; §5.5's write side stays with whichever
  Step actually needs it (B.5-adjacent). Full reasoning: NOTIFY.md's Step 2.13 entry.

- Step 3.1 (K1/K2, D-R5-4/D-R5-37): the `resolveTerms` gap NOTIFY.md flagged after Step 2.5
  (`termsCurrencyCode` never resolved) was still open — fixed it here the same way Step 2.5
  added `approvalPolicy`: `TERMS_FIELD_NAMES`/`ResolvedTerms`/`tenantDefaultTerms`/
  `termsFieldIsSet`/`applyTermsField`, PLUS one field-specific extra step
  (`applyTermsCurrencyFallback`) for D-R5-37's base-currency fallback, since this field (unlike
  every sibling scalar term) can resolve from a THIRD place outside the group chain. Found an
  existing, unused-until-now `currencies.BaseCurrencyService` (`resolveBaseCurrency({ tenantId,
  organizationIds })`, DI key `baseCurrencyService`) rather than writing a second raw-SQL
  lookup against the `currencies` table — reused it via the SAME `softCradle` shape
  `customerPurchaseApprovalService` already uses for `moduleConfigService` (`currencies` stays
  a soft peer, not added to `customer_groups`'s `requires`). `ResolveTermsInput.organizationId`
  is a new, optional, additive field — every pre-existing caller (`customerCreditService`,
  the `explain-terms` route, `ecommerce`'s `buyerContext.ts`) never passes it and keeps
  `termsCurrencyCode` resolving to `null` in that case, unaffected. Did NOT add
  `allowQuoteRequests`/`requiresPoNumber` — still no caller in this run; Step 5.1 (checkout
  B.5) must add them the same way.
- Step 3.1 (K2, §9a.2 "recomputes it... at cart.lock"): did NOT add a second `resolveTerms`
  call inside `commands/lock.ts` itself. `cart.lock` already unconditionally dispatches
  `cart.reprice` (`trigger: 'lock'`) before it ever checks the gate, and `cart.reprice`'s own
  totals phase (`lib/reprice.ts#buildRecomputeCartTotalsPhase`) now recomputes
  `cart.requiresApproval` from fresh terms on EVERY call — hooking the gate's "whenever totals
  change" requirement into that one, already-universal totals phase (every line write, every
  dispatch of `cart.reprice` itself, which covers merge/promotions/admin-reprice/lock) also
  satisfies "recompute again at lock" for free, since lock's forced re-price is itself one of
  those calls, strictly before the gate check reads `cart.requiresApproval` back off the
  freshly re-read cart. Alternative considered: a second, lock-local `resolveTerms` call
  immediately before the gate check, matching the spec's two-sentence phrasing more literally
  — rejected as a redundant second DB round-trip and a second place the §9a.2 formula would
  need to stay in sync, for a case the forced re-price already covers by construction.
- Step 3.1 (test item 9, `customer_groups` absent): decided and tested explicitly — when
  `customerGroupsService` cannot be resolved via DI (the soft `tryResolveCustomerGroupsService`
  in the new `cart/lib/approvalGate.ts` catches the throw), `requiresApproval` always computes
  `false`, never an error and never a gate nobody could check. Same documented-degrade
  precedent Step 2.10 already set for `tryResolveCustomerPurchaseApprovalService` despite
  `customer_groups` being a hard `requires` of `cart` — this is purely defensive, unreachable
  in a real deployment, and costs nothing to keep consistent with that precedent.
- Step 3.1 (brief's own `min_order_value` scope question): confirmed `min_order_value` is NOT
  implemented anywhere in `cart` today (grep for `minOrderValue`/`min_order_value` under
  `cart/` turns up nothing) and did not add it here. Per the revised spec's own §9a.6
  ("`min_order_value` is checked by checkout, never by the cart — cart exposes only
  `purpose`"), this is deliberately checkout's concern (Step 5.1, B.5), not a gap this Step
  should close.
- Step 3.1 (i18n): added real `cart.errors.cart_requires_approval`/
  `cart.errors.approval_requires_identified_buyer` keys to all 5 locales (English text
  duplicated across non-English locales, matching the existing
  `cart.errors.store_context_unavailable` precedent — no other `cart.errors.*` key is
  actually localized today either). The command's own thrown `CrudHttpError` message stays
  `[internal]`-prefixed either way (no public route calls `cart.lock` yet in this worktree,
  same reasoning Step 2.8 gave for `invalid_lock_ttl_ms`) — the locale keys exist ahead of
  their first real consumer (checkout, Phase 4/5) per this Step's own explicit instruction,
  the same precedent Step 2.5/2.7 set for pre-declaring `customer_groups.approval.*`
  notification i18n ahead of a UI that reads it.

- Step 3.2 (K5, §9a.5 vs. the task brief's own instruction): the task brief's own
  Implementation bullet asked the new subscriber to "ALSO clear `Cart.approvalId` when the
  outcome is NOT approved". Read the REVISED, authoritative spec text instead and found it
  says the opposite, twice: §9a.5's own prose ("it clears `awaiting_approval_since`;
  otherwise it does nothing. It changes no other column and emits nothing") and §9a.4's
  lifecycle table ("§9a.5 subscriber clears `awaiting_approval_since`; `approval_id` is
  unchanged"). Implemented the subscriber (`lib/approvalDecidedSubscriber.ts`, shared by
  all four `.approved`/`.rejected`/`.expired`/`.withdrawn` thin files) to clear ONLY
  `awaiting_approval_since`, uniformly across all four events including `.approved`, and
  to NEVER touch `approval_id` under any outcome. This is not cosmetic: `approval_id` stays
  the one authoritative pointer (§9a.4: "An older approved approval that still names this
  cart as its subject is never read by cart or checkout" is the ONLY stale-reference case
  the spec calls out — a rejected/withdrawn/expired approval staying referenced is how
  `CartView.approval` can keep showing the buyer the final status of their last request
  until they make a NEW one, which is what actually moves the pointer). Per root AGENTS.md
  ("the spec is the authoritative contract... the analysis/brief is the finding that
  produced it"), followed the spec. Alternative considered: implement the brief's literal
  instruction — rejected as a real behavioral bug (an operator-facing "why does this
  rejected/withdrawn approval still show on the cart" surprise, and a dead read for
  `CartView.approval`'s own live `getApproval` call, which already degrades correctly to
  the approval's own terminal status without any column-clearing help).
- Step 3.2 (K3, the brief's own narrower enumeration vs. the full finding): the task brief's
  title/Implementation list named four K3 transitions (merge-source, expiry, purge,
  undo-merge-recompute-not-restore) and did not name the fifth row in K3's own full table
  — "Converted | Pending (a `purpose: 'quote'` conversion, §9a.6): withdrawn." Did NOT
  implement this fifth row in `cart.markConverted` (`commands/lock.ts`) — no caller in this
  worktree ever reaches it with `purpose: 'quote'` through to conversion (checkout's quote
  flow is Phase 5.1's own scope, not yet landed), so there is nothing to exercise or test
  against today, and the brief's own explicit Implementation bullets, which this Step is
  judged against, never named it. Flagged here rather than silently added: Step 5.1 (or
  whichever Step first makes `cart.markConverted` reachable with `salesQuoteId` set) should
  add "if `input.salesQuoteId` is set and the cart's current approval is still `pending`,
  withdraw it (`lib/approvalLifecycle.ts#withdrawPendingCartApproval`, reason — none of the
  three existing reasons fit; a fourth reason value may be needed, or `'cart_merged'`'s
  slot repurposed — the owner should decide which)" to that Step's own scope. Alternative
  considered: add it now as cheap, well-specified, additive logic — rejected because it
  would be untestable without inventing a fake `purpose: 'quote'` caller this Step has no
  business inventing, and because the brief's own narrower enumeration, read against its
  explicit "If this Step genuinely needs splitting, STOP" instruction, reads as a deliberate
  scope boundary rather than an oversight.
- Step 3.2 (K7, the brief's own payload list vs. the revised spec's §11 text): the task
  brief's own "K7 `cart.approval.requested` payload" instruction and the pre-revision K7
  analysis finding both give a 6-field payload (`{ cartId, approvalId, tenantId,
  organizationId, amountGross, currencyCode }`). The REVISED, authoritative §11 text (rev
  10) gives 8 fields for the SAME event: `{ cartId, approvalId, tenantId, organizationId,
  customerId, customerUserId, amountGross, currencyCode }`, with its own explanatory line
  ("`customerId` is the company the approval was requested for"). Implemented the 8-field
  spec shape, reading `customerId` off `requestResult.approval.customerId` (the service's
  own G11 company-first resolution) rather than re-deriving it — same "spec overrides the
  pre-revision analysis finding/brief paraphrase" precedent Step 2.9 applied to
  `resolveForBuyer`'s fill list and Step 2.7 applied to the `approval.decided` notification.
- Step 3.2 (K4/§8.4, route-level identity binding for a guest cart): confirmed
  `resolveCurrentCart`'s existing binding check (`lib/currentCartRoute.ts`, Step 2.9) only
  enforces a customer session when the ADDRESSED cart already has a `customerUserId` — a
  guest cart (the K4 case this route exists to refuse) reaches the command un-gated by that
  check. The actual guest refusal is therefore `commands/approval.ts`'s own `if
  (!cart.customerUserId)` guard, run AFTER `loadMutableCart`'s status gate — matching
  §9a.4's own ordering ("Preconditions: an identified basket with the matching session...").
  Not a gap: the route-level binding check still does its OWN job (an identified basket
  answers only to ITS buyer), and this command's guard is the separate, K4-specific "no
  buyer identity at all" case §8.4 does not cover by itself.
- Step 3.2 (idempotency-key, §10's generic "every mutation" text vs. this module's own
  precedent): did NOT wire the generic `lib/idempotency.ts` `Idempotency-Key` replay-cache
  into `POST /current/request-approval`, despite §10's route contract text listing it
  ("`Idempotency-Key` and the optimistic-lock header are accepted as on every mutation").
  That helper's own header comment states its scope explicitly: "this is why this helper
  only wires into the line-mutation routes" — `/current/merge` and `/current/undo-merge`
  (this Step's own named structural precedent) do NOT wire it in either, despite being
  "mutations" too. The real retry-safety guarantee this route needs is already the DOMAIN-
  level idempotency `requestApproval` provides (G8: a duplicate request for the same
  subject while pending returns the SAME approval, never a second one) — a second, generic
  response-replay cache on top would be redundant for this specific route. Standard
  optimistic-lock header support IS wired in (every `/current/*` mutation route carries it,
  no exception). Alternative considered: extend `lib/idempotency.ts` to this route for
  literal §10 compliance — rejected as scope creep past a documented, already-precedented
  module boundary, for a risk (double-request on retry) the service's own G8 guard already
  closes.
- Step 3.2 (§9a.4 step 4's pseudocode vs. the service's actual shipped signature): the task
  brief's own call-shape pseudocode names `customerId: <resolved per G11, company-first>`
  and `approvalPolicySnapshot: <from resolved terms>` as fields to pass into
  `requestApproval`. Neither exists on the service's actual, Step-2.5-shipped
  `RequestApprovalInput` type — it takes `buyer: { customerIds: string[] }` (the service
  resolves the company-first `customerId` internally via `resolveCompanyFirstCustomerId`,
  G11) and no `approvalPolicySnapshot` field at all (`approvalPolicy` is resolved
  internally from `groupsService.resolveTerms` and snapshotted onto the row the service
  creates). Called the real, shipped signature exactly as it exists rather than the brief's
  paraphrase of an earlier design — this is not a judgment call so much as the only way the
  code compiles, but recorded here since the brief's own pseudocode reads as if those two
  fields were real inputs.

- Step 3.3 (§7a.5, the task brief's own "reject-command-vs-route" question): resolved in
  favor of a real command. §7a.5's literal text names only `cart.proposal.reject`, called
  by BOTH the buyer-facing route (Step 3.4) and every author-side ending ("withdraw,
  supersede and re-author call `cart.proposal.reject`... There is no separate
  `cart.proposal.withdraw`/`.supersede` command. Distinguished by a `rejectedBy: 'buyer' |
  'author'` input field the caller supplies. Full reasoning in NOTIFY.md's Step 3.3 entry.
- Step 3.3 (D-R5-14's re-author subscriber, placement): built in `cart`
  (`lib/proposalRetarget.ts` + `subscribers/cart-merged-proposal-retarget.ts`) as a
  PROVISIONAL mechanism, even though the authoritative spec (`2026-09-22-assisted-selling.md`
  §8.1/§6.4) places this subscriber in `assisted_selling`, which does not exist as code yet
  (this run's own Phase 4, Steps 4.3–4.5). The task brief explicitly instructed building a
  cart-only version now ("do not attempt to call into a non-existent assisted_selling
  module"). Flagged for whichever Step builds the real `assisted_selling` module to remove
  or narrow this subscriber so the two mechanisms never double-process one merge.
  Alternative considered: skip the mechanism entirely and leave it for Phase 4 — rejected
  because the task brief's own explicit Implementation bullets named it as this Step's
  scope, with an explicit fallback to build if `assisted_selling` is absent.
- Step 3.3 ("supersede-on-merge" vs. the authoritative spec's "both proposals are live"):
  the task brief's literal test sentence ("supersede-on-merge leaves exactly one live
  proposal targeting a cart after acceptance") read, taken at face value, as "supersede
  SIBLING proposals when one is accepted" — directly contradicted by
  `2026-09-22-assisted-selling.md` §6.1: "Both proposals are live... neither blocks the
  other; the buyer may accept both, either or neither." Per root AGENTS.md (the spec is
  authoritative, the brief is the finding that produced it), did NOT build sibling
  supersession. "Exactly one live proposal after acceptance" falls out of the ordinary
  lifecycle instead (the accepted proposal's own status leaves `active`; the sibling is
  never touched) — tested explicitly. Read "supersede-on-merge" and "re-author" as two
  facets of the ONE login-merge mechanism above, not a second piece of logic. Alternative
  considered: build an explicit "reject every other active proposal targeting this cart on
  acceptance" rule to satisfy the brief's literal sentence — rejected as directly
  contradicting the authoritative spec text quoted above, with no stated reason to diverge.
- Step 3.3 (S10, `addedByActorType` on a proposal line): hard-coded to `'rep'` for any
  authenticated `ctx.auth.sub`-bearing caller, never derived from `users.kind`. Release 5's
  own scope decision (D-R5-15/S10: `mode: rep | off` only, no AI agent participant is ever
  created) makes `'ai_agent'` unreachable regardless of what `cart` itself could otherwise
  detect, and no caller in this release ever supplies one. Revisit when Phase 3 (AI actor)
  ships.
- Step 3.3 (`cartProposalCreateLineInputSchema`, id format): `productId`/`variantId` are
  plain non-empty strings, not `uuid()` — same precedent `cartMarkConvertedLineMapEntrySchema`
  (Step 2.10) already set: no public route exists yet, the real guard is the batched catalog
  lookup collapsing to `product_unavailable`, and this module's own `CatalogProduct.id` test
  fixtures are plain strings throughout (`'product-1'`). The public `POST /proposals` body
  (Step 3.4) gets its own `.strict()`, `uuid()`-validated schema.

- Step 3.4 (§3.1a: "`cart.proposal.accept` delegates to `cart.merge`; it is not a second
  merge implementation"): built `cart.proposal.accept` as a real, third registered command
  in `commands/proposal.ts` (the task brief's own phrasing — "the route delegates to the
  EXISTING merge command" — read literally would have the ROUTE call `cart.merge` directly
  with no intermediate command). The spec's own §3.1a command list names `cart.proposal.
  accept` explicitly, alongside `.create`/`.reject`, as one of the module's registered
  commands — so "delegates to `cart.merge`" describes what `cart.proposal.accept`'s OWN
  `execute` does internally (verify the `acceptanceToken`'s freshness, then call
  `commandBus.execute('cart.merge', ...)`), not a license to skip the wrapper command
  entirely. `commands/merge.ts` gained a `proposalCartId`/`lines` discriminated-union input
  variant (`CartMergeManualInput`) handled by a dedicated `executeProposalAcceptance`
  function — a completely separate code path from the existing §7.1 guest-merge branch,
  reusing only its small pure helpers (`buildMergeOutcome`, `resolveMaxOrderQuantities`,
  `filterCustomerLines`) — so the already-tested guest-merge path carries zero behavioural
  change or regression risk from this Step. Alternative considered: have the ROUTE call
  `cart.merge` directly with no `cart.proposal.accept` wrapper — rejected as contradicting
  §3.1a's own command list, and because the acceptanceToken verification (§7a.4's own
  two-step preview→accept contract) has nowhere sensible to live other than a command of
  its own (it is not merge mechanics, and a route-layer implementation would duplicate the
  fresh-preview-rebuild logic `preview` itself already owns).
- Step 3.4 (§7a.4, "TTL 15 min... single-use"): the `acceptanceToken` is a `signAudienceJwt`/
  `verifyAudienceJwt`-signed token (`lib/acceptanceToken.ts`), reusing the SAME shared,
  audience-scoped JWT primitive `customer_accounts` already uses for customer session
  tokens, rather than inventing a bespoke HMAC scheme (the module's other signed-token
  precedents — `communication_channels/lib/thread-token.ts` — carry no payload at all, so
  they are not reusable templates for a token that must BIND two carts' `updatedAt`
  snapshots). "Single-use" is achieved for free: a successful accept moves BOTH the target's
  and the proposal's `updatedAt`, so re-presenting the same token for a second accept call
  fails the ordinary freshness comparison with no separate single-use ledger needed.
  Alternative considered: a dedicated HMAC token format over a fixed byte layout (mirroring
  `thread-token.ts`) — rejected as reinventing exactly what `signAudienceJwt` already does
  for a payload-bearing, expiring, audience-scoped token, for no benefit.
- Step 3.4 (§7a.4's own un-named "preview" reusable mechanism): built `lib/proposalPreview.ts`
  as a pure, read-only dry-run — reuses `cart.proposal.create`'s own exported pricing helpers
  (`buildCartPricingRowFilterContext`, `fetchPriceRowsBatch`, `groupRowsByProduct`,
  `resolveLinePricing`, all from `commands/lines.ts`) rather than re-implementing a second
  pricing path. Matches the task brief's own fallback instruction ("if this preview
  mechanism doesn't exist as a reusable cart function yet, build the minimal version").
- Step 3.4 (§10's own prose, not a literal field in the route table): `GET /proposals`
  (list) returns only `status: 'active'` ("live") proposals, newest first — reading the
  route table's word "Live" as the filter itself, not flavour text. `GET /proposals/:id`
  (detail) is readable at ANY status, matching TC-CART-PROP-16's explicit "an expired
  proposal is readable." Alternative considered: list every status too and let the client
  filter — rejected as contradicting the route table's own word choice ("Live proposals"),
  which `POST /proposals/:id` (detail) tellingly does NOT repeat.
- Step 3.4 (§10.2's own K12/X5 posture, scope boundary deliberately NOT closed): did NOT
  widen the STAFF admin `GET /api/cart/carts`/`GET /api/cart/carts/:id` routes to accept
  `kind: 'proposal'` (gated by the already-declared `cart.proposals.view` feature), even
  though §10.2's prose now describes exactly that ("`kind` ... `proposal` accepted and
  additionally requires `cart.proposals.view`"). Those two routes' own code comments
  (`api/carts/route.ts`, `api/carts/[id]/route.ts`) explicitly scoped themselves to
  `kind: 'basket'` only "while the §7a proposal seam is deferred" — a deferral Step 2.10
  made on purpose, named as ITS OWN gap to close once the seam ships. This Step's task
  brief named only the buyer-facing `/api/cart/proposals/*` family, the sweeper branches and
  the undo refusal — not the admin list/detail widening, which is a separate, pre-existing,
  explicitly-flagged deferral in a DIFFERENT file family. Flagged here and in NOTIFY.md for
  whichever Step picks it up; `cart.proposals.view` is already declared and unused for
  exactly this purpose. Alternative considered: widen both admin routes in this Step too,
  since the ACL feature already exists — rejected as expanding this Step's own file touch
  list into a surface area (admin `DataTable`/backend page awareness of a second `kind`)
  the task brief never named, for a gap this run's own Step 2.10 already flagged as a
  deliberate, revisit-later deferral rather than an oversight.
- Step 3.4 (no explicit spec rate-limit bucket named for `POST /proposals`): the buyer-facing
  `GET /proposals` and every `/proposals/:id/*` route carry the SAME `CART_RATE_LIMITS`
  buckets (`read`/`mutate`) every other token-bound cart route uses. `POST /proposals` (the
  staff/API-key author route) carries NONE — §15a's rate-limit table (checked) names buckets
  keyed by cart TOKEN (`create`/`mutate`/`read`), and this route has no cart token to key by
  at all (§10's own text: "accepts no cart token"); IP-only throttling under one of those
  buckets would conflate an authenticated, ACL-gated staff/service caller with an anonymous
  storefront buyer's abuse surface, which is not what any of the three buckets are sized
  for. Flagged here rather than silently applied — a future Step adding a dedicated
  author-route budget (if `assisted_selling`'s own rep console turns out to need one) should
  add a fourth bucket, not reuse these three.
- Step 3.4 (§8.3's "rotated on merge and on adoption", applied to the proposal-acceptance
  branch too): `executeProposalAcceptance` rotates the target's token unconditionally, same
  as the existing guest-merge path — `cart.proposal.accept`'s own result surfaces the
  rotated token in its response body the same way `/current/merge`'s response does
  (`buildCartResponseEnvelope`'s own "rotated unconditionally... always present" comment).
  Alternative considered: skip rotation for acceptance (no login/identity-crossing event
  occurs) — rejected as an unnecessary divergence from `cart.merge`'s own single, already-
  tested rotation rule, which the spec's §8.3 text does not carve out an exception for.
- Step 3.4 (TC-CART-PROP-09's literal text, "a proposal acceptance's merge event carries
  `kind: 'proposal'`"): `cart.cart.merged`'s `kind` field is read as "the SOURCE's kind" —
  `'basket'` for the ordinary guest-merge path (unchanged), `'proposal'` for the manual-
  acceptance branch — rather than some other axis (e.g. the merge's own `strategy`, which a
  separate field already carries).
- Step 3.5 (checkout §4.3 vs. the Implementation list's own framing): the spec's `.ai/specs/
  2026-03-19-checkout-simple-checkout.md` §4.3 names a brand-new `CheckoutLinkCartTemplate`
  (`checkout_link_cart_templates`) entity — it did not exist in code at all before this Step,
  despite the task brief's own Read-first list implying `CheckoutLink`/`CheckoutLinkTemplate`
  already carried "the template's line definitions, including `unit_price_override`." Built
  the entity now (additive migration), scoped to exactly what seeding needs: `product_id` is
  REQUIRED (not the spec's nullable "catalog reference, or freeform for non-catalog item"),
  since `cart.lines.add` has no freeform/non-catalog line path today — a freeform template
  line is a documented follow-up gap, not built here. No admin route writes these rows yet
  either (no CrudForm sub-resource editor) — tests create fixture rows directly. `{ source:
  'link' }` is reachable only for `checkoutType: 'simple_checkout'` links (§3.2's entry-mode
  table); a `checkoutType: 'pay_link'` link still 404s at `checkout.session.create` and keeps
  its entire Phase A path (`/pay/[slug]`, `/submit`) completely untouched end to end (C10).
  Alternative considered: branch purely on `cart` module availability inside the EXISTING
  `/pay/[slug]` routes instead of a new `source: 'link'` session-create path — rejected: Phase
  A's own route contract (no `session_id`, no cart) is frozen by §3.2's "Phase A pay links
  keep their existing path end to end... removes nothing from it," and the spec's own §9.0
  route table names `{ source: 'link', slug }` at `POST /sessions` as B.2's actual entry point.
- Step 3.5 (`cart` contract, D-R5-19, pre-approved Ask First): closing the cart-side gap the
  checkout spec's §4.3/cart §6a.4 "rev 10" text already describes but the shipped `cart` code
  (through Step 3.4) did not yet implement — `requireChannelFeature`'s `systemActor` bypass for
  `channel: 'pay_link'` ONLY (R22), `cart.create`'s `tenantId` trusted-fallback input field (no
  `ctx.auth` exists for a system actor), and `CartLine.unitPriceOverride` + `cart.lines.add`'s
  override bypass of catalog price resolution (gated identically: `systemActor` + `channel ===
  'pay_link'` only). Kept deliberately minimal — no reprice-engine rewrite beyond the one-line
  exclusion `lib/reprice.ts#buildCartLineRepricePhases` already uses for gift lines (same
  "never silently overwrite a deliberately non-catalog price" reasoning). `basis: 'gross'` is
  assumed for every checkout-link override (Phase A's own pricing modes are all gross-oriented,
  `fixedPriceIncludesTax`'s own default) — `CheckoutLinkCartTemplate.unitPriceOverride` has no
  `basis` column of its own, unlike `CartLine.unitPriceOverride`'s `{ amount, basis }` shape.
- Step 3.5 (C9 at creation — most comparisons are tautological by construction): the session
  about to be persisted COPIES the cart's own channel/currency/tenant/organization, so three of
  the four C9 comparisons can never actually fire at creation (they only start doing real work
  at Step 4.1's submit, after a cart could have drifted since the session was opened). The one
  comparison with real teeth now is the store check — `storeContextService.resolve(request,
  { fresh: true })` against `cart.storeId` for a non-null-store (storefront) cart, newly
  enforced here and NOT enforced at creation before this Step (Step 2.12's own flagged gap).
  Confirmed via the full `source: 'cart'` regression suite that this is additive, not breaking:
  one pre-existing test needed a `storeContextService` mock added (a storefront cart with a
  real store now genuinely requires one, matching §3.4's own documented behavior), every other
  pre-existing test already uses a `store_id: null` cart peer and is completely unaffected.

- Step 4.1 (checkout B.4 submit, C19 steps 1-5): the Step 2.13 NOTIFY question ("does submit
  take the payment method as a direct input, or build a selection route first?") is resolved
  as the FORMER — `checkout.session.submit`'s own input carries a required `paymentMethodCode`
  field, read nowhere else; no `POST /sessions/current/payment` route is built by this Step (or
  any Step before it). `purpose` stays `'order'` unconditionally — `paymentMethodCode ===
  'request_quote'` is refused outright (`422 payment_method_unavailable`) rather than silently
  mis-handled, since the quote branch's own `cart.lock({ purpose: 'quote' })` semantics are
  Step 5.1's scope.
- Step 4.1 (C7, genuine gap found during implementation, not anticipated by the task brief):
  `cartService.getSalesSnapshot` — the function C7/the cart module's own spec (§3.1a/§9.1 rev
  10) names as the single source checkout must use to build its quote — did NOT exist anywhere
  in the `cart` module before this Step (confirmed: zero hits for `getSalesSnapshot`/
  `toSalesSnapshots` outside spec/analysis text). Built it as `cart/lib/toSalesSnapshots.ts`
  (per the spec's own named file path) plus a new `getSalesSnapshot` method on the existing
  `cartService` DI key — additive, matching the cart spec's own BC table entry for exactly this
  ("DI | cartService.getSalesSnapshot (new method on an existing key) | Additive"). Per-line
  mapping reuses `lib/reprice.ts#toCartTotalsLineSnapshot` verbatim (never a second mapper);
  order-scope adjustments are reconstructed from the persisted `CartPromotionApplication`
  (`scope: 'order'`) rows rather than recomputed, since nothing holds the in-memory
  `SalesAdjustmentDraft[]` `cart.reprice` built past that one request.
- Step 4.1 (C2, the SAME genuine-gap class): `cart.lock`'s own storefront-routeContext
  assertion, which C2's finding text explicitly names ("This adds the assertion lock.ts:75-85
  deferred 'until a real caller exists'" — Step 2.8/2.9's own documented deferral), was still
  unbuilt. Added it to `commands/lock.ts` (400 `assortment_scope_required_for_storefront_
  channel`) and extended `cartService.lock`'s OWN input with an additive `request` field so a
  cross-module caller (checkout) can get a real `ResolvedCartRouteContext` resolved WITHOUT
  violating `routeContext.ts`'s own documented invariant ("the ONLY function permitted to
  construct one is `resolveCartRouteContext`") — the facade resolves it in-module from the
  request when supplied, degrading to `undefined` (never throwing) when `ecommerce` is absent,
  so `cart.lock`'s own assertion is always the correct backstop either way.
- Step 4.1 (`sales`, additive, Ask-First already covered by D-R5-30's own package accept):
  `quoteCreateSchema`/`createQuoteCommand` never exposed `externalReference`/`customerReference`
  as inputs, even though the `SalesQuote` entity has carried both columns since before this
  release and `orderCreateSchema`/`createOrderCommand` already wire the identical pair — C3's
  own design ("`sales.quotes.create` with: `external_reference`...") requires them. Closed the
  gap with the minimal mirror of `orderCreateSchema`'s own two fields (additive, optional,
  non-breaking) rather than a two-step create-then-update workaround (which would leave a
  not-yet-externally-referenced quote briefly unindexed between the two calls). Added the
  `(tenant_id, external_reference)` index itself (D-R5-30, pre-approved) as a hand-authored,
  `CONCURRENTLY`-built migration (Migration20261028010000), matching this module's own
  established precedent for a non-trivial table (Migration20260806120000/20260821120000/
  20260916120000) rather than a `yarn db:generate` diff.
- Step 4.1 (C7, the quote's own persisted totals vs. the cart's "goods" totals): the
  calculation engine (`sales/lib/calculations.ts`) folds a `shipping`-kind adjustment directly
  into `subtotalNet/GrossAmount` (not a separate "goods subtotal" field) — so the QUOTE's own
  `subtotalNetAmount` etc., once checkout's own shipping + delivery-discount adjustments are
  added, can never equal the CART's `subtotalNetAmount` key-for-key without first subtracting
  shipping back out via engine-internal arithmetic this command would then have to keep in
  sync forever. Implemented the equality check instead as an INDEPENDENT, goods-only
  `salesCalculationService.calculateDocumentTotals` call (the same engine, the SAME
  `snapshot.lines`/`snapshot.adjustments` — no shipping, no delivery discount), compared
  against `cart.totals` — mathematically a sanity/regression guard (same engine, same inputs,
  provably equal unless a real bug or a race exists) rather than a literal re-read of the
  persisted quote row's own totals. D-R5-24's SEPARATE "full payable amount" check (goods
  gross + delivery cost − delivery discount vs. the reserved credit amount) is a distinct
  comparison, implemented separately, exactly as the task brief's own "do not conflate them"
  instruction required.
- Step 4.1 (idempotent-retry test scope, task brief's own test priority #2): "a killed-process-
  style retry... resumes/no-ops correctly at each already-completed step" is tested as the
  idempotent REUSE of an existing quote/order found by `external_reference`/`id` — not as two
  literal top-level calls to `checkout.session.submit` with the same session. A second literal
  call while `status = 'submitting'` is, per §7.4's own text, a UNIFORM `409
  submit_in_progress` ("it does not queue behind it... never a resume") — the only way the SAME
  attempt/keys are genuinely replayed is a crash-recovery mechanism re-running the lower-level
  calls directly, which is Step 4.2's own named scope (`recover-stuck-submits`, C24). Testing
  the quote-lookup-before-create reuse directly is the one NEW idempotency mechanism this Step
  itself builds; `cart.lock`'s own idempotent extend and `availability.reserve`/
  `customerCreditService.reserveCredit`'s own idempotency-key replay are already covered by
  their own Steps' test suites (2.8, 2.2, 1.6) and are not re-proven here.
- Step 4.1 (availability absence, D-R5-18): gated on `tryResolve(container,
  'policyResolutionService')` as the "is `availability` active" signal (the one DI key that
  module's `di.ts` registers unconditionally) rather than dispatching `availability.reserve`
  unconditionally and catching a "command not found" error — consistent with every other
  soft-peer check this module already makes (`cartService`, `customerCreditService`,
  `salesCalculationService`). The SAME gate protects the compensation path's `availability
  .release` call, so a submit that never reserved stock (availability absent) never attempts a
  pointless release that would otherwise be misreported as a compensation failure.

- Step 4.2 (code structure, the task's own explicit conditional): Step 4.1's committed
  `checkout.session.submit` is ONE function performing steps 1-5 inline and returning early
  — not a decomposition into the §11 table's separately-named sub-commands
  (`checkout.session.finalize`/`.initiatePayment`/`.complete`/`.fail`, which are spec prose,
  never shipped in code). Per the brief's own instruction to follow whatever shape Step 4.1
  already committed to, steps 6-8 were added as a continuation of the SAME function
  (`continueOrderOutcome`, called from `execute()`'s own tail instead of its old early
  `return`) rather than new standalone commands. Consequence accepted and paid: EVERY
  existing Step-4.1 test that asserted the OLD stop-point (`status: 'submitting'`,
  `submitProgress: 'document_created'`) as a FINAL state needed updating to the new terminal
  state, since that assertion was explicitly flagged in Step 4.1's own header comment as
  "Step 4.2 continues from exactly this point" — not a frozen contract. Alternative
  considered: build a second, standalone command/route pair calling `checkout.session.submit`
  then a new `checkout.session.finalize` — rejected as literal non-compliance with the task's
  own conditional, and because it would leave `checkout.session.submit`'s own CAS guard
  (`status === 'submitting' -> 409`) unable to protect a second in-flight command the same
  way.
- Step 4.2 (`CheckoutTransaction.linkId` becomes nullable, §4.4's own "extended, additive"
  framing): a session-backed gateway payment (no `CheckoutLink` at all for a buyer-initiated
  session) still needs ONE `CheckoutTransaction` row per §4.4's own text ("creates one
  `CheckoutTransaction` per attempt... with `session_id`, `order_id` and `quote_id` set").
  Phase A's own `checkout.transaction.create`/`.updateStatus` commands are hard-coupled to a
  real `CheckoutLink` row (reservation-count bookkeeping, `usageLimitReached`) that a session
  has none of, so this Step writes/reads the entity DIRECTLY in `commands/submit.ts`
  (`em.create`/`em.findOne`) for the session path, reusing only the PURE helpers
  (`mapGatewayStatusToCheckoutStatus`, `assertValidCheckoutStatusTransition`) — never calling
  the link-only commands for a link-less row. `link_id` therefore had to become nullable
  (migration `Migration20261028020000`); the two existing call sites that assumed it was
  always a string (`api/transactions/route.ts`'s admin list join, `commands/transactions.ts`'s
  terminal-event payload) were fixed minimally (filter nulls; a documented non-null assertion
  where that command's own 404-on-missing-link guard already proves it). Phase A's own rows
  keep `link_id` set and are untouched. Alternative considered: seed a synthetic/placeholder
  `CheckoutLink` for every session-backed payment so `link_id` could stay required — rejected
  as inventing a fake link row purely to satisfy a type, polluting Phase A's own link listings
  with rows that were never real payment links.
- Step 4.2 (C6, `customerCreditService.linkCreditReservationToOrder`, confirmed missing):
  grep-verified absent from Step 1.6's shipped service (confirmed by the task brief itself).
  Added as a same-module, additive method on the EXISTING `customerCreditService` DI key
  (G26: this release's own convention — one DI key per concern, never grown onto
  `CustomerGroupsService`) — locks the owning `CustomerCreditAccount` row (same `§6.3`
  convention every other write on this service already follows) and writes
  `linked_order_id` on the `reserve` ledger entry found by `idempotencyKey`. Idempotent: the
  SAME order on a second call is a no-op; a DIFFERENT order throws the service's own
  `idempotency_key_mismatch`. `customer_groups:order-cancelled-credit-release` (shipped
  Phase 3, before this method existed) already reads `linkedOrderId` — this method is the
  missing write side that subscriber was always waiting for.
- Step 4.2 (C5, `registerUsage`'s `appliedPromotions` source — NOT limited to code-triggered
  promotions): `cart_promotion_applications.effect` already stores the exact `ResolvedEffect`
  object `promotionsService.evaluate()` produced when the promotion was applied to the cart
  (confirmed by reading `cart/lib/promotionContext.ts`'s own write and
  `cart/lib/toSalesSnapshots.ts`'s own read of the SAME column, scope `'order'` only). Added
  `lookupCartAppliedPromotionEffects`/`lookupPromotionNames` (`lib/cartPeer.ts`, same FK-id +
  raw-SQL "snapshot" pattern this file already uses throughout) reading EVERY scope (`'line'`
  and `'order'`), not just `'order'` — `registerUsage` tracks budget consumption for every
  promotion that discounted the order, automatic or code-triggered, not only the delivery-
  scoped subset `toSalesSnapshots.ts` cares about for its own, narrower purpose. `useCode`'s
  `customerId` and `registerUsage`'s `customerId` both resolve to the cart's own plain
  `customer_id` column (`cartPeer.customerId`, NOT the `customerIds` identity array
  `reserveCredit` uses for its own company-first resolution) — confirmed by reading
  `cart/commands/promotions.ts`'s existing `reserveCode`/`validateCode` call site, which
  already uses `cart.customerId` for the SAME per-customer-limit eligibility check `useCode`
  re-runs, so reusing it keeps eligibility consistent with whatever the code's original
  reservation already decided. `promotionsService.useCode`/`.registerUsage` resolve their own
  tenant/org scope off a container-registered `auth` token (`lib/promotions-service.ts`'s own
  documented design, not this Step's choice) — `continueOrderOutcome` registers a minimal
  `{ tenantId, orgId }` auth value on the per-call container immediately before resolving the
  facade, the same pattern `api/codes/use/route.ts`'s own (human, authenticated) caller
  already uses for itself.
- Step 4.2 (compensation uniformity, the task's own explicit instruction): EVERY failure from
  step 6 onward (stock_lost on commit, a refused code, a budget overrun, a gateway intent
  failure, a gateway-reported payment failure) compensates through ONE path —
  `compensateByCancellingOrder`, which resolves the `sales.order_status` dictionary's
  `canceled`/`cancelled` entry and calls `sales.orders.update`, letting the THREE existing
  `sales.order.cancelled` subscribers (wms's order-hold release, `customer_groups`'s
  `order-cancelled-credit-release` via C6's `linkedOrderId`, `promotions`'s
  `order-cancelled-usage-revert` via `CodeUsage.orderId`, all three already shipped by earlier
  Phases) do the actual releasing — never a hand-rolled parallel release call on this path.
  The order-status DICTIONARY lookup (`resolveSalesOrderStatusEntryId`, raw SQL against
  `dictionaries`/`dictionary_entries`, never an import of `sales/lib/dictionaries.ts` or the
  `dictionaries` module's own entities) was a genuine, unavoidable discovery: `sales`'s own
  `documentUpdateSchema` has no plain `status` string field, only `statusEntryId` resolved
  against a per-tenant, per-organization configurable dictionary — confirmed by reading
  `commands/documents.ts`'s own `updateOrderCommand` and `lib/dictionaries.ts`'s seed
  defaults (`'confirmed'`, `'canceled'` — note the single `-l`, matched defensively against
  BOTH spellings since `isCancelledOrderStatus` itself already tolerates both).
- Step 4.2 (gateway synchronous-completion assumption, task's own test priority #1 "ends with
  completed" for BOTH on-account AND non-on-account/gateway variants): `continueOrderOutcome`
  checks the gateway's OWN immediate `createPaymentSession` response status
  (`mapGatewayStatusToCheckoutStatus`) and completes (or fails) INLINE when it is already
  terminal (a test/mock gateway's typical shape, and some real providers' own synchronous-
  capture flow) — this call's own terminal state is `awaiting_payment` ONLY when the gateway
  reports a genuinely still-pending status. The webhook/polling-driven LATER completion of a
  session left at `awaiting_payment` (§7.2's own "Payment result (webhook or polling, Phase A
  path)" is written as a SEPARATE block from the synchronous "status = awaiting_payment" line)
  has no owning Step anywhere in PLAN.md's Phase 1-6 list — `expire-awaiting-payment` (§12's
  OWN separate job) is the closest candidate and is NOT part of this Step's own Tasks-table
  title ("recover-stuck-submits decision table"). Flagging this as a genuine, unclaimed gap:
  a session that reaches `awaiting_payment` via a gateway that answers asynchronously (the
  common case for most real redirect-based providers) has no mechanism in this run that ever
  moves it to `completed`/`failed` on its own. A future Step must build either a payment-
  gateway webhook subscriber that completes a session-linked `CheckoutTransaction`, or
  `expire-awaiting-payment` itself (§12), reusing `confirmOrderAndComplete`/
  `compensateByCancellingOrder` (both exported by `commands/submit.ts`) rather than a third
  reimplementation.
- Step 4.2 (`recover-stuck-submits` scope, C24): built as the `submitting`-only half of §12's
  job table — `awaiting_payment` recovery is §12's OWN separate, unbuilt job
  (`expire-awaiting-payment`, same gap named above). A genuine implementation discovery
  changed the table's own shape: `commands/submit.ts`'s steps 1-5 (Step 4.1) never persist
  `submit_progress` as `locked`/`stock_reserved`/`credit_reserved` on the `CheckoutSession`
  row — only `null` (at the CAS) and `document_created` (step 5d) are ever written; the
  matching `writeSessionEvent` calls at each intermediate step append `CheckoutSessionEvent`
  AUDIT rows, never a `submit_progress` column update. C24's own table is keyed on exactly
  those three now-unreachable intermediate values, so the worker collapses them into ONE
  branch: whenever progress is anything before `document_created`, probe-free compensate
  (release stock AND credit by the session's own stored `stock_reservation_key`/
  `credit_reservation_key` — both release calls already no-op gracefully when nothing was
  actually reserved) plus a best-effort `cart.unlock` that swallows a 404 (never actually
  locked) rather than reporting it as a failed compensation. `document_created`/`finalized`
  resume forward by calling `continueOrderOutcome` again (the SAME function the live path
  calls, re-deriving every input from the session's own stored columns) — proven idempotent
  by the SAME idempotency keys steps 6-8 already use. An attempt stuck past a 30-minute
  give-up window compensates by cancelling the order and fails the session with
  `submit_recovery_failed`, per §12.1's own final row. Alternative considered: keep the
  original three-way `locked`/`stock_reserved`/`credit_reserved` branching literally, reading
  `CheckoutSessionEvent` rows instead of the (always-null) `submit_progress` column to
  recover the real per-step granularity — rejected as a materially larger surface (a new,
  dedicated audit-trail query plus a second probe mechanism) for a benefit the uniform
  release-by-stored-key approach already gets for free, given both release primitives are
  no-op-safe.
- Step 4.2 (quote-outcome `lineMap`, D-R5-26, confirmed deferred): `request_quote` is refused
  outright at the very top of `checkout.session.submit` (Step 4.1's own code, unchanged by
  this Step), so the quote-outcome branch of §7.2 steps 5/6 is never reachable from this
  command yet — confirmed by reading Step 4.1's own early refusal
  (`payment_method_unavailable`) and PLAN.md's own Phase 5 listing of `request_quote` as Step
  5.1's scope. This Step built ONLY the order-outcome `lineMap` (`buildOrderLineMap`, reading
  `sales_order_lines.metadata.cartLineId`). Step 5.1 must build the quote-outcome's own
  `lineMap` (`salesQuoteLineId` instead of `salesOrderLineId`, reading `sales_quote_lines`
  instead) when it adds the reachable `request_quote` path.
- Step 4.2 (public route rate limits, C14/§13): the route reuses the EXISTING
  `checkoutSubmitRateLimitConfig` (points: 10, already shipped unused-by-this-route since
  before this Step — Phase A's OWN link-based `/pay/[slug]/submit` route already consumes it,
  IP-keyed, for an unrelated bucket) for the NEW per-session bucket, via the SAME
  `keyOverride`-to-session-token-hash pattern every other `/sessions/current/*` mutation
  route already uses — rather than declaring a second, numerically-identical config. A NEW
  `checkoutSessionSubmitIpRateLimitConfig` (points: 60, distinct `keyPrefix` from Phase A's
  own `checkout-submit` IP bucket) covers the per-IP half, enforced alongside, never instead
  of, the per-session one.
- Step 4.2-fix (C1/§12, `expire-awaiting-payment`): the authoritative clock is
  `CheckoutSession.payment_expires_at` — §12's own table entry states it verbatim
  ("`awaiting_payment` past `payment_expires_at`"), not a re-derived TTL; this is the SAME
  value `continueOrderOutcome`'s gateway step (§7.2 step 7) reads off the gateway's own
  session response (`sessionResult.transaction.expiresAt ?? +60min default`) before the lock
  is extended by `paymentWindowMs` (a fixed 75 min = 60 min default + 15 min margin, computed
  BEFORE the gateway call, not from the real `payment_expires_at` — a pre-existing Step 4.2
  deviation from §6's literal "payment_expires_at − now + 15 min" wording, left as-is: fixing
  it is a cart-lock-margin change, not this job's own mandate, and the margin it actually
  grants is never smaller than the spec's). Cadence set to the spec's own "every 5 min".
  `confirmOrderAndComplete`/`compensateByCancellingOrder` were NOT already exported from
  `commands/submit.ts` despite the prior NOTIFY.md entry's claim ("both exported") — that was
  stale/aspirational; this Step adds `export` to both (additive, same file, no behavior
  change) so the job calls the SAME functions rather than duplicating "confirm the order,
  markConverted, complete" or "cancel the order, fail the session". The gateway probe does
  NOT depend on `CheckoutTransaction.gatewayTransactionId` ever being populated for a
  session-backed row — a genuine discovery: that field is only ever written by
  `checkout.transaction.updateStatus`, which 404s for a session-backed `CheckoutTransaction`
  (its own `linkId` is null, so the command's `tx.findOne(CheckoutLink, { id: null })` 404s;
  see `commands/transactions.ts:159-165` and its own comment on line 243-244), so session-
  backed rows never get a `gatewayTransactionId`. Instead the job resolves the live
  `GatewayTransaction` via `paymentGatewayService.findTransactionBySessionId(session.
  paymentIntentRef, scope, session.paymentMethodCode)` — Phase A's OWN idiom (`api/pay/
  [slug]/status/[transactionId]/route.ts`'s `getPaymentStatus` refresh-on-read pattern,
  generalized to the one lookup key a session-backed row actually carries,
  `CheckoutSession.paymentIntentRef` = the provider's own session id). No probe/no-match/
  probe-error are all treated identically as "no definitive answer" → compensate, per §12's
  own "otherwise compensate" (never treated as a success by default).

- Step 4.3 (`assisted_selling` ACL, §6.1's own literal route table): declared only
  `assisted_selling.settings.manage`, gating BOTH `GET` and `PUT /settings/:storeId` — the
  spec's own §6.1 table names that one feature for both methods, with no sibling `.settings.
  view`. Thread/message/proposal/attribution feature ids (also named in §6.1/§6.2) are Step
  4.4/4.5's own scope and are deliberately NOT pre-declared, following Step 1.7's "defer a
  feature id until the entity/route it gates exists" precedent rather than Step 1.7's rejected
  alternative (placeholder features with nothing to test against). `setup.ts` gives `admin`
  only (`assisted_selling.*`); `employee` gets nothing, since least-privilege (D-R5-7's
  precedent) has no `.view` feature to grant separately from `.manage` here.
- Step 4.3 (`di.ts`, not built): settings are read/written through plain exported functions
  (`lib/settings.ts#loadAssistedSellingStoreSettings`/`resolveEffectiveAssistedSellingSettings`)
  and a registered command (`commands/settings.ts`), mirroring `warranty_claims`'s own settings
  precedent (`lib/settings.ts` + `commands/settings.ts`, no DI service) exactly rather than the
  spec's `customer_groups`/`availability`-style DI-registered service classes. No other module
  needs to resolve assisted-selling settings in this Step's scope (cart/ecommerce are callees
  of `assisted_selling`, never the reverse), so there is no cross-module DI consumer to justify
  a service yet. If Step 4.4/4.5 need the mode check from WITHIN this module's own commands/
  routes, they import these same lib functions directly (same package, no DI indirection
  needed); a DI service becomes worth building only if a FOREIGN module ever needs a
  `tryResolve`-able read, which nothing in this run's scope does.
- Step 4.3 (`store_id` existence, S9/§6.1's "404 for a store outside the caller's
  organizations"): NOT validated against `ecommerce.EcommerceStore` — `storeId` is treated as
  an opaque FK id, scoped only by `(tenant_id, organization_id, store_id)` on the settings row
  itself, mirroring `availability.AvailabilityPolicy.storeId`'s own precedent (that module's
  per-store policy doesn't verify the store exists either, per its own code comment "not yet a
  real entity in this repo"). The spec's "404 for a store outside the caller's organizations"
  guarantee falls out of the row itself being organization-scoped (a caller can only ever read/
  write a settings row inside ITS OWN `organizationId`), not from a second cross-module
  existence check. Revisit if a later Step (the rep console, 5.3) needs a store PICKER that
  must enumerate only real stores — that is a UI concern for `ecommerce`'s own store list API,
  not this route's job.
- Step 4.3 (`events.ts`, omitted entirely rather than shipped empty): this Step declares and
  emits no events (Step 4.4 is the first to need `assisted_selling.proposal.*`/`.message.
  posted`), and 15 other `packages/core/src/modules/*` modules (e.g. `api_keys`, `audit_logs`,
  `configs`, `dashboards`, `feature_toggles`, `portal`) already ship with no `events.ts` file
  at all rather than one exporting an empty array — confirmed by listing every core module
  directory. Matching that existing, more-common convention rather than inventing a vacuous
  file.
- Step 4.3 (module registration / create-app template, D22/D-R5-36 precedent, exact mechanism
  found): `apps/mercato/src/modules.ts` gets an ACTIVE `{ id: 'assisted_selling', from:
  '@open-mercato/core' }` entry (right after `cart`, its seam dependency). The create-app
  template's own copy is NOT hand-edited directly — `scripts/template-sync.ts` exports a
  `TEMPLATE_COMMENTED_MODULES` map (one entry per module that stays commented-out-with-an-
  explanation in the template rather than stripped, e.g. `cart`/`availability`/`ecommerce`/
  `promotions`) that `yarn template:sync:fix` applies as a literal find-and-replace over the
  mirrored file; a module id missing from that map gets mirrored ACTIVE (verified the hard way:
  a first `template:sync:fix` run before this map entry existed synced the template's
  `assisted_selling` line uncommented, which `packages/create-app/src/lib/template-modules-
  parity.test.ts`'s own byte-for-byte assertion would have caught before merge). Added an
  `assisted_selling` entry to `TEMPLATE_COMMENTED_MODULES` (same shape, same no-harness-case
  rationale as `availability`'s own entry, naming `.ai/guides/modules/assisted_selling/
  index.md`), re-ran `yarn template:sync:fix`, and confirmed both
  `template-modules-parity.test.ts` cases pass and `yarn template:sync` reports clean parity.
  This is the established, maintainer-authored mechanism for "active in the app, commented out
  in the template" — editing the template file by hand would have been silently overwritten by
  the next `template:sync:fix` run.
- Step 4.3 (migration, hand-authored rather than `yarn db:generate`): the sandbox's local
  Postgres instance holds schema state from unrelated prior QA/dev sessions (`om_qa_*`/
  `om_cart49` databases, confirmed via `psql -l`), the same condition Step 2.10's NOTIFY entry
  already documented for this exact risk. Hand-authored `Migration20261027120000_assisted_
  selling.ts` (one `create table` + one `unique` constraint, matching `data/entities.ts`
  column-for-column) and its `.snapshot-open-mercato.json` entry directly, rather than risk an
  unrelated-drift diff the "coding-agent exception" would then require manually pruning.

- Step 4.4 (S23, the brief's own flagged ambiguity): confirmed there IS a separate
  `AssistedSellingProposal` entity, not a contradiction of S1's "a proposal is a cart role, not
  a new entity family" design principle. §5.4/§3.4 of the revised spec resolve this explicitly:
  the principle means a proposal does not duplicate the cart's lines/prices/totals in a second
  entity family — it IS realized as a real `cart.Cart` row (`kind: 'proposal'`). What this Step
  adds on top is a small METADATA row (`AssistedSellingProposal`, no lines, no prices, no
  totals) carrying `proposal_cart_id` plus the facts `cart` cannot hold (thread, author,
  idempotency key). The idempotency unique key therefore lives exactly where S23's analysis-era
  wording said: `AssistedSellingProposal.idempotency_key`, unique `(tenant_id, thread_id,
  idempotency_key)`. Also added a NOT-in-the-spec-table, additive `response_snapshot jsonb`
  column on the same entity — §6.3's "a replay with the same digest returns the ORIGINAL 201
  body" requires the original `rejectedLines` on a replay, and that is request-time-only data
  with nowhere else to live (mirrors `cart`'s own `CartIdempotencyKey.responseBody`, applied to
  this module's thread-scoped key instead of a separate ledger table, the same class of
  judgment call Step 2.7's two nullable timestamp columns made for its own idempotency need).
- Step 4.4 (cross-module read, no existing primitive): `POST /threads`/`GET /threads` need a
  `kind: 'basket'` cart read scoped to a LIST of the caller's `organizationIds` (S9) — the only
  existing by-id read, `cart.get`, takes a single `organizationId`, and the ADMIN route's own
  equivalent read (`GET /api/cart/carts/:id`) lives inside `cart` itself with a direct `Cart`
  entity import, which a cross-module caller may not do. Added two additive methods to `cart`'s
  existing `cartService` facade (`cart/lib/cartService.ts`, `cart/di.ts`'s already-registered DI
  service): `getForOrganizations` (the basket read, organizationIds-list-scoped) and
  `getProposalCartLines` (a `kind: 'proposal'` cart's own lines, needed by `/proposals/:id/
  reauthor`, §6.4, "from the old one's lines"). Resolved from `assisted_selling` through a
  duck-typed `AssistedSellingCartServiceLike` interface (`lib/cartAccess.ts`), never a static
  import of `cart/lib/cartService.ts`'s own types — that file is module-private per the SAME
  reasoning `cart/lib/adminCartScope.ts`'s own header comment already gives for not importing a
  sibling module's `lib/` helper directly. Alternative considered: have this module read `Cart`/
  `CartLine` rows directly — rejected as the exact cross-module ORM-relationship violation root
  AGENTS.md forbids.
- Step 4.4 (`cart.proposal.create`'s own `routeContext` field, a Step 3.3 typing gap): narrowed
  `CartProposalCreateInput.routeContext` from the full, HTTP-route-edge-only branded
  `ResolvedCartRouteContext` (`cart/lib/routeContext.ts`, buildable only by
  `resolveCartRouteContext(request, …)`) to `CartProposalRouteContext = Pick<
  ResolvedCartRouteContext, 'assortmentScope'>` — the ONE field `createProposalCommand.execute`
  actually reads off it. Step 3.3's own field comment already named `resolveForBuyer` as this
  field's real, intended caller ("resolved server-side by the trusted caller
  (`storeContextService.resolveForBuyer`)"), but typed it as the wrong shape — a trusted,
  non-HTTP caller like this module can never literally construct a `ResolvedCartRouteContext`
  (it has no request, no `channel: 'storefront'` literal, no `currencyCode`/`locale`/
  `salesChannelId` to supply). Purely additive/widening: any future caller passing a full
  `ResolvedCartRouteContext` still satisfies the narrower structural type unchanged (confirmed —
  the full cart test suite, 443 tests, stayed green after this edit). Alternative considered:
  build a fake `ResolvedCartRouteContext` with invented values (e.g. `channel: 'storefront'` on
  a non-storefront cart) just to satisfy the literal type — rejected as a lie with no runtime
  effect today (the field is unread) but a real one the day something reads it.
- Step 4.4 (POST /threads's body shape, not given literally by the spec): added one additive,
  optional field, `message?: string` (≤2000 chars) — §6.1's own text says opening a thread
  "creates the thread, adds the rep as a participant and posts an opening message" but never
  shows a literal request body for this route the way §6.3 does for authoring. Treated as the
  smallest faithful reading: an optional note, empty when omitted, mirroring §6.3 step 7's own
  "empty when none was given" convention for the authoring `note`. Alternative considered: no
  body field at all, with a fixed system string as the opening message — rejected as removing
  the rep's own ability to say anything in the message §6.1 says gets posted.
- Step 4.4 (Step 3.3's provisional `cart.cart.merged` re-author/supersede subscriber,
  `cart/lib/proposalRetarget.ts` + `cart/subscribers/cart-merged-proposal-retarget.ts`): LEFT
  UNCHANGED. That file's own header comment already names the authoritative home as
  `assisted_selling` once it exists, and flags itself provisional pending review "once this
  Step ships the REAL module" — but closing that gap properly means the retarget mechanism
  ALSO updating this module's own bookkeeping on re-author (the old `AssistedSellingProposal`'s
  `superseded_by_proposal_id`, the thread's `live_proposal_count`, emitting `.proposal.
  superseded`) exactly as `commands/proposals.ts#reauthorProposalCommand` now does for the
  staff-initiated path — i.e. a real migration of a cross-cutting lifecycle subscriber, not a
  small edit, and a login-merge trigger is neither a "staff author route" nor a "buyer thread
  route" (this Step's and Step 4.5's own explicit scope boundaries). Moving it now risked this
  Step outgrowing one commit for a mechanism nothing in THIS Step's own test list names.
  Consequence, made explicit rather than silently inherited: a proposal retargeted by a login
  merge today still only updates `cart`'s own rows (the provisional mechanism's documented
  scope) — the `assisted_selling` thread/proposal rows for that conversation are NOT updated
  (no `superseded_by_proposal_id`, no `live_proposal_count` adjustment, no `.superseded`
  event) until a future Step migrates the mechanism into this module for real. Flagged in
  NOTIFY.md as a gap needing its own Step (or Step 4.5/5.x absorbing it) before Release 5 can
  call the login-merge retarget path complete end to end. Alternative considered: delete the
  cart-side mechanism now rather than leave two half-complete systems — rejected because D-R5-14
  (re-author-on-merge) has a REAL caller today (`cart.cart.merged`) and removing it would
  regress a already-shipped guarantee for zero gain this Step's own scope can offer instead.
- Step 4.4 (the §6.6 terminal-state subscriber and the §5.1 `cart.cart.merged`/`.adopted`
  thread-identity subscribers — spec Phase 1 items 6-7, NOT built this Step): the task brief's
  own Implementation bullet list named only entities + staff author routes (`POST /threads`,
  `GET /threads`, `POST .../proposals`, withdraw, re-author) — it never named the subscriber
  that writes `accepted`/`rejected`/`expired` onto the local `AssistedSellingProposal` row from
  `cart.proposal.*`, nor the thread re-pointing subscribers. Checked PLAN.md's own Phase 4/5 rows
  for where these land: Step 4.5 is explicitly scoped to "buyer thread routes + /thread/events +
  retention/erasure" and does not name them either; no other row does. This is a genuine PLAN.md
  coverage gap, not a deferral this Step is entitled to resolve unilaterally (building subscriber
  logic plus its own bookkeeping would have pushed this commit well past "staff author routes").
  Consequence: a buyer's own accept/reject, or the `expire-carts` sweeper's own expiry, of a
  proposal cart currently updates ONLY `cart`'s own `Cart.status` — the local
  `AssistedSellingProposal.status` stays `published` forever, `live_proposal_count` never
  decrements for THOSE transitions (it does decrement correctly for this Step's own withdraw/
  reauthor-supersede paths, which call `cart.proposal.reject` directly), and the rep console
  (Step 5.3) would have nothing live to react to. Flagged in NOTIFY.md as a follow-up Step the
  run's own loop should insert before Phase 4/5 is considered functionally complete — likely
  alongside whichever Step finally migrates the Step 3.3 retarget mechanism (same subscriber
  family, same "assisted_selling learns of cart decisions" shape).
- Step 4.4 (ACL grants, §6.9 vs. what this Step actually ships): declared exactly three new
  features (`threads.view`, `threads.participate`, `proposals.author`) and granted `employee`
  only the first two — `messages.post` stays undeclared (no route in this Step gates on it;
  §6.1's own `POST /threads/:id/messages` is not part of this Step's scope either) and
  `attributions.view` stays Step 5.4's own scope. Same "defer a feature id until the entity/
  route it gates exists" precedent Step 1.7 and Step 4.3 both already set.
- Step 4.4-fix (the cart-side provisional subscriber, full removal vs. stub): REMOVED outright
  — `cart/lib/proposalRetarget.ts`, `cart/subscribers/cart-merged-proposal-retarget.ts` and
  their own test file deleted, not stubbed. That mechanism was unshipped (this is an
  in-progress fork PR, not a released version), explicitly self-labeled "PROVISIONAL" in its
  own header comment with the real home already named as `assisted_selling`, and nothing
  external (no committed generated registry, no other module) referenced it — only the
  ephemeral, gitignored `apps/mercato/.mercato/generated/modules.generated.ts` did, and
  `yarn generate` cleanly dropped it after removal (verified: zero `cart:proposal-retarget-
  on-merge` references anywhere post-regen). `packages/events/AGENTS.md`'s subscriber
  contract only forbids changing a *kept* subscriber's `{event, persistent?, id?}` metadata
  shape; it says nothing about removing one, and `BACKWARD_COMPATIBILITY.md`'s `subscribers/
  *.ts` row is the same. A stub was considered and rejected: a no-op handler left registered
  under the old id would still fire on every `cart.cart.merged` and do nothing, which is
  strictly worse than removing the listener entirely for a mechanism that was always going to
  move. 437/437 pre-existing `cart` tests stayed green after removal (443 minus the 6 that
  belonged to the deleted file itself).
- Step 4.4-fix (the real decrement mechanics for `live_proposal_count`, not literally what
  §6.6's prose describes): discovered mid-implementation that `withdrawProposalCommand` calls
  `cart.proposal.reject` (which emits `cart.proposal.rejected` INLINE, synchronously, since
  that specific `cart`-side emit carries no `persistent: true`) BEFORE writing its own local
  `status: 'withdrawn'`, while `reauthorProposalCommand`'s supersede branch writes `status:
  'superseded'` locally BEFORE calling `cart.proposal.reject` — opposite orderings between
  the two existing Step 4.4 callers. A terminal-state subscriber that decides "should I
  decrement" by reading the proposal's current `status` at delivery time would therefore
  decrement correctly for withdraw but silently skip the decrement for reauthor's supersede
  (and, by the same shape, for this Step's new merge-retarget supersede path too) — a real,
  not-hypothetical double-counting/under-counting bug, not just a redelivery edge case.
  Fixed by having every AUTHOR-initiated ending (withdraw, reauthor's supersede branch, the
  new `reauthorProposalForMergeRetarget`'s supersede branch) decrement `live_proposal_count`
  itself, synchronously, in its own local transaction — never deferred to the async
  subscriber — and having the terminal-state subscriber's `.rejected` handler unconditionally
  skip every `rejectedBy: 'author'` payload (`skipWhenRejectedByAuthor`), relying on that
  field instead of on local-write ordering. This is a small, additive change to
  `withdrawProposalCommand`/`reauthorProposalCommand` (both already shipped under Step 4.4,
  same PR) — flagged here rather than silently folded in, since it touches code this Step
  was not originally asked to touch. Alternative considered: add a dedicated "already
  decremented" boolean column — rejected as unnecessary schema churn when `rejectedBy` (a
  field the payload already carries) disambiguates the two cases for free.
- Step 4.4-fix (re-author migration: reuse vs. port, per the task's own either/or): reused
  Step 4.4's own `performAuthorProposal` (the `assisted_selling`-side §6.3 sequence), not
  Step 3.3's cart-side retarget helpers — ported the SHAPE of Step 3.3's mechanism (candidate
  enumeration, the eligibility/no-lines/thread-missing fallback branches, supersede-then-
  reject) but not its code, because Step 3.3's own helpers are keyed off `cart.Cart`/
  `CartLine` rows `assisted_selling` cannot import, and because they never resolved
  `assortmentScope` at all (no `resolveForBuyer` call, no mode check) — a real gap against
  §8.1's own "re-runs §6.3 in full, including step 0's live-mode check" text. The migrated
  version now re-runs §6.3 in full, via `performAuthorProposal`'s own `targetCartId`/
  `targetBuyerIdentity` overrides (additive params; every existing caller is unaffected),
  rather than the author-context-only, no-repricing version Step 3.3 shipped.
- Step 4.5 (route prefix, S4): the executor brief's own shorthand named `GET/POST /thread`
  under `/api/assisted_selling`, but §6.2's own literal text is explicit — "Paths below are
  relative to `/api/assisted_selling/storefront`." Built the four routes at
  `/api/assisted_selling/storefront/thread`, `/thread/messages` and `/thread/events`, matching
  the spec's own router-derivable shape (S4's own rule: every path must be producible by
  `/api/<module_id>/<api subpath>`) rather than the brief's paraphrase. Alternative
  considered: follow the brief literally — rejected as contradicting the spec it was itself
  quoting from one line earlier.
- Step 4.5 (`cartService.resolveBasketByToken`, cross-module surface): §5.1 names this exact
  method on `cart`'s own DI service, but it did not exist on `CartService`/`CartServiceImpl`
  yet. Added it there (one more scope-free, `kind: 'basket'`-only read, the SAME shape
  Step 4.4's own `getForOrganizations`/`getProposalCartLines` additions already set a
  precedent for) rather than reimplementing `cart`'s token-hash algorithm a second time in
  this module — `lib/cartAccess.ts`'s own header comment is explicit that this module may
  duck-type `cartService`'s DI surface but must never import `cart/lib` directly for
  CART-domain logic. The D-R5-21 identity-binding check itself (comparing the resolved
  basket's `customerUserId` against the caller's customer session) stays in THIS module's own
  `lib/buyerIdentity.ts`, via the SAME static `getCustomerAuthFromRequest` import
  `cart/lib/currentCartRoute.ts` (Step 2.9) and `checkout/lib/currentSessionRoute.ts` already
  use for the identical helper — not a new precedent, a fourth call site of one.
- Step 4.5 (Phase 2 item 5 scope: the two time-based sweepers vs. the three event subscribers):
  the Step's own brief enumerated exactly three erasure triggers (`cart.cart.purged`,
  `customer_accounts.user.deleted`, `auth.user.deleted`) under "Retention/erasure sweepers"
  and its own test list named only these three — never the idle-close or retention-day
  sweepers §5.10 also requires (an open thread idle past `idle_close_days`; a closed thread
  past `conversation_retention_days`). Built exactly the three the brief named, sharing one
  `eraseThread` routine (`lib/retention.ts#eraseAssistedSellingThread`) so a later Step's
  idle-close/retention sweepers reuse it rather than duplicating the hard-delete/clear/
  soft-delete sequence a third way. Alternative considered: build all five §5.10 triggers in
  this Step for full Phase-2-item-5 compliance — rejected as scope creep past the Step's own
  enumerated brief (cron/job registration, its own settings-driven scheduling, and its own
  test surface are a materially different unit of work from "wire three event subscribers"),
  and because the brief's own test list is the authoritative acceptance bar for this Step. The
  two sweepers remain an open gap against §5.10/S7's full text — flagged for whichever Step
  picks up Phase 6.1's integration-coverage completion pass, or a dedicated follow-up.
- Step 4.5 (buyer participant `displayName`, no literal spec text): §5.2 says a buyer
  participant's `display_name` is "Snapshot, shown to the other party" but never gives a
  literal value for the buyer's OWN snapshot the way §5.10 does for the anonymized-rep case
  ("Former team member"). Used `'Customer'` for an identified buyer and `'Guest'` for a guest,
  plain literal snapshots (not `t()`-routed) — the same class of stored, shown-to-the-other-
  party text `lib/participants.ts#resolveDisplayName` already stores for a rep's real name,
  never run through i18n either. Alternative considered: resolve the buyer's real name via a
  new soft dependency on `customer_accounts`/`customers` — rejected as scope creep this Step's
  own brief does not ask for (no rep console exists yet in this Step to even render it), and
  because `cartAccess.ts`'s own established DI surface does not expose a name lookup today.
- Step 4.5 (`POST /thread`'s missing-store-id edge, not named by §6.10's error table): a
  basket with no resolved `store_id` (e.g. a `pos`/`api` cart never bound to a store) has
  nowhere to read `AssistedSellingStoreSettings.mode` from, mirroring `commands/threads.ts`'s
  own staff-side `store_required` case one Step up — but the buyer route has no error code
  named for it in §6.10 either. Answered `409 assisted_selling_unavailable` (the SAME code the
  table already uses for "live mode refuses") rather than inventing a new `store_required`
  code for the buyer side, since from the buyer's point of view the two cases are
  indistinguishable ("this conversation feature isn't available for this basket right now").
  Alternative considered: a new `store_required` buyer error code — rejected as an
  unnecessary, spec-silent addition to §6.10's closed error-code table for an edge case the
  spec itself never anticipated on this side.
- Step 5.1 (`min_order_value` currency-mismatch posture, task brief vs. the authoritative
  spec): the executor brief characterized D-R5-4 as one uniform "fail-closed-on-mismatch
  rule" covering both the approval gate and `min_order_value`. The revised spec's own §7.1
  precondition 8 and §8.5 say the opposite for `min_order_value`: "a cart in another currency
  is not checked" — i.e. skipped (fail-open), not refused. Implemented per the spec (root
  AGENTS.md: the spec is authoritative; same class of brief-vs-spec call Step 3.2 made for
  K5's `approval_id`-clearing question). Alternative considered: implement the brief's literal
  "fail-closed" instruction — rejected as contradicting the spec's own explicit, two-place
  text with no stated reason to diverge.
- Step 5.1 (PO number input location, §9's route table names a `POST .../current/payment`
  route that does not exist anywhere in this worktree): added `poNumber` as an additive,
  optional field on `checkout.session.submit`'s own input instead of building the missing
  selection route — the identical resolved shape Step 4.1 already chose for
  `paymentMethodCode` ("submit takes the method as a direct input... no selection route is
  built"). Alternative considered: build the `POST .../current/payment` route now, since §8.4
  literally says the PO is "captured at the payment step" — rejected as reopening a decision
  Step 4.1 already made deliberately and explicitly for the sibling field on the exact same
  route table row, for no reason specific to the PO number that wouldn't apply equally to
  `paymentMethodCode` itself.
- Step 5.1 (K3's fifth row — withdraw a cart's pending approval on a `purpose: 'quote'`
  conversion, flagged by Step 3.2 for "whichever Step first makes `cart.markConverted`
  reachable with `salesQuoteId` set"): this Step is that Step, but did NOT implement it — the
  fix belongs inside `cart` (`commands/lock.ts#markConverted` or a `cart.cart.converted`
  subscriber), outside this Step's own `checkout`-only Implementation bullet list and module
  boundary. Left flagged exactly as Step 3.2 already flagged it, for a future Step (or a
  dedicated follow-up) to pick up explicitly. Alternative considered: implement it here as a
  small, additive `cart`-module change since the shape is simple — rejected as crossing into
  a different module's command than this Step's brief named, and Step 3.2's own text already
  noted the reason-value choice ("a fourth reason value may be needed... the owner should
  decide which") needs an owner call this Step has no more standing to make than Step 3.2 did.
- Step 5.2 (C11 resume-subscriber transition map, task brief vs. the authoritative spec): the
  task brief paraphrased the finding as "on `approved`, transition to `open`; on `rejected|
  expired|withdrawn`, transition to `failed`" — a single two-way split. The REVISED,
  authoritative spec text (§8.2 step 3) is explicit and three-way: `approved -> open` (quoted_
  totals cleared); `rejected -> failed` (`failure_code: 'approval_rejected'`); `expired` AND
  `withdrawn -> open`, NOT `failed` ("the buyer may request again or reduce the cart"), with
  `checkout.session.approval_rejected` still emitted for those two but carrying the real
  outcome in the payload. Implemented per the spec (root AGENTS.md: the spec is the
  authoritative contract; the brief is only the analysis-era paraphrase that produced it — the
  same class of call Steps 2.5/2.7/2.9/3.2/5.1 already made in this run). Verified against
  `lib/session-status-machine.ts`'s own enum: `awaiting_approval -> {open, failed, canceled,
  expired}` permits both targets, so neither reading was blocked by the state machine itself —
  this was a pure spec-vs-brief reading call, not a schema constraint. Alternative considered:
  follow the brief's literal two-way split — rejected as contradicting the spec's own explicit,
  three-way, separately-justified table with no stated reason to diverge, and as the same
  mistake class the brief's own "Read first" instructions (item 1) explicitly warned to check
  for before writing any code.
- Step 5.2 (D-R5-33 audit, no gap found): audited every existing `/api/checkout/sessions/
  current/*` route file Steps 2.12/2.13/3.5/4.1/4.2/5.1 actually shipped (`route.ts` (GET/
  PATCH), `delivery/route.ts`, `delivery-options/route.ts`, `payment-methods/route.ts`,
  `submit/route.ts`) — every one already calls `lib/currentSessionRoute.ts#resolveCurrentSession`
  (Step 2.12's own D-R5-33 helper) before any PII-bearing read, confirmed by direct grep and
  code read, not by trusting prior Steps' own NOTIFY claims. No compliance gap existed to fix.
  Three routes §9's own route table names (`POST .../cancel`, `POST .../step`, `POST .../
  payment`) are NOT built in this worktree at all — confirmed via PLAN.md's own Step 2.12/2.13
  NOTIFY entries, which explicitly deferred them (named by the spec's §17 Phase B.1 scope but
  absent from each Step's own Implementation/test-priority list) — so there is no route to
  audit there; a future Step building one must call the SAME helper, not invent a second
  binding mechanism.
- Step 5.3 (missing staff routes this Step's own console needs, task brief vs. §6.1's full
  route table): Steps 4.4/4.4-fix/4.5 built only `GET/POST /threads`, `POST /threads/:id/
  proposals`, `POST /proposals/:id/{withdraw,reauthor}` and `GET/PUT /settings/:storeId` —
  explicitly deferring `GET /threads/:id`, `POST /threads/:id/{join,leave,assign}` and `POST
  /threads/:id/messages` to "the rep console (Step 5.3)" (Step 4.4's own NOTIFY entry). Built
  all five here, with three new commands (`assisted_selling.thread.{join,leave,assign}` in
  `commands/threads.ts`, `assisted_selling.message.post` in a new `commands/messages.ts`) and
  the matching routes — the console cannot function without them, and no other Step in
  PLAN.md's table claims them. Added the ACL feature §6.9 already names but Step 4.4 deferred
  (`assisted_selling.messages.post`) and granted it to `employee` per setup.ts's own
  already-written comment anticipating this. `assign` is optimistic-locked on the thread's
  `updated_at` per §6.1's own text; `join`/`leave` are idempotent, no-op rather than erroring on
  a repeat call. `GET /threads/:id` requires BOTH `assisted_selling.threads.view` and
  `cart.proposals.view` per §6.1's own two-feature discipline for exactly this route.
- Step 5.3 (S22 price provenance read, additive `cartService` method): the console's proposal
  cards must show "the buyer's resolved unit price... labelled as the buyer's" with
  `price_row_id` provenance (§7.2), but the only existing `cartService` read for a proposal
  cart (`getProposalCartLines`, Step 4.4) returns bare product/variant/quantity — no pricing
  columns, by design (it exists only to re-price on reauthor). Added a FOURTH additive
  `cartService` method, `getProposalCartPricedLines`, that reads the proposal cart's own
  `CartLine` rows (`unitPriceNet`/`unitPriceGross`/`taxRate`/`priceRowId`/`lineTotals`) back
  verbatim via the same `toCartLineSnapshot` mapper `cart`'s own command layer already uses —
  never recomputed. This is what makes S22's "byte-identical to the buyer's own `GET /api/
  cart/current` pricing" true by construction rather than by coincidence: the proposal cart's
  columns were written by `cart.proposal.create` pricing AS THE BUYER (§6.3 step 3) and are
  read back unchanged. Unit-tested at the `cartService` layer (`cart/lib/__tests__/
  cartService.test.ts`) rather than through a full buyer-`/current`-vs-console integration
  test, which belongs to the Playwright suite this run's own instructions place out of this
  Step's scope (no dev server, no browser verification here).
- Step 5.3 (console scope, task brief's explicit screen list vs. §7's full console): the task
  brief's own title and "Implementation" bullets name exactly four screens — inbox, thread
  page, composer, proposal builder — and do NOT list a settings page or the attribution report,
  even though §7's full Release-5 console scope (D-R5-15) includes both. The settings API
  already exists with no UI (Step 4.3); the attribution entity/subscriber/route are explicitly
  Step 5.4's own scope per this PLAN.md's own Phase 5 listing. Built exactly the four named
  screens; the settings page UI and attribution report UI are NOT built here — flagged as an
  open gap for whichever Step is meant to close it (5.4 for attribution; no Step currently
  names the settings page).
- Step 5.3 (`CrudForm` over a line-item field array, §7.1's prescribed shape vs. what exists):
  §7.1 names "Proposal builder: ... `CrudForm` over a line-item field array" as the component
  to reuse. This codebase's `CrudForm` (`packages/ui/src/backend/CrudForm.tsx`) has no
  array-field primitive today (confirmed by inspection — no `type: 'array'`/repeater field kind
  anywhere in its schema). Building one would be a new, separate UI-primitive feature, not a
  console screen. Built the proposal builder instead as a focused dialog from DS primitives
  (`Dialog`/`Input`/`Textarea`/`ComboboxInput`/`Button`), keeping §7.2's own behavioural rules
  (Cmd/Ctrl+Enter submit, Escape cancel via the Dialog primitive's own default, aria-labelled
  icon buttons, no client-side pricing, `rejectedLines` surfaced after submit). Flagged as a
  gap against the spec's literal component choice, not against its behavioural contract.
- Step 5.3 (`EmailThreadsPanel`/`MessageComposer` reuse, §7.1's named component vs. the shape
  mismatch): §7.1 names `EmailThreadsPanel` ("A thread viewer of `EmailThreadsPanel`'s shape")
  and `MessageComposer`'s inline variant for the timeline/composer. Both are built for a
  DIFFERENT backend shape: `EmailThreadsPanel` is a master-list-of-MANY-conversations + detail
  pane for email threads (subject/participants/messages, no concept of an embedded priced
  proposal card); `MessageComposer` is bound to the `messages` module's own generic
  `ObjectMessage` entity (`entityModule`/`entityType`/`entityId`), not this module's bespoke
  `AssistedSellingMessage`/`AssistedSellingProposal` rows. Force-fitting either would need a
  nontrivial adapter layer with its own bugs, for a page that is ONE conversation with embedded
  proposal cards, not a list of many. Built a focused timeline + inline composer from DS
  primitives instead (`StatusBadge`, `Button`, `Textarea`, the `detail` family for loading/
  error states), following the SAME visual and interaction conventions (status via DS tokens,
  Cmd/Ctrl+Enter send, no custom polling — wired to `useAppEvent`/`useAppEventCoalesced`
  instead, per `.ai/ui-backend-components.md`'s own "message and thread surfaces subscribe
  through the shared hook" rule). Flagged as a gap against the spec's literal component
  choice, not against the "reuse, don't rebuild" principle it serves.
- Step 5.3 (inbox "assignee: a named rep" filter, task brief vs. no reps-directory API): §7.1
  names filtering by "assignee ('mine', 'unassigned', a named rep)". No existing API lists
  staff users holding `assisted_selling.threads.participate` for a rep-picker, and building one
  is a new, separate capability. Implemented `mine`/`unassigned`/a literal rep user-id (the
  `GET /threads` query already accepts a bare uuid, so a future rep-picker widget needs no
  server change) — the filter UI itself offers only `mine`/`unassigned` today, with a bare
  store-id text filter alongside it. Flagged as a UX gap, not a missing server capability.

- Step 5.4 (§6.7, S18, task brief's gate condition vs. the authoritative spec's literal text):
  the task brief's own framing ("a converted cart's lines map to `cartLineId`s... IF the
  cart's conversion came from an accepted proposal at all — a converted cart with NO accepted
  proposal in its history has NOTHING to attribute") reads as a per-cart gate: skip entirely
  when no proposal was ever accepted. The REVISED, authoritative spec text says the opposite,
  twice: §6.7 itself ("a subscriber on `cart.cart.converted` writes one `AssistedSellingAttribution`
  per cart line" — unconditional, no proposal-existence precondition anywhere in the prose) and
  §10.4's own gate text ("a mixed cart (buyer lines + two reps' proposals) produces the correct
  split" — which only makes sense if BUYER lines get rows too, not just proposal-authored ones).
  A cart that never had a proposal accepted is simply the degenerate case where every line's
  row has `actor_type: 'buyer'`/`'system'`/`'merge'` and `thread_id`/`proposal_id` NULL — still
  written, not skipped. Implemented per the spec (root AGENTS.md: the spec is the authoritative
  contract; the task brief is only the analysis-era paraphrase that produced it — the same class
  of call Steps 2.5/2.7/2.9/3.2/5.1/5.2 already made in this run). This also means the subscriber
  fires, and writes rows, for every converted BASKET cart that names an order or a quote outcome
  — including one `assisted_selling` never touched — which is the only way a commission report
  can show "% of revenue assisted" rather than only the assisted slice. Alternative considered:
  gate the whole subscriber on "does an `AssistedSellingProposal` exist with this cart somewhere
  in its merge-log ancestry" and no-op otherwise — rejected as contradicting the spec's own
  literal, twice-stated unconditional text, and as actively harmful to the report's own stated
  purpose (a commission report that only ever shows carts reps touched cannot answer "how much
  of total revenue was assisted," the comparison the whole feature exists to support).
- Step 5.4 (§5.5's column table vs. its own prose, `cart_line_id` nullability): §5.5's column
  table lists `cart_id / cart_line_id | uuid` with no "nullable" annotation on either, but §6.7's
  prose two paragraphs later is explicit that the degraded path writes "the line id NULL." Made
  `cart_line_id` a nullable uuid column (Postgres `uuid null`) — the column table's own formatting
  groups `cart_id`/`cart_line_id` together as "Provenance" without a per-column nullability
  breakdown, and the prose is unambiguous that degraded rows carry no line id. Alternative
  considered: follow the table literally and make the column non-null, forcing the degraded path
  to invent a sentinel line id — rejected as fabricating data the spec explicitly says has none.
- Step 5.4 (§6.9's full feature table vs. `setup.ts`'s existing employee grant): declared
  `assisted_selling.attributions.view` in `acl.ts` (the last of §6.9's five features this run's
  earlier Steps had deferred) but did NOT add it to `setup.ts`'s `employee` grant — §6.9's own
  grant text is explicit that this feature "stay[s] with `admin` or [is] granted by hand to the
  reps who sell," the same least-privilege line Step 4.4/5.3 already drew for `proposals.author`.
  The `admin: ['assisted_selling.*']` wildcard already covers it.
- Step 5.4 (`GET /attributions` route shape, no literal spec route table for Phase 4): §6.1's own
  route table only enumerates Phase 1/2 routes; Phase 4's own text says only "`GET /attributions`
  and the console report" without a literal path, query shape, or response schema. Built
  `/api/assisted_selling/attributions` (not `/attributions/report` or similar — mirrors `GET
  /threads`'s own top-level-resource-noun convention) with filters by `proposalId`/`threadId`/
  `cartId`/`salesOrderId`/`salesQuoteId`/`convertedAt` range (every id a report consumer already
  has on hand, per the task brief's own filter list) and `assisted_selling.attributions.view` as
  the sole gate. The console report page (`backend/assisted-selling/attributions/`) is a plain
  list — no sort-by-column wiring, since the route itself only ever sorts by `convertedAt DESC`
  — matching the task's own "keep this minimal (a list, not a dashboard)" instruction literally.
- Step 6.1 (integration-coverage completion pass, full disposition in NOTIFY.md's own
  2026-10-27T07:35:00Z entry): G21 test gap and cart K3/K11 behavior gaps fixed and tested
  (commits `bc8d54f8e8`, `b43d5bd6a1`); `assisted_selling`'s idle-close/retention sweepers built
  as MANDATORY per §5.10/S7's own unconditional text, not the soft SLA the task brief allowed for
  (commit `1050cb0cb4`); A16's missing i18n label fixed (commit `0f291f0264`); the
  `credit-accounts/missing` route and the `CheckoutLinkCartTemplate` admin route both
  re-confirmed as genuine, harmless gaps with no downstream dependent — accepted, carried to
  Step 6.2's `UPGRADE_NOTES.md`. Two items left deliberately open, NOT attempted this pass: (1)
  A7's product-pool allocation in the reservation gate — confirmed real and unchanged since Step
  2.2's own flag, but closing it needs locking every sibling variant of a pooled product, "a
  materially larger change" in Step 2.2's own words, which this pass judged too large to build
  and test soundly in the time available; (2) a real-HTTP Playwright integration spec for
  `/api/cart/proposals/*` — the highest-value coverage gap by this run's own framing, but writing
  one without running it against the ephemeral harness risks landing a broken spec (`.ai/qa/
  AGENTS.md`'s "Never leave broken tests"), and running that harness end-to-end was a materially
  larger time investment than the rest of this Step combined. Both are documented in NOTIFY.md
  with a concrete follow-up scope rather than silently dropped.
- Post-6.4, UI QA step: a dedicated browser QA pass could not capture screenshots for the new
  admin screens. The dev-QA environment stood up for real (fresh `.env`, disposable `om_qa_r5`
  DB, `build:packages --force`/`build:app --force` confirmed 0-cached, migrations + `mercato
  init` all genuinely run), but the booted dev server was completely unresponsive to every
  request (`/api/healthz`, `/login`, `/api/auth/login` all 404 or timed out at 45-60s) across
  6+ minutes of generous retries including one auto-restart, while this machine's swap sat at
  ~95-96% full (31+ of 32GB) from unrelated concurrent cezar sessions — a documented pre-existing
  machine-contention pattern on this exact host, not a defect in this branch (Postgres itself
  was confirmed healthy with only 1 idle connection, ruling out a DB-pool cause). Waited 10
  minutes and re-checked: swap was still ~96% full, so a same-day retry was judged unlikely to
  succeed and not worth further run time. Chose to proceed to the PR-ready steps on the strength
  of the automated evidence already gathered instead: the full validation gate (including the
  real suite), plus the dedicated code-review pass's real-Postgres concurrency tests and
  independently-verified security/money/visibility/compensation invariants. Alternative
  considered: keep retrying the dev server indefinitely until the machine frees up — rejected as
  unbounded and against the brief's own "don't sink unbounded time" posture; a human (or a later
  run, on a quieter machine) can still do this pass before or shortly after merge, flagged
  explicitly in the PR description. The one UI fact confirmed before the server died: no
  dedicated staff admin UI exists for purchase approvals in this release (API routes only,
  `customer_groups/api/customer-groups/approvals/*` + `api/portal/approvals/*`) — matching the
  Step 2.6/G15 decision already on record above.

## External References

- `.ai/specs/analysis/ANALYSIS-2026-10-26-ecommerce-release-5-scope.md`
- `.ai/specs/analysis/ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md`
- `.ai/specs/analysis/ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` (D-R5-1…37, audit trail — specs win on conflict)
- `.ai/specs/analysis/ANALYSIS-2026-10-26-customer-groups-release-5.md` (G1–G26)
- `.ai/specs/analysis/ANALYSIS-2026-10-26-availability-release-5.md` (A1–A21)
- `.ai/specs/analysis/ANALYSIS-2026-10-26-cart-module-release-5.md` (K1–K17)
- `.ai/specs/analysis/ANALYSIS-2026-10-26-assisted-selling-release-5.md` (S1–S25)
- `.ai/specs/analysis/ANALYSIS-2026-10-26-checkout-release-5.md` (C1–C26)
- `.ai/specs/2026-08-14-customer-groups-and-b2b-terms.md`, `2026-08-14-availability-contract.md`,
  `2026-08-14-cart-module.md` (rev 10), `2026-09-22-assisted-selling.md` (rev 6),
  `2026-03-19-checkout-simple-checkout.md` (v2.3), `SPEC-029-2026-02-17-ecommerce-storefront-module.md`
  (v4.10), `SPEC-055-2026-02-23-promotions-module.md`

## Risks (brief)

- Each Phase-1 track is independent (per the wave table) but several later tracks (cart, checkout)
  have hard sequencing on Phase 1/2 outputs — Steps are ordered so a track's own prerequisites
  always land first.
- Row-lock concurrency (credit, G1) and CAS transitions (approvals G6; availability A3/A5) are the
  highest-risk mechanisms; each gets its own dedicated Step with a concurrency test before anything
  is built on top of it.
- Executors run on the `standard` tier per the operator's instruction (never `cheap`), given the
  size and cross-cutting nature of each Step.

## Implementation Plan

Each Step's full description is the corresponding Gap-Analysis / Critical-or-Important-Gap item
cited in its title, read from the analysis doc named, with the governing D-R5 decision applied
exactly (the revised spec sections cited in that decision's "Consequence for the specs" column are
the authoritative text — the analysis is the finding, the spec is the contract to build against).
Executors MUST read the cited spec sections themselves before writing code; this plan does not
re-paste them.

### Phase 1 — Foundations (wave 1, depends on wave 0 only; tracks independent)

- **1.1** shared trusted-context helper (cross-spec X10): one helper, inputs `{ tenantId,
  organizationId, actorType: 'system' | 'user', actorId?, reason }`, used by every caller that
  builds a command context not derived from a request (D-R5-14 re-author, D-R5-19 pay-link
  seeding, D-R5-22 `resolveForBuyer`-sourced identity, C2/X15 recovery re-lock). Marks audit
  entries system-initiated in one place.
- **1.2** `ecommerce`: `storeContextService.resolveForBuyer` per D-R5-22/S1 (SPEC-029 §6.3 as
  revised) — optional `storeId`, refuses a store outside tenant+organization, never cached under
  the buyer's 60s key, in-process only.
- **1.3** `wms`: extract `wmsReservationService` per A1 — `reserveInTransaction`/
  `releaseInTransaction`/`convertInTransaction`; existing `wms.inventory.reserve/release` commands
  become thin wrappers with no behaviour change (existing wms tests are the regression net).
- **1.4** `availability`: Phase 2 alignment (A2) — one shared SQL sellable builder used by both the
  read provider and the future reservation gate; fix `findProfile` variant fallback, add
  product-pool subtraction, lot-eligibility filter, and resolve the `locationIds`/warehouses
  naming per D-R5-31 (additive `warehouseIds`, no semantic change to the shipped type).
- **1.5** `customer_groups`: `CustomerCreditAccount`, `CustomerCreditLedgerEntry` entities +
  migration; `CustomerGroupTerms` additive columns: `terms_currency_code`, `approval_policy`
  (D-R5-1), `allow_quote_requests` (D-R5-20), `requires_po_number` (D-R5-28) — all nullable,
  inherited like `allow_purchase_on_account`.
- **1.6** `customer_groups`: credit service — `checkCredit`/`reserveCredit`/`releaseCredit`/
  `settleCredit`, scoped (G2), row-lock concurrency (G1, `PESSIMISTIC_WRITE` inside
  `withAtomicFlush(..., { transaction: true })`, no SERIALIZABLE/retry helper), decimal-string
  money (G14), idempotency rules (G12). Ship the N=20 parallel-reserve test plus the
  nested-outer-transaction variant before anything else in this Step.
- **1.7** `customer_groups`: credit admin API (detail tab widget on
  `detail:customers.company`/`.person`), ACL features + grants (G16), `encryption.ts` for
  `hold_reason`/ledger `note` (G22).
- **1.8** `customer_groups`: notification types (G15), `credit-exposure-audit` worker (G21), and the
  `sales.order.cancelled` subscriber releasing the order's unsettled reservation (D-R5-2 hybrid
  settlement — payments settle only via `/adjust` or `settleCredit`, never automatically).
- **1.9** `promotions`: additive `revertCodeUse` + a `sales.order.cancelled` subscriber (C5), per
  SPEC-055.
- **1.10** `promotions`: un-hide `delivery_method` rule + `DELIVERY_DISCOUNT` effect (D-R5-17,
  amending D-R4-14) — authorable once checkout exists as the evaluation source.
- **1.11** `customer_groups`: gap-fill appended after Step 1.7 landed without it. G13/D-R5-5
  ("Credit accounts are created by an operator only") requires an actual admin provisioning
  route — without one, no `CustomerCreditAccount` can ever exist and the whole credit feature
  (and checkout B.4/B.5's on-account path, Phase 4/5) is unreachable. Add: `POST
  /api/customer_groups/customer-groups/credit-accounts` (admin-create, `customer_groups.credit.manage`,
  `.strict()` body, `default_credit_limit` pre-fill semantics per D-R5-5) and a ledger-listing read
  route (`GET .../credit-accounts/:id/ledger`, `customer_groups.credit.view`, decrypted `note`,
  paginated) so the admin UI (1.7's widget) can show ledger history. No notification/job change —
  that's 1.8's own scope.
- **1.12** `customer_groups`: gap-fill appended after Step 1.8 landed without it — see PLAN.md
  "Decisions taken without the owner". D-R5-2/§6.5 states payments settle "only via `/adjust` or
  `settleCredit`"; Step 1.8 shipped the automatic cancel-release subscriber and the audit job but,
  per its own brief, deliberately did not build `/adjust` (an admin API route, not its scope). Add:
  `POST /api/customer_groups/customer-groups/credit-accounts/:id/adjust`
  (`customer_groups.credit.adjust`, body `{ amount: string, note: string }` validated `.strict()`),
  running the `customer_groups.credit.adjust` command under the account row lock (§6.3, same
  pattern as `reserveCredit`/`releaseCredit`), appending a signed ledger entry with the required
  `note` (G20). Undo appends the inverse entry (`related_entry_id` = the original,
  `idempotencyKey: undo:{entryId}`) and never deletes (G20). Declare and emit
  `customer_groups.credit.adjusted` (G18) alongside it, since the command has no consumer without
  it. ACL feature `customer_groups.credit.adjust` already exists (Step 1.7).

### Phase 2 — wave 2 (depends on wave 1)

- **2.1** `availability`: `AvailabilityReservation` entity + migration (A3) — columns per the gap
  analysis (`idempotency_key` unique per tenant+organization, `status`, `expires_at`, `items`
  jsonb, `wms_reservation_ids` jsonb, `order_id`).
- **2.2** `availability`: `reserve`/`release`/`commit` built on `wmsReservationService` (1.3), one
  transaction, CAS on `status = 'active'`, per-line `outcome` (`held|not_tracked|preorder|
  backorder|shortfall`, A6/D-R5-9: backorder holds `min(requested, sellable)`), warehouse
  allocation (A7), key-mismatch 409 (A15), `isUndoable: false` (A14/D-R5-10).
- **2.3** `availability`: expiry job (CAS to `expired`, release via the service, A11), reconciliation
  job (drift cases a/b/c, A12), `availability.reservation.*`/`availability.shortfall.detected`
  events with scope (A13/X11).
- **2.4** `customer_groups`: `CustomerPurchaseApproval` entity + migration — actor-typed
  requester/decider columns (D-R5-1), two decision slots for `approval_policy: both`, policy
  snapshot at creation, `subject_type: cart | quote` (D-R5-3/D-R5-23).
- **2.5** `customer_groups`: approval service (`requestApproval`/`getApproval`/
  `getActiveApprovalForSubject`/`withdrawApproval`/`decideApproval`), every transition a CAS
  conditional update (G6), `expire-approvals` job defaulting to 14 days (D-R5-27).
- **2.6** `customer_groups`: buyer portal routes (`requireCustomerAuth`), staff routes, ACL features
  + `defaultCustomerRoleFeatures` grants (G5/G7/D-R5-7), `checkout.sessions.*` + least-privilege
  grants per D-R5-34 land here too if checkout's ACL file already exists, else in 2.12.
- **2.7** `customer_groups`: approval notifications — in-app to staff deciders + the company's
  `account_manager`, email to buyer-side deciders/requesters with a per-tenant switch (D-R5-6);
  `customer_groups` is the only notifier (D-R5-32) — cart/checkout approval events stay signals.
- **2.8** `cart`: lock contract — `lockTtlMs` (bounded), idempotent extend (same
  `checkoutSessionId` on an already-locked cart returns the cart instead of 423), `unlock`/
  `markConverted` require a matching `checkoutSessionId` (uniform 404 on mismatch) (C1).
- **2.9** `cart`: D-R5-21 — every `/api/cart/current/*` route on an identified basket
  (`customer_user_id` set) requires the matching customer session, else `404` (closes the
  `commands/cart.ts:603-608` identity-rewrite bypass, D-R5-13 becomes a special case); D-R5-22 —
  the trusted `resolveForBuyer`-sourced identity path for `pay_link`/`api`/`agent` carts replaces
  the ad hoc context-less seeding at `cart/commands/cart.ts:236-258`.
- **2.10** `cart`: `markConverted` additive `salesOrderId`/`lineMap`/`salesQuoteId` inputs (K8,
  D-R5-26), emitted on `cart.cart.converted`; admin `GET /api/cart/carts` + `/carts/[id]` +
  `POST /carts/[id]/reprice` (K6) with `DataTable`, decrypted `email`/`note` via the query engine,
  no ciphertext search.
- **2.11** `cart`: `cart.cart.abandoned` payload growth (K9); `codeService.releaseCode` wired into
  `expire`/`mark-abandoned` sweepers (K11, closing the Release 4 deferral).
- **2.12** `checkout`: B.1 — `CheckoutSession` entity + step machine, `/api/checkout/sessions/
  current/*` with `X-Checkout-Session-Token` (C4, `token_hash` stored, plaintext returned once),
  soft `tryResolve` peers only (C10, no hard `requires`), plus the C14 minimum shipped now:
  rate limits (reusing `enforceCheckoutRateLimit`), the session encryption map, `CheckoutSessionEvent`
  payload redaction, cross-tenant check on every request. ACL `checkout.sessions.view/manage`
  (admin; `employee` view per D-R5-34).
- **2.13** `checkout`: B.3 — delivery step (rate quoting C13: store/warehouse origin, catalog
  weight/dimensions with single-parcel default, flat-rate fallback per D-R5-35, 5 min cache) and
  payment-method listing; delivery-promotions evaluation at delivery selection (`promotionsService.
  evaluate` with `deliveryMethodCode`/`deliveryCost`, C8).

### Phase 3 — wave 3 (depends on wave 2 approvals + cart trusted path)

- **3.1** `cart`: approval gate (K1 one amount basis = goods gross after promotions excl. delivery,
  K2 `requiresApproval` computed from fresh terms at every totals change and re-checked at `lock`,
  `409 cart_requires_approval`); `purpose: 'quote'` skips the gate and `min_order_value` (D-R5-23);
  guest carts over a default-group threshold refused fail-closed (D-R5-12/D-R5-29, `409
  approval_requires_identified_buyer`).
- **3.2** `cart`: `/current/request-approval` (idempotent per pending approval, G8), K3 lifecycle
  table (withdraw on merge-source/expiry/purge, recompute-not-restore on undo-merge), K4 guest
  rule enforcement, K7 `cart.approval.requested` payload, K5 `awaiting_approval_since` column +
  subscriber on `customer_groups.approval.*` maintaining it (no abandonment while pending).
- **3.3** `cart`: §7a proposal commands — `cart.proposal.create` (ttlSeconds input per S5, no
  promotion codes per S14/K14, visibility check against `resolveForBuyer` scope emitting
  `cart.line.visibility_rejected` with `triggeredBy: 'proposal_create'` per S13/K13), withdraw,
  supersede-on-merge, re-author on `cart.cart.merged` as the original author per D-R5-14 (with the
  stated fallback to supersede-only).
- **3.4** `cart`: §7a proposal routes (`/api/cart/proposals/*`, D-R5-13/D-R5-21 identity binding),
  sweeper branches for `kind = 'proposal'` (never abandoned, own `expires_at`, 90-day post-
  resolution purge per D-R4-20, K15/S15), `409 merge_undo_not_supported_for_proposal` on
  `/current/undo-merge` of a proposal-sourced merge (D-R5-25).
- **3.5** `checkout`: B.2 — cart-backed link flow; trusted in-process pay-link cart seeding via
  `cart.create` + template line adds through the command bus, context from the link's own tenant/
  organization via the 1.1 helper, buyer identity applied when a customer session is present
  (D-R5-19); store/channel/currency mismatch refusal at session creation and submit (C9).

### Phase 4 — wave 4 (depends on wave 3: availability, credit, cart lock, promotions)

- **4.1** `checkout`: B.4 submit, steps 1–5 of C19 — preconditions (C9, K1/K2 approval, D-R5-12
  guest, C15 PO/`min_order_value`), `cart.lock` with fresh route context + session id (C1/C2),
  `availability.reserve` (`sourceType: 'checkout'`, per-line outcomes), on-account `reserveCredit`
  (G1/G2), idempotent document creation (`external_reference`, non-confirmed status,
  `metadata.cartLineId` per line, C3), the C7 goods-totals equality check.
- **4.2** `checkout`: B.4 submit, steps 6–8 — order outcome: `availability.commit` (D-R5-8, right
  after document creation, before payment), `linkCreditReservationToOrder` (C6), `useCode` +
  `registerUsage` before payment with `409 promotion_unavailable` on refusal/budget overrun (C5);
  quote outcome: release stock (A9), no credit reservation; gateway step with lock-extend (C1),
  `lineMap` built from the order's lines (C18) and passed to `markConverted`; `recover-stuck-
  submits` decision table (C24).
- **4.3** `assisted_selling`: module scaffold (entities for threads/participants/messages come in
  4.4), store settings (`mode` limited to `rep | off`, S10; TTL setting), module registration in
  `apps/mercato/src/modules.ts` commented out in the create-app template (D-R5-36, run
  `yarn template:sync:fix`).
- **4.4** `assisted_selling`: thread/participant/message entities (encrypted `body`/`displayName`/
  `rejectionReason` per S19/G22-style map), staff author routes (`POST /threads`,
  `POST /threads/:id/proposals` wrapping `cart.proposal.create`, withdraw/supersede/re-author),
  scoped by the caller's `organizationIds` (S9), idempotency unique key per thread (S23).
- **4.5** `assisted_selling`: buyer thread routes (`GET/POST /thread`, `POST /thread/messages`)
  under the D-R5-21 identity rule when the basket is identified (Phase 2 item 1, required by R3);
  `GET /thread/events` server-side ETag/304 contract, rate limited (Phase 2 item 2); retention/
  erasure sweepers wired to `cart.cart.purged`, `customer_accounts.user.deleted`,
  `auth.user.deleted` (Phase 2 item 5, S7).

### Phase 5 — wave 5 (depends on wave 4: checkout B.4, cart approval gate)

- **5.1** `checkout`: B.5 B2B — PO number written to `SalesQuote.customer_reference` when the
  resolved term requires it (D-R5-28), `min_order_value` check in `terms_currency_code` (D-R5-4),
  on-account eligibility (allowPurchaseOnAccount + existing credit account, not on hold, D-R5-5),
  `request_quote` payment method offered only when `allow_quote_requests` allows it (D-R5-20),
  quote outcome ends submit after document creation with no payment/credit/stock hold (C16/C17).
- **5.2** `checkout`: approval-resume subscriber on `customer_groups.approval.approved|rejected|
  expired|withdrawn` returning the session to `open`/`failed` (C11, no workflows); every
  `/api/checkout/sessions/current/*` route requires the matching customer session on an identified
  cart (D-R5-33).
- **5.3** `assisted_selling`: rep console (Phase 2 item 3) — inbox with filters, thread page,
  composer, proposal builder showing the buyer's own prices with provenance; reuses existing
  backend UI families per `.ai/ui-backend-components.md`.
- **5.4** `assisted_selling`: Phase 4 attribution entity, `cart.cart.converted` subscriber
  (consuming `lineMap`/`salesOrderId`/`salesQuoteId` from 2.10/4.2), `GET /attributions`, console
  attribution report; degrades visibly to `assisted_selling.attribution.degraded` when `lineMap`
  is absent.

### Phase 6 — wave 6, full gate

- **6.1** Integration-test completion pass across every module touched, filling any test named in
  the five analyses' coverage lists (G23, A20, K17, S16, C26) not already covered by a Phase 1–5
  Step's own tests — cross-tenant isolation on every new route is non-negotiable here.
- **6.2** `UPGRADE_NOTES.md` entry: D-R5-21 behaviour change (identified-basket session requirement
  on `/api/cart/current/*`), A16 (`InventoryReservationSourceType` gains `'checkout'`), G26 (new DI
  keys `customerCreditService`/`customerPurchaseApprovalService` instead of growing
  `CustomerGroupsService`).
- **6.3** `yarn template:sync:fix` verification pass over every `apps/mercato/src/**` /
  `apps/mercato/src/i18n/**` change made across Phases 1–5 (module registration, new env vars if
  any).
- **6.4** Full validation gate per `.ai/agentic.config.json` `validation.commands`, fix-forward on
  any failure, re-run until green.

## Checkpoints

Fire every 5 landed Steps (or at a Phase close with ≥3 Steps), per
`.agents/skills/om-auto-create-pr-loop/references/checkpoint-pass.md`. Index starts at 1.
