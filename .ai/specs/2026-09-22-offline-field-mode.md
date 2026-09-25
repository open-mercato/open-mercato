# Offline Field Mode

| Field | Value |
|-------|-------|
| **Status** | Specification |
| **Created** | 2026-09-22 |
| **Suite** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) — spec 14, cross-cutting (see [ADR-10](./2026-08-14-ecommerce-suite-roadmap.md#adr-10--field-mode-assembles-offline-commits-online)) |
| **Modules** | `packages/shared` (contract + reconciliation logic, new), `ecommerce` (two read endpoints, one settings key — extension, no new module), `apps/storefront` (client route subtree — extension) |
| **Depends on** | [Ecommerce Suite Roadmap](./2026-08-14-ecommerce-suite-roadmap.md) (ADR-1, ADR-2, ADR-7 amended, ADR-9), [Storefront Public API](./2026-08-14-storefront-public-api.md) (§9 caching, §9.1 named-component keying), [Cart Module](./2026-08-14-cart-module.md) (§4.1, §4.2, §5.2, §6a, §7.1–§7.2, §8.1–§8.2, §10), [Storefront Application](./2026-08-14-storefront-app.md) (§3.3, §9, §14 OQ4 — resolved here) |
| **Related** | [POS Module (SPEC-022)](./SPEC-022-2026-02-07-pos-module.md) §3 — named second consumer of the contract this spec defines |

---

## TLDR

**Key Points:**
- Field mode is two independently-risked halves that must never be specified, or built, as one "let's make it a PWA" feature: a server-built, buyer-priced **offline pack** for reading, and a client-side **intent outbox** for writing. Treating them as one feature is why offline commerce projects usually fail — the read half is a pricing-disclosure problem and the write half is a data-integrity problem, and conflating them means neither gets the review it needs.
- **No offline checkout, ever.** A buyer assembles an order while disconnected; every commit — price, tax, credit, stock — happens online. The outbox holds intent ("add variant X, quantity N"), never a total, and replays through `cart.lines.bulkAdd`, a command that already exists (cart spec §6a.1, §10) and already handles partial success and idempotency (cart spec §8.2). This spec adds no new cart endpoint and no new cart contract field.
- The offline pack is keyed on the same **named** `BuyerContext` components every other cached surface in this suite now uses post-[ADR-7 amendment](./2026-08-14-ecommerce-suite-roadmap.md#adr-7--buyer-context-is-resolved-once-at-the-edge) — `assortmentScopeHash`, `priceScopeKey`, `customerOverlayId` — never a digest of the whole context. A priced catalog leaving the server onto a device nobody controls is R1's failure class (storefront-app §11, storefront-public-api §11) at its most literal: the device *is* the cache, and it can be picked up by anyone.
- Because every commit re-validates online with a freshly-resolved `BuyerContext`, a stale or wrong-identity pack can produce a bad **offline preview** — but it cannot produce an unauthorized **purchase**. That is the core safety property of "assemble offline, commit online," and it is what makes the rest of this spec's risk profile tractable.
- The contract — pack manifest shape, outbox intent shape, and the replay-reconciliation function — lives in `packages/shared`, not in `apps/storefront`. POS has the identical problem, today parked as an explicit non-goal (SPEC-022 §3: *"Offline mode and sync (Phase 3)"*). This spec names POS as the contract's second consumer and states what it deliberately excludes (cash handling, register session state, hardware).
- This spec introduces **zero new database tables**. It is a contract-and-endpoint spec, not a new module.

**Scope:**
- The offline pack: content selection, size ceiling, manifest + delta protocol, cache keying
- The outbox: intent shape, replay algorithm, reconciliation against the cart's existing response envelope
- Device-at-rest protection: opt-in, encryption, a local passcode/biometric gate, TTL, purge triggers
- `packages/shared` contract types and the one piece of shared logic (`reconcileOfflineReplay`)
- Two new `ecommerce` read endpoints; zero changes to `cart`, `sales`, or `checkout`
- The client-side route subtree in `apps/storefront` and its bundle/service-worker boundary
- POS named as the second consumer, with explicit exclusions
- Resolution of [Storefront Application](./2026-08-14-storefront-app.md) §14 Open Question 4

**Concerns:**
- A priced catalog at rest on a shared warehouse tablet is a worse version of R1 than any cache-header mistake, because the leak is physical, not architectural
- The staleness window here is hours to days, not the seconds a cart's re-pricing trigger set (cart spec §5.2) was designed for — the same disclosure discipline has to hold at a much longer horizon
- It is tempting to solve this with a generic service worker cache; that is exactly the mistake this spec's ADR exists to foreclose

---

## 1) Overview

Some buyers place an order standing in a place with no signal: a warehouse floor, a factory line, a field. They have a catalog they downloaded earlier, in the last place they had a connection, and they want to pick items and quantities now, then have the order actually go through the moment their phone finds a bar of signal again.

That is the whole feature. It is not "the storefront works offline." It is: a bounded, buyer-priced slice of the catalog is readable without a network, and a bounded queue of add-to-cart intents can be composed without a network, and neither of those things pretends to be a price, a stock guarantee, or an order until the device is back online and the platform's existing pricing, tax, credit, and stock authorities have had a chance to say so.

**Out of scope, stated up front and never revisited below:** offline checkout, offline order creation, client-side price or total arithmetic of any kind, and a cache of the whole catalog. Every one of these is a repeat of a decision already made elsewhere in this suite (ADR-1, ADR-2, storefront-public-api R1) — promoting it into "yes, but for offline" is exactly the relitigation this document exists to refuse.

---

## 2) Problem Statement

### 2.1 A naive PWA cache is R1 wearing a service worker

The obvious first idea — a service worker that caches `/products` responses — fails for the same reason storefront-app §11 R1 exists: price depends on who is asking. A service-worker cache has no concept of buyer identity; it would cache one buyer's negotiated prices and serve them to whoever opens the app next on that device. That is not a hypothetical for this feature's own target hardware — a shared tablet on a factory floor is a more likely sharing scenario than the CDN-bleed case R1 was written for.

The read side therefore cannot be "cache the existing endpoint." It has to be a **purpose-built, server-computed artifact** that is priced once, for one resolved identity, and carries that identity with it so the client can tell when it has gone stale.

### 2.2 A basket has idempotent bulk-add already; offline has nothing that uses it

`cart.lines.bulkAdd` already exists to add many lines in one call, already accepts an `Idempotency-Key` (cart spec §8.2), and already degrades to partial success with per-line `warnings` instead of an all-or-nothing failure (cart spec §6a.1, §10.1). This is precisely the shape an offline queue needs on reconnect: many intents, replayed once, tolerant of some of them no longer being valid. Nothing today assembles those intents while offline or drives them through that endpoint on reconnect — not because the endpoint is missing a feature, but because no client-side queue and no reconciliation contract exist yet.

### 2.3 The reconciliation screen must not be invented twice

Cart spec §7.2 already defines `mergeSummary` — a screen that shows what happened when two baskets combined, including what got capped or dropped. Offline replay produces the exact same category of event: some intents landed, some got capped, some got rejected. A second, offline-specific "here's what changed" screen would drift from the merge screen the moment either one is touched, and the buyer would have to learn two UI patterns for the same underlying fact ("some of what you tried to add isn't what's in your cart now"). Section 3.3 below is designed so replay output is presentable through the identical `priceChanges` / `warnings` / `mergeSummary` surface cart already returns.

### 2.4 POS has the identical problem, parked, not solved

POS (SPEC-022) is explicit that offline is out of scope for its first phases: *"Offline mode and sync (Phase 3)"* is listed under Non-Goals (SPEC-022 §3, line 36). A POS register on a warehouse floor with no signal is the same shape of problem as a storefront buyer in the same warehouse: a bounded catalog read offline, a bounded set of intents queued offline, replayed through an idempotent bulk mutation online. If the pack manifest, the outbox envelope, and the reconciliation shape are defined inside `apps/storefront`, POS's eventual Phase 3 spec will invent an incompatible second version of all three, and the two channels will need two sync engines for what is architecturally one problem. §7 below is where this spec draws that boundary.

---

## 3) Architecture

### 3.1 Two halves, one boundary

```
                     ┌─────────────────────────────────────────┐
                     │              apps/storefront             │
                     │            /field/* route subtree         │
                     └───────────────┬───────────────┬──────────┘
                                      │               │
                     while online    ▼               ▼   while online
                     ┌──────────────────┐   ┌──────────────────────┐
                     │  READ: the pack   │   │  WRITE: the outbox    │
                     │  (server-built,   │   │  (client-local queue,  │
                     │   buyer-priced)   │   │   intent only)         │
                     └─────────┬────────┘   └───────────┬───────────┘
                               │ GET, cached,            │ replays as
                               │ scope-keyed              │ cart.lines.bulkAdd
                               ▼                          ▼
                     ┌──────────────────┐        ┌──────────────────┐
                     │    ecommerce     │        │       cart        │
                     │ offline-pack API │        │  (unmodified —    │
                     │  (new, §5)       │        │   §10 as written) │
                     └──────────────────┘        └──────────────────┘
```

The boundary is: **you assemble offline, you commit online.** Nothing below this line is new architecture — the pack is a read endpoint like any other in `storefront-public-api.md`, and the outbox replays through a cart command that already exists. What is new is the discipline of keeping the two halves from touching: the pack never accepts a write, and the outbox never carries a price, a total, or a stock guarantee.

### 3.2 Read: the offline pack

**What it is.** A versioned, server-computed slice of the catalog, priced once for one resolved `BuyerContext`, never recomputed on the client. `cart` already refuses to let the client do arithmetic (ADR-2); the pack applies the identical rule to the client's *view* of prices — the client renders what the server sent, and nothing else.

**Who selects the content, and how much.** A store-level policy (§4.1) selects, in order of priority up to a hard cap: the buyer's own price-list scope, their previously-ordered products (most-recent first), and any merchant-curated categories or tags flagged for field mode. A buyer may additionally pin individual products themselves, within the same cap — pinning past the cap evicts the buyer's own oldest pin with a visible notice, never silently. **The pack is never the whole catalog.** It is capped at 500 products / 1,500 variants by default (§8, autonomous default, store-configurable), and the manifest's `entryCount` makes the bound visible to the client and to support.

**Images are opt-in and separately budgeted.** The base pack is text-and-price only. A store may opt into thumbnails, which draw from a separate, smaller budget (default 20 MB, aggressively compressed, low-resolution, fetched opportunistically and never blocking the base pack's availability).

**Freshness is disclosed, not hidden.** Every pack carries `generatedAt`, and the client shows it verbatim — "prices as of 14:20, offline" — for as long as the device has no connection. This is not a courtesy; it is the same disclosure discipline cart spec §5.3 requires for an in-session re-price, stretched over a much longer window (hours to days instead of the 30-minute staleness budget cart spec §5.2 trigger 4 uses), which is exactly why it must be **more** visible here, not less.

**Manifest + delta, so a brief moment of signal doesn't restart the download.** A lightweight `GET .../offline-pack/manifest` call (§5) returns just the current `version` and a checksum — cheap enough to poll the instant a bar of signal appears. If the version matches what the client already has, nothing else happens. If it does not, `GET .../offline-pack?since=<version>` returns only the entries that changed and the ids that dropped out of scope, not the whole pack again — unless the client's `since` is unrecognized (too old, or a first fetch), in which case the server returns the full set. Given the pack's hard size ceiling, a full resend is cheap enough to be an acceptable fallback rather than something requiring unbounded version history on the server.

**Cache keying follows ADR-7's amendment, not around it.** The manifest and pack responses are cached exactly like every other buyer-aware surface in `storefront-public-api.md` §9 — through `buildStorefrontCacheKey`, keyed on the pack's own named scope components (`assortmentScopeHash`, `priceScopeKey`, `customerOverlayId`), never on a digest of the whole `BuyerContext`. This is not a new caching decision; it is the existing one, applied to a fourth surface.

### 3.3 Write: the outbox

**What it is.** A client-local, bounded queue of `OfflineIntent` records (§4.2) — product, variant, configuration, quantity, and the timestamp and pack version the buyer saw when they queued it. **No price. No total. No tax.** An intent is a request to add a line, structurally identical to what `cart.lines.add` already accepts, minus the network round trip.

**Replay, on reconnect:**

1. The client re-resolves `BuyerContext` online (the normal `/context` call every buyer-aware route already makes) — **not** the possibly-stale scope embedded in the offline pack. This is the step that makes a wrong-identity pack safe rather than merely disclosed (§9 R5).
2. The client attempts `GET /carts/:token` against its last-known cart. If the cart is gone, expired, or in a terminal status (`converted`, `expired`), it falls back to the existing `POST /carts` (cart spec §10) to obtain a fresh one — no server change, no new endpoint; this *is* what "replay lands in a new cart, not a 404" means (§9 R3).
3. The client calls the existing `POST /carts/:token/lines/bulk` (cart spec §10, §6a.1) with the queued intents mapped 1:1 to `bulkAdd` line inputs, the freshly-resolved `assortmentScope`, and an `Idempotency-Key` derived from the outbox batch — so a flaky reconnect that retries the same replay does not double-add (cart spec §8.2).
4. The response is the cart's own unmodified envelope (cart spec §10.1): `cart`, `priceChanges`, `warnings`, and `mergeSummary` if a guest→customer merge also fired.

**Reconciliation without a second screen.** `reconcileOfflineReplay` (§4.3) — a pure function shipped in `packages/shared`, not duplicated per channel — diffs the queued intents against the resulting `cart.lines`, matched by the exact `(productId, variantId, configuration)` triple cart spec §4.2 already uses as the line-uniqueness key. Every intent is classified `accepted`, `quantity_adjusted`, or `rejected`; rejections attach the matching `warnings` entry where cart's own `lineId` correlation makes that possible, and otherwise surface as an unattributed but still visible "N items did not make it" alongside the full `warnings` list (see §9 residual risk on this specific limitation). The output feeds directly into the same `priceChanges` / `warnings` / `mergeSummary` presentation the cart page and checkout already render — no new component contract, per §2.3.

**No offline checkout, enforced in the client, not just documented.** The `/field/*` route subtree has no route that reaches checkout while offline; navigating to checkout requires a live connection check, the same way the normal cart page already assumes connectivity for its "always live" rendering row (storefront-app §3.3).

### 3.4 Client surface

`apps/storefront` gains a route subtree, not a second app:

```
apps/storefront/src/app/field/
├── page.tsx                    Enable / pack status / last-synced-at
├── catalog/page.tsx            Browse the pack (list + search over local data)
├── catalog/[handle]/page.tsx   Pack entry detail — price, tiers, quantity rules
├── cart/page.tsx               The local outbox, reviewed like a cart
└── sync/page.tsx               Reconciliation screen, shown on reconnect
```

**This subtree is client-only and precached for offline use; the rest of the app is not.** Storefront-app §3.3's rendering table (server-first, buyer-aware, ISR per audience digest) is correct and stays unchanged for every route outside `/field/*` — it is precisely what cannot be done offline, because it depends on a live server resolving a live `BuyerContext` per request. Field mode is therefore a **separate, fully client-rendered route subtree** layered over the pack data, not "the app now works offline." A scoped service worker (or equivalent Cache API usage) precaches only the `/field/*` route's own JS/CSS shell — because unlike normal route-level code splitting, this subtree cannot lazy-load a chunk it doesn't already have once the device is offline. It registers no fetch interception for `/products`, `/categories`, or any other buyer-aware route; §9 R9 is the regression this boundary exists to prevent, and it is asserted by test (§10).

**Budget consequence for storefront-app §9.** Field mode does not count against the catalogue (< 180 kB) or checkout (< 250 kB) JS budgets — it is a separate, route-level chunk that a normal buyer never downloads. It carries its own budget instead, because it must ship everything it needs (IndexedDB handling, the encryption/passcode gate, the outbox UI) in one precached shell rather than fetching pieces on demand. See storefront-app §9's amended table (this spec's storefront-app.md edit).

**`@open-mercato/storefront-ui`'s budget is untouched.** Field mode's components (`OfflinePackStatus`, outbox review, the sync/reconciliation screen) are commerce-specific and live in the app, exactly where ADR-8 already says commerce components belong — not in the shared primitives package.

---

## 4) Data Models

**Zero new database tables.** This spec introduces one new settings key on an existing entity, and a set of `packages/shared` types with no server-side persistence of their own — the pack is computed and cached, not stored, and the outbox lives entirely on the client. This is a deliberate consequence of §3: reusing `cart`'s existing idempotency (§8.2) and `storefront-public-api`'s existing tag-based cache invalidation (§9.1) means neither a manifest table nor an outbox table earns its keep.

### 4.1 `EcommerceStore.settings.offlineFieldMode` (new key on an existing JSONB column, owned by `ecommerce`)

```typescript
type OfflinePackPolicy = {
  enabled: boolean                    // store-level opt-in; off by default — see §8
  selectionMode: 'price_list' | 'previously_ordered' | 'merchant_curated' | 'combined'
  maxProducts: number                 // default 500
  maxVariants: number                 // default 1500
  includeImages: boolean              // default false
  imageBudgetBytes: number            // default ~20_000_000, only relevant when includeImages
  offlineTtlHours: number             // default 72 — pack and passcode-gate lifetime, see §6
  buyerPinningEnabled: boolean        // default true
  buyerPinCap: number                 // default 50, counted within maxProducts
}
```

No FK, no new table: this is a settings-blob extension exactly like the branding fields `storefront-app.md` §6 already reads from `EcommerceStore.settings`.

### 4.2 `packages/shared/src/lib/offline/` — the contract

```typescript
// manifest.ts
type OfflinePackScope = {
  assortmentScopeHash: string          // named BuyerContext component, roadmap ADR-7 (amended)
  priceScopeKey: string
  customerOverlayId: string | null
}

type OfflinePackManifest = {
  version: string                      // opaque, monotonic per scope
  scope: OfflinePackScope
  storeId: string
  generatedAt: string                  // ISO — the client's "prices as of" banner source
  expiresAt: string                    // generatedAt + offlineTtlHours
  entryCount: number
  checksum: string
}

type OfflinePackEntry = {
  productId: string
  variantId: string | null
  handle: string
  name: string
  sku: string | null
  optionValues: Record<string, string> | null
  unitPriceNet: string
  unitPriceGross: string
  taxRate: string
  priceKindId: string | null
  priceTiers: Array<{ minQuantity: number; unitAmount: string; formatted: string }>
  quantityRules: { min: number; max: number | null; increment: number }
  availabilityState: AvailabilityResult['byItem'][string]['state']   // advisory only; isAuthoritative is always false in a pack
  image: { thumbnailUrl: string; width: number; height: number } | null
  contentHash: string                  // per-entry hash, for delta diffing
}

type OfflinePackDelta = {
  version: string
  scope: OfflinePackScope
  generatedAt: string
  expiresAt: string
  changed: OfflinePackEntry[]          // the full set on a from-scratch fetch
  removed: string[]                    // productId (or productId:variantId) no longer in the pack
}
```

```typescript
// outbox.ts
type OfflineIntent = {
  localId: string                      // client-generated; never sent to the server
  productId: string
  variantId: string | null
  configuration: Record<string, unknown> | null
  quantity: number
  queuedAt: string
  packVersionAtQueue: string
  unitPriceAtQueue: { net: string; gross: string }   // display only — never sent as a price anywhere
  status: 'queued' | 'replaying' | 'accepted' | 'quantity_adjusted' | 'rejected'
}

type OfflineReplayReconciliation = {
  accepted: OfflineIntent[]
  quantityAdjusted: Array<{ intent: OfflineIntent; requestedQuantity: number; resultingQuantity: number }>
  rejected: Array<{ intent: OfflineIntent; warning: CartWarning | null }>
  priceChanges: PriceChange[]          // verbatim from the cart response, cart spec §5.3
  mergeSummary: MergeSummary | null    // verbatim from the cart response, cart spec §7.2, when present
}
```

### 4.3 `reconcileOfflineReplay` — the one piece of shared logic, not just a type

```typescript
// packages/shared/src/lib/offline/reconcile.ts
function reconcileOfflineReplay(
  intents: OfflineIntent[],
  cartResponse: CartMutationResponse,   // cart spec §10.1's envelope, unmodified
): OfflineReplayReconciliation
```

A pure function, dependency-free, matching intents to the resulting `cart.lines` by the `(productId, variantId, configuration)` triple cart spec §4.2 already treats as the line-uniqueness key. It exists in `packages/shared` — not duplicated in `apps/storefront` and, later, in a POS client — because the whole point of putting the contract here rather than in the app (per the roadmap decision this spec's ADR records) is that the diffing logic is exactly as reusable as the types it operates on.

---

## 5) API Contracts

Two new routes, both under the existing `/api/ecommerce/storefront/*` namespace (roadmap §9), both public with an optional buyer session, both cached and keyed exactly like every other surface in `storefront-public-api.md` §9. No route on `cart`, `sales`, or `checkout` changes.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ecommerce/storefront/offline-pack/manifest` | Lightweight version check — poll on reconnect before paying for a full fetch |
| GET | `/api/ecommerce/storefront/offline-pack` | Full pack (no `since`, or an unrecognized `since`) or delta (`?since=<version>` recognized) |

### 5.1 Response shapes

`GET .../offline-pack/manifest` → `OfflinePackManifest` (§4.2), no entries.

`GET .../offline-pack` → `OfflinePackManifest & { entries: OfflinePackEntry[] }` on a full fetch, or `OfflinePackDelta` (§4.2) on a recognized `since`. The two are distinguishable by the presence of `removed` — the manifest fields are identical either way, so a client that only cares about `version`/`generatedAt`/`expiresAt` does not need to branch.

### 5.2 Caching & rate limits

| Endpoint | TTL | Key | Notes |
|---|---|---|---|
| `/offline-pack/manifest` | 30s | `assortmentScopeHash` + `priceScopeKey` + `customerOverlayId` | Cheap; safe to poll aggressively the instant signal returns |
| `/offline-pack` | 60s | same three components | Full and delta share a cache entry per version; authenticated responses `Cache-Control: private, no-store` at the HTTP layer per the existing convention (storefront-public-api §9.1) |

Rate limits, per IP per store: `/offline-pack/manifest` 120/min (cheap poll), `/offline-pack` 30/min (bounded payload, but still a real query).

### 5.3 What is deliberately reused, unchanged

`POST /carts`, `GET /carts/:token`, `POST /carts/:token/lines/bulk` — all cart spec §10, all called by the field-mode client exactly as any other channel calls them. This spec makes **no** amendment to cart-module.md. If a future implementation finds it needs the queued-intent order preserved across a partial rejection more precisely than `(productId, variantId, configuration)` matching allows, that is a cart-module amendment to propose there, not something this spec pre-empts (see §9's residual note on this and §12 Open Question 5).

---

## 6) Offline Data Protection

This is the section the brief for this spec insists on by name, because the threat model here is not "a cache header was wrong" — it is "a priced catalog is sitting, unencrypted, on a tablet a shift worker left on a shelf."

**Opt-in, not ambient.** Field mode does not activate itself. `OfflinePackPolicy.enabled` defaults to `false` (§8 — flagged for explicit human confirmation, not shipped on by default); a buyer or operator must explicitly enable it for a device, and the enable flow states plainly what will be stored locally and for how long.

**Encrypted at rest.** The pack payload in IndexedDB is encrypted with AES-GCM using a non-extractable WebCrypto key. The key is not merely present in IndexedDB unprotected — it is wrapped behind a local gate (below), so reading the pack requires passing that gate on every app open, not just once per install.

**A local passcode/biometric gate, not just a session cookie.** Where a platform authenticator is available, the gate is a WebAuthn local credential (Face ID / fingerprint / device PIN via the OS, not a network round trip). Where it is not available, the app falls back to an app-level PIN prompt. This is the concrete answer to "what mitigates R1 beyond TTL and logout-purge": **the device being unlocked is not sufficient to read the pack; a second, local gate is required**, and that gate re-prompts each time the app is (re)opened, not once per session.

**TTL shorter than the underlying session, and configurable down to a shift.** Default `offlineTtlHours: 72`; a merchant with more sensitive pricing can configure it as low as a single shift (8 hours). The pack's own TTL is independent of, and normally shorter than, the buyer's ordinary authentication session — field-mode freshness is a data-protection control, not an auth control (§3.3 makes the same point about replay re-authenticating separately from pack freshness).

**Purge triggers, all automatic:** explicit logout; a resolved identity that no longer matches the pack's embedded `OfflinePackScope` (§9 R5); TTL expiry; and an explicit "Clear field data" control for a buyer who wants to hand the device to someone else immediately. A purge removes the pack; it does **not** remove a non-empty outbox (§9 R8) — those are different lifetimes for a reason (§3.3).

**Residual risk, stated rather than hidden.** Within the TTL window, on an already-unlocked device, before the local gate has timed out and re-prompted, the pack is readable by whoever is holding the device. No offline-capable design eliminates this; the passcode/biometric gate plus a short, merchant-tunable TTL is the realistic mitigation, not a claim of elimination. This is recorded honestly as R1's residual in §9, not smoothed over.

---

## 7) POS as the Second Consumer

SPEC-022 §3 lists *"Offline mode and sync (Phase 3)"* as a non-goal for POS's first phases — not a rejection of offline for POS, a deferral. When that phase is eventually specified, it faces the identical two-halves problem this document solves: a register on a warehouse floor needs a priced, bounded local catalog and a queue of sale intents that replay once signal returns.

**What POS inherits from this spec, unchanged:** `OfflinePackManifest`, `OfflinePackEntry`, `OfflineIntent`, and `reconcileOfflineReplay` (§4) are channel-agnostic by construction — nothing in their shape assumes a storefront session, a buyer-facing UI, or the `/field/*` route tree. A POS offline spec can build its own register-facing UI over the identical read/write contract, the same way `checkout`, pay links and storefront all mutate the same `cart` (ADR-1) without sharing a UI.

**What this spec explicitly does not define for POS, on purpose:** cash handling, cash-drawer float and reconciliation, register session open/close state, and hardware integration (receipt printers, barcode scanners, cash drawers) — all of it stays entirely inside POS's own domain and its own future spec, exactly as SPEC-022 §2 already scopes it. This spec commits POS only to the boundary — "a POS sale, like a cart, is not final until an online, register-bound submit" — and to reusing the contract types rather than inventing a second, incompatible sync engine.

**What is deferred to POS's own spec, not decided here:** whether POS's replay target is a `cart` at all (a register may have its own submission path distinct from checkout) and whether POS-specific fields (register id, cashier id, session id) attach to `OfflineIntent` via its optional `configuration` bag or need a POS-specific wrapper type. Both are POS-module decisions; this spec's job is only to make sure POS is not starting from zero when it gets there.

---

## 8) Resolved Assumptions (Autonomous Defaults)

Per this run's brief, every open point below is resolved with a stated default, override path noted. One item is flagged for explicit human confirmation.

| # | Question | Resolution | Override |
|---|---|---|---|
| 1 | Pack content & size | §3.2/§4.1: merchant-configured `selectionMode`, hard cap 500 products / 1,500 variants, images opt-in on a separate 20 MB budget | `OfflinePackPolicy` fields, per store |
| 2 | Device-at-rest protection | §6: AES-GCM encryption, WebAuthn/PIN local gate, 72h default TTL (down to 8h) | `offlineTtlHours`, per store |
| 3 | Cart TTL expiry during offline | §3.3 step 2: replay falls back to `POST /carts` transparently, buyer informed via the reconciliation screen | None needed — reuses existing cart behavior |
| 4 | Multi-device conflict | §3.3, §9 R4: replay is an ordinary cart mutation; existing merge policy (cart §7.1) and `mergeSummary` (§7.2) apply unchanged | None — deliberately no new policy |
| 5 | Delta protocol / versioning | §3.2, §5: monotonic `version` per scope, manifest poll before a full/delta fetch, full resend as an acceptable fallback given the pack's hard size ceiling | None — the size ceiling is what makes this acceptable; revisit if a merchant's pack routinely approaches the cap |
| 6 | `apps/storefront` vs. a separate deliverable | §3.4: a client-only route subtree in `apps/storefront`, own bundle budget, `storefront-ui`'s 45 kB / 24-export budget untouched | None — matches ADR-8's "commerce components live in the app" rule |
| 7 | Offline session token lifetime | §3.3, §6, §9 R8: no new token type — the pack's TTL is independent of the buyer's ordinary auth session; the outbox is not purged by pack expiry and survives until a normal re-login enables replay | `offlineTtlHours` bounds the pack only, by design |

**⚠ NEEDS HUMAN CONFIRMATION:** `OfflinePackPolicy.enabled` defaults to `false` — field mode ships opt-in per store, not ambient. This is a genuine product/legal call (does this platform want a priced catalog ever able to leave the server as a local artifact, for any tenant, by default) and is deliberately not decided unilaterally here. If confirmed, no further change is needed; if the platform wants it enabled by default for a subset of tenants (e.g. any store with a B2B customer group), that policy belongs in this spec's Implementation Phase 1 and should be confirmed before Phase 2 starts.

---

## 9) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Priced catalog at rest on an uncontrolled device | **Critical** | Client, security | A shared warehouse tablet is handed between staff, or a device is lost or stolen within the TTL window; whoever holds it can read another buyer's negotiated prices. | Opt-in only (§8); AES-GCM encryption; a local passcode/biometric gate independent of device unlock, re-prompted on every app open (§6); default 72h TTL, configurable down to a single shift; automatic purge on logout, identity mismatch, and TTL | Medium — an already-unlocked device within TTL and before the local gate re-prompts is not protected beyond app-backgrounding behavior; stated, not hidden |
| R2 | Stale offline price read as a locked-in commitment (Omnibus / legal) | **High** | Legal | A buyer queues at a promotional price shown when the pack was built; by reconnect the promotion has ended and the price is higher. If nothing discloses this, the buyer reasonably believes they already secured the lower price. | The "prices as of `generatedAt`, offline" banner is persistent while disconnected (§3.2); the reconciliation screen's `priceChanges` (§3.3) is mandatory before the buyer returns to the normal cart flow; checkout's own `StorefrontPriceChangedError` re-confirmation (storefront-app §5.5) remains the final legal gate — cart mutation alone is never a purchase commitment | Low — no money changes hands before checkout re-confirms |
| R3 | Replay targets an expired or missing cart | Medium | `cart`, UX | The buyer is offline long enough that `Cart.expires_at` (cart §4.1) passes; the remembered token 404s or reports a terminal status on reconnect. A naive client shows a dead end and the queued outbox looks lost. | §3.3 step 2: `GET` failure or a terminal status falls back to `POST /carts` transparently; the outbox replays into the fresh cart; the reconciliation screen states plainly that the saved cart had expired and a new one was started | Low |
| R4 | Multi-device conflict | Medium | `cart` | The buyer queues offline on a warehouse tablet while also editing the cart live from a desktop; replay produces two baskets that need combining. | Replay is an ordinary cart mutation, so the existing merge policy (cart §7.1) and `mergeSummary` disclosure (§7.2) apply with no new logic | Low — inherits cart's own residual (cart §13 R2) |
| R5 | Pack built for the wrong identity | **Critical** | Security | A device is shared between two buyers — plausible on exactly this hardware profile — and Buyer A's pack is still present when Buyer B opens field mode. | The manifest embeds its `OfflinePackScope`; every resume compares it to the current identity and purges on mismatch (§6); more importantly, replay always re-resolves `BuyerContext` online before mutating the cart (§3.3 step 1), so cart spec §6a.1's storefront assortment check runs against the fresh scope regardless of what the pack believed — a wrong-identity pack can produce a bad **preview**, never an unauthorized **purchase** | Low for purchasing; Medium for the preview-only disclosure window until the mismatch purge fires |
| R6 | Delta protocol keyed on the wrong granularity | Medium | `ecommerce`, cache | The pack's cache key omits a named scope component and falls back toward a whole-context digest, the way storefront-public-api §9.1 initially did for `priceRange` before it was fixed. | The pack and manifest endpoints are required to key on the same three named `BuyerContext` components as every other post-ADR-7-amendment surface, through the same `buildStorefrontCacheKey` helper storefront-public-api §9 already requires | Low — same helper-enforced discipline as the rest of the suite |
| R7 | Outbox growth exhausts device storage or the cart's own limits | Low/Medium | Client, `cart` | A buyer stays offline for an unusually long field trip and queues far more than a normal cart would ever hold. | Outbox capped to mirror cart's own limits (200 lines per cart, cart §13 R10; bulk calls chunked at 100 per cart §10); once full, further offline adds are refused with a clear "sync to add more" state, never silently dropped | Low |
| R8 | Offline session left stranded past every TTL | Medium | Auth | Both the buyer's ordinary auth session and the pack's own TTL lapse before signal returns, while the outbox still holds real, unsynced intent. | The outbox is not purged by pack expiry (§6) — only the pack read-cache is; reconnect requires an ordinary re-login before replay proceeds, the same flow that already exists, with no bespoke recovery path | Low — bounded only by how long the buyer is willing to hold an unsynced queue |
| R9 | A future generic service-worker cache reintroduces R1 | Medium | Architecture | A later contributor adds a common PWA pattern — cache-first across the whole storefront — without realizing it would cache buyer-priced pages exactly the way storefront-app §11 R1 already forbids. | The service-worker precache scope is explicitly restricted to the `/field/*` shell's own assets (§3.4), documented as a boundary in both this spec and storefront-app §3.3a; a test asserts no service-worker registration intercepts `/products`, `/categories`, or any other buyer-aware route | Low |

**A named limitation, not a risk:** reconciliation attribution for a **rejected new addition** depends on cart's `warnings[].lineId`, which cart spec §6a.1 sets to `null` for a line that was never added — so when several *new* offline-queued products are rejected in one replay, the reconciliation screen can show the full `warnings` list but cannot always attribute a specific rejection to a specific queued item beyond what `(productId, variantId, configuration)` matching already resolves. This is not worked around by amending cart-module here (out of this spec's scope, §5.3); it is recorded as Open Question 5 (§12) for whoever picks up a future cart-module amendment.

---

## 10) Test Coverage

Integration coverage for every API path this spec adds, and the key client-side flows, ships in the same change per `.ai/qa/AGENTS.md`.

**Pack (read side):**
- Two buyers with different `priceScopeKey`/`customerOverlayId` sharing a device get non-interfering packs; a mismatch on resume purges the stale one (R5)
- Pack respects `maxProducts`/`maxVariants`; never returns the whole catalog regardless of policy
- `/offline-pack/manifest` returns quickly and cheaply when nothing changed; a version match short-circuits the client without a full fetch
- `/offline-pack?since=<version>` returns only `changed`/`removed` entries for a recognized version; an unrecognized `since` returns the full set
- Pack and manifest cache keys use the three named scope components, never a whole-context digest (R6) — same assertion style as storefront-public-api §12's buyer-isolation suite
- `generatedAt`/`expiresAt` surface correctly through to the client banner

**Device protection (§6):**
- The local passcode/biometric gate blocks pack access even with the OS-level device unlocked (automated where WebAuthn can be simulated; otherwise a documented manual security-review step per release, mirroring storefront-app §8's manual accessibility pass)
- TTL expiry purges the pack automatically; logout purges it; an identity mismatch on resume purges it (R1, R5)
- A non-empty outbox survives a pack purge (R8) — asserted explicitly, since the two lifetimes are easy to conflate

**Outbox and replay (write side):**
- Intents never carry a price or total field anywhere in their wire or storage shape (ADR-2 extended)
- Outbox persists across app reload/relaunch while offline
- Replay derives `Idempotency-Key` from the batch; a retried replay after a flaky reconnect does not double-add (cart §8.2)
- Replay against an expired/terminal cart transparently creates a new one via `POST /carts`; disclosed on the reconciliation screen (R3)
- Replay re-resolves `BuyerContext` online before mutating the cart — a membership that lapsed entirely during the offline window is rejected by cart's own §6a.1 check even though the pack still showed the product as available (R5's TOCTOU extension of cart §14's existing fixture)
- A multi-device conflict (offline queue on device A, live cart edits on device B) replays through the existing merge policy and surfaces `mergeSummary` (R4)
- `reconcileOfflineReplay` correctly classifies `accepted`/`quantity_adjusted`/`rejected` against a fixture cart response, matched by `(productId, variantId, configuration)`
- The outbox cap (200 lines) is enforced; hitting it blocks further offline adds with a visible state, never a silent drop (R7)
- No route in `/field/*` reaches checkout without a live connectivity check

**Architecture boundary:**
- The registered service worker's precache/fetch scope covers only the `/field/*` shell; a test asserts no interception of `/products`, `/categories`, or any other buyer-aware route (R9)
- Field mode's JS is a separate, route-level chunk absent from the catalogue and checkout bundle budgets (storefront-app §9)

**Contract conformance (shared, channel-agnostic):**
- `packages/shared`'s own test suite exercises `OfflinePackManifest`/`OfflinePackEntry`/`OfflineIntent`/`reconcileOfflineReplay` against a fixture with no storefront-specific assumptions, so a future POS implementation (§7) can assert conformance against the same fixture rather than the storefront's own test suite

---

## 11) Implementation Phases

### Phase 1 — Contract and pack read path
`packages/shared/src/lib/offline/` types and `reconcileOfflineReplay`; `ecommerce`'s two new endpoints; `OfflinePackPolicy` settings key; cache keying on the three named scope components.

**Gate:** buyer-context isolation tests pass for the pack and manifest endpoints, mirroring storefront-public-api's own Phase 1 gate; the enabled-by-default question (§8) is confirmed before this phase ships to any tenant.

### Phase 2 — Client shell and device protection
`apps/storefront` `/field/*` routes; IndexedDB storage; AES-GCM encryption; the WebAuthn/PIN local gate; TTL and purge triggers; the scoped service worker.

**Gate:** the pack is unreadable without passing the local gate, even with the device unlocked at the OS level; all four purge triggers verified; no service-worker interception of a buyer-aware route (R9).

### Phase 3 — Outbox and replay
Local intent queue; idempotency-key derivation; the reconnect replay algorithm (§3.3); the reconciliation screen reusing `priceChanges`/`warnings`/`mergeSummary`.

**Gate:** the full offline → reconnect → reconcile flow passes, including the expired-cart fallback (R3) and the multi-device fixture (R4); no offline route reaches checkout.

### Phase 4 — Contract conformance fixture
A `packages/shared` fixture proving the pack/outbox/reconciliation contract is channel-agnostic, exercised against both a storefront-shaped and a synthetic non-storefront consumer.

**Gate:** the fixture passes without any storefront-specific assumption leaking into the shared package; no POS UI work happens in this phase — that remains POS's own future spec (§7).

---

## 12) Open Questions

1. **Per-group / per-buyer entitlement beyond a store-wide toggle.** This spec assumes a single store-level `enabled` flag (§8) is sufficient for v1. Whether individual customer groups need their own opt-in (a Wholesale group allowed, a lower-trust group not) is deferred; nothing here forecloses adding it as a `customer_groups` amendment later.
2. **Exact numeric defaults will likely need tenant-specific tuning.** The 500-product cap, 20 MB image budget, and 72h/8h TTL range (§8) are reasonable starting points, not measured ones — expect them to move once real field-mode usage data exists.
3. **POS's own shape.** Whether POS's eventual offline/sync spec (SPEC-022 §3 Phase 3) reuses `OfflineIntent` verbatim or needs a POS-specific wrapper (register id, cashier id, session id) is left entirely to that spec (§7); this document commits POS only to the channel-agnostic core.
4. **Analytics and telemetry for field-mode adoption and failure rates** are out of scope here, mirroring storefront-app §14 Open Question 3's existing "no analytics specified" position for the suite generally.
5. **`warnings[].lineId` attribution for rejected new additions in a bulk replay** (§9, named limitation) is a real, small cart-module gap surfaced by this spec's reconciliation requirement. This spec does not amend cart-module.md to fix it (out of scope, §5.3); whether to add a product/variant identifier to `warnings` there, or accept `(productId, variantId, configuration)` matching as sufficient for v1, is left for whoever next touches cart-module's write-response contract.

---

## 13) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | The pack reads `catalog`/`availability` through the same DI services `ecommerce`'s public API already uses; the outbox reaches `cart` only through its existing public HTTP contract |
| Tenant/organization scoping | Every pack and manifest response scoped through the same `StoreContext` resolution as every other `storefront-public-api.md` surface |
| No new `SPEC-*` filename prefix | `{YYYY-MM-DD}-{kebab-case}.md` |
| Backward compatibility | Additive only: two new `ecommerce` GET endpoints, one new settings key on `EcommerceStore.settings`; zero changes to `cart`, `sales`, or `checkout` contracts |
| Optimistic locking | Not applicable — this spec introduces no new server-side user-editable entity; the pack is a computed, cached read, and the outbox is client-local only |
| No offline checkout / no client arithmetic | ADR-2 and this spec's own hard boundary (§1, §3.3); asserted by test (§10) |
| Buyer-context cache keying | Named scope components only, per ADR-7 amended (§3.2, §5.2, R6) |
| Device-at-rest protection | Opt-in, encrypted, locally gated, TTL-bounded, auto-purged (§6); residual risk stated, not hidden (R1) |
| Second consumer named | POS (SPEC-022 §3), with explicit exclusions (§7) |
| Integration coverage | §10, shipping in the same change |

---

## 14) Changelog

### 2026-09-22
- Initial specification. Split reading (server-built offline pack) and writing (client-side intent outbox) into two independently-risked halves per this run's brief, after concluding — consistent with storefront-app §11 R1 and storefront-public-api §11 R1 — that a naive service-worker catalog cache fails for the same buyer-aware-pricing reason a naive ISR cache does.
- Reused, without modification: `cart.lines.bulkAdd`'s existing idempotency (cart §8.2) and partial-success behavior (cart §6a.1) for replay; the existing `mergeSummary`/`priceChanges`/`warnings` envelope (cart §7.2, §10.1) for reconciliation, rather than designing a second screen. No amendment to `cart-module.md` was made or required.
- Placed the contract — pack manifest, outbox intent, and the one shared reconciliation function — in `packages/shared`, and named POS (SPEC-022 §3, line 36's "Offline mode and sync (Phase 3)" non-goal) as the contract's explicit second consumer, with cash handling, register session state, and hardware integration excluded on purpose (§7).
- **Resolves [Storefront Application](./2026-08-14-storefront-app.md) §14 Open Question 4.** That question characterized offline as something "the roadmap listed... as a non-goal" — the word "offline" does not appear anywhere in `2026-08-14-ecommerce-suite-roadmap.md` prior to this change; no such non-goal exists to reverse. This spec does not treat OQ4 as overturning a prior decision, only as answering a question the roadmap had never actually foreclosed. The storefront-app.md edit accompanying this change records the same discrepancy in that document's own changelog.
- Flagged one assumption for explicit human confirmation (§8): whether `OfflinePackPolicy.enabled` should default to `false` (opt-in per store, as specified) or `true` for some tenant segment. Everything else in §8 is a resolved autonomous default with a stated override path.
