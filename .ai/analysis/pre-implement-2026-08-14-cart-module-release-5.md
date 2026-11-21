# 🔍 Pre-implementation analysis: Cart Module — Phase 4 (eComm Release 5)

**Readiness: conditional** — no finding blocks the start, but a port that follows the spec text alone would bring back the approval-gate race the review rounds found. It would also reopen an approval bypass (a quote-purpose lock converted as an order), compare money as floats on a `main` that has exact decimals, and fail its own 4a gate on 4b-only dependencies.
Spec: `.ai/specs/2026-08-14-cart-module.md` (rev 10) · scope Phase 4 (4a, 4b, 4c) plus §11, §12, §14, §15a, §16a · audited 2026-11-19 against `BACKWARD_COMPATIBILITY.md`, template: built-in (no `paths.specTemplate`, no template in `.ai/specs/`) · grounded in `origin/main` (worktree `feat/r5-spec-revision`) and the reference `refs/remotes/pr/8268` @ `bdb747c36a` (diff base `b7b5309ccc`).

Counts: **0 Critical · 18 Important · 12 Nice-to-have/Low.** BC: 0 Critical, 2 Warnings.

Next action: implement with the `om-auto-implement-spec` skill, one PR per slice, adding the "during implementation" items below to each slice plan. Fold the "before implementation" spec edits into the first 4a PR's spec update.

## ⚠️ Decisions for the spec owner

| # | Question | Recommended answer | Trade-off |
|---|---|---|---|
| D1 | Is `checkoutSessionId` **required** on `cart.unlock` / `cart.markConverted` (spec §9.1, §16a) or optional (reference `commands/lock.ts:404-409,480-482`)? | Required, enforced at runtime (a missing value gets the uniform `404`), recorded in `UPGRADE_NOTES.md` as a signature change on a STABLE DI service. No caller outside `cart` exists on `main` (searched `packages/**`). | Optional is BC-safe, but omitting the id silently skips the C1 session binding. |
| D2 | What does `cart.lock` do with an `abandoned` basket? Spec §9 says "any mutation" reactivates it. The reference answers `404` (`lock.ts:167`). Checkout §674 expects `409 cart_not_active` and tells the buyer to "start from the current cart", which is this same cart. | `cart.lock` reactivates an `abandoned` basket (it is a buyer-triggered mutation), then runs the normal fresh lock. `merged`/`expired`/`converted` answer `409 cart_not_active` with `status`, as §9.1 and checkout expect. | Reactivation also extends `expires_at` from checkout. Refusing leaves a buyer who returns after 24 h at a dead end. |
| D3 | Must the lock `purpose` be bound to the conversion outcome? | Yes. Persist the lock purpose (additive `carts.lock_purpose`). `markConverted({ salesOrderId })` on a `purpose: 'quote'` lock is refused (`409`), and switching purpose needs unlock + lock (already the §9.1 rule). | One more column. Without it the cart's gate (R17, "the cart is the control") relies on checkout never mixing the two. |
| D4 | `GET /api/cart/carts?kind=proposal` and a proposal detail (§10.2, `TC-CART-ADM-02`): ship them or not? The reference accepts only `kind = basket` (`api/carts/route.ts:85,191`; `[id]/route.ts:65`). | Ship them as specified. The assisted-selling console reads through this route (§10.2), and the seam ships under D-R5-11. | About 40 LOC more in 4a or 4c. Dropping them means editing §10.2, ADM-02 and assisted selling. |
| D5 | K11 on reactivation: §12 says a returning basket "re-reserves on its next evaluation". `main`'s `extendReservation` is a no-op once the reservation is gone (`promotions/lib/code-service.ts:348-358`), so the code is dropped with `no_longer_valid`. | Say "the code is dropped with `cart.promotion.no_longer_valid` and a warning; the buyer re-enters it". Do not build re-reservation in Release 5. | A buyer away for more than 24 h loses a code. That matches R8's intent. |

## 📋 Readiness gate

| # | Item | Result | Evidence / fix |
|---|------|--------|----------------|
| R1 | Declared status | ⚠️ | `Status` is "Specification (rev 10 … Phase 4 specified … not built)". The repo defines no ready vocabulary (`SDLC.md` and `.ai/specs/AGENTS.md` have none), so this is an Important gap, not a fail. Set it to "Approved for implementation — Phase 4 (Release 5), decisions D-R5-* applied". |
| R2 | No blocking open questions | ✅ | §16 Q1–Q9 are closed. There are no `⚠ NEEDS HUMAN CONFIRMATION` entries. The tax-provider pointer in §5.2 trigger 5 is explicitly outside Release 5. |
| R3 | Traceability | ⚠️ | Almost every requirement has a `TC-CART-*` oracle. Missing: `cart.lock.extended` (I14), the binding between purpose and conversion (D3), rate limits on the new buyer routes (`CART_MUTATE`/`CART_READ`, §15a), the stuck `awaiting_approval_since` case (I10), and the `cart:cart` encryption backfill (I4). |
| R4 | Contracts defined | ⚠️ | Response shapes are missing for `GET /proposals` items, `POST /proposals/:id/reject`, the `accept` response and the per-line fields of `acceptancePreview`. These routes freeze as STABLE on ship (§15). Four emitted error codes are undocumented (I14, I16). |
| R5 | Phases are deliverable | ⚠️ | The 4a gate needs 4b work (`awaitingApproval` filter, ADM-04 live approval, SWP-02 approval withdrawal). APR-01 (4b) needs 4c, and PROP-12 (4c) needs 4b. The single "Phase 4 migration" spans the phases (I12). |
| R6 | Grounded in the codebase | ⚠️ | Phase 4 surfaces are described correctly against `main` and the reference. Imprecise: the `resolveTerms` call shape (`main` requires `customerId`, `customer_groups/services/customerGroupsService.ts:75-81`) and the `requestApproval` input (I11). Out of scope but contradicting §8.4/BIND-01: `POST /current/reprice` is in the §10 table and in the §15a `CART_MUTATE` list, yet exists neither on `main` nor in the reference (I18). |

## 💥 Backward compatibility

Phase 4 is additive across all 14 surfaces in `BACKWARD_COMPATIBILITY.md`, with two Warnings:

| # | Surface | Phase/step | Change | Severity | Migration path |
|---|---------|------------|--------|----------|----------------|
| B1 | 3 Function signatures / 9 DI (`cartService`) | 4a | §9.1/§16a make `checkoutSessionId` required on `unlock`/`markConverted` and label it "Additive". Adding a required parameter to a shipped STABLE service is a narrowing, not an addition. | Warning | Decide D1, then classify it in §16a as a signature change. Add a `UPGRADE_NOTES.md` entry next to D-R5-21's. Keep the TS field optional for one minor version if the owner wants the bridge, but refuse at runtime. |
| B2 | 5 Event IDs | 4a | The reference adds `cart.lock.extended` (`events.ts:25`). It is additive, but §11 and §16a ("Event ids: unchanged") do not list it. | Warning | Add it to §11 with payload `{ cartId, tenantId, organizationId, checkoutSessionId }` and to the §16a table, or drop the emit from the port. |

The other surfaces are untouched or additive:
- **1 Auto-discovery:** new `subscribers/` files and `backend/cart/carts/**` pages follow the conventions; one event per subscriber file (`.ai/review-checklist.md:79-80`).
- **2 Types:** `CartLockInput`/`CartView` gain optional fields only.
- **4 Import paths:** untouched.
- **6 Widget spots:** new `data-table:cart.carts` only; see N5 for spots to declare before they freeze.
- **7 Routes:** new routes only, plus the documented D-R5-21 behaviour change.
- **8 DB:** three additive columns and one index. A STORED generated column rewrites `carts` once (N10).
- **10 ACL:** no new feature.
- **11 Notifications:** none.
- **12 AI ids:** none.
- **13 CLI:** none.
- **14 Generated files:** `yarn generate` only.

§16a exists and covers the rest.

## 📝 Spec completeness

| Section | Missing / incomplete | Impact | What to add |
|---------|----------------------|--------|-------------|
| §8.1 / §9.1 / §9a.3 / §7a.4 concurrency | The per-cart lock is specified for `lines.add`/`.bulkAdd` only. | The approval-gate bypass race found by proof returns (I1). | An "every writer of a cart's lines or status" rule (I1). |
| §4.1 / §16a data model | No `grand_total_gross_amount` generated column, though the admin sort and the K9 payload need one. The index in the spec differs from the reference's. §16a counts "one nullable column on carts". | The port invents the schema (I12, I13, I3). | Name every Phase 4 column and index and its phase. |
| §7a.4 / §10 proposal routes | Response shapes are missing, and `GET /proposals/:id` is absent (I16). | The routes freeze STABLE with undefined bodies. | Copy the reference shapes. |
| §15a | Four codes are undocumented (I14). | K10 recurs. | Add the rows and the i18n keys. |
| §17 encryption | `cart:cart` has no backfill (I4). | Tenants that predate Release 4 store `email`/`note` in plaintext. | A backfill migration in 4a. |

## 🔍 Repo-rule compliance

| Rule (source) | Spec location | Fix | Severity |
|---------------|---------------|-----|----------|
| A deployed module's GDPR map needs a `buildEncryptionMapBackfillSql` migration (`packages/core/AGENTS.md` Encryption, line 529; #8893) | §17, §10.2 (`email`/`note` decrypted in admin) | `cart` shipped in Release 4 with `encryption.ts` and no backfill (`cart/migrations/*` has no encryption SQL). Add one in the first 4a migration, copying `packages/checkout/src/modules/checkout/migrations/Migration20261109120000.ts`, with fields `email`, `note` and an empty `down()`. | Important |
| Integration tests for every new API path ship in the same change (root `AGENTS.md` → Documentation and Specifications; `.ai/qa/AGENTS.md`) | §14 | The reference has **no** new `__integration__/TC-CART-*.spec.ts` for Phase 4. Only `TC-CART-PRICE-01-02` changed; the rest is unit tests. These IDs appear nowhere in the reference: BIND, TRUST, ADM, SWP, B2B-05, LOCK-01…05, APR-10/11, PROP-01/02/03/05/06/08/12/13/15/17/18. Each slice must add its API-level specs. `cart` must also join the `test:pg-integration` regex (`packages/core/package.json`) with the first race test (I15). | Important |
| A catch that records an error MUST also `reportError` (`.ai/review-checklist.md:331`); persistent subscribers may be retried (`:81`) | §9a.5, §12 | `approvalDecidedSubscriber.ts:76-77` logs and swallows. Rethrow so the persistent queue retries. In the sweepers, best-effort catches (`releaseCartCodeReservations`, the expiry withdrawal) must call `reportError` (I10, N11). | Important |
| "Nothing under an advisory lock takes another pool connection; blocking waiters exhaust the pool" (`.ai/lessons/cart-contention-tests-must-prove-transaction-liveness.md`; spec §8.1 2026-10-27) | §9.1, §7a.4 | `cart.lock` (`lock.ts:288`) and `acquireCartLineLocks` (reference `lib/lineMutationLock.ts`) use a blocking `pg_advisory_xact_lock`. `main` uses try-lock with rollback and backoff (`lib/lineMutationLock.ts:41`). Extend `withCartLineMutationLock` to multiple keys and use it (I1). | Important |
| Money is exact (`main` #7324: `SalesDocumentAmounts.*Exact`, `sales/lib/types.ts:155-172`; `@open-mercato/shared/lib/decimal` `compareDecimals`) | §9a.1–9a.4 | Use `grandTotalGrossAmountExact` and `compareDecimals`. Never `Number()` or `String(number)` (I3). | Important |
| Mutation guards with real grants on custom write routes (review history §2.7, R21/R23/R27) | §10.2, §7a | The reference already does this (`api/carts/[id]/reprice/route.ts:119-125`). Keep it on every new write route. `request-approval` and the proposal buyer routes need the same treatment. | — (port note) |

## ⚠️ Risks

| Risk | Level | Impact | Mitigation |
|------|-------|--------|------------|
| A lock, merge or proposal accept racing a line write approves stale totals (review history §2.5: R1 → R6 plus the proof-found bypass "24 → 36 still locks") | High | An over-threshold order without approval, or a double lock that reserves stock and credit twice. | I1. Port CA0 first and keep the real-command race harness (#9183). |
| Quote-purpose lock converted as an order | High | Gate bypass if checkout mixes the outcomes. | D3. |
| Pay-link or `api` lock refused with `cart_has_unavailable_lines`, because the scope resolved from the request host is applied to an exempt cart (`lib/cartService.ts:265-279`; `api/carts/[id]/reprice/route.ts:150-169`; `shouldEnforceAssortmentScope(channel, scope)`) | Medium | A merchant's pay link cannot be paid. | I7. Resolve or apply a scope only when `cart.channel === 'storefront'`. |
| Approval withdrawn by a merge or quote conversion that later fails (`commands/merge.ts:987` runs before the locks at `:1030`; `lock.ts:597-600`) | Medium | The buyer loses a pending approval and must re-request. | I9. Withdraw after commit. |
| `awaiting_approval_since` stuck after a lost subscriber delivery | Medium | The basket is never abandoned, so no K9 recovery and no K11 release. | I10. |
| Generated column `numeric(16,4)` over the float JSON key (`Migration20261026231500_cart.ts`) | Medium | A total above 10^12 overflows on every cart write, a regression against `main`'s unbounded numerics (`Migration20261027113555_cart.ts`). It also rewrites `carts` on deploy. | I3, N10. |
| `getSalesSnapshot` adjustments rebuilt from `CartPromotionApplication` rows (`lib/toSalesSnapshots.ts:83`), not from the drafts the totals used | Medium | A `totals_mismatch` like #9389 after the #8425 tax fix. | LOCK-06 with a percentage code and the post-#8425 tax path, on real Postgres. |
| Migration `20261026231500` sorts before `main`'s `20261027113555` | Low | None found. MikroORM runs pending migrations by name and the statements are independent. | Keep the file names (QA databases recorded them). |

## 🔍 Gaps

- **Important I1 — concurrency contract for Phase 4 writers.** §8.1 should say this:
  - `cart.lock` (fresh and extend), `unlock`, `markConverted`, `cart.approval.request`, `cart.merge` (both carts), `mergeUndo`, and `cart.proposal.accept`/`.reject` (proposal + target) take `cart:lines:<id>` through `main`'s try-lock helper, in sorted key order, with the same 15 s budget and `503 cart_busy`.
  - `cart.lock` recomputes totals and `requires_approval` under the lock and changes status by compare-and-set (`WHERE status = 'active'`). A lost race answers `409 cart_lock_conflict`.
  - Accept re-checks both preview versions under the locks.
  - Evidence: review history §2.5 and §2.7, #8414, #9183, the `cart.lock` block at reference `lock.ts:270-311`.
- **Important I2 — purpose binding** (D3): §9.1 and §9a.6.
- **Important I3 — exact money.**
  - §9a.1 should name `totals.grandTotalGrossAmountExact` (float fallback only when it is absent).
  - Comparisons use `compareDecimals`, and `requestApproval.amountGross` is that exact string. The reference uses floats: `lib/approvalGate.ts:39-43,82`, `commands/approval.ts:135,173`.
  - Define the generated column as unbounded `numeric` over the `…Exact` key, or drop it in favour of query-engine sorting.
- **Important I4 — `cart:cart` encryption backfill:** see the compliance table.
- **Important I5 — session binding** (D1, B1).
- **Important I6 — lock status codes and abandoned baskets** (D2). Also `cart.proposal.create` against a `locked` target: the reference does `423` (`proposal.ts:244`) as the spec says. Keep it.
- **Important I7 — trusted and route context.**
  - `cartService.lock({ request })` and the admin reprice must not apply a resolved scope to a non-storefront cart (§6a.4 exemption).
  - For a storefront lock, assert that the resolved `routeContext.storeId` equals `cart.storeId`, and that its `customerUserId` equals `cart.customerUserId` when the cart is identified. This is defense in depth for D-R5-21/D-R5-33, which today rely on checkout's routes alone.
- **Important I8 — the recovery-lock seam (X15/D-R5-22) has no API.**
  - `ResolvedCartRouteContext` can be built only by `resolveCartRouteContext(request)`. §9.1 says recovery builds it through `resolveForBuyer`, but names no cart entry point.
  - The reference has none. `checkout/workers/recover-stuck-submits.worker.ts` never re-locks.
  - Specify a cart-internal builder, for example `cartService.lock({ …, fromStoredIdentity: true })`, which calls `resolveForBuyer` with `cart.storeId`/`customerUserId`/`customerId` under `buildTrustedCommandContext`. Otherwise `TC-CART-LOCK-04` has nothing to test.
- **Important I9 — approval withdrawal timing.** §7.4 says "inside the merge command". Change it to: after the merge commits, best-effort and idempotent (`approval_not_pending` counts as settled), with `awaiting_approval_since` cleared in the same post-commit step. Do the same for `markConverted` on a quote outcome.
- **Important I10 — stuck awaiting flag.** The subscriber rethrows. In addition, `mark-abandoned-carts` ignores an `awaiting_approval_since` older than the tenant's approval expiry plus a margin, or `expire-carts` reconciles it against `getApproval`.
- **Important I11 — cross-spec approval contract.**
  - Cart §9a.4 must use customer groups' `requestApproval({ scope, buyer: { customerIds }, requestedBy, … })` (customer-groups spec lines 463-472).
  - Both specs need a `cart_converted_as_quote` withdrawal reason. Today `withdrawn_reason` (customer-groups line 259) and the system-reason union (line 487) lack it. The reference added it (`lib/approvalLifecycle.ts:30-33`; review history: Nit R1 → Medium R6).
  - §9a.1's `resolveTerms` call must carry `customerId` (required on `main`) and `organizationId` (D-R5-37 fallback, CG1).
- **Important I12 — the phase cut.**
  - Assign each migration to a phase: `unit_price_override` → 4a (trusted path); the generated column + index → 4a (admin, K9); `awaiting_approval_since` → 4b.
  - Move from the 4a gate to 4b: the `awaitingApproval` filter and row field, ADM-04's live approval (4a asserts `approval: null` when the service is absent), and SWP-02's approval withdrawal (already in APR-08).
  - APR-01's "proposal acceptance" case moves to PROP-12, and 4c lists 4b as a prerequisite.
- **Important I13 — admin list.** D4, plus the index: the spec says `(tenant_id, organization_id, kind, last_activity_at)`, the reference `(tenant_id, status, grand_total_gross_amount)`. Specify both, or the one the default sort uses.
- **Important I14 — undocumented codes and event.**
  - Codes: `409 cart_lock_conflict` (`lock.ts:310`), `400 invalid_lock_ttl_ms` (`:84`), `400 cart_convert_line_map_invalid` (`:519`), `503 approval_service_unavailable` (`commands/approval.ts:106-108`).
  - Event: `cart.lock.extended` (B2).
  - Each needs a §15a row and `cart.errors.*` keys in 5 locales.
- **Important I15 — integration suites** in each slice (see the compliance table).
- **Important I16 — proposal buyer route shapes.**
  - Define the `GET /proposals` item: `{ proposalCartId, status, expiresAt, authoredByActorType, lineCount, totals, updatedAt }` or the reference's.
  - Define the `GET /proposals/:id` detail. The route exists in the reference (`api/proposals/[id]/route.ts`) and is absent from §10.
  - Define the `acceptancePreview` line fields, the accept response (the §10.1 envelope with `mergeSummary` and `priceChanges`), and the reject response.
- **Important I17 — proposal lines with variants (#8418, open, not fixed in the reference).** A product with variants and no `variantId` is rejected (`commands/proposal.ts:401-422` → `proposal_empty`). State the rule: resolve the default variant as `cart.lines.add` does, or reject with `reason: 'variant_required'`.
- **Important I18 — `POST /current/reprice`** (outside Phase 4). Remove it from §10 and §15a, or mark it unbuilt, so that "every `/current/*` route" in §8.4 and BIND-01 match reality.
- **Nice-to-have:** N1–N12 under "Spec vs. reference" and the remediation plan.

## Spec vs. reference implementation

(a) the spec should change · (b) the reference must change when ported · (c) owner decision.

| # | Topic | Spec | Reference @ `bdb747c36a` | Class |
|---|---|---|---|---|
| V1 | Lock and line-lock primitive | §8.1: try-lock and backoff for add/bulkAdd. Lock: silent. | Blocking `pg_advisory_xact_lock` in `cart.lock` (`commands/lock.ts:288`), and the new `acquireCartLineLocks` (`lib/lineMutationLock.ts`, merge `:1030,:1310`, accept `:627`). | (a) spec adds I1; (b) use `main`'s try-lock helper |
| V2 | Gate recompute under the lock, CAS status | Not stated. | Present (`lock.ts:220-311`). `409 cart_lock_conflict`. | (a) |
| V3 | Non-active status at lock | `409 cart_not_active` (§9.1); checkout §674 passes it through. | `404` (`lock.ts:167,206,359`). | (b), plus D2 for abandoned baskets |
| V4 | `checkoutSessionId` on unlock/markConverted | Required. | Optional; omission skips the check (`lock.ts:404-409,432,480-482,574`). | (c) D1 |
| V5 | Lock TTL errors | "Refused". | `400 invalid_lock_ttl_ms` (`lock.ts:78-85`). | (a) document |
| V6 | Extend event | None. | `cart.lock.extended` (`lock.ts:382`, `events.ts:25`). | (a) document, or (b) drop |
| V7 | Purpose | Not persisted; extend never changes it. | Not persisted; `markConverted` does not check the outcome against the purpose. | (c) D3 |
| V8 | lineMap bijection | "Every customer line … gift lines mapped like any other". | Every live line, gifts included. Both ids together is a `400 cart_convert_line_map_invalid` (`lock.ts:513-551`). | (a) say "every live line", name the code |
| V9 | Code release on convert and merge | Not stated (§12 covers abandon/expire only). | Released on convert (`lock.ts:631-634`) and on the merge source (`merge.ts:1062`). | (a) document; confirm with promotions that usage is recorded before release |
| V10 | Approval withdrawal timing | "Inside the merge command" (§7.4). | Before the locks and the flush (`merge.ts:987` vs `:1030`; `lock.ts:597-600`). | (a) after commit; (b) move it |
| V11 | Approval money basis | `grandTotalGrossAmount`, no comparison rule. | Float `Number()` (`approvalGate.ts:39-43,82`; `approval.ts:135,173`). | (a) Exact field + `compareDecimals`; (b) port on decimals |
| V12 | `resolveTerms` input | `{ customerIds, tenantId }`. | `{ customerId, customerIds, tenantId, organizationId }` (`approvalGate.ts:164-169`). | (a) |
| V13 | `requestApproval` input | `customerId: <company>`. | `buyer: { customerIds }`, `requestedBy.customerEntityId` (`approval.ts:163-175`), matching the customer-groups spec. | (a) |
| V14 | Approval-service-missing code | `503`, no code. | `503 approval_service_unavailable` (`approval.ts:106-108`). | (a) |
| V15 | Approval subscriber | One file `subscribers/approval-decided.ts`. Failure handling silent. | Four files (one event each) on a shared handler that swallows errors (`lib/approvalDecidedSubscriber.ts:76-77`). | (a) manifest; (b) rethrow + `reportError` |
| V16 | Trusted helper | `@open-mercato/shared/lib/commands/trustedContext`, `actor: {type…}`; "ACL loaded fresh by the helper". | `…/commands/trusted-context`, `{ actorType, actorId, reason }` returning `{ ctx, auditMetadata }`. No ACL load; the cart command loads features via `rbacService` (`commands/proposal.ts:103-121`). | (a) |
| V17 | Trusted pay-link tenant | Tenant and organization are the link's own, from the context. | Organization from the context; `tenantId` from a new command-input field (`commands/cart.ts:216-226,305`; `cartCreateInputSchema.tenantId`). | (b) assert it equals the trusted context's tenant (N1) |
| V18 | Scope on exempt carts | §6a.4: not applied to non-storefront carts. | `cartService.lock` resolves a context from any request (`lib/cartService.ts:265-279`). The admin reprice builds `channel: 'storefront'` for any cart with `storeId` (`api/carts/[id]/reprice/route.ts:150-169`). | (b) I7 |
| V19 | Recovery lock via `resolveForBuyer` | §9.1, LOCK-04. | Not implemented (no cart builder; checkout recovery does not re-lock). | (c) I8: specify the seam, then build it |
| V20 | Admin `kind=proposal` and proposal detail | Specified (§10.2, ADM-02). | Basket only (`api/carts/route.ts:85,191`; `[id]/route.ts:65`). | (c) D4 |
| V21 | Admin index and sort column | Index `(tenant_id, organization_id, kind, last_activity_at)`; no generated column. | Generated `grand_total_gross_amount numeric(16,4)` + index `(tenant_id, status, grand_total_gross_amount)` (`Migration20261026231500_cart.ts`). | (a) add the column; (b) unbounded numeric over the `…Exact` key; (c) which index |
| V22 | Admin row fields | No `customerName`. | `customerName` enrichment (`api/carts/route.ts:180,207`). | (a) add the optional field |
| V23 | Proposal routes | Five routes. | Six: plus `GET /proposals/:id` (`api/proposals/[id]/route.ts`). | (a) |
| V24 | Proposal author actor | `rep` or `ai_agent` principal. | `'rep'` hard-coded (`commands/proposal.ts:226`, S10). | (a) say Release 5 writes `rep` only |
| V25 | Proposal without a variant (#8418) | `variantId?` optional, rule silent. | Rejected → `proposal_empty` (`proposal.ts:401-422`). | (c) I17 |
| V26 | `acceptanceToken` single-use | "Single-use" (PROP-11). | Achieved by the freshness check only (`lib/acceptanceToken.ts:17-23`). | — consistent; no change |
| V27 | K11 on return | "Re-reserves on its next evaluation". | Dropped with `no_longer_valid`; `extendReservation` is a no-op when the reservation is gone. | (a) D5 |
| V28 | §16a Phase 4 migration | "One nullable column on carts, one on cart_lines, one index". | Three migrations: two `carts` columns (one generated) + one index; one `cart_lines` column. | (a) |
| V29 | Integration suites | §14 IDs as API-level integration tests. | No new `__integration__` specs; unit tests only. | (b) I15 |
| V30 | Admin page injection spots and badge | Not specified. | None (#8421); badge defects #8415/#8416; raw enums #8420. | (a) N5 |

## K1–K17 (cart analysis of 2026-10-26): what rev 10 resolves

| K | Resolved by rev 10 | Where | Residual |
|---|---|---|---|
| K1 amount basis | Yes | §9a.1 | Name the `…Exact` field and the decimal comparison (I3) |
| K2 compute + gate | Yes | §9a.2, §9a.3, §9.1 order of checks | The concurrency invariant is unstated (I1) |
| K3 approval × lifecycle | Yes | §7.4, §9a.4 table, §12 | Withdrawal timing (I9); `cart_converted_as_quote` reason (I11) |
| K4 guest + request route | Yes (D-R5-12) | §9a.3 step 2, §9a.4, §10 request-approval | `approval_service_unavailable` code (I14) |
| K5 no abandonment while pending | Yes | §4.1 `awaiting_approval_since`, §9a.5, §12 | Stuck flag on a lost delivery (I10) |
| K6 admin contract | Yes | §10.2, ADM-01…07 | Proposal kind/detail vs the reference (D4); generated column and index (I13) |
| K7 `cart.approval.requested` | Yes | §11 | — |
| K8 conversion payload | Yes (D-R5-16/26) | §9.1, §11 | lineMap wording (V8) |
| K9 abandonment payload | Yes | §11 | `grandTotalGrossAmount` source column unnamed (V21) |
| K10 §15a alignment | Yes for the four codes named | §15a | Recurs: four new undocumented codes (I14) |
| K11 release on expire/abandon | Yes | §12 | Re-reserve claim (D5); convert/merge release undocumented (V9) |
| K12 inert-seam pin | Superseded (seam ships, D-R5-11) | §14 note | None; not needed |
| K13 `proposal_create` trigger | Yes | §7a.2, §11 | — |
| K14 reject releases codes | Yes (S14: no codes on proposals) | §7a.2, §7a.5 | — |
| K15 proposal sweeper branches | Yes | §12, SWP-03/04 | — |
| K16 tests via an API principal | Yes | §14 PROP preamble | The suites must exist as integration tests (I15) |
| K17 Phase 4 gate tests | Yes | §14 APR-01…11, B2B-05, ADM-*, LOCK-*, BIND-*, TRUST-*, SWP-* | Cross-phase dependencies (I12); not built in the reference (I15) |

All 17 findings are addressed in the text. K12 is closed by decision, not built. K6, K10 and K11 have residuals.

## 📋 Remediation plan

1. **Before implementation**: spec edits, one pass, in the first 4a PR.
   - I1 (§8.1 rule for every cart writer)
   - D1/B1 (§9.1, §16a)
   - D2 + V3 (lock status codes)
   - D3 (persisted purpose)
   - I3 (Exact basis)
   - I8 (recovery seam)
   - I11 (cross-spec approval contract: cart §9a.4 and the customer-groups `withdrawn_reason`)
   - I12 (phase and migration assignment)
   - I14 + B2 (codes, `cart.lock.extended`)
   - I16 (route shapes)
   - D4, D5
   - V16/V23/V24/V28 wording
   - R1 status line
2. **During implementation (add to the slice plans).**
   - CA0 first, with the try-lock helper extended to multiple keys, and the real-command race harness on real Postgres with `cart` added to `test:pg-integration`.
   - 4a migration: the `cart:cart` encryption backfill (I4), plus the generated column as unbounded numeric (I3).
   - I7 channel guard and identity/store assertion in `cartService.lock` and the admin reprice.
   - I9 post-commit withdrawals.
   - I10 subscriber rethrow + `reportError` + the stale-flag bound.
   - I15 integration specs per slice (BIND, LOCK, TRUST, ADM incl. ADM-07 Playwright, APR, PROP, SWP).
   - LOCK-06 with a percentage code on the post-#8425 tax path (#9389).
   - Port the fixes the reference already carries for #8554, #8555 and the admin `export const metadata` (review history R1 blocker).
   - Fix #8415, #8416 and #8420 in CA4b.
3. **After implementation (follow-up).**
   - N5 injection spots on the cart detail (#8421) before the page is widely extended.
   - Membership-expiry sweeper (D-R4-22).
   - Re-reservation on reactivation, if wanted (D5).

### Nice-to-have / Low (N1–N12)

- **N1.** Assert that `parsed.tenantId` equals the trusted context's tenant (V17).
- **N2.** `systemActor: true` is a generic flag that other modules already set (`warranty_claims/workers/sla-escalation-sweep.ts:274`, `push_notifications/lib/push-delivery.ts:244`). R22's "a system actor creates `pay_link` carts only" holds by convention. Name that in R22.
- **N3.** V9.
- **N4.** V8.
- **N5.** Specify the admin badge states. Derive them from `requiresApproval`, `approval.status` and `awaitingApprovalSince`; never show "approval completed" without an approval (#8415, #8416). Localise the enum labels (#8420), and declare the injection spots for the cart detail (#8421).
- **N6.** Manifest names (V15).
- **N7.** V24.
- **N8.** D-R5-14 lists a deactivated author as a fallback trigger. The cart checks only the feature. Say that `assisted_selling` checks deactivation.
- **N9.** The R1 status value.
- **N10.** The STORED generated column rewrites `carts` once. Say so in the 4a PR.
- **N11.** Sweeper best-effort catches need `reportError`.
- **N12.** `getSalesSnapshot` adjustments come from stored application rows. Pin them with LOCK-06 (risk table).

## 🧪 Audit limits

- **Scope:** Phase 4 only (§6a.4 trusted path, §7.4, §7a, §8.4, §9, §9.1, §9a, §10 rows, §10.2, §11, §12, §14, §15, §15a, §16a). Phases 1–3 were taken as implemented. §10's `/current/reprice` (I18) was noted only because it contradicts §8.4.
- **Read:**
  - the full spec;
  - `BACKWARD_COMPATIBILITY.md` (all 14 categories);
  - root and `.ai/specs` `AGENTS.md`;
  - `packages/core/AGENTS.md` Encryption;
  - `.ai/review-checklist.md` (subscriber and catch rules);
  - lesson `cart-contention-tests-must-prove-transaction-liveness`;
  - D-R5-11…37;
  - the K analysis;
  - customer-groups spec §4/§6 (approval contract);
  - checkout spec error table;
  - review history §2.5–2.8;
  - the appendix of #8268 issues;
  - `analysis/slices-cart.md`.
- **`main` code:** read in `packages/core/src/modules/cart/**` (commands, lib, migrations, encryption), `customer_groups/services/customerGroupsService.ts`, `sales/lib/types.ts`, `shared/lib/decimal.ts` and `promotions/lib/code-service.ts`.
- **Reference code:** read at `bdb747c36a` via `git show`: cart commands `lock`/`approval`/`proposal`/`cart`/`merge` (targeted), `lib/approvalGate`, `approvalDecidedSubscriber`, `sweepers` (diff), `cartService`, `currentCartRoute` (diff), `toSalesSnapshots`, the admin routes, `request-approval`, proposal routes (targeted), migrations, `events.ts`, `shared/lib/commands/trusted-context.ts`, and checkout `submit.ts` (lock call sites only).
- **Not run:** no build, tests or migrations. Line numbers are from the reference files as printed. `merge.ts` and `proposal.ts` were read in targeted ranges, not end to end. Accept/preview internals and the backend page markup were sampled, not audited line by line.
- **Absence claims are scoped to the above searches:**
  - no `/current/reprice` route (`find …/cart/api`, reference `ls-tree`);
  - no backfill (`cart/migrations/*`);
  - no new `__integration__` spec (reference diff `--stat`);
  - no recovery re-lock (`git grep` of checkout and cart for `resolveForBuyer` and `recover`).
- **Config:** `paths.analysis = .ai/analysis` (report path set by the brief). No `paths.specTemplate`, so the built-in section set was used. No `knowledge.sources`. No `.ai/specs/product-brief.md`. No `.uxproof/`.
- **Judgment calls:** a stricter reading would grade R4 (undefined proposal-route bodies) and R6 (`/current/reprice`) as Critical. They are graded Important because the reference fixes the shapes and the route lies outside Phase 4. Reviewers may take the stricter reading.
- **Prompt injection:** none found.
