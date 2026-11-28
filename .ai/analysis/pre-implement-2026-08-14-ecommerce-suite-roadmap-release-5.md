# 🔍 Pre-implementation analysis: Ecommerce Suite Roadmap, Release 5 revisions

**Readiness: conditional.** No ADR contradicts a child spec on a decided behaviour, and every code claim checked against the reference holds except one (the D-R5-24 payable check). Nine ADR gaps would still mislead the people porting the code. The order-lifecycle inverses (order deletion, undo of a cancellation) are missing from ADR-4, ADR-6 and R6, although the reference already handles them. The trusted-context helper's caller set, import path and input shape are stated three different ways. ADR-6 does not mention that D-R5-24's payable amount is computed outside `salesCalculationService`, which ADR-2 forbids.

Spec: `.ai/specs/2026-08-14-ecommerce-suite-roadmap.md` (2026-10-26 changelog entry) · audited 2026-11-19 against `BACKWARD_COMPATIBILITY.md` (14 categories); no template (umbrella ADR record). Scope covers ADR-3, ADR-4, ADR-6, ADR-7, ADR-10, R5 and R6 only. They were checked against:
- the seven revised child specs;
- `ANALYSIS-2026-10-26-ecommerce-release-5-cross-spec.md` (X1–X20, final implementation order);
- `ANALYSIS-2026-10-26-ecommerce-release-5-scope.md`;
- the decisions register (D-R5-1…37);
- `main` (worktree HEAD) and the reference `bdb747c36a` (`refs/remotes/pr/8268`).

**Next action.** The roadmap ships no code. Apply the "Before implementation" edits below in the wave 0 spec PR. Each wave 1+ PR follows its own child-spec audit (via the `om-auto-implement-spec` skill).

## ⚠️ Decisions for the spec owner

1. **Should the D-R5-24 payable amount be computed by checkout or by `sales`?** ADR-2 says `cart` and `checkout` keep one arithmetic path. D-R5-24, as written in checkout §7.2 step 2, computes `payable = goods gross + delivery cost − delivery discount` in checkout.
   - **Recommended:** have `salesCalculationService.calculateDocumentTotals` compute payable, with the selected shipping line and the delivery-discount adjustment included. This is the same call the C7 guard already makes. Record it in ADR-6.
   - **Alternative:** add an explicit exception to ADR-2.
   - **Tradeoff:** the recommended option costs one more `calculateDocumentTotals` call at submit. In exchange, shipping tax is never left out of the credit reservation.
2. **What happens to credit when a cancellation is undone and the account is full?** (#8819, open, reference fix is partial.) This is the inverse of D-R5-2's automatic release. Options:
   - (a) refuse the undo;
   - (b) reinstate over the limit and notify;
   - (c) reinstate nothing and flag it.
   - **Recommended:** (a), because it keeps R6's "Low" residual true. The tradeoff is that ops must lower exposure before an undo.
3. **Name of the trusted-context import path.** It becomes a frozen surface (BC §4) once wave 1 ships.
   - **Recommended:** `@open-mercato/shared/lib/commands/trusted-context`, the path the reference already uses. The barrel `@open-mercato/shared/lib/commands` stays as a second entry point.
   - **Tradeoff:** three specs need a one-word fix. The alternative, renaming the reference file while porting, works too, as long as it happens before the first PR merges.

## 📋 Readiness gate (adapted: consistency, not phases)

| # | Item | Result | Evidence / fix |
|---|------|--------|----------------|
| R1 | Declared status | ✅ | "Specification (umbrella)"; the document says it contains no implementable work of its own (§1) |
| R2 | No blocking open questions | ✅ | Every §11 item is delegated to a child spec and none blocks Release 5. Q1 and Q2 have since been decided but are still listed as open (Important 4) |
| R3 | Traceability | ✅ | Every Release 5 bullet cites its D-R5 id and the child-spec section that owns it |
| R4 | Contracts defined | ✅ (delegated) | The child specs own the shapes. Consistency gaps are listed below |
| R5 | Phases deliverable | ✅ with gap | §7 exists, but it does not point at the Release 5 wave order (Important 9) |
| R6 | Grounded in the codebase | ✅ | All `main` claims hold: `wms.inventory.reserve`/`.release` are `isUndoable: false` (`wms/commands/inventory-actions.ts:960-962,1154-1156`); `cart`, `availability`, `customer_groups`, `ecommerce` and `promotions` exist; `assisted_selling`, `wmsReservationService` and `trusted-context.ts` are absent, as expected for planned work |

## 💥 Backward compatibility

The roadmap defines no surface of its own. Categories 1, 5, 6, 8, 10, 11, 12, 13 and 14 cannot be touched by a roadmap and were skipped. Categories 2, 4, 7 and 9 were cross-checked through the ADRs. The new DI keys under category 9 are additive and need no row.

| # | Surface | Where | Change | Severity | Migration path |
|---|---------|-------|--------|----------|----------------|
| B1 | §2 Types: `StoreContextService` | ADR-7 (l.340) → SPEC-029 §6 (l.311) | SPEC-029 declares `resolveForBuyer(...)` as a **required** interface member. That breaks any third-party implementer. The owner made it optional (2026-11-19), and the reference declares `resolveForBuyer?` (`ecommerce/lib/storeContextService.ts:79`) | Warning | Make it `resolveForBuyer?(...)` in SPEC-029 §6. ADR-7 adds "optional member; callers feature-check it", matching how the reference callers handle it (`payLinkCartSeed.ts:198`, `assisted_selling/commands/proposals.ts:343`) |
| B2 | §4 Import paths | ADR-7 l.340, cart §3.1a l.113, checkout l.847 | `@open-mercato/shared/lib/commands/trustedContext`. The reference ships `…/commands/trusted-context`, plus the barrel export (`shared/src/lib/commands/index.ts:30-35`) | Warning | Owner decision 3, then fix all three specs in one edit before the wave 1 shared PR merges |
| B3 | §7 API routes (behaviour) | ADR-7 l.342, §12 l.602 | D-R5-21/-33 refuse token-only access to identified baskets and sessions on routes shipped in Release 4. §12 still claims "no deprecation protocol is triggered" | Warning | Rewrite the §12 BC row so it lists the Release 5 behaviour changes and their `UPGRADE_NOTES.md` entries: D-R5-21, thresholds that start to apply (D-R5-4/-37), and the optional `resolveForBuyer` (B1). Wave 6 already plans those notes |

## 🔍 Gaps

**Critical** — none.

**Important**

1. **The trusted-context helper is stated three ways** (ADR-7 l.340; cart §3.1a l.113; checkout l.243, l.759).
   - ADR-7 lists four callers and says "the command context these callers run under comes from one shared helper". Two of the four don't use it: assisted-selling authoring runs under the rep's own request, and trusted `api`/`agent` carts run under a principal holding `cart.channel.*` (cart §6a.4 item 4). Cart §3.1a lists a different set of three.
   - The reference uses the helper for more than either list. Checkout submit runs its `sales.*` and `availability.*` writes, compensation and completion under it (`checkout/commands/submit.ts:124-135,569,1194,1382`), and the `availability` service context is built with it (`availability/lib/reservationCommands.ts:219-227`).
   - **Fix:** ADR-7 states a rule instead of a list: every command context not derived from the acting principal's own request is built through the helper. It names the helper's input shape and the audit marker once (Spec vs. reference rows 1–5).
2. **ADR-4, ADR-6 and R6 stop at "cancel releases".**
   - ADR-6 (l.270) releases credit on `sales.order.cancelled` only. ADR-4 (l.240) relies on `wms` releasing on cancel, and the child specs say the same (no `sales.order.deleted` or reinstatement in the customer-groups, availability or checkout specs).
   - The reference also releases credit on `sales.order.deleted`, reinstates on re-confirmation, and serializes every lifecycle handler of one order on an advisory lock with a status fence. See `customer_groups/subscribers/order-deleted-credit-release.ts` and `order-confirmed-credit-reinstate.ts`, review R13–R15, and #8404, #8406 and #9073.
   - **Fix:** ADR-6 gains one bullet: an order's credit and stock follow its current status (cancel or delete releases; revival re-holds, or is refused per owner decision 2); handlers serialize per order. Customer groups §6.5/§11 and availability §7 carry the detail. Raise R6's residual to Medium until #8819 is decided.
3. **D-R5-24's payable amount versus ADR-2** (owner decision 1). ADR-6 (l.270) says the full payable total is reserved but does not say who computes it. Checkout §7.2 step 2 computes it with checkout arithmetic. The reference compares that number with itself and never with the document (Spec vs. reference row 7). #9389 (High, open) shows that the goods-side C7 guard already disagrees with `sales` (`taxTotalAmount`) since `main`'s #8425 fix.
   - **Fix:** ADR-6 names the source of payable and the invariant "credit reserved = the document's grand total gross".
4. **Stale open point (ADR-3 l.201; §11 Q1 l.587).** Both still lean towards `workflows`. Checkout v2.3 decided "a fixed state machine, not a workflow; no workflow runs in Release 5" (checkout l.26, l.132, §5.1).
   - **Fix:** replace the ADR-3 "Open point" with the decision and a pointer to checkout §5. Mark §11 Q1 decided. Mark Q2 decided as well: guests cannot buy on account (D-R5-12, and on-account needs a company, #8407). This is required by `.ai/specs/AGENTS.md` ("Never leave stale … assumptions").
5. **The session binding covers only `/current/*`** (ADR-3 l.199; checkout §9.0 l.612). The reference found that a link-session resume through `POST /api/checkout/sessions` returned session PII without the buyer binding (review R21 C1, `commands/session.ts:82-92`; fixed in `2c3efcac30`).
   - **Fix:** in ADR-3 and checkout §9.0, "every route that returns or mutates session data, including the create/resume call".
6. **ADR-6 leaves out D-R5-37** (l.272). The ADR still reads "compared only in the new `terms_currency_code`". Customer groups §5.3 (l.176) and cart (l.724) carry the base-currency fallback. Without it, an implementer who reads only the ADR builds fail-closed behaviour for every tenant upgrading from Phase 2.
   - **Fix:** add "falling back to the organization's base currency (D-R5-37)".
7. **§12 BC row is stale** (B3, plus B1).
8. **No suite-wide encryption-backfill rule.** Tenant encryption maps are seeded only when a tenant is created. None of the eComm child specs names `buildEncryptionMapBackfillSql`, and the reference has no backfill for its new maps (#8893, High; checkout `Migration20261109120000.ts` covers only the older checkout entities).
   - **Fix:** add a §12 row: "every new or extended `encryption.ts` map in a suite module ships a `buildEncryptionMapBackfillSql` migration (`packages/core/AGENTS.md` → Encryption)". This is a suite-wide rule like D-R5-32's event-scope rule.
9. **§7 phasing and the Release 5 order don't match.** §7 records only the spec 13 exception (l.514). Release 5 also lands spec 1 Phases 3–4 and spec 2 Phase 3 with Phase 3 (conversion). The Phase 3 gate (l.507) has no Release 5 criteria: stock commit before payment, the approval gate, the quote outcome, `lineMap` attribution. The §6 row 7 "Depends on" still reads `5` only.
   - **Fix:** add a "Release 5" note under §7 that points at the cross-spec "Final implementation order" as the binding sequence and extends the Phase 3 gate with those four items. This is the failure the 2026-09-06 changelog entry records ("an implementer using this roadmap as the suite's index would not have found…").

**Nice-to-have**

- R5 (l.578): "there is no unheld window from the hold until `commit`" holds only while the 900 s TTL lasts. Availability §7 (l.574) covers the sweep winning first. Add "within the hold TTL", and cite #8414 (last-unit submits still failed under 20× load in QA round 4) as the open evidence behind the Medium residual.
- ADR-3 (l.194-197): the soft-dependency list leaves out `sales` and `ecommerce` (both `503 checkout_sessions_unavailable`; for `ecommerce`, storefront carts only), `payment_gateways` and `shipping_carriers`. Point at checkout §3.4 as the canonical table. The reference matches §3.4 (`cartSessionConsistency.ts:83-103`, `submit.ts:513,809`).
- ADR-10 (l.409): re-authoring is described for "merged at login" only. Adoption (`cart.cart.adopted`, #9392) also migrates the buyer identity. Add one clause, as assisted-selling l.302 and l.895 already do.
- §6 statuses ("to write" for specs that exist) predate Release 5. Refresh them when the roadmap is next touched.

## 🔀 Spec vs. reference implementation (ADR claims about code only)

The following claims match the reference and need no row:
- **Checkout:**
  - no new `requires` (`checkout/index.ts`, identical to `b7b5309ccc`);
  - `token_hash` only (`checkout/data/entities.ts:530-533`);
  - the `X-Checkout-Session-Token` header (`lib/currentSessionRoute.ts:14`);
  - `503 checkout_sessions_unavailable` (`commands/session.ts:44`).
- **Availability and `wms`:**
  - per-line outcomes `held|not_tracked|preorder|backorder|shortfall` (`availability/data/entities.ts:106`);
  - `isUndoable: false` (`availability/commands/reservations.ts:24,43,61`);
  - the four `wmsReservationService` methods (`wms/lib/wmsReservationService.ts:770,941,1046,1209`);
  - `warehouseIds` (`availability/data/validators.ts:154`).
- **Customer groups:**
  - the `PESSIMISTIC_WRITE` credit lock (`customer_groups/services/customerCreditService.ts:592,851,981`);
  - the separate credit and approval DI keys (`customer_groups/di.ts:48,53`);
  - the 14-day approval expiry (`customerPurchaseApprovalService.ts:186`);
  - approval notifications sent only by `customer_groups` (the cart has no `notifications.ts`; checkout's notifications are about transactions and links only).
- **Cart and assisted selling:**
  - `409 merge_undo_not_supported_for_proposal` (`cart/commands/merge.ts:1263`);
  - `mode` limited to `rep|off` (`assisted_selling/data/validators.ts:14`);
  - the `lineMap` entry with `salesOrderLineId?`/`salesQuoteLineId?` (`cart/data/validators.ts:289-293`).

| # | Spec says | Reference at `bdb747c36a` | Class |
|---|-----------|---------------------------|-------|
| 1 | Helper path `@open-mercato/shared/lib/commands/trustedContext` (ADR-7 l.340; cart l.113; checkout l.847) | `packages/shared/src/lib/commands/trusted-context.ts`, re-exported from `lib/commands/index.ts:30-35`. Callers import both forms (`submit.ts:5`, `payLinkCartSeed.ts:3`) | (a) spec should change, per owner decision 3 |
| 2 | Helper input `actor: { type: 'system' } \| { type: 'user'; userId }` (cart l.113; checkout l.243, l.759) | Flat `actorType: 'system' \| 'user'`, `actorId?`, `reason` (`trusted-context.ts`, `TrustedCommandContextInput`) | (a) |
| 3 | "A `user` actor's ACL is loaded fresh by the helper" (cart l.113) | The helper builds `auth: { sub, tenantId, orgId }` and loads no ACL. The caller checks the ACL (`assisted_selling/lib/reauthorOnMerge.ts`) | (a): put the duty on the caller, or (b) move it into the helper. Pick one before CA8/AS4 |
| 4 | Four callers, all on the helper (ADR-7 l.334-340) | Helper used by pay-link seeding (`payLinkCartSeed.ts:229`), re-authoring (`reauthorOnMerge.ts:112,356`), checkout submit's sales/availability writes and compensation (`submit.ts:124-135`), and the availability service context (`reservationCommands.ts:219-227`). Not used by assisted-selling authoring or by `api`/`agent` carts | (a), see Important 1 |
| 5 | X10: "the revision pass names where the system-initiated marker is stored". No spec names it | `auditMetadata.context = { systemActor: 'system:trusted-context', reason }`, reusing the command bus's `systemActor` key (`trusted-context.ts`, `TRUSTED_CONTEXT_MARKER`) | (a): record it in ADR-7 or cart §3.1a |
| 6 | Credit released on `sales.order.cancelled` only (ADR-6 l.270; customer groups l.583, l.909) | Plus `order-deleted-credit-release.ts` and `order-confirmed-credit-reinstate.ts`, serialized per order with a status fence (review R13–R15). #8819 (reinstating over a full limit) is only partly handled | (a) for delete and reinstate; (c) for #8819 |
| 7 | D-R5-24: "after document creation it compares the order's grand total gross with the reserved amount"; checkout §7.2 step 5b "quote grand total gross = payable" | `submit.ts:774-777` computes payable as goods + delivery cost − discount. `submit.ts:907-908` recomputes the same sum from `calculateDocumentTotals` over the goods lines only, plus the same delivery numbers. The persisted quote's grand total is never read, so a shipping-tax difference goes undetected. It is also unverified whether `freshDeliveryCost` is gross | (b) reference must change: compare with the persisted document's grand total gross. Then apply owner decision 1 |
| 8 | `resolveForBuyer` required on `StoreContextService` (SPEC-029 §6 l.311, which ADR-7 cites) | `resolveForBuyer?` (`ecommerce/lib/storeContextService.ts:79`), per the settled owner decision | (a) |
| 9 | Session binding on `/api/checkout/sessions/current/*` (ADR-3 l.199; checkout l.612) | The binding also had to be enforced on the link-session resume through `POST /api/checkout/sessions` (`2c3efcac30`, review R21 C1) | (a) |

## ⚠️ Risks

| Risk | Level | Impact | Mitigation |
|------|-------|--------|------------|
| Credit or stock out of step with the order after undo, revival or deletion (#8404, #8406, #8819, #9073) | High | Live on-account orders with no credit hold or no stock, or exposure past the limit. R6's "Low" residual is not true today | Important 2; owner decision 2; the per-order lock and status fence from the reference become spec invariants; port the #9183 race tests with CG5b |
| Payable or totals divergence at submit (#9389 open High, #9390) | High | `500 totals_mismatch` and an orphan draft quote on every attempt with a percentage code, or credit reserved below the invoiced total | Owner decision 1; Spec vs. reference row 7; CH4 must match `main`'s #8425 tax fix |
| Import path frozen before the name is settled | Medium | A second path, or a deprecation bridge, from the first release on | Owner decision 3 before the wave 1 shared PR |
| Last-unit oversell or pool exhaustion under load (#8414 open) | Medium | 500 instead of `409 stock_shortfall` on concurrent submits | R5 wording (Nice-to-have); AV2a runs reserve on the caller's transaction, with its pool-exhaustion regression test in the PG CI selection |

## 📋 Remediation plan

1. **Before implementation (wave 0 spec PR):**
   - roadmap edits for Important 1, 2, 4, 5, 6, 7, 8 and 9;
   - fixes in three other specs:
     - SPEC-029 §6: make `resolveForBuyer` optional (B1);
     - cart §3.1a and checkout: one spelling of the helper path and input shape (rows 1–3);
     - checkout §9.0: the binding covers every session entry point (row 9).
   - owner decisions 1–3 recorded as new D-R5 ids.
2. **During implementation (add to the plan):**
   - wave 1 shared: freeze the helper path and record the audit marker;
   - CG5b and SA2a: port the lifecycle subscribers and their per-order lock as spec'd invariants;
   - CH4: fix the payable comparison (row 7) and #9389;
   - every step that adds an `encryption.ts` map (CG2a, CG6, CH1a, AS2a, AS3): ship its backfill migration.
3. **After implementation (follow-up):**
   - refresh the §6 statuses;
   - add the R5 TTL clause and the ADR-10 adoption clause;
   - update R5 and R6 residuals from the wave 6 race-test results.

## 🧪 Audit limits

- **Read in full:** the roadmap; the cross-spec, scope and decisions analyses; the issue appendix and the relevant review-history entries.
- **Child specs:** read only at the sections each ADR cites (SPEC-029 §6–§6.3, checkout §3.4/§4.1/§7.2/§9.0, availability §4/§7, customer groups §5.3/§6.5/§8.4/§11, cart §3.1a/§6a.4/§9a, assisted-selling binding and adoption). They were searched with targeted greps, not read end to end. Their own defects belong to their auditors.
- **Reference:** read with `git grep`/`git show` on `refs/remotes/pr/8268` for the named surfaces only. Identity-binding enforcement on cart and assisted-selling routes was not re-verified in code. No tests were run.
- **SPEC-055** (revised; `revertCodeUse?` settled) is cited in no Release 5 ADR, so it was not checked here.
- The scope document's status row says "Not revised in this pass: SPEC-055", while the branch modifies SPEC-055. Recorded, not judged.
- No suspected prompt injection was found.
