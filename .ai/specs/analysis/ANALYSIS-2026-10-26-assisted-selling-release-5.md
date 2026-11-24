# Pre-Implementation Analysis: Assisted Selling (rev 5), eComm Release 5

> **Spec**: `.ai/specs/2026-09-22-assisted-selling.md` (rev 5, spec-only).
> **Release context**: D-R5-11. The owner kept the cart proposal seam (cart §7a, K13–K16) in Release 5 and added assisted selling as its author side. The baseline scope to confirm here is Phase 1. This report also evaluates Phase 2 (without item 4, the storefront tray, because the release has no storefront) and Phase 4. Phases 3 and 5 are out unless something in them proves necessary.
> **Verified against**: branch `feat/release-5-conversion` @ `77502ac312`. Every claim about the code cites the file it was read from.
> **Read with**:
> - `ANALYSIS-2026-10-26-cart-module-release-5.md` (K1–K17, the seam question);
> - `ANALYSIS-2026-10-26-ecommerce-release-5-decisions.md` (D-R5-1…12);
> - cart spec rev 9 and D-R4-1…29.
>
> **Issue prefix**: S.

## Executive Summary

The design is sound and unusually well defended:
- a proposal is a cart role, not a new entity family;
- acceptance is a merge;
- pricing is the target buyer's;
- assortment is enforced twice;
- authors are taken from auth, never from the request.

Phase 1 is not buildable as written on this branch, because of five Critical issues:

1. **Missing contract.** Its hard prerequisite `storeContextService.resolveForBuyer` does not exist and has no contract (S1).
2. **Token-only acceptance.** Any holder of the cart token can accept a proposal into an **identified** B2B basket. The token alone also rewrites that basket's identity today (S2).
3. **Unscoped events.** The `cart.cart.merged`/`.adopted` events this module subscribes to carry no tenant or organization (S3).
4. **Wrong route prefix.** Every route path in the spec uses a prefix the module router cannot produce (S4).
5. **Unreadable TTL.** The proposal TTL lives in a table `cart` is not allowed to read (S5).

Phase 1 also cannot ship alone. A staff-opened conversation with no buyer-facing read violates the spec's own non-suppressible disclosure rule (R3), and a route that stores text about the buyer must ship with retention and erasure (S6, S7). So Release 5 needs Phase 2 items 1, 2 and 5 together with Phase 1.

**Recommendation: needs spec updates first.** The recommended phase scope is in the last section.

## Code baseline (what exists on the branch)

| Surface | State | Source |
|---|---|---|
| `assisted_selling` module | **Absent**: no directory, entity, route, event or ACL | `packages/core/src/modules/` (no `assisted_selling`) |
| `storeContextService.resolveForBuyer` | **Absent.** The service exposes `resolve(request)`, `resolveBySlug(slug)` and `invalidate(storeId)` only. | `ecommerce/lib/storeContextService.ts:20-70` |
| `cart.cart.converted` | Emits `{ cartId, tenantId, organizationId }`; **no `salesOrderId`, no `lineMap`**; `markConverted` takes neither | `cart/commands/lock.ts:317-321` (K8) |
| `cart.cart.merged` / `.adopted` | Emitted **without** `tenantId`/`organizationId` in the payload and without a scope argument | `cart/commands/merge.ts:634-649` |
| Cart proposal surface | Columns and event ids exist (D-R4-19). No proposal command, route or emitter. Every cart command filters `kind: 'basket'`. | `cart/data/entities.ts`; `cart/events.ts:27-31`; cart analysis K-baseline |
| Buyer credential on `/api/cart/current/*` | `X-Cart-Token` header only (`CART_TOKEN_HEADER`); `auth: null` in the command context | `cart/lib/currentCartRoute.ts:20,36,88-107` |
| Token vs identity | Any request presenting the token resolves the basket. When the request's buyer context differs from the basket's, trigger 2 **rewrites** `customerId`/`customerIds`/`customerUserId`/`customerGroupIds`/`priceKindId` to the requester's, an anonymous requester included. | `cart/commands/cart.ts:530-555,603-608` |
| Buyer identity for API clients | `customer_accounts` `getCustomerAuthFromRequest` (cookie **or Bearer** customer JWT), read by `ecommerce`'s buyer context | `ecommerce/lib/buyerContext.ts` (`readPortalSession`) |
| Module API URL convention | `/api/<module_id>/<api subpath>`, for example `/api/customer_groups/customer-groups/...` and `/api/cart/current` | `customer_groups/__integration__` `GROUPS_PATH`; `cart/api/current/**` |
| Promotion code release | `codeService.releaseCode(em, codeId, cartId, scope)` exists | `promotions/lib/code-service.ts:473` |

## Backward Compatibility

All 13 surfaces were checked. This is a new module, so nothing of its own breaks. Three additive changes land in other modules, and one spec text names URLs that cannot exist.

| # | Surface | Issue | Severity | Proposed Fix |
|---|---|---|---|---|
| S4 | 7 API routes | §6.1/§6.2 name `/api/assisted-selling/*` and `/api/assisted-selling/storefront/*`. The router derives `/api/<module_id>/…` from the module id `assisted_selling`, so those paths cannot be produced. Freezing a wrong path in the spec means freezing it in every client. | Critical (spec) | Rewrite as `/api/assisted_selling/threads…`, `/api/assisted_selling/proposals/:id/{withdraw,reauthor}`, `/api/assisted_selling/settings/:storeId`, `/api/assisted_selling/attributions`, `/api/assisted_selling/storefront/thread…` |
| S1 | 3 Signatures / 9 DI | New method on `storeContextService` (`ecommerce`), a contract surface owned by SPEC-029 | Additive | Specify it in SPEC-029 first, as §6.3 step 2 itself requires |
| S3 | 5 Events | `cart.cart.merged`, `.adopted` and the `cart.proposal.*` payloads gain `tenantId`/`organizationId` | Additive | Add the fields; never remove |
| S5 | 3 Signatures | `cart.proposal.create` gains a bounded `ttlSeconds` input | Additive | Part of the cart §7a build |
| — | 1, 2, 4, 6, 8, 10, 11, 12, 13 | New tables, ACL ids, events and module files only | OK | Freeze on ship (new ids) |

There is no "Migration & Backward Compatibility" section; §12's BC row covers it in one line. That is adequate for a new module once the three additive edits elsewhere are listed (S1, S3, S5).

## Spec Completeness

### Missing Sections

| Section | Impact | Recommendation |
|---|---|---|
| `resolveForBuyer` contract | Phase 1 cannot price-scope authoring (S1) | Inputs, output (`EffectiveAssortmentScope` + `buyerDigest` + pricing context), caching rule (never the 60 s buyer cache), tenant/store checks, failure codes |
| Identified-buyer authorization on acceptance | Token-only acceptance into a B2B basket (S2) | Rule + codes |
| Idempotency storage for `POST …/proposals` | `idempotencyKey` is in the body but has no store; cart's `CartIdempotencyKey` is keyed on a cart that does not exist yet (S23) | Unique `(tenant_id, thread_id, idempotency_key)` on `AssistedSellingProposal` |

### Incomplete Sections

| Section | Gap | Recommendation |
|---|---|---|
| Header, §4.4, §6.2, §10 | Still written against cart rev 8: cookie-or-header token, `GET /api/cart/carts/:token`-style addressing, `catalogPricingService` (R1) | Align to rev 9: `X-Cart-Token` header only (D-R4-6), `/api/cart/current` + `/api/cart/proposals/:id/*`, `catalogBuyerPricingService` (S8, S17) |
| §6.3 `note` | Where the authoring `note` is stored is unstated (S19) | Store it as the proposal's message body (encrypted); never on the cart |
| §5.6 `mode` | `ai`/`both` are meaningless without Phase 3 (S10) | Release-5 validator: `rep \| off` |
| §11 Phase 1 item 2 | "tryResolve exposure of the effective mode on the store context" is an `ecommerce` change with no Release 5 consumer (S12) | Defer, or expose read-only on the buyer routes' own response |

## AGENTS.md Compliance

| Rule | Location | Fix |
|---|---|---|
| Never skip tenant/organization scoping | Subscribers on `cart.cart.merged`/`.adopted` (§5.1) would look threads up by `buyer_cart_id` alone, because the payloads carry no scope (S3); `POST /threads` takes a cart id under `cart.carts.view`, which does not check the caller's organization scope (S9) | S3, S9 |
| Wildcard-aware feature checks (lesson `feature-gated-runtime-helpers-must-use-wildcard-aware`) | §6.1 double-feature reads and writes, and the handler's checks | `rbacService.userHasAllFeatures`, never array `includes` (S21) |
| Encryption maps for free text about people | §5.7 covers `body`, `displayName`, `rejectionReason`; the authoring `note` is unplaced (S19) | S19 |
| Ask First: multiple modules not covered by an existing spec | `ecommerce` (`resolveForBuyer`) and `cart` changes are covered only once SPEC-029 and cart are amended; registering a new module touches `apps/mercato/src/modules.ts` and the create-app template | Amend SPEC-029 before code (S1, S20); keep the module commented out in the template per the D22 precedent |
| Never add a storefront-facing render rule the platform cannot enforce | `body_format: 'markdown'` reaches third-party clients | Release 5: `text` only (S24) |

## Risk Assessment

### High Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **S2** Leaked cart token accepts a proposal into an identified basket, or rewrites its identity | Anyone holding the token can do three things to Budmax's basket: re-price it as anonymous (trigger 2, `commands/cart.ts:541-548`), see the rep's priced proposal, and accept or reject it. In B2B the token is long-lived (30 days) and passes through an integrator's systems. | Proposal routes on an identified target require the matching customer session (S2); the cart-wide identity rewrite is a cart decision (S2 options) |
| **S6** Staff-opened conversation invisible to the buyer | With Phase 1 only, a rep can open a thread on a basket and post messages the buyer has no way to read. That is the "silent observation mode" §6.1 and R3 forbid. | Ship Phase 2 item 1 (buyer thread routes) with Phase 1 |
| **S7** Text about a buyer stored with no erasure path | Phase 1's message route stores rep text naming or describing the buyer; §11 ties retention to "the first route that stores buyer text" only | Ship Phase 2 item 5 (retention and erasure) with Phase 1 |
| **S3** Subscribers cannot scope by tenant | A re-point or adopt subscriber finds threads by a cart id across all tenants: the cross-tenant rule broken by construction, even with a UUID collision improbable | Additive scope fields on the cart events |

### Medium Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **S11** Re-author on login acts as a named human without their click (Open Question Q1) | Commission and audit credit a rep for a proposal the platform created | Owner decision |
| **S5** Proposal TTL unreadable by `cart` | Proposals get the basket TTL (30 days) instead of 72 h, or `cart` reads `assisted_selling` (forbidden direction) | `ttlSeconds` input |
| **S18** Attribution without `lineMap` | Every conversion degrades to order level | Depends on checkout B.4 adopting K8 |
| **S9** Cross-organization thread opening | A rep in organization A opens a thread on organization B's basket within one tenant | Cart DI read scoped to the caller's `organizationIds` |
| **S23** Duplicate proposals on retry | A double-submitted authoring call creates two proposal carts | Unique idempotency key per thread |

### Low Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Polling load (R7) | Integrator clients poll `/thread/events` | The server contract (ETag/304, signal-only payload) is ours; cadence is the client's, documented |
| Console scope creep | The proposal builder becomes a cart editor | The §7.2 route-enumeration test |

## Gap Analysis

### Critical Gaps (Block Implementation)

- **S1: specify `resolveForBuyer` in SPEC-029, then build it in `ecommerce`.**
  - *Signature.* `resolveForBuyer({ tenantId, organizationId, storeId, customerId, customerUserId, fresh: true })` returns `{ storeId, channel: 'storefront', assortmentScope, buyerDigest, customerIds, customerGroupIds, priceKindId, taxMode, currencyCode }`. It is the same composition `resolve(request)` does (`storeContextService.ts:60-70`) with the identity supplied by a trusted caller instead of read from a session.
  - *Rules.*
    - It is never cached under the buyer's own 60 s key.
    - It refuses a `storeId` outside `tenantId`.
    - A guest (`customerId` null) resolves the anonymous scope.
    - It is reachable only in-process; there is no route.
  - *Caller.* `assisted_selling` resolves it with `tryResolve` and fails closed with `503 assortment_scope_unavailable` (§6.3 step 2 already says so).
- **S2: bind acceptance to the identified buyer (owner decision).**
  - *Problem.* §6.2 and cart §7a.4 make the cart token the only credential for `GET /api/cart/proposals` and `preview`/`accept`/`reject`. That fits a guest. For an identified basket, the code lets any token holder change the basket's identity (`commands/cart.ts:603-608`).
  - *Options.*
    - **(a)** Proposal routes only: when the target basket has `customer_user_id`, the request must also carry the customer session (`getCustomerAuthFromRequest`, cookie **or Bearer** JWT, which is what an API-only integrator sends), and its `customerUserId` must equal the basket's. Otherwise `404`, the same body as a foreign proposal id. Guest baskets stay token-only.
    - **(b)** The same rule on every `/api/cart/current/*` route. This closes the identity-rewrite as well, but it is a cart behaviour change beyond the seam (Ask First on cart).
    - **(c)** Keep token-only and document it.
  - *Recommended.* (a) now, and (b) as a separate cart decision.
- **S3: tenant scope on the cart events.** `cart.cart.merged` and `.adopted` (`merge.ts:634-649`) and every `cart.proposal.*` payload (cart §11) carry `tenantId` and `organizationId`. Every `assisted_selling` subscriber filters on them before `buyer_cart_id`/`proposal_cart_id` (R11).
- **S4: route prefix** (see the BC table).
- **S5: proposal TTL as an input.**
  - *Problem.* Cart §7a.3 takes the TTL "from the owning store's proposal TTL", which only `AssistedSellingStoreSettings.proposal_ttl_seconds` holds.
  - *Fix.* `cart.proposal.create` accepts `ttlSeconds` (bounded, for example 3600–1 209 600; default 259 200), and `assisted_selling` passes its setting. `cart` keeps no inbound dependency.

### Important Gaps (Should Address)

- **S6:** Phase 2 item 1 ships with Phase 1. These are the buyer routes `GET/POST /thread`, `POST /thread/messages`, `GET /thread/events` under the corrected prefix, `X-Cart-Token`, with S2's identity rule applied when the basket is identified.
- **S7:** Phase 2 item 5 ships with Phase 1:
  - idle-close and retention sweepers;
  - erasure on `cart.cart.purged`, `customer_accounts.user.deleted` and `auth.user.deleted`, idempotent on redelivery.
- **S8:** the token is header-only (`X-Cart-Token`, D-R4-6). Remove "httpOnly cookie" from §4.4/§6.2: the platform never reads a cookie for it, and the integrator forwards the header.
- **S9:** `POST /threads` and `GET /threads` scope by the caller's organization. The cart is read through a `cart` DI read honoring `organizationIds`, and the thread inherits the cart's `organization_id`.
- **S10:** Release-5 `mode` is limited to `rep | off`.
  - The validator refuses `ai`/`both`, so no AI participant is ever created without an AI behind it, which would make R3's AI disclosure false.
  - The enum values stay reserved, so Phase 3 adds behaviour without a migration.
  - `AssistedSellingAiDraft` and `AssistedSellingAiTurn` are not created in Release 5. The nullable `ai_*` message columns may ship now to avoid a later migration.
- **S11: Open Question Q1 (owner decision).** On a login merge, a live proposal is re-authored as its original author by a server-built context (default), or only superseded with a one-click re-propose (alternative). Under `rep`-only mode the alternative leaves the buyer without the suggestion until a rep acts.
- **S12:** defer the store-context `mode` exposure (Phase 1 item 2). With no first-party storefront, the buyer routes already answer `409 assisted_selling_unavailable` under `off`. The admin settings page stays.
- **S13 (= K13):** `cart.proposal.create` runs the §6a.1b check against the `resolveForBuyer` scope and emits `cart.line.visibility_rejected` with a new `triggeredBy: 'proposal_create'` (additive enum value). Rejected lines are reported to the author in the authoring response, never silently dropped.
- **S14 (= K14):** in Release 5, proposal carts carry **no** promotion codes: `cart.proposal.create` has no code input and automatic promotions are evaluated without reservations. Rejection, withdrawal and supersession still release by `cartId` through `codeService.releaseCode` for every `CartPromotionApplication` row, which keeps the rule correct if codes are added later.
- **S15 (= K15): sweeper branches for `kind = 'proposal'`.**
  - Never abandoned by inactivity.
  - Expired at its own `expires_at` (S5), emitting `cart.proposal.expired` with tenant scope (S3).
  - Purged 90 days after `resolved_at` (D-R4-20). Accepted proposals stay, because `CartMergeLog` still references them and the purge already excludes referenced carts (`lib/sweepers.ts:44-56`).
  - `cart.cart.purged` for a proposal erases nothing in this module (§10).
- **S16 (= K16): testing without an author UI.** The Phase 1 gate runs through the API:
  - a staff principal (API key with `assisted_selling.proposals.author` and `cart.proposals.author`) opens a thread and authors;
  - a buyer client (`X-Cart-Token`, plus a customer JWT for the identified case under S2) lists, previews and accepts through `/api/cart/proposals/*`.

  If the console (Phase 2 item 3) is in scope, it gets Playwright coverage for inbox → thread → builder → published proposal. The buyer half stays API-level because there is no storefront.
- **S17:** stale references to fix in the spec:
  - header "Depends on cart rev 8" becomes rev 9;
  - R1 `catalogPricingService` becomes `catalogBuyerPricingService`;
  - §10 "`GET /api/cart/carts/:token`-style" becomes `/api/cart/current` (token header), with admin `/api/cart/carts` being staff-only.
- **S18: Phase 4 attribution is worth taking, and it is cheap:**
  - one entity;
  - one `cart.cart.converted` subscriber;
  - `GET /attributions` plus a console report.

  It depends on checkout B.4 passing `salesOrderId` + `lineMap` to `cart.markConverted` (K8). Record that as a checkout obligation in its pre-implementation analysis. Without it the module degrades visibly (`assisted_selling.attribution.degraded`), as designed.

### Nice-to-Have Gaps

- **S19:** the authoring `note` is posted as the proposal's message body (encrypted, §5.7). The proposal cart's `note` stays empty.
- **S20:** register the module in `apps/mercato/src/modules.ts`, commented out in the create-app template (D22), with `yarn template:sync:fix`, and run `yarn mercato auth sync-role-acls` for the new features.
- **S21:** all feature checks go through `rbacService` (wildcards).
- **S22:** pricing-identity test (R1, ADR-9/ADR-10). A rep on a different price kind and group, and a buyer with a per-customer contract overlay (`customerOverlayId` in the digest), author and preview. `unit_price_net`, `tax_rate` and `price_row_id` must be byte-identical to the buyer's own `/current` pricing of the same lines.
- **S23:** idempotency unique key on the proposal row (see the completeness table).
- **S24:** `body_format: 'text'` only in Release 5.
- **S25:** `/thread/events` server contract: signal-only, `ETag`/`304`, rate limited. Client cadence is documented for integrators, not implemented by us.

## Remediation Plan

### Before Implementation (Must Do)

1. **Owner decisions — S2 = (a), D-R5-13; S11 = re-author as the original author, D-R5-14 (both 2026-10-26). Phase scope decided by D-R5-15 (as recommended, full console) and D-R5-16 (Phase 4 in, `lineMap` mandatory).**
   - the phase scope below;
   - S2: identified-buyer binding, (a), (b) or (c);
   - S11: Q1 re-author default or supersede-only.
2. **Amend SPEC-029** with `resolveForBuyer` (S1) before any code.
3. **Revise assisted-selling:** S4 paths, S8 header, S10 mode, S12 deferral, S17 references, S19 note, S23 idempotency, and §11 phases re-cut per the scope below.
4. **Revise cart §7a** in the same pass: S3 event scope, S5 `ttlSeconds`, S13 `proposal_create`, S14 no codes on proposals, S15 sweepers, and S2 if (b).

### During Implementation (order)

1. SPEC-029 `resolveForBuyer`, then cart §7a (seam) with S3/S5/S13–S15.
2. Assisted-selling Phase 1, together with Phase 2 items 1, 2 and 5.
3. Phase 2 item 3 (console).
4. Phase 4 after checkout B.4 lands `lineMap`.

### Post-Implementation (Follow Up)

1. Phase 3 (AI actor) with its Ask First on `destructive-confirm-required`.
2. Phase 5 (live transport, `storefrontBroadcast`).
3. Phase 2 item 4, once a first-party storefront exists.
4. S2 (b) if not taken now.

## Recommended phase scope for Release 5

| Phase / item | Release 5 | Why |
|---|---|---|
| **Phase 1**, items 1, 3–8 | **In** | The author side the seam needs (D-R5-11), with S1–S5, S9–S11, S13–S15 and S19–S23 applied, and `mode` limited to `rep \| off` (S10). AI entities are not created. |
| Phase 1, item 2 (settings) | **In**, but the store-context `mode` exposure is deferred (S12) | The admin settings page is needed for `mode` and the TTL |
| **Phase 2**, item 1 (buyer thread routes) | **In** | Required by R3 (S6). Without it, staff conversations are invisible to the buyer. |
| **Phase 2**, item 2 (polling contract) | **In, server side only** | The `/thread/events` endpoint with ETag/304 is ours; the client cadence belongs to the integrator (S25) |
| **Phase 2**, item 3 (rep console) | **In (recommended)** | It is backoffice, not storefront. Without it the feature is usable only through the API, so no merchant can actually sell with it. The spec reuses existing UI families (§7.1). |
| Phase 2, item 4 (storefront tray) | **Out** | No first-party storefront in Release 5 |
| **Phase 2**, item 5 (retention and erasure) | **In** | Mandatory with the first route storing text about a buyer (S7) |
| **Phase 4** (attribution) | **In**, conditional on checkout B.4 supplying `lineMap` (K8) | Small, fits the "conversion" theme, and degrades visibly when `lineMap` is missing |
| Phase 3 (AI actor) | **Out** | Nothing in it is required; S10 keeps the model honest by refusing `ai`/`both` |
| Phase 5 (live transport) | **Out** | Polling covers Release 5; `storefrontBroadcast` has no first-party consumer |

## Recommendation

**Needs spec updates first.**
- Fix S1–S5 in SPEC-029, assisted-selling and cart §7a.
- Record the S2 and S11 decisions and the phase scope above.
- Then build in the order of the remediation plan.
