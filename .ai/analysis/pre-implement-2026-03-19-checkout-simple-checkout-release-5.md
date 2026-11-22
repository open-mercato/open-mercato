# 🔍 Pre-implementation analysis: Checkout — Unified Checkout Funnel, Release 5 (Phases B.1–B.5)

**Readiness: no-go.** Built as written, the order path has three defects. A crash right after the quote converts leaves a live order with no stock or credit holding it, and the buyer can then pay for a second one. Every checkout order reaches staff as a new quote and drops the PO number. The C7 totals check rejects every percentage-code checkout (#9389). The spec also leaves every buyer route without request and response bodies. For an API-only release, that is the contract integrators build against.

Spec: `.ai/specs/2026-03-19-checkout-simple-checkout.md` (v2.3, Release 5 revision 2026-10-26) · audited 2026-11-19 against `BACKWARD_COMPATIBILITY.md` (13 surfaces) and the `.ai/specs/AGENTS.md` content checklist plus the skill's built-in section set (the repo has no spec template). Ground truth: current `main` in this worktree (`5d93cbd8bf`), and the reference implementation `refs/remotes/pr/8268` (`bdb747c36a`, diff base `b7b5309ccc`).

Scope: §3.4, §4, §5.2–§5.5, §6–§13, §14a, §16, §17 B.1–B.5, and the C14 security minimum. Phase A pay links are context, except where the 2026-11-19 decisions change them. B.6 is out.

**Next action:** revise the spec with the `om-spec-writing` skill (items 1–8 of the remediation plan). Then implement per phase step with the `om-auto-implement-spec` skill, adding the during-implementation items.

## ⛔ Blocking before implementation

1. **The order path cannot be made idempotent with the quote's `external_reference`** ([G1](#gaps)). On `main`, `sales.quotes.convert_to_order` hard-deletes the quote (`sales/commands/documents.ts:7663`, `em.remove(quote)`; `sales/AGENTS.md:59` says quotes are "deleted on conversion"). It copies neither `external_reference` nor `customer_reference` onto the order (`documents.ts:7415-7480`). Suppose a process dies after the conversion and before the session records the order. §7.2 step 5a then finds no quote, and §12.1's row "Quote absent → release credit, release stock, unlock, `open`" releases the holds while a live, non-confirmed order exists. The buyer's next submit creates a second order. The reference does exactly this (`workers/recover-stuck-submits.worker.ts:200`, falls through to `:293`). **Fix:** key idempotency on the order itself: either create the order directly (item 2), or have `convert_to_order` copy `external_reference`. Then look the order up by `(tenant_id, organization_id, external_reference)` with an additive index on `sales_orders` (a new Ask First on `sales`, beyond D-R5-30). Rewrite the §7.2 5a/5c and §12.1 rows accordingly.
2. **Document creation through quote + convert causes #9390 and #8413** ([G2](#gaps)). `sales.quotes.create` notifies every `sales.quotes.manage` holder of a new quote (`documents.ts:5540-5575`), so every gateway or on-account checkout order reaches staff as a quote to review. The conversion also loses data:
   - the PO number (§8.4's claim that `convert_to_order` "carries" `customer_reference` is false);
   - the status, because the order inherits a **quote**-status dictionary entry (C17 names no status entry);
   - the channel, buyer e-mail and payment method, which §7.2 maps nowhere.

   **Fix (owner decision, recommended):** the order outcome creates the order with `sales.orders.create`, which on `main` already accepts `externalReference`, `customerReference`, `channelId`, `statusEntryId`, the shipping/payment method fields and `customerSnapshot` (`sales/data/validators.ts:781-826`). Only `request_quote` uses `sales.quotes.create`. Add a field-mapping table from session/cart to document (see G2).
3. **The C7 totals guard rejects percentage promotion codes, #9389** ([G3](#gaps)). `main`'s #8425 fix (`4ab033c20f`) puts `metadata.taxRate` on the cart's order-scope discount draft, so `Cart.totals` carries the reduced tax. The snapshot that checkout builds the document from re-creates those drafts from `CartPromotionApplication` rows *without* `metadata` (reference `cart/lib/toSalesSnapshots.ts:83-96`). Recomputing it gives the pre-discount tax, so `findGoodsTotalsMismatch` trips on `taxTotalAmount` (reference `checkout/commands/submit.ts:895-917`). The draft quote has already been created by then (`:812-887`), which leaves an orphan per attempt. Worse, the document built from that snapshot would itself carry the wrong tax, which is #8425 again on every checkout order. **Fix:**
   - §7.2 5b states that the snapshot's adjustments are the exact drafts behind `Cart.totals`, metadata included. This is a cart-spec contract (§3.1a, `TC-CART-LOCK-06`), and the test must use a percentage code with tax.
   - The snapshot self-check (recompute = `Cart.totals`) runs **before** any document exists.
   - After creation, the check compares the **persisted** document (goods keys and grand total gross = payable) for every payment method. Today the reference compares the payable only for `on_account` (`:908`).
4. **No backfill migration for the new encryption map** ([R-1](#-repo-rule-compliance)). §13 adds `checkout:checkout_session` to `defaultEncryptionMaps`, and §14a says "No data migration". `packages/core/AGENTS.md` → Encryption requires a `buildEncryptionMapBackfillSql` migration for a deployed module; without it, existing tenants store `email`, `phone` and both addresses in plaintext (#8893, High). `main` already has the pattern for checkout's older maps (`checkout/migrations/Migration20261109120000.ts`). **Fix:** add the backfill migration to B.1 and §14a, with a unit test modelled on that migration's test.
5. **Buyer API contracts are undefined** (R4). §9's route table gives only a "Purpose" per route. Missing:
   - the submit body: payment method, PO number, `successUrl`/`cancelUrl`;
   - the submit response's payment hand-off (`redirectUrl`/`clientSecret`/`providerKey`). Without it the gateway path cannot complete (review Blocker R1, fixed in the reference by `18da64483f`);
   - the response shapes of `GET /current`, `delivery-options` and `/result`;
   - how the gateway result resumes the session.

   **Fix:** a request/response schema per route in §9, including the return-URL rule (relative paths resolved against the server-pinned origin, `packages/checkout/AGENTS.md` Security Notes).

## ⚠️ Decisions for the spec owner

| # | Question | Recommended answer | Tradeoff |
|---|---|---|---|
| D1 | How is the order outcome's document created? (Blockers 1, 2.) | Create it directly with `sales.orders.create` (non-confirmed `statusEntryId`, `externalReference`, `customerReference`, `channelId`, method fields, `customerSnapshot`). Look it up by `sales_orders.external_reference` (new additive index, Ask First on `sales`). Keep `sales.quotes.create` for `request_quote` only. `lineMap` is read from the order lines' `metadata.cartLineId`. | Also needs an order-create path that takes the cart's exact lines and adjustments (the reference widened the line validators for quotes; the same widening applies to order lines). The alternative, keeping quote + convert, needs three `sales` seams: notification suppression, `convert_to_order` copying both references and mapping the status, and an order lookup. That is more surface in `sales` for a worse result. |
| D2 | Is the payment method (and PO number) selected by `POST /sessions/current/payment` (§5.5, §9), or passed to submit (the reference)? | Keep `/payment` as specified. It is what makes `quoted_totals`, the `payment` step and `purchase_order_number` on the session meaningful. Submit re-validates against the listing either way (§13 Entitlement). | The reference has no `/payment`, `/step`, `/cancel` or `/result` (route list at `bdb747c36a`). Porting it as-is means writing four routes the reference never tested. |
| D3 | Phase A gateway subscribers (CH0b in the slicing analysis): the reference rewrites all four `gateway-payment-*` subscribers to rethrow, and deletes `main`'s `lib/gateway-status-sync.ts` from #9597. | Port the rethrow rule, but keep `main`'s `reportGatewayStatusSyncFailure` for the terminal-409 branch ("captured on an expired transaction"). Record it in §14a as a Phase A change. `packages/checkout/AGENTS.md` makes payment state transitions Ask First. | Without some subscriber change, session transactions never complete: `checkout.transaction.updateStatus` 404s for a transaction without a link. |
| D4 | Is a digital-only cart (no `delivery` step, §5.2) in Release 5? | Either specify how `delivery` is skipped (no shipping method, no shipping address required, no shipping adjustment), or state that Release 5 requires a physical delivery. | The reference refuses submit without `shippingMethod` and `shippingAddress` (`submit.ts:405-428`), so §5.2's skip rule is not implemented. |
| D5 | Peer reads: the reference reads `carts`, `cart_promotion_applications`, `promotions`, `sales_quotes`, `sales_orders`, `sales_order_lines`, `sales_payments` and `dictionaries` with raw Kysely (`lib/cartPeer.ts:109-246`, `submit.ts:972-1308`). §19 says peers are reached "via DI (`tryResolve`) or `commandBus`". | Route the reads through peer services: `cartService` already exposes reads, and `sales` should offer a status-entry resolver and an order-by-reference lookup. Alternatively, sanction "FK-id raw reads of non-encrypted columns" explicitly in §3.3 and list the columns. | Raw reads couple checkout to other modules' table layouts, and bypass decryption if any read column is ever added to an encryption map. |

## 📋 Readiness gate

| # | Item | Result | Evidence / fix |
|---|---|---|---|
| R1 | Declared status | ✅ | "Specification (v2.3 …)". The repo defines no status vocabulary (`.ai/specs/AGENTS.md`); this is the revision the owner approved (decisions file: "Still open: none"). |
| R2 | No blocking open questions | ✅ | §18 OQ1 and OQ4 state the behaviour they assume, and OQ2 and OQ3 are explicitly out of scope. The §5.2 tax-with-address question is deferred to the tax roadmap. Move them to "Resolved assumptions / deferred" so the block reads as closed. |
| R3 | Traceability | ✅ | §16 lists a case per route and per C-finding, and §17 has gates. Add oracles for the gaps G1–G3 (crash after conversion; percentage code with tax; no quote notification for an order outcome) and G4 (payment recorded). |
| R4 | Contracts defined | ❌ | Blocker 5. Also undefined: the ops notification behind `checkout.compensation.failed`, `totals_mismatch` and `stock_lost` (type id, recipients, feature; §7.3, §9.2, R9). Neither the spec nor the reference declares one; the reference only logs "raising an ops notification" at `submit.ts:910,1803`. |
| R5 | Phases deliverable | ✅ | Every phase has dependencies and a gate. The B.4 dependency list is incomplete (G8). The phases are larger than the planned one-PR steps, and the spec has no step breakdown; the slicing in `slices-checkout.md` (CH0a…CH6b) should be referenced from §17. |
| R6 | Grounded in the codebase | ❌ | Mis-descriptions verified on `main`: **(1)** `convert_to_order` keeps the quote (it hard-deletes it, `documents.ts:7663`); **(2)** it carries `customer_reference` to the order (§8.4; it does not, `:7415-7480`); **(3)** `sales.quotes.create` accepts `external_reference`/`customer_reference` (§7.2 5a; `quoteCreateSchema` at `validators.ts:836` has neither — the reference adds them); **(4)** "the Phase A path, unchanged" completes a session payment (§7.2 step 7; `updateStatus` 404s without a link — review Blocker R1); **(5)** "`admin` gets both (covered by `checkout.*`)" (§9.1; only `superadmin` has `checkout.*`, `admin` is an explicit list, `checkout/setup.ts`); **(6)** §14a #13's import path `@open-mercato/shared/lib/commands/trustedContext` with `actor: { type }` (the reference ships `…/trusted-context` with `actorType`). |

## 💥 Backward compatibility

| # | Surface | Phase/step | Change | Severity | Migration path |
|---|---|---|---|---|---|
| 1 | 3 Function signatures (sales) | B.4 | `sales.quotes.create` gains `externalReference` and `customerReference`. The line validators are widened to accept `null` (reference `sales/data/validators.ts` diff; review Major R4 #9 asked for an exact UPGRADE_NOTES entry). Not in §14a. | Warning | List both in §14a as `sales` contract changes; add an UPGRADE_NOTES entry. With D1, the order-create path needs the same widening. |
| 2 | 8 DB schema (sales) | B.4 | D1/Blocker 1 needs an index on `sales_orders (tenant_id, organization_id, external_reference)`. D-R5-30 approved only `sales_quotes`. | Warning | Additive index, with its own Ask First on `sales`. |
| 3 | 2 Types, 8 DB (checkout Phase A) | B.4 | `checkout_transactions.link_id` drops NOT NULL and `CheckoutTransaction.linkId` becomes nullable (reference `Migration20261028020000`). `GET /api/checkout/transactions` can then return `linkId: null`. §4.4 claims "additive nullable columns only". | Warning | State it in §4.4 and §14a; add an UPGRADE_NOTES entry for API consumers. |
| 4 | 8 DB (checkout) | B.4 | `payment_recorded_at` and `payment_repair_attempted_at` plus a partial index on `checkout_transactions` (reference `Migration20261111174229…`). Not specified. | Warning | Add them to §4.4 (G4). |
| 5 | 2 Types / 7 API (ecommerce) | B.3 | The flat-rate fallback adds `settings.shipping.flatRate`, and the reference makes `shipping` a **required** key of `EcommerceStoreSettings`. `checkout_links` and `checkout_link_templates` gain `flat_rate_shipping_*` columns. Neither is in §14a. | Warning | Make the key optional; list both in §14a (owner: SPEC-029 for the store setting). |
| 6 | 3 Signatures (promotions) | B.4 | §14a #10 lists `revertCodeUse` as "Additive". The decision is that it is OPTIONAL (`revertCodeUse?`); the reference declares it required (`promotions/lib/types.ts:148`). | Warning | §3.3, §7.3 and §14a say `revertCodeUse?`, and checkout must not depend on it (see S7). |
| 7 | 7 API routes (Phase A) | B.1 | Decided 2026-11-19: pay-link routes declared fail-closed answer `503` when no limiter is registered. This changes `POST /api/checkout/pay/[slug]/submit` and `/verify-password`, and reverses #5030's tests. §3.2 says Phase A is untouched. | Warning | Record it in §3.2 and §14a as a Phase A behaviour change; add an UPGRADE_NOTES entry. |
| 8 | 4 Import paths | Phase A (D3) | The reference deletes `checkout/lib/gateway-status-sync.ts` (`reportGatewayStatusSyncFailure`, merged on `main` 2026-11-17). | Warning (if it shipped in a release) | Keep the export or follow the deprecation protocol (D3). |
| 9 | 11 Notification type ids | B.4 | The required ops notification (R4) is a new type. | Additive | Declare it in `checkout/notifications.ts` and name it in §10/§14a. |
| 10 | 9 DI keys | B.4 | The reference registers `checkoutScheduleUpgradeRegistrar` for the `configs` upgrade action (#8822). Not in the spec. | Additive | Name it in §12 and §14a (G5). |
| — | 1, 5, 6, 10, 12, 13 | all | New routes, subscribers, workers, events, ACL features and tables. No CLI change. Generated registries change by regeneration only. | Additive | — |

§14a exists but omits rows 1–8, and its "Upgrade steps" say "No data migration", which contradicts Blocker 4 → **Warning**.

## 📝 Spec completeness

| Section | Missing / incomplete | Impact | What to add |
|---|---|---|---|
| §9 API Contracts | Request/response bodies (Blocker 5) | Integrators cannot build a client; implementers will invent shapes | Zod-shaped schemas per route, the payment hand-off, the return-URL rule |
| §7.2 step 7 / §12 | Payment recording and repair (G4) | The order shows nothing paid (#8423); the transaction stays `processing` (#8821) | `sales.payments.create` per captured or authorised payment, idempotent per `(order, paymentReference = GatewayTransaction.id)`; the `repair-gateway-payments` and `repair-order-compensation` workers; the `compensating` value of `submit_progress` |
| §12 | Schedule registration for existing tenants (G5) | Upgraded tenants get no sweeps (#8822) | One schedule helper used by `seedDefaults`, `onOrganizationCreated` and a `configs` upgrade action; an UPGRADE_NOTES entry including `UPGRADE_ACTIONS_ENABLED` |
| §4.1 / §9.0 | Binding source | The token alone could act for a buyer who logged in later | Bind to the **live cart's** `customer_user_id`, not the session's creation-time copy (review R1/R2, `c8b9531a76`) |
| §4.3 / §7.2 | Pay-link capacity | A tokenless `POST /sessions` exhausted `maxCompletions` (review R4, Sec-Medium #9) | Probe capacity at seeding; reserve a slot atomically at submit, release it exactly once on a status CAS (`f0fadba93d`); resume a link session by its token |
| §5.3 | Currency of rates and flat rates | A USD cart charged a 20 PLN rate as 20 USD (review M5) | Drop rates and fallbacks whose currency differs from the session |
| §5.3 / §3.4 | Warehouse origin | The reference gates carrier quoting on `wmsReservationService`, which `main` does not register, so only flat rates ever appear | Add `wms` as a soft peer to §3.4 and name the origin source |
| §7.2 2/5a | Shipping adjustment tax | The reference sends `amountNet = amountGross = cost` (`submit.ts:849-856`), so shipping is never taxed | State whether rates are net or gross and how tax applies |
| §4.3 | Money type | `numeric(12,2)` contradicts `main`'s `ExactDecimalType` for checkout money (#7324) | Use `ExactDecimalType`; specify decimal arithmetic for the totals and payable comparison (the reference uses floats with a 0.0005 epsilon, `submit.ts:203-216`) |
| §16 | Missing cases | — | Crash after `convert_to_order` (G1); percentage code + tax (G3); no quote notification and full field mapping on the order (G2); payment recorded; schedules after upgrade; real-Postgres race suites proven to run in CI (#9183, review 2.14) |

## 🔍 Repo-rule compliance

| Rule (source) | Spec location | Fix | Severity |
|---|---|---|---|
| R-1 Encryption-map backfill for a deployed module (`packages/core/AGENTS.md` → Encryption) | §13, §14a "No data migration" | Blocker 4 | Critical |
| R-2 Custom write routes MUST call `runMutationGuards` (`packages/core/AGENTS.md` → API Routes) | §9, §11 claims commands give "the same mutation guards" | Name `runMutationGuards` for every buyer `POST`/`PATCH` (the reference wires none: no hit under `checkout/api/sessions`; assisted selling had the same finding, R21 M12) | Important |
| R-3 Ask First on public pay-page contracts and payment state transitions (`packages/checkout/AGENTS.md`) | §3.2, §14a | Record the 503 decision (BC 7) and D3 | Important |
| R-4 A catch that records an error MUST `reportError` (root `AGENTS.md`, Task Router) | §7.3, §8.2 | State it for the persistent subscribers and workers (the reference fixed swallowing in R2–R6 and R21 M4) | Important |
| R-5 `sales` "MUST scope all documents to a channel" (`sales/AGENTS.md` Always 3) | §7.2 5a | Map the session to `channelId`: storefront via the store's default `ecommerce_store_channel_bindings.sales_channel_id`; say what link and API carts use (#8413) | Important |
| R-6 Use `findWithDecryption` (root `AGENTS.md`, Data & Security) | §19 | Holds in the spec; the reference's repair workers use raw `em.find` on `CheckoutSession` (slices CH5b). Port with `findWithDecryption` | Nice-to-have |

## ⚠️ Risks

| Risk | Level | Impact | Mitigation |
|---|---|---|---|
| Orphan live order after a crash between conversion and the session write (Blocker 1) | High | Order without holds; buyer pays twice | Order-level `external_reference` + lookup; a §16 kill test placed exactly after conversion |
| Connection-pool exhaustion under parallel submits (#8414, still 500 in QA round 4) | High | Last-unit buyers get 500; the N=20 gate (R7) fails | §7.2: nested commands run on the caller's transaction (`ctx.transactionalEm`); size the R7 test to the pool; real-PG suite in a CI runner |
| The submit saga is the review hotspot (17 fix commits in `submit.ts`, payment repair redesigned 6 times) | High | Re-introducing fixed defects while slicing | §17 references the CH slicing; each must-keep fix is listed per slice (slices CH4/CH5a/CH5b) |
| Totals guard false positives beyond #9389 (floats, 2 dp vs 4 dp) | Medium | Valid orders refused with `500 totals_mismatch` | Exact decimals; one rounding rule per comparison (G3) |
| Phase A regression from subscriber and `link_id` changes | Medium | Pay links break | Keep the C10 boot test; run the existing `update-transaction-status` suite unchanged |
| Subscribers and workers dispatch commands without a real container (review R27–R29) | Medium | Recovery of promoted orders ends in cancellation | B.4 depends on the container hand-off (`SubscriberContext.container`, `WorkerJobContainer.register`) |
| `instanceof CrudHttpError` across bundles (reference `submit.ts:1634,1808`, `recover-stuck-submits.worker.ts:74`) | Medium | A 404 that should mean "already unlocked" is treated as a failure | Use `isCrudHttpError` when porting |

## 🔍 Gaps

<a id="gaps"></a>
- **Critical — G1 order idempotency** (Blocker 1): §7.2 5a/5c, §12.1 rows "credit_reserved or crash in step 5" and `document_created`.
- **Critical — G2 order creation and field mapping** (Blocker 2, #9390, #8413): §7.2 5a needs a table from session/cart to order:
  - `channelId`;
  - `customerEntityId` from the **locked** cart (review R27 M3);
  - `customerSnapshot` with the e-mail;
  - both address snapshots;
  - shipping method code and snapshot;
  - payment method code and snapshot (`on_account` included, so staff can see it, #8413);
  - `customerReference` = PO;
  - a named non-confirmed order `statusEntryId`;
  - `metadata.sourceModule`/`checkoutSessionId`.
- **Critical — G3 totals invariant** (Blocker 3, #9389): §7.2 5b, §9.2 `totals_mismatch`, plus a cart-spec amendment (snapshot adjustment metadata, `TC-CART-LOCK-06` with a percentage code).
- **Important — G4 payment recording and repair** (#8423, #8821): §7.2 step 7, §12, §4.4.
- **Important — G5 schedules for existing tenants** (#8822): §12, §14a.
- **Important — G6 ops notification** (R4): §7.3, §10 — type id, recipient feature (for example `checkout.sessions.view`), and the events that raise it.
- **Important — G7 §8.2 item 4**: a new session on a cart with a pending approval starts `awaiting_approval`. Not implemented at the reference (no `getActiveApprovalForSubject` call anywhere in checkout).
- **Important — G8 B.4 dependencies**:
  - the `sales` quote/order create inputs and line-validator widening (BC 1);
  - `UseCodeInput.orderId` (promotions);
  - the order lifecycle events from `sales` (cancel/undo re-emit, #8404/#8406);
  - the event/worker container hand-off;
  - `wms` for the delivery origin.
- **Important — G9 `quoted_totals` lifecycle**: §5.2 and §7.1 #10 (clear on cart change, compare `cartUpdatedAt`) are not implemented. The reference compares only the delivery cost and discount (`submit.ts:674-689`).
- **Nice-to-have**:
  - cite D-R5-37 (the base-currency fallback) in §7.1 #7–#8;
  - the event payloads of §10 differ from the reference (`submitted` lacks `paymentMethodCode`; `compensation.failed` carries `failed[]`);
  - `continueOrderOutcome` throws code `totals_mismatch` for "no cart" (`submit.ts:1789`).

## Spec vs. reference implementation

Classification: **(a)** spec should change · **(b)** reference must change when ported · **(c)** owner decision.

| # | Topic | Spec | Reference `bdb747c36a` | Class |
|---|---|---|---|---|
| S1 | Document path | §7.2 5: quote → `convert_to_order` for the order outcome | Same (`submit.ts:812-887`, `:1740-1750`); causes #9390, #8413 and G1 | (c) D1, recommended direct order create |
| S2 | Idempotency after conversion | §12.1: "Quote absent → release … `open`" | Same; orphan order (`recover-stuck-submits.worker.ts:200-293`) | (a) + (b) |
| S3 | Totals check | §7.2 5b: compares the persisted quote's goods totals and the payable | Recomputes the snapshot instead of reading the quote; snapshot drops `metadata.taxRate` (`toSalesSnapshots.ts:83-96`); payable compared only for `on_account` (`submit.ts:895-917`); the quote is created before the check | (b), plus (a) for "check before create" |
| S4 | PO number | §8.4: written to the quote, carried by the conversion | Sent as the quote's `customerReference`; lost on conversion; never stored on the session | (a) + (b) |
| S5 | Payment selection | §5.5/§9: `POST /sessions/current/payment` stores the method and PO | No route; `paymentMethodCode`/`poNumber` are submit inputs (`submit.ts:60-67`) | (c) D2 |
| S6 | Routes | §9: `/step`, `/cancel`, `/payment`, `/result` | None of the four exist; `step` is always `'contact'` (`commands/session.ts:317`) | (b) or (c) D2 |
| S7 | Code reversal in compensation | §7.3: checkout calls `revertCodeUse({ cartId })` | Never calls it; `useCode` receives `orderId` (`submit.ts:1850-1857`), so the promotions subscriber's `revertCodeUse({ orderId })` covers it | (a): adopt the reference; matches the optional `revertCodeUse?` decision |
| S8 | `revertCodeUse` optionality | §14a #10 "Additive" | Required member (`promotions/lib/types.ts:148`) | (b), per the 2026-11-19 decision |
| S9 | Payment recording | Not specified | `sales.payments.create` from three completion sites, idempotent, plus repair worker (`1e2c669308`, `6ce0a445ff`) | (a) G4 |
| S10 | Jobs | §12: four jobs incl. `retry-failed-compensations` | Six workers: no `retry-failed-compensations`; adds `repair-gateway-payments` (15 min) and `repair-order-compensation` (10 min); `submit_progress: 'compensating'` | (a) |
| S11 | Ops notification | §7.3, §9.2, R9 | None raised; log line only (`submit.ts:910,1803`) | (a) define + (b) implement |
| S12 | Identity binding | §4.1/§9.0: session `customer_user_id` | Live cart's `customer_user_id` (`lib/currentSessionRoute.ts:56-72`) | (a) |
| S13 | Pay-link slots | §4.3: "usage limit" checked at seeding | Probe at seeding, atomic reserve at submit, single release (`payLinkCartSeed.ts`, `submit.ts:525-553`) | (a) |
| S14 | Delivery currency | §5.3 silent | Mismatched-currency rates dropped (`deliveryRateQuote.ts`, review M5) | (a) |
| S15 | Digital-only carts | §5.2: `delivery` skippable | Submit requires `shippingMethod` + `shippingAddress` (`submit.ts:405-428`) | (c) D4 |
| S16 | `quoted_totals` | §4.1/§7.1 #10: goods, `cartUpdatedAt`, re-evaluated on cart change | Delivery cost and discount only (`commands/delivery.ts:148`, `submit.ts:674-689`) | (b) |
| S17 | Pending approval on a new session | §8.2 item 4 | Not implemented | (b) |
| S18 | Mutation guards on buyer routes | §11 implies them | Not wired | (b) |
| S19 | Peer reads | §19: DI or command bus | Raw Kysely over 8 foreign tables | (c) D5 |
| S20 | Money arithmetic | §7.2 "4 dp per key"; §4.3 `numeric(12,2)` | Floats with epsilon; `numeric(12,2)` columns vs `main`'s `ExactDecimalType` | (a) + (b) |
| S21 | Encryption backfill | Not specified | Missing for `checkout:checkout_session` | (a) + (b) |
| S22 | Trusted context helper | `…/commands/trustedContext`, `actor: { type }` | `…/commands/trusted-context`, `actorType` | (a): align with the shipped helper |
| S23 | Phase A changes | §3.2: untouched | Fail-closed 503 without a limiter (decided); four subscribers rewritten and #9597's helper deleted; `link_id` nullable; `updateStatus` link-less branch | (a) record; (c) D3 for the subscribers |
| S24 | Admin routes | §9: viewer routes are B.6; §9.1 ships only features | `GET /sessions` and `GET /sessions/[id]` ship with B.1 under `checkout.sessions.view` | (a) |
| S25 | B.2 templates | §4.3, §11: `checkout.cartTemplate.*` commands, `CrudForm`, freeform lines, mixed-currency rejection | No commands, no UI; `product_id` required; mixed currency not rejected (rows only via SQL) | (b): the B.2 gate cannot pass as ported |
| S26 | Events | §10: `step_changed`, `cartTemplate.*` | Not declared (`events.ts`) | (b) |
| S27 | Approval command registration | §11 | `commands/approval.ts` not imported by `commands/index.ts`, so workers never have it | (b) |
| S28 | ACL wording | §9.1: admin "covered by `checkout.*`" | Explicit admin list, both features added; `employee` gets `.view` | (a) |
| S29 | Flat-rate store setting | §5.3 | `EcommerceStoreSettings.shipping` required; link columns not writable (no route, no UI) | (b) optional key; (a) say how link flat rates are set |

## C1–C26 of `ANALYSIS-2026-10-26-checkout-release-5.md`: resolved by v2.3?

| Finding | Status | Note |
|---|---|---|
| C1 lock through payment | Resolved | §6, §7.2 step 7 |
| C2 fresh route context | Resolved | §6 |
| C3 idempotent document | **Not resolved** | Holds only until the quote is converted, which deletes it (Blocker 1) |
| C4 token transport | Resolved | §9.0, §13 |
| C5 codes and usage before payment | Resolved | Simplify per S7 |
| C6 credit linkage | Resolved | §7.2 6b, §8.3 |
| C7 totals invariant | **Not resolved** | The specified check is defeated by snapshot drafts without tax metadata (#9389, Blocker 3) |
| C8 delivery promotions | Resolved | §5.4; add identical code inputs at selection and at submit |
| C9 store/channel/currency consistency | Resolved | §7.1 #4 |
| C10 soft dependencies | Resolved | §3.4; add `wms` |
| C11 event-driven approval | Resolved | §8.2 (item 4 missing at the reference, G7) |
| C12 buyer authentication | Resolved | §9.0, §4.3; the binding source must be the live cart (S12) |
| C13 rate inputs | Resolved | §5.3; currency gap (S14) |
| C14 security minimum | **Partly** | The encryption-map backfill is missing (Blocker 4); mutation guards not named (R-2) |
| C15 B.5 terms | **Partly** | The PO number does not reach the order (#8413) |
| C16 quote releases stock | Resolved | §8.6 |
| C17 non-confirmed status | **Partly** | No status entry is named; the order inherits a quote-status entry |
| C18 `lineMap` | Resolved | Holds with either document path (line `metadata` is copied) |
| C19 sequence | Resolved | §7.2 |
| C20 optimistic locking | Resolved | §4.1, §4.3 |
| C21 cross-tenant | Resolved | §9.0, §13 |
| C22 event payloads | Resolved | §10 |
| C23 wording | Resolved | §8.3 |
| C24 recovery table | **Partly** | The post-conversion row is wrong (Blocker 1) |
| C25 ACL | Resolved | §9.1 (wording, S28) |
| C26 coverage | **Partly** | Add the G1–G4 cases and the CI-selected real-PG suites |

## 📋 Remediation plan

1. **Before implementation:**
   1. Take D1. Rewrite §7.2 5a–5d, §7.3 and §12.1 around an order-level `external_reference`. Add the `sales_orders` index to §14a.
   2. Add the §7.2 field-mapping table (G2).
   3. Rewrite §7.2 5b (G3) and amend the cart spec's snapshot contract and `TC-CART-LOCK-06`.
   4. Add the encryption backfill migration to §13, §14a and §17 B.1.
   5. Write request/response schemas for every §9 route, including the payment hand-off and return URLs.
   6. Specify payment recording and repair (G4), schedules for existing tenants (G5) and the ops notification (G6).
   7. Complete §14a with BC rows 1–8 and the Phase A changes (S23). Take D2–D5.
   8. Fix the §9.1 and §14a #13 wording; add §16 cases for G1–G4.
2. **During implementation (add to the plan):**
   - port by the CH slices with their must-keep fixes;
   - `isCrudHttpError` instead of `instanceof`;
   - `findWithDecryption` in the repair workers;
   - `runMutationGuards` on buyer writes;
   - `revertCodeUse?` optional;
   - `ExactDecimalType` money;
   - register `commands/approval.ts` in `commands/index.ts`;
   - real-PG concurrency suites named so CI selects them (#9183);
   - nested commands on the caller's transaction (#8414);
   - UPGRADE_NOTES for every row of BC 1, 3, 5, 7 and G5.
3. **After implementation (follow-up):**
   - B.6 viewer;
   - the `checkout.cartTemplate.*` admin UI, if B.2 ships with rows only;
   - #8426 re-test (blocked by #9389);
   - #8940 item 4.

## 🧪 Audit limits

- Searched: the full spec. `main` sources for checkout (`index.ts`, `acl.ts`, `setup.ts`, `encryption.ts`, `migrations/`, `lib/rateLimiter.ts`, `commands/transactions.ts`); sales (`commands/documents.ts` create/convert/notification, `data/validators.ts`, `data/entities.ts`, `notifications.ts`); `cart/lib/promotionContext.ts` and commit `4ab033c20f`; `ecommerce/lib/storeContextService.ts`; existence checks for the customer_groups, promotions, payment_gateways and shipping_carriers services.
- Reference files read in full or in the relevant ranges: `commands/submit.ts` (1–1020, 1700–1930), `workers/recover-stuck-submits.worker.ts`, `cart/lib/toSalesSnapshots.ts`, `data/entities.ts` (`CheckoutSession`), `events.ts`, `setup.ts`/`acl.ts`/`encryption.ts` diffs, `Migration20261028020000`, `lib/currentSessionRoute.ts`, `lib/sessionEvents.ts`, `shared/lib/commands/trusted-context.ts`, `promotions/lib/types.ts`.
- For the slice boundaries and for files not read here (`payLinkCartSeed.ts`, `deliveryRateQuote.ts`, the repair workers, the gateway subscribers), the audit relied on `analysis/slices-checkout.md`, `analysis/review-history.md` and `parts/appendix-issues.md`. Claims taken from them are cited by commit or review round.
- #9389's mechanism is inferred from the code (the snapshot drops `metadata`; the recompute compares against `Cart.totals`) and matches the reported `mismatchKey: "taxTotalAmount"`. It was not reproduced at runtime. No tests or builds were run.
- No `.uxproof/` contract applies: the scope adds no `.tsx` (B.2's `CrudForm` group is not in the reference). No `product-brief.md` exists. No suspected prompt injection was found.
