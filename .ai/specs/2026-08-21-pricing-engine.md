# Pricing Engine

## 📝 TLDR
A generic, reusable price-resolution contract sized so a simple deployment (one price per SKU) needs zero configuration, while a complex one (B2B contract pricing, customer/customer-group pricing, quantity tiers, channel pricing, time-boxed campaigns) is served by the same resolution algorithm. Ships in three independently-shippable phases across two module owners: **Phase 1** gives `catalog` the admin UI its already-complete price API/commands have never had; **Phase 2** hardens `catalog`'s existing resolver-chain extension point (a latent registry-scoping bug, currency-awareness, `customerGroupIds` set matching) so it is safe to build on; **Phase 3** ships a new, optional `pricing` module that registers into that hardened chain and takes over resolution — the same optional-integration shape as `availability`/`wms` and its ADR-4 (see provenance note below). Scope is **price resolution only**: context in, one best-matching unit price out. Discount/promotion effects (`promotions`, SPEC-055) and totals/tax/rounding (`salesCalculationService`) are explicitly out of scope and not duplicated. All three phases ship with **zero schema migrations**.

**Sibling spec provenance.** This spec cites `2026-08-14-ecommerce-suite-roadmap.md` (source of "ADR-4" and the `availability`/`wms` precedent), `2026-08-14-cart-module.md`, and `2026-08-14-customer-groups-and-b2b-terms.md`. None of these exist in `.ai/specs/` on `develop` today — they live on branch `spec/ecommerce-module-suite` (upstream PR [#5384](https://github.com/open-mercato/open-mercato/pull/5384), marked `do-not-merge` pending maintainer discussion). Read them via `git show fork/spec/ecommerce-module-suite:.ai/specs/<file>` (or the equivalent remote) until that PR merges. Every citation below to those three files is a forward reference to unmerged, still-under-discussion work, not a settled dependency — treat any risk or design point resting on them as provisional until that PR's fate is known, not as verified fact the way this spec's citations to code on `develop` are.

## 📝 Problem Statement

`CatalogProductPrice` already models everything a B2B pricing matrix needs — customer, customer-group, channel, quantity tiers, validity windows — and `catalog/lib/pricing.ts` already scores and resolves matches by specificity. Despite that, three concrete gaps keep this capability from being either "simple" or "generic and reusable" today:

1. **No admin UI reaches most of the schema.** Price editing today is inline on the product page and touches only `unitPriceNet`/`unitPriceGross`/`channelId`. The customer/customer-group/quantity-tier/validity-window dimensions — already fully supported by `catalog/api/prices/route.ts` and `catalog/commands/prices.ts` — are reachable only by inserting rows directly. A capability nobody can reach through the UI isn't a capability a merchant can use.
2. **The extension point a "pluggable, complex-when-needed" engine would build on has a latent bug.** `registerCatalogPricingResolver`'s backing array (`pricingResolvers` in `catalog/lib/pricing.ts:121`) is module-local state, not `globalThis`-backed — the same failure class this codebase already hit and fixed once for the ORM/entity registry (`.ai/lessons/global-registries-in-publishable-packages-must-use-globalthis.md`). Under a multi-module-instance topology (a standalone app built from this monorepo, or any dev/build setup that loads `catalog` through more than one chunk), a resolver registered from one instance is invisible to resolution running in another — silently, with no error.
3. **Currency and multi-group scoping are undocumented, caller-responsibility contracts.** `PricingContext` has no currency field — callers pre-filter `CatalogProductPrice` rows by `currencyCode` themselves today, an implicit convention with no enforcement. The sibling `2026-08-14-customer-groups-and-b2b-terms.md` spec (see provenance note above) is about to move `customerGroupId` (single value) to `customerGroupIds: string[]` (set membership) — a shape change this resolution layer needs to originate, not inherit after the fact.
4. **Tenant/organization scoping of the rows a resolver runs over is an unstated caller contract, not an enforced one.** `matchesContext`/`scorePrice`/`selectBestPrice` are pure functions over whatever `rows: PriceRow[]` a caller passes in — there is no scoping check inside the resolver itself today, and none is added by this spec. It is safe only because every current caller fetches rows through routes/services that already filter by `organization_id`/`tenant_id` first. Worth stating explicitly given root `AGENTS.md`'s "Never expose cross-tenant data" rule — see Edge Cases.

None of this requires new entities. It requires an admin surface, one infrastructure fix, and a hardened, currency-and-group-aware resolution contract that a future optional module can safely extend.

## 📝 Proposed Solution

Do not build a new pricing data model. Do not build a new "generic rule engine" from scratch — `catalog/lib/pricing.ts` already *is* one (specificity scoring, a priority-ordered resolver-chain extension point, before/after lifecycle events); it is under-exposed (no UI) and under-hardened (registry bug, no currency/multi-group awareness), not under-designed.

Three phases, two module owners, no new data model:

- **Phase 1 (`catalog`)** — a dedicated backend admin page for `CatalogProductPrice`, exposing every dimension the API and commands already accept. Independently valuable: works today, with or without anything else in this spec.
- **Phase 2 (`catalog`)** — harden the existing extension point: `globalThis`-scope the resolver registry (with dedupe-by-id, so any future registrant is HMR-safe, not just this spec's), and extend `PricingContext`/`matchesContext` additively with `currencyCode` and `customerGroupIds`. This is infrastructure work inside the module that already owns the resolver — not new module-boundary surface.
- **Phase 3 (`pricing`, new, optional)** — a module that, when installed, registers a resolver into the now-hardened chain and takes over resolution. It owns no entities and no admin UI of its own; it composes catalog's existing `matchesContext`/`scorePrice`/`selectBestPrice` rather than reimplementing them (`catalog/AGENTS.md` § Never: "Never reimplement catalog pricing inline").

**Alternatives considered and rejected:**
- *A single spec/module owning everything, including a rewritten data model* — rejected: `CatalogProductPrice` already covers every dimension found in Medusa's price-rule model and commercetools' Standalone Price constraints (see Research below); rebuilding it would be pure churn.
- *Ship the admin UI inside the new `pricing` module, calling `catalog`'s public API* — rejected: it would make Phase 1's value conditional on installing an optional module, when the underlying capability is catalog's own and complete today. Confirmed with the user as a deliberate two-phase, two-owner split rather than two separate specs, since the phases are thematically one initiative even though independently deployable.
- *A pluggable "rule strategy" abstraction over price sources* — rejected as unnecessary new surface: `registerCatalogPricingResolver`'s priority-ordered chain already **is** that abstraction; Phase 2 fixes it, Phase 3 uses it.

### Research: what market leaders get right (and what this spec skips)

- **Medusa.js v2's Pricing Module** groups prices into "price sets" resolved by an explicit rule engine (`calculatePrices(context)`) that handles "overlapping applicability and rule priorities" and is deliberately stateless/serverless-safe. This validates two decisions here directly: (a) resolution should be a pure function of `(context, candidate rows)` — the `globalThis` fix in Phase 2 scopes the *registration* registry, not the per-request resolution call, which stays pure; (b) multi-currency is a first-class dimension of the rule context, not an afterthought — matching the Q2 decision to require `currencyCode`. [Pricing Module - Medusa Documentation](https://docs.medusajs.com/resources/commerce-modules/pricing)
- **commercetools' Standalone Prices** define an explicit, documented precedence: Customer Group > Channel > country, currency always required, and — notably — **a tiered price is ignored once a product discount already applies**, rather than the two effects composing. That's a directly relevant precedent for the resolution → promotions boundary this spec deliberately keeps out of scope: whoever builds the promotions handoff should decide interaction rules explicitly (suppress vs. compose), not assume additive stacking. This spec does not implement that decision — it flags it as a documented open question for that future work, so it isn't silently assumed. [Price selection | commercetools](https://docs.commercetools.com/learning-price-and-discount-your-products/price-calculation/price-selection)
- **What this spec deliberately skips relative to both:** neither a new "price set" grouping abstraction nor a formal declarative rule DSL. `CatalogProductPrice` rows plus `scorePrice`'s weighted specificity already produce the same *outcome* (most-specific-match-wins) with far less new surface. commercetools' Customer-Group-over-Channel precedence differs from `scorePrice`'s current weights (channel +5 > customerGroup +3) — this spec does **not** change that ordering; `catalog/AGENTS.md` § Ask First explicitly requires asking before touching resolver priority semantics, and doing so is out of scope here. Noted for whoever eventually revisits `scorePrice`'s weights.

## 📝 User Stories / Use Cases

Added retroactively to an already-approved spec, scoped strictly to capability already described above (Phase 1 UI, Phase 3 diagnostic page) — no new capability is introduced by this section.

### Epic 1 — Manage product price rules (Phase 1)

- **Operator** wants to see every price rule configured for a product in one list, so they understand the current pricing configuration without querying the database directly.
  - *Empty state*: a product with zero `CatalogProductPrice` rows shows "No price rules yet — add one to price this product beyond its base price," not a blank table.
  - *Default state*: list renders scope as chips (customer / customer group / channel), the quantity range, currency + amount, and the validity window at a glance — the reachability gap this spec exists to close.
- **Operator** wants to create a price rule scoped to a specific B2B customer group, so a contracted account automatically sees the agreed price.
  - *Default values*: currency pre-fills from the store/channel context; `kind` defaults to `regular`.
  - *Optional scope*: saving without a customer or customer-group selection is valid (a channel- or tier-only rule) — scope fields are optional, not required.
  - *Error state*: an exact-duplicate scope (same customer group + channel + quantity range) is rejected with a field-level error, not a raw 500.
- **Operator** wants to define quantity-tier pricing (e.g. 10+ units at a lower unit price), so bulk buyers get an automatic discount without a separate promotion.
  - *Error state*: `maxQuantity` set below `minQuantity` is rejected at save; leaving `maxQuantity` empty means "and above."
- **Operator** wants to set a validity window (starts/ends) on a price rule, so a seasonal or promotional price expires on its own without manual cleanup.
  - *Error state*: `endsAt` before `startsAt` is rejected with a field-level error.
  - *Default state*: an expired rule stays visible in the list (never silently hidden) with a visual "Expired" indicator, so operators can find and renew or remove it.
- **Operator** wants to scope a price rule to a specific channel and currency, so multi-channel or multi-currency catalogs don't collide on a single price.
  - *Error state*: currency is required at save time — no silent fallback to the store's default currency when a channel with a different currency is selected.
- **Operator** wants to edit or delete an existing price rule, so mistakes can be corrected without direct database access.
  - *Default state*: the edit form pre-fills every field from the existing row — round-trip fidelity is the reachability gap this spec closes.
  - *Optimistic-lock conflict*: editing a row changed since the form loaded surfaces the standard conflict bar (`surfaceRecordConflict`) instead of silently overwriting it.
  - *Undo*: delete requires confirmation; both delete and edit are undoable via the existing `catalog.prices.*` command undo/redo mechanism.
  - *Keyboard*: `Cmd/Ctrl+Enter` submits the form, `Escape` cancels, per the platform's dialog convention.

### Epic 2 — Diagnose the active pricing resolver (Phase 3, optional)

- **Admin** wants to see which pricing resolver is currently registered and at what priority, so they can diagnose "why is this price wrong" without reading server logs or code.
  - *Permission state*: without the `pricing.diagnostics.view` feature, the page is absent from navigation and direct navigation returns the standard permission-denied page.
  - *Empty/baseline state*: when the optional `pricing` module isn't installed, the page (if reached) states plainly that only catalog's built-in resolver is active — this is a normal state, not an error.
  - *Read-only*: the page performs no mutations.

### Cross-cutting rules
- Every price-rule mutation flows through the existing `catalog.prices.create/update/delete` commands — no bespoke pricing logic in the UI layer.
- The list and form surface only fields the API/commands already accept (per Problem Statement — closing a reachability gap, not adding new capability).
- Phase 1 reuses the existing `catalog.products.manage` feature (no new ACL surface); only Phase 3's diagnostic page introduces a feature (`pricing.diagnostics.view`).

## 📝 Architecture

```
                     ┌─────────────────────────────────────────────┐
                     │  catalog (existing, hardened in Phase 1–2)   │
                     │                                               │
  admin operator ───▶│  Phase 1: backend/catalog/prices UI          │
                     │      ↓ (existing CRUD API + commands)        │
                     │  CatalogProductPrice rows                    │
                     │                                               │
                     │  Phase 2: PricingContext (+currencyCode,     │
                     │      +customerGroupIds, additive)            │
                     │  matchesContext() / scorePrice() (unchanged  │
                     │      weights, extended filters)              │
                     │  pricingResolvers registry → globalThis-keyed│
                     │      store, dedupe-by-id                     │
                     │  registerCatalogPricingResolver(fn, {id,     │
                     │      priority})  ◀───────────────┐           │
                     └────────────────────────────────────┼─────────┘
                                                            │ registers at boot
                     ┌──────────────────────────────────────┼─────────┐
                     │  pricing (new, optional, Phase 3)     │         │
                     │                                        │         │
                     │  di.ts: register(container) calls ────┘         │
                     │      registerCatalogPricingResolver(...)         │
                     │  lib/resolver.ts: composes catalog's             │
                     │      matchesContext/scorePrice/selectBestPrice,  │
                     │      adds currency + customerGroupIds matching   │
                     │  owns: no entities, no admin UI                  │
                     └───────────────────────────────────────────────┘

resolution (this spec) ──▶ discount/promotion effects (promotions, SPEC-055, OUT OF SCOPE)
                       ──▶ totals / tax / rounding (salesCalculationService, OUT OF SCOPE)
```

**When `pricing` is not installed**: `catalog`'s baseline `resolveCatalogPrice()` (hardened in Phase 2) is the whole system — currency-aware, `customerGroupIds`-aware, `globalThis`-safe. This is deliberately a complete, non-crippled baseline; Phase 1's admin UI works fully here too, since it depends only on `catalog`.

**When `pricing` is installed**: it registers a resolver into the same chain used today, at a priority above catalog's built-in fallback. Because registration flows through `registerCatalogPricingResolver`, `catalog` never imports, resolves, or knows about `pricing` — the dependency direction required by `packages/core/AGENTS.md` § Cross-Module Coupling ("the upstream/depended-on module MUST NOT import, resolve, or hard-require the consumer") holds by construction: `catalog` is upstream, `pricing` is the optional consumer that reaches *into* catalog's own extension point, not the other way around.

**Registry hardening detail (Phase 2).** Two changes to `pricingResolvers`:
1. Move from a module-local `const pricingResolvers: RegisteredResolver[] = []` to a `globalThis`-keyed singleton (stable key, lazy-initialized, reused across module-instance duplication) — same pattern as the ORM entity registry and the global event bus fixes already in this codebase.
2. Add an optional `id` to `registerCatalogPricingResolver(resolver, { priority, id? })` and skip re-registration when an entry with the same `id` is already present. This isn't `pricing`-specific — it makes the *existing, documented* extension point (already used by any third-party module per `catalog/AGENTS.md`'s own example) safe under dev hot-reload for every future registrant, not just this spec's.

**Why resolution stays a pure function.** Per the Medusa precedent above, `resolveCatalogPrice()`'s actual per-request computation takes `(context, fetched candidate rows)` and returns a result — no request-scoped mutable state. Only the *registration* of which resolver functions exist is a shared/global concern; that's exactly what Phase 2 fixes, and nothing else needs to move to `globalThis`.

## 📝 Data Model

**No schema changes in any phase.** `CatalogProductPrice` (`catalog/data/entities.ts:788+`) already carries every field: `currencyCode`, `kind`, `minQuantity`/`maxQuantity`, `unitPriceNet`/`unitPriceGross`, `taxRate`/`taxAmount`, `channelId`, `userId`/`userGroupId`, `customerId`/`customerGroupId`, `startsAt`/`endsAt`, tenant/org scope. Phase 1 exposes existing columns in a new UI. Phase 2 changes an in-memory TypeScript type (`PricingContext`) and an in-memory registry's storage location — no persistence involved. Phase 3 ships a module with zero entities: it reads catalog's existing rows at request time (the same cross-module read pattern response enrichers already use — an ID/entity-manager lookup, not a compile-time ORM relation) and persists nothing of its own.

**Actual current type** (`catalog/lib/pricing.ts:10-19`, verified by direct read, not reconstructed from memory):

```ts
export type PricingContext = {
  channelId?: string | null
  offerId?: string | null
  userId?: string | null
  userGroupId?: string | null
  customerId?: string | null
  customerGroupId?: string | null
  quantity: number   // required
  date: Date          // required
}
```

**`PricingContext` shape change (additive only, per `BACKWARD_COMPATIBILITY.md` § Type Definitions) — only two fields are added, nothing else about the existing type changes:**

```ts
export type PricingContext = {
  channelId?: string | null
  offerId?: string | null
  userId?: string | null
  userGroupId?: string | null
  customerId?: string | null
  /** @deprecated use customerGroupIds — kept for backward compatibility, read as a one-element set when customerGroupIds is absent */
  customerGroupId?: string | null
  customerGroupIds?: string[]   // new, Phase 2 — set membership; priority tiebreak among matches per 2026-08-14-customer-groups-and-b2b-terms.md (provenance note above)
  currencyCode?: string | null  // new, Phase 2 — optional at the type level (existing callers unaffected); functionally required by the pricing module's own resolver
  quantity: number    // unchanged — stays required
  date: Date           // unchanged — stays required
}
```

`quantity`/`date` stay required exactly as they are today — an earlier draft of this section incorrectly showed them as optional and dropped `| null` from the six existing optional fields; both would have been undisclosed, silently-permissive behavior changes (`matchesContext`'s range/window checks would pass on `undefined` rather than erroring) riding alongside the one currency change this spec deliberately discloses. Only `customerGroupIds` and `currencyCode` are new; every other field is untouched. This satisfies "MAY add optional fields" without narrowing anything required. The *pricing module's* own resolver (Phase 3) treats `currencyCode` as required at its own entry point and returns "no price found" rather than guessing when it's absent from a caller that opted into the stricter contract; catalog's baseline resolver keeps today's behavior (no currency filtering) when the field is omitted, so the "strictly safer" currency fix is opt-in at the point of adoption, not a silent behavior change for existing callers. See Edge Cases below for the one caller-visible behavior change this still causes.

## 📝 API Contracts

**Phase 1** adds no new HTTP routes. The admin UI consumes the existing `catalog/api/prices/route.ts` CRUD route and `catalog.prices.create/update/delete` commands, both already schema-complete for every specificity dimension — confirmed by direct inspection, not assumed. If implementation surfaces a genuine list-shaping gap (e.g., grouping price rows by product for the list view), that is a small additive query-param/response-field change to the existing route, not a new one.

**Phase 2** changes a service-level (DI/TypeScript) contract, not an HTTP one:
- `PricingContext` — additive fields per Data Model above.
- `registerCatalogPricingResolver(resolver, options?: { priority?: number; id?: string })` — matches today's actual signature (`catalog/lib/pricing.ts:127-133`: `options?: { priority?: number }`, defaulting to `?? 0`) with `id` appended as a new optional field; every existing call site (all in-repo callers and the documented `catalog/AGENTS.md` example) keeps compiling and behaving identically, so this is additive per `BACKWARD_COMPATIBILITY.md` § Function Signatures.
- No new output contract needed: the existing resolved `PriceRow` (via `selectBestPrice`) already carries `id` and `minQuantity`, which is everything the sibling `2026-08-14-cart-module.md` spec's line-item explainability snapshot (`price_row_id`, `price_tier_min_quantity`) needs (provenance note above — that spec is unmerged). `priced_at` is stamped by the caller (cart), not returned by the engine — no new field required.

**Phase 3** adds no new HTTP routes for the resolver itself (it's a DI-registered function, not an endpoint). An optional, small diagnostic backend page (see UI/UX) may add one lightweight read-only status route (`GET` — which resolver is currently active/registered, for operator debugging given the "silent failure" risk this spec's whole premise is built to close) — additive, and explicitly optional/nice-to-have, not blocking.

## 📝 UI/UX

**Phase 1 — `catalog/backend/catalog/prices/` (new page).**
- `<DataTable>` listing `CatalogProductPrice` rows: product/variant, kind, amount + currency, scope summary (customer/customer-group/channel, rendered as chips), quantity range, validity window. Stable `entityId`/`extensionTableId` per `packages/ui/AGENTS.md`.
- `<CrudForm>` for create/edit exposing every specificity field (`createCrud`/`updateCrud`/`deleteCrud`; `createCrudFormError` for local validation). `Cmd/Ctrl+Enter` submit, `Escape` cancel. Optimistic locking via `updatedAt` (verify `CatalogProductPrice` carries `updated_at` during Step 1 — the root convention requires it on user-editable entities; not independently confirmed by this spec's research and must be checked, not assumed, before the form ships).
- i18n via `useT()`/locale files — no hardcoded labels; reuse `catalog`'s existing translation namespace.
- No design-system inventions: `<StatusBadge>` for `kind` (custom/promotion/tier/regular), standard DS tokens throughout.

**Phase 2** — no UI.

**Phase 3** — no required UI. Optional: a small read-only backend page (e.g. under `pricing/backend/`) showing the currently-registered resolver chain (ids, priorities, which one is `pricing`'s) for operator diagnosis — directly answers the "why is this price wrong" debugging need the registry-hardening work exists to prevent. Guarded by a new `pricing.diagnostics.view` feature declared in `pricing/acl.ts` and granted via `setup.ts` `defaultRoleFeatures` (`admin`, at minimum), consistent with every other route in this codebase requiring a declared feature rather than shipping unguarded. Nice-to-have, cut first if Phase 3 needs to shrink.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Behavior | User-visible effect |
|---|---|---|
| No price row matches a context in any currency | Resolver returns "no price found" | Caller's problem to handle (out of scope here); documented as the contract, not silently defaulting to some other currency's price |
| Price rows exist, but only in a different currency than the (Phase-2-aware) caller requested | **Behavior change**: previously could silently match a wrong-currency row (today's undocumented bug); now correctly resolves to "no price found" | Only affects callers that adopt `currencyCode` in their context — see Data Model. Flagged in Migration & Backward Compatibility as a deliberate, strictly-safer change, with a release note for the one caller (`catalog` itself) currently doing implicit pre-filtering |
| Two resolvers register at the same priority (e.g. a future third module also targets this extension point) | Existing chain iteration order is not documented today — must be confirmed (stable insertion order, presumably) during Phase 2 implementation and made explicit, not left implicit | Deterministic resolution requires this to be a documented, tested behavior, not an accident of array order |
| `customerGroupIds` context matches more than one group-scoped row with different scores | Priority tiebreak follows whatever `2026-08-14-customer-groups-and-b2b-terms.md` ultimately specifies (provenance note above — unmerged); if it hasn't shipped by the time Phase 2/3 land, this spec defines a provisional default (highest `scorePrice` score wins — consistent with existing same-kind tie-break logic) and documents it as provisional pending that sibling spec | Consistent, explainable price selection even before the sibling spec lands |
| `pricing` module installed, then disabled without an app restart (dev hot-toggle) | No unregister mechanism exists or is added by this spec — module enable/disable takes effect on next boot, consistent with how routes/ACL/DI already work for every other module in this system | Not a new operational burden; documented explicitly so it isn't assumed to be instant |
| `pricing` module registers a resolver whose priority is misconfigured below catalog's built-in fallback | Falls back to catalog's baseline resolver silently succeeding at a lower specificity than intended | Phase 3's diagnostic page (if built) surfaces this; otherwise it's a configuration error the operator must catch via testing, documented as a known limitation |
| A caller passes `resolveCatalogPrice`/`selectBestPrice` a row set that was not pre-scoped by `organization_id`/`tenant_id` (e.g. a careless future `pricing`-module or `cart`/`sales` integration fetches more broadly than today's callers do) | The resolver has no scoping check of its own — it is a pure function over whatever rows it receives, and always has been | Cross-tenant price leak. Not a new risk introduced by this spec, but this spec is the first place documenting it as an explicit caller contract: **every caller MUST pre-scope rows by `organization_id`/`tenant_id` before calling the resolver** — verified true of every current caller today, and must remain true of `pricing`'s Phase 3 resolver and any future consumer |

## 📝 Risks & Impact Review

### High
- **Registry-scoping fix is foundational, not cosmetic.** If Phase 2 ships without the `globalThis` migration actually verified under a multi-instance topology (not just the monorepo dev app), Phase 3's entire premise — "when installed, it takes over" — is unverified in exactly the environments (standalone apps) this spec's "generic and reusable" goal targets most. Mitigation: a regression test that registers a resolver from a second module instance and confirms `resolveCatalogPrice()` (running against the first instance) sees it — modeled on whatever test was added for the ORM-registry fix this lesson references.
- **`sales/AGENTS.md` overclaim must be corrected regardless of Q1's outcome.** Leaving a false "MUST use `selectBestPrice`" rule in place misleads future contributors into believing sales pricing is already centrally enforced when it isn't. Mitigation: fix the doc in this spec's own change-set (Phase 1 or 2, whichever lands first) independent of whether `sales` wiring itself is in scope.
- **Bundling Phase 1 (catalog UI) and Phase 3 (new module) into one spec has real process friction, even though the user explicitly chose to keep them together rather than split.** Not re-litigating that call — naming the cost it carries: (a) approving this spec as one unit needs a reviewer competent in both DS-compliant `CrudForm`/`DataTable` conventions *and* module-registry/`globalThis`/cross-module-coupling correctness — two largely disjoint skill sets under one verdict; (b) Phase 1 has zero dependency on Phase 2/3 (confirmed in Phasing), so bundling buys no sequencing benefit while still coupling their fates at spec-approval time — a dispute over the Phase 3 registry-dedupe design stalls the unrelated, ready-to-ship UI work too; (c) discoverability — a spec titled "Pricing Engine" is not where someone auditing "how do I add a price-rule admin page" would look, and the `customerGroupIds`-shape coordination risk (below) is harder for `2026-08-14-customer-groups-and-b2b-terms.md`'s author to find, buried in a document whose title foregrounds UI/registry work. Mitigation: none applied — the split-vs-bundle call is the user's and stands; this is recorded so the cost is visible, not silently absorbed.

### Medium
- **`customerGroupIds` shape is defined by two independent specs (this one and `2026-08-14-customer-groups-and-b2b-terms.md`, provenance note above).** Risk of incompatible landed shapes if merge order isn't coordinated. Mitigation: this spec is the shape's origin per the Q4 decision; the sibling spec's own Migration & Backward Compatibility section must explicitly defer to whatever lands here, not redefine independently. Flag to whoever owns that spec.
- **Currency behavior change (see Edge Cases) is opt-in but still needs a release note**, since silently-matched cross-currency prices — if any exist in seeded/demo data or a real deployment relying on the current bug — would start returning "no price found" once a caller adopts `currencyCode`. Mitigation: `UPGRADE_NOTES.md` entry alongside the Phase 2 PR.

### Low
- **Optional diagnostic page (Phase 3) is the only mitigation for silent misconfiguration** (wrong resolver priority). Accepted as low-severity since it's explicitly optional/nice-to-have — the alternative (skip it) just means relying on tests and documentation instead of a runtime UI.

## 📋 Phasing

1. **Phase 1 — Catalog price-rule admin UI** (`catalog`). Independently shippable. No dependency on Phase 2 or 3.
2. **Phase 2 — Catalog resolver contract hardening** (`catalog`). Independently shippable. No dependency on Phase 1. **Prerequisite for Phase 3.**
3. **Phase 3 — Pricing resolution engine module** (`pricing`, new, optional). Depends on Phase 2's hardened contract. Does not depend on Phase 1.

Explicitly deferred / out of scope for this spec (named so the gap doesn't silently close itself — see Q1 decision and Risks): wiring `sales`/`cart` to call the engine (owned by `2026-08-14-cart-module.md`, provenance note above, and a future `sales`-specific spec), the promotions interaction rule flagged in Research, and any admin UI inside `pricing` beyond the optional diagnostic page.

## 📋 Implementation Plan

### Phase 1 — Catalog price-rule admin UI
1. Verify `CatalogProductPrice` carries `updated_at`; if missing, add it (additive migration) before the form ships, since optimistic locking is default-on for user-editable entities.
2. Build `catalog/backend/catalog/prices/` list page (`<DataTable>`) against the existing prices CRUD route — no new backend route.
3. Build the create/edit `<CrudForm>` exposing all specificity fields; wire `createCrud`/`updateCrud`/`deleteCrud`.
4. Add i18n keys for every new label; run `yarn i18n:check-hardcoded`.
5. Integration test: create a customer-group-scoped, quantity-tiered price row through the UI, then confirm `selectBestPrice` picks it over a regular price for a matching context (proves the UI reaches the dimensions the API already supported).

### Phase 2 — Catalog resolver contract hardening
1. Migrate `pricingResolvers` to a `globalThis`-keyed store; add a regression test that registers from a second simulated module instance and confirms visibility from the first (modeled on the ORM-registry fix's own test).
2. Add optional `id` + dedupe-by-id to `registerCatalogPricingResolver`; test double-registration with the same `id` is a no-op.
3. Add `currencyCode`/`customerGroupIds` to `PricingContext`; extend `matchesContext()` additively (both fields optional, legacy behavior preserved when absent).
4a. Decide and document the resolver-chain same-priority tie-break rule (e.g. stable insertion order) — this is a design decision, not yet made anywhere in this spec or the current code (see Edge Cases).
4b. Once 4a is decided, add a test asserting that specific rule. (Split from a single step because a test can't verify a rule that doesn't exist yet — the original single-step phrasing was circular.)
5. Fix `sales/AGENTS.md`'s `selectBestPrice` overclaim to state the actual current state.
6. Add an `UPGRADE_NOTES.md` entry for the currency behavior change (opt-in, strictly safer).

### Phase 3 — Pricing resolution engine module
1. Scaffold `packages/core/src/modules/pricing/` (`index.ts`, `acl.ts`, `setup.ts`, `di.ts`) — no entities. Even without the diagnostic page, `acl.ts`/`setup.ts` exist per module convention; add `pricing.diagnostics.view` to both only if Step 5 ships.
2. `di.ts` `register(container)` calls `registerCatalogPricingResolver(resolver, { priority, id: 'pricing.engine' })` at module load.
3. `lib/resolver.ts` composes catalog's `matchesContext`/`scorePrice`/`selectBestPrice` (imported, not reimplemented) with mandatory currency filtering and `customerGroupIds` set matching + priority tiebreak (provisional default per Edge Cases if the sibling spec hasn't landed). Reads catalog's `CatalogProductPrice` rows already pre-scoped by `organization_id`/`tenant_id` by whatever caller supplied them — see the new tenant-scoping Edge Case; does not add its own scoping check, matching every existing caller's contract.
4. Integration test: module absent → catalog baseline resolves; module installed → `pricing`'s resolver wins for a context it claims; module logically "uninstalled" (not registered on a fresh boot) → reverts to baseline.
5. Optional: diagnostic backend page listing the active resolver chain, guarded by `pricing.diagnostics.view` (declared in `acl.ts`, granted to `admin` in `setup.ts` `defaultRoleFeatures`).
6. Run `yarn generate`, full validation gate.

## Integration Test Coverage

- **API**: `catalog/api/prices` create/update/delete with every specificity field (Phase 1 UI's backing contract — already exists, add coverage if missing).
- **Resolver behavior**: currency filtering (match / no-match), `customerGroupIds` set membership + tiebreak, same-priority resolver chain order, registry visibility across simulated module instances (Phase 2).
- **UI**: create a tiered/customer-group price row via the new admin page, confirm it resolves correctly end to end (Phase 1).
- **Module lifecycle**: `pricing` absent vs. installed vs. never-registered-this-boot (Phase 3), per `packages/core/src/__tests__/module-decoupling.test.ts`'s pattern for optional-module absence.

## Final Compliance Report

| Check | Verdict | Note |
|---|---|---|
| Scope cohesion (one capability per spec) | Reviewed and confirmed as a deliberate exception, friction named not hidden | Admin UI (Phase 1) and the resolution engine (Phase 3) are independently deployable; user explicitly chose to keep them as phases of one spec rather than splitting (see Changelog). A fresh-context adversarial review confirmed the split-vs-bundle call isn't reopened but surfaced concrete costs — reviewer-skill mismatch, zero sequencing benefit, discoverability — now recorded in Risks (High) rather than left implicit |
| Canonical mechanisms reused, not reinvented | Pass | Reuses `CatalogProductPrice`, `matchesContext`/`scorePrice`/`selectBestPrice`, `registerCatalogPricingResolver`, `makeCrudRoute`, `CrudForm`/`DataTable`, commands pattern — verified against actual code by the adversarial review, not just plausible-sounding |
| Contracts and compatibility | Pass, after correction | Adversarial review caught two drafting errors: the `PricingContext` diagram had silently flipped `quantity`/`date` to optional and dropped `\| null` from existing fields; `registerCatalogPricingResolver`'s stated signature was stricter (`options` non-optional) than the real one. Both fixed in Data Model / API Contracts against the verified actual types. The one real behavior change (currency) remains correctly flagged with an `UPGRADE_NOTES.md` entry |
| Reversibility | Pass | Phase 3 module is opt-in/uninstallable by design (that's its whole premise); Phase 1/2 changes are additive UI/registry fixes with no destructive path |
| Boundaries and coupling | Pass | `catalog` never imports/resolves `pricing`; `pricing` reaches into catalog's own documented extension point, matching `packages/core/AGENTS.md` § Cross-Module Coupling. Adversarial review confirmed this was checked against the rule's actual text, not just asserted |
| Sensitive data | Pass, no new surface | Price rows carry no PII; no `encryption.ts` changes needed. The optional diagnostic route needed (and now has) a named ACL feature — not a PII gap, but an access-control completeness gap the review caught |
| Failure scenarios | Pass, after addition | Adversarial review found the Edge Cases table gave currency a full caller-contract treatment but omitted the equivalent tenant/organization-scoping contract despite it being a higher-severity rule in root `AGENTS.md`. Added as an explicit row |
| Testability | Pass, after correction | Every Implementation Plan step has an associated test; Phase 2's tie-break step was circular (testing a rule not yet decided) and is now split into a decide-then-test pair |
| Citation provenance | Pass, after correction | `2026-08-14-ecommerce-suite-roadmap.md`/ADR-4, `2026-08-14-cart-module.md`, and `2026-08-14-customer-groups-and-b2b-terms.md` do not exist in `.ai/specs/` on `develop` — they live on the unmerged `spec/ecommerce-module-suite` branch (PR #5384). A provenance note now marks every citation to them as a forward reference, not settled fact |

## Changelog

- **2026-08-21** — Initial skeleton with Open Questions Q1–Q5 (module location, sales/cart wiring, currency, admin UI, `customerGroupIds` shape).
- **2026-08-21** — Q1 (module location) closed by rule (`packages/core/AGENTS.md` § Where to Put Code). Pre-implementation analysis (`ANALYSIS-2026-08-21-pricing-engine.md`) surfaced the `pricingResolvers` `globalThis`-scoping bug; folded into scope.
- **2026-08-21** — Q1(orig. numbering)/Q2/Q4 resolved (engine-only for sales/cart wiring; currency-aware; `customerGroupIds` from day one). Verification of catalog's existing price UI/API showed the admin-UI gap is UI-only, with data/API/commands already complete — reframed Q3 as a module-ownership question.
- **2026-08-21** — Scope-cohesion check: admin UI and resolution engine are independently deployable; user chose to keep as two phases of one spec rather than splitting into two. Full Architecture/Data Model/API Contracts/Phasing drafted, grounded against Medusa.js and commercetools pricing architectures.
- **2026-08-31** — Added the "User Stories / Use Cases" section (Epics 1–2, role-goal-outcome stories with UX acceptance criteria for empty/error/permission/optimistic-lock/undo/keyboard/default-value states), scoped strictly to capability already described in Proposed Solution/UI-UX — no new capability introduced. Added to unblock an `om-mockup-prototype` click-through prototype of Phase 1's admin UI.
- **2026-08-21** — Fresh-context adversarial review (per `om-spec-writing` step 8, reviewer had no prior context and independently verified claims against the actual repo). Findings applied: sibling-spec citations (`ecommerce-suite-roadmap`/ADR-4, `cart-module`, `customer-groups-and-b2b-terms`) marked with an explicit provenance note — they live on unmerged branch `spec/ecommerce-module-suite` (PR #5384), not on `develop`; `PricingContext`'s Data Model diagram corrected to match the actual current type (`quantity`/`date` are required, existing optional fields carry `| null`) after the draft had silently narrowed/widened them undisclosed; `registerCatalogPricingResolver`'s API Contracts signature corrected to match the real `options?: { priority?: number }`; added an explicit tenant/organization-scoping caller-contract Edge Case (the resolver has no scoping check of its own — always been true, now documented); named the bundling friction (reviewer-skill mismatch, no sequencing benefit, discoverability) as a High risk instead of leaving it implicit in the Final Compliance Report; split Phase 2's circular tie-break-decide-and-test step into two; added a named `pricing.diagnostics.view` ACL feature for the optional diagnostic route.
