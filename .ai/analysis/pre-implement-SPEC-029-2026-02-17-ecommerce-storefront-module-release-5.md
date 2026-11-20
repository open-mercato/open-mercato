# 🔍 Pre-implementation analysis: SPEC-029 Ecommerce Store Module, Release 5 amendment (`resolveForBuyer`)

**Readiness: conditional.** The amendment is additive and its core composition is sound. Implemented as written, though, the method would be declared required (against the settled decision and BC §9). Its refusals would also surface as unmapped errors in three other modules, and carts whose stored buyer changed after creation could stop re-pricing, locking or recovering.
Spec: `.ai/specs/SPEC-029-2026-02-17-ecommerce-storefront-module.md` (header says **v4.11**; the task named v4.10, see Audit limits). Audited 2026-11-19 against `BACKWARD_COMPATIBILITY.md` and the `.ai/specs/AGENTS.md` content checklist. Ground truth: current `main` in this worktree, plus reference `refs/remotes/pr/8268` (`bdb747c36a`, diff base `b7b5309ccc`).

Scope: §6 interface addition, §6.3, the §12, §16, §17 Phase 4 and §18 entries, and the v4.11 changelog. Callers are covered as specified in the revised cart, checkout, assisted-selling and customer-groups specs. Also covered: assisted-selling finding **S1** and cross-spec findings **X2** and **X15**. The rest of SPEC-029 is implemented on `main` and is context only.

**Next action:** fix spec items 1–6 of the remediation plan (they are small text edits), then implement Phase 4 with the `om-auto-implement-spec` skill, adding the during-implementation items.

## ⚠️ Decisions for the spec owner

| # | Question | Recommended answer | Tradeoff |
|---|----------|--------------------|----------|
| D1 | A stored-identity refresh (admin re-price, lock, recovery, proposal on an existing cart) names a buyer or store that no longer resolves. Causes: a CRM relink or merge changed `CustomerUser.person_entity_id`, the portal user was deactivated, the CRM customer was deleted or erased, or the store was soft-deleted. Should `resolveForBuyer` refuse, or should the caller degrade? | Refresh callers pass **`customerUserId` alone** when the cart has one, so a stale stored `customerId` cannot trigger `buyer_out_of_scope`. That is the point of the "read fresh, never from claims" rule (§6, line 278). For a buyer or store that is really gone, the caller fails with a **mapped** code (e.g. `409 cart_buyer_unresolvable`) and never with an unmapped error. Never silently fall back to the stored identity. | Failing closed blocks checkout for that cart until staff intervene. Falling back would price a since-relinked buyer under the old company's terms, which is R1's failure mode. |
| D2 | `storeId` is given but the store has no usable default channel binding (none, or its sales channel was deleted, v4.10). | Throw `store_misconfigured`, consistent with §4.1 and §6.2. The reference instead returns `channel: null`, so `assortmentScope` becomes the group scope alone, which may be `null` (unrestricted) for an assisted-selling proposal. | A rep cannot author against a store the buyer cannot use anyway. This is stricter than "serving gates stay at the edge", but it is about scope, not serving. |
| D3 | X15: which recovery path actually fresh-locks a cart? Checkout §12.1 (lines 762–770) only unlocks, or extends at `finalized`, and X15 says an extend needs no route context. The reference has no recovery caller (`recover-stuck-submits.worker.ts` only calls `cartService.unlock`). | Name the row. The likely candidate: `finalized` when the lock already lapsed, so the extend turns into a fresh lock. Otherwise drop the caller row from §6.3 and the Phase 4 "hard prerequisite of checkout recovery" claim. | Keeping a phantom caller makes Phase 4's dependency graph and coverage list wrong. |

## 📋 Readiness gate

| # | Item | Result | Evidence / fix |
|---|------|--------|----------------|
| R1 | Declared status | ✅ | Header v4.11, Release 5 amendment recorded in §21 |
| R2 | Open questions / unconfirmed assumptions | ✅ | §19 open items (6, 7) are out of scope. No `NEEDS HUMAN CONFIRMATION` markers. D1–D3 above are new. |
| R3 | Requirement → AC → phase → test traceability | ❌ (Important) | The §16 "pricing identity" oracle contradicts §6.3 for store-less callers (finding I6) |
| R4 | Every affected contract defined | ❌ (Important) | The refusal contract (error type, status, how a peer module recognises it) is undefined (I2) |
| R5 | Phases have dependencies and an observable exit gate | ❌ (Important) | The Phase 4 gate cites caller integration cases that ship in later waves (I6). The dependency "Phase 1 only" is correct: `customer_groups` multi-id inputs exist on `main` (`customerGroupsService.ts:65`). |
| R6 | Section completeness | ✅ | §6.3, §12, §16, §17, §18 and §21 are all present for the amendment |

## 💥 Backward compatibility

| # | Surface | Phase/step | Change | Severity | Migration path |
|---|---------|------------|--------|----------|----------------|
| B1 | 9 DI service interfaces / 3 Signatures (`StoreContextService`) | Phase 4 | §6 (line 311) declares `resolveForBuyer(input)` as a **required** member, and §18 calls it "a new method on an existing service". BC §9 allows only *optional* methods, and the owner settled on `resolveForBuyer?` on 2026-11-19 (review history R1→R6 #5). | Warning | Change it to `resolveForBuyer?(…)`. Reword §18 to "new optional method". Add to §6.3 that a registered service *without* the method is a third state each caller handles. The reference is already correct (`ecommerce/lib/storeContextService.ts:79`). |

No other protected surface is touched: no route, event, ACL feature, cache tag, DB column, CLI command or generated file. There is no new or changed `encryption.ts` map, so no `buildEncryptionMapBackfillSql` migration is needed (#8893 does not apply). `UPGRADE_NOTES.md` has no entry and none is required for an optional additive method. Optionally add a row to the additive-changes log in `BACKWARD_COMPATIBILITY.md`.

## 🔍 Findings

| # | Finding | Severity | Evidence | Fix |
|---|---------|----------|----------|-----|
| I1 | The method is declared required. Fallback semantics cover only "service not registered". | Important (BC Warning B1) | §6 line 311; §6.3 "Resolved with `tryResolve`"; ref `storeContextService.ts:69-79` | See B1. Per caller, state the behaviour for an **absent method**: assisted selling 503 (ref `assisted_selling/commands/proposals.ts:343`); admin re-price of a storefront cart 503 (ref `cart/api/carts/[id]/reprice/route.ts:132`); `cart.create` trusted path falls back (ref `cart/commands/cart.ts:161`); pay link becomes a guest cart (ref `payLinkCartSeed.ts:198`). |
| I2 | The refusal contract is undefined. The spec says "throws, `code: …`" but gives no type, status, or a way for a peer module to recognise the error without importing `ecommerce/lib`. | Important | §6.3 Rules. The ref throws `StorefrontResolutionError(403, …)` (`storeContextService.ts:130`, `buyerContext.ts:483,525`). **No caller maps it**: `cart.ts:150-170` propagates it by design, and `reprice/route.ts:141`, `cart/api/proposals/route.ts:208` and `payLinkCartSeed.ts:199` call unguarded. The result is an unmapped error on two admin routes and on the public pay-link page. | Specify the shape, e.g. an error carrying `{ status, code }` recognised through a shared duck-typed guard (the ref already has `Symbol.for('@open-mercato/ecommerce/StorefrontResolutionError')`, `storeContext.ts:63`). Add a per-caller mapping: assisted selling → 503 `assortment_scope_unavailable` (already specified); re-price, lock and recovery → a mapped 409 (D1); pay link with a session buyer refused → guest cart plus a warning log, or a mapped 409 (owner's choice). |
| I3 | A stored-identity refresh can hard-fail permanently (D1). | Important | Cart §9.1 recovery (line 709) and the ref re-price route (`route.ts:141-147`) pass both `customerUserId` and the stored `customerId`. §6.3 refuses a `customerId` that is not among the user's *current* ids. The ref also filters `isActive: true`/`deletedAt: null` (`buyerContext.ts:521`, `:482`) and `s.deleted_at is null` (`storeContext.ts:757+`). | Apply D1 in §6.3 ("refresh callers pass `customerUserId` alone when set") and in cart §9.1. Add a §16 case: relinked person → refresh succeeds with the new ids. |
| I4 | The input-provenance rule contradicts the cart trusted path. §6.3 says inputs "MUST come from stored records … or the caller's own auth context, never from a request body". For `api`/`agent` carts, the `customerId` is command input from an authenticated server principal holding `cart.channel.api\|agent`. | Important | §6.3 Rules; cart §6a.4 line 435 ("trusted command input, never from a request body reachable by an anonymous caller"); ref `cart.ts:307-322` | Adopt the cart wording: "from stored records, the caller's own auth context, or feature-gated authenticated command input; never from input an anonymous caller can reach". The tenant/organization refusal stays the backstop. |
| I5 | The callers table is incomplete and contains one phantom row. | Important | Missing: cart admin re-price (cart §10.2 line 872; ref `reprice/route.ts`), whole-cart re-price at lock for non-storefront carts (cart line 439), the cart proposals route (ref `cart/api/proposals/route.ts:205-216`), and assisted-selling re-author on merge (assisted-selling line 820; ref `reauthorOnMerge.ts:383`). Phantom: checkout recovery (D3). | Add the rows with their `storeId` and fallback. Resolve D3. |
| I6 | The §16 pricing-identity oracle and the Phase 4 gate are not satisfiable as written. Without a store, `priceKindId` is the group terms override or `null` (§6.3 Output). The buyer's own `/context` falls back to the **channel default** price kind. So "pay-link cart resolves the same `priceKindId` … line prices equal storefront prices" holds only for buyers whose group sets a price kind. The Phase 4 gate also requires these caller-level cases, which ship with callers in later waves. | Important | §16 "Pricing identity"; §17 Phase 4 Gate; §6.3 Output | Make the parity fixture a buyer with a group price-kind override. Add a no-override case (`priceKindId: null`, `taxMode: null` → the caller keeps its own). Make the Phase 4 gate the `ecommerce` unit suite only, and move the parity and tenant-mismatch integration cases to each caller's phase gate (cart 4a, checkout B.2, assisted-selling Phase 1). |
| I7 | The reference unit suite misses §16 cases. | Important | Ref `ecommerce/lib/__tests__/resolveForBuyer.test.ts` covers only (a)–(f): no-store, store, store outside tenant, store outside org, guest, cache. Missing: `buyer_out_of_scope` for a foreign `customerUserId`, for a foreign `customerId`, and for a `customerId` not among the user's ids; the `customerId`-only person → company path; the company-alone path. | Add these when porting Phase 4. |
| N1 | `customerId`-only semantics are under-specified. The ref sets `isAuthenticated: true` (`buyerContext.ts:493`), which decides the `require_authentication` deny-all. A person can have several companies (`customer_person_company_links`, `customers/data/entities.ts:209-216`), but the spec reads only `customer_people.company_entity_id`. | Nice-to-have | §6.3 Inputs | State both explicitly: an identified CRM buyer counts as authenticated for scope, and the company is the person's primary (`company_entity_id`). |
| N2 | The checkout caller usage drifts from checkout §4.3 step 3. Checkout §4.3 says checkout passes the full identity (`customerIds`, groups, price kind) to `cart.create`. The ref passes only `customerId`/`customerUserId`, and `cart.create` resolves again (two calls). With the method absent, the ref makes the cart a guest cart, so the cart's "fallback to trusted input" never applies. | Nice-to-have | Checkout spec line 244; ref `payLinkCartSeed.ts:189-205`; cart line 439 | Either pass only `customerUserId` and let `cart.create` resolve (one call, simpler; update checkout §4.3), or pass the resolved identity. Also state the absent-method fallback for pay links. |
| N3 | The `ecommerce` `requires` list omits `customers`. The ref adds `CustomerEntity` and a raw `customer_people` read to `buyerContext.ts` (lines 9, 453-475). | Nice-to-have | `ecommerce/index.ts` (`requires: ['catalog','sales','customer_accounts','customer_groups']`); `main` already imports `customers` in `api/storefront/context/route.ts` | Add `customers` to `requires`, or note the transitive dependency through `customer_accounts`. |

## 🔁 Spec vs. reference implementation

| # | Point | Spec | Reference (`bdb747c36a`) | Class |
|---|-------|------|--------------------------|-------|
| V1 | Method optionality | §6 line 311: required | `storeContextService.ts:79`: `resolveForBuyer?` | (a) spec should change (settled) |
| V2 | Refusal error | "throws, `code`", no type or status | `StorefrontResolutionError(403, code)`, unmapped by every caller | (a) spec defines the contract; (b) callers map it when ported |
| V3 | Stale stored identity | Refuses a `customerId` not among the user's ids | Refresh callers pass both ids (`reprice/route.ts:141-147`, `cart/api/proposals/route.ts:208-214`) | (c) owner decision D1, then (b) |
| V4 | Store without a usable default binding | Not addressed | `loadStoreChannelForBuyer` (`storeContext.ts:757+`) has no `sales_channels` join (unlike `resolve`, `:459/:495`) and returns `channel: null` → group-only scope | (c) owner decision D2 |
| V5 | Checkout recovery caller (X15) | Listed in the §6.3 table and as a Phase 4 dependant | No caller; the recovery worker only unlocks | (c) owner decision D3 |
| V6 | Extra callers | Not listed | Admin re-price route, proposals route, `cart.proposal.create`, `reauthorOnMerge`, `cart/lib/reprice.ts` | (a) spec should change (I5) |
| V7 | `currencyCode` use on trusted `cart.create` | "Caller keeps its cart's currency" when `null` | Never applied, even with a store (`cart.ts:327`) | Consistent with cart §6a.4's fill list; no change |
| V8 | Pay-link identity handoff | Checkout §4.3: full identity passed | Only the ids are passed; `cart.create` re-resolves | (a) checkout spec should change (N2) |
| V9 | Unit coverage | §16 lists the `buyer_out_of_scope` and `customerId`-only cases | Absent | (b) reference must change (I7) |

## 🧭 S1, X2, X15 status

- **S1** (assisted-selling analysis). Closed by §6.3, with deliberate deviations. `storeId` is optional (D-R5-22). The `fresh: true` input is dropped because the method always reads fresh, which is correct. The `channel: 'storefront'` output is dropped; assisted selling derives the channel from the cart instead, which is fine. "Failure codes" is only half closed: the codes exist but the contract does not (I2). The reference assisted-selling caller fails closed on an absent method, a thrown error or a missing `assortmentScope` (`proposals.ts:343-365`), as specified.
- **X2** (cross-spec). Closed for `cart.create` (ref `cart.ts:156-170, 307-340`), with the documented fallback when `ecommerce` is absent. Residual issues: I3 (stale refresh) and I4 (provenance wording).
- **X15** (cross-spec). Not closed: no recovery row fresh-locks a cart, and the reference has no such caller (D3).

## ⚠️ Risks

| Risk | Level | Impact | Mitigation |
|------|-------|--------|------------|
| A stale stored identity blocks re-price, lock and recovery of a cart (I3) | Medium | A B2B buyer cannot check out after a CRM relink; the admin re-price route answers with an unmapped error | D1. The refresh passes `customerUserId` alone. Add a mapped 409 and a regression test. |
| An unmapped refusal on the public pay-link page (I2) | Medium | A logged-in buyer whose portal user was deactivated, but whose token is still live, gets an error page instead of a guest cart | Specify the mapping and test it in checkout B.2 |
| An unrestricted proposal scope for a store without a default binding (V4) | Low | A rep proposes products outside the store's channel assortment. The checkout lock still blocks them later, because the storefront answers 503. | D2: fail closed with `store_misconfigured` |
| Cache isolation | Low | — | Verified: the ref trusted path never references `buyerContextCache`, and `customerGroupsService` holds only per-call `Map` caches (`customerGroupsService.ts:123-154`), so "visible to the next trusted call with no wait" holds |

## 📋 Remediation plan

1. **Before implementation (spec edits, SPEC-029 unless noted)**
   1. §6 line 311: `resolveForBuyer?`. §18: "optional method". §6.3: the absent-method state per caller (I1/B1).
   2. §6.3 Rules: the refusal contract plus a per-caller mapping table (I2).
   3. §6.3 and cart §9.1: refresh callers pass `customerUserId` alone when it is set; record D1 (I3).
   4. §6.3 Rules: align the provenance wording with cart §6a.4 (I4).
   5. §6.3 callers table: add the missing rows and resolve D3; update the Phase 4 "hard prerequisite" sentence (I5).
   6. §16 and §17: fix the parity oracle and split the Phase 4 gate (I6). Decide D2.
2. **During implementation (add to the plan)**
   - Port the reference with V2 mapping and V3/V4 per D1/D2. Add the I7 unit cases and a relinked-buyer case.
   - Declare `customers` in `requires` (N3).
3. **After implementation (follow-up)**
   - Checkout §4.3 step 3 wording and the pay-link absent-method fallback (N2).
   - State the `customerId`-only semantics (N1).

## 🧪 Audit limits

- Searched `main` (`packages/core/src/modules/{ecommerce,customer_groups,customers}`, `packages/shared/src/lib/commands`) and the reference for `resolveForBuyer`, using `git grep` over `refs/remotes/pr/8268 -- packages`. That search found 37 non-test hits in 13 files. Each caller's input handling was read; the full bodies of the `cart.proposal.create` command and of `reauthorOnMerge` were not.
- `main` has no `cart` or `assisted_selling` module and no `buildTrustedCommandContext`. The `checkout` package exists. On `main`, `resolveForBuyer` is absent and the v4.10 deleted-sales-channel fix (`5581e39977`) is present; that fix is also an ancestor of the reference.
- `parts/appendix-issues.md` has no issue that touches `resolveForBuyer`. The only related review item is review-history R1→R6 #5 (optionality), which is settled.
- The task named v4.10, but the spec header and changelog carry the amendment as **v4.11** (§21, 2026-10-26). The audit used the file as it stands.
- No validation commands were run (analysis only). Config: `.ai/agentic.config.json` (`paths.analysis = .ai/analysis`). The report path was set by the caller.
