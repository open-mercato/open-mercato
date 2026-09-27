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
- The offline pack is keyed on the same **named** `BuyerContext` components every other cached surface in this suite now uses post-[ADR-7 amendment](./2026-08-14-ecommerce-suite-roadmap.md#adr-7--buyer-context-is-resolved-once-at-the-edge) — `assortmentScopeHash`, `priceScopeKey`, `customerOverlayId` — never a digest of the whole context, plus one pack-specific component, `contentOwnerId`, whenever the pack's *content* (not just its prices) depends on the individual customer (§3.2, §5.2). A priced catalog leaving the server onto a device nobody controls is R1's failure class (storefront-app §11, storefront-public-api §11) at its most literal: the device *is* the cache, and it can be picked up by anyone.
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

Cart spec §7.2 already defines `mergeSummary` — a screen that shows what happened when two baskets combined on a guest→customer login, including what got capped or dropped. Offline replay produces the same *category* of event: some intents landed, some got capped, some got rejected. A second, offline-specific "here's what changed" visual pattern would drift from the merge screen the moment either one is touched, and the buyer would have to learn two UI patterns for the same underlying fact ("some of what you tried to add isn't what's in your cart now"). Section 3.3 below is designed so replay output is presentable through the same `priceChanges` / `warnings` presentation, and the same visual pattern as the merge summary.

What replay does **not** get is a `mergeSummary` from the server. Cart only produces one for a guest→customer merge on login (cart spec §7.1–§7.2); a replay is a plain `bulkAdd` into an existing cart, where an identical `(product, variant, configuration)` line simply sums its quantity (cart spec §4.2). The per-intent outcome is therefore computed client-side by `reconcileOfflineReplay` (§4.3) from the pre-replay and post-replay cart state; a server `mergeSummary` appears in the replay result only when the replay happens to follow a guest→customer login merge.

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
                               │ GET, cached,            │ replays via app route
                               │ scope-keyed              │ handlers → bulkAdd
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

**Who selects the content, and how much.** A store-level policy (§4.1) selects, in order of priority up to a hard cap: the buyer's own price-list scope, their previously-ordered products (most-recent first), and any merchant-curated categories or tags flagged for field mode. A buyer may additionally pin individual products themselves, within the same cap — pinning past the cap evicts the buyer's own oldest pin with a visible notice, never silently. Where pins are stored so the server can build them into the pack is **not yet decided** (§12 Open Question 7); pinning does not ship until it is. **The pack is never the whole catalog.**

**Per-customer content means a per-customer cache entry.** `price_list` and `merchant_curated` content is a function of the buyer's *scope* — every buyer with the same `assortmentScopeHash` + `priceScopeKey` + `customerOverlayId` gets the same pack, so sharing a cache entry between them is correct. `previously_ordered`, `combined` and buyer pins are not: they depend on the individual customer's order history or choices. `customerOverlayId` cannot carry that, because it is set to the customer id *only when that customer has contract price rows of their own* (roadmap ADR-7 amended, "How `customerOverlayId` is computed") and is `null` for every other customer — two buyers in the same groups with no contract rows would share a key and Buyer B would be served Buyer A's history-derived pack. The pack therefore carries a fourth scope component, `contentOwnerId` (§4.2): the resolved customer id whenever the effective selection includes `previously_ordered`, `combined` or pins, and `null` otherwise. It enters both the cache key (§5.2) and the embedded `OfflinePackScope` that the resume-time mismatch purge compares (§6, R5). Whether v1 should instead ship scope-level content only (`price_list` + `merchant_curated`) and defer history and pins entirely is left to the maintainers (§12 Open Question 6). It is capped at 500 products / 1,500 variants by default (§8, autonomous default, store-configurable), and the manifest's `entryCount` makes the bound visible to the client and to support.

**Images are opt-in and separately budgeted.** The base pack is text-and-price only. A store may opt into thumbnails, which draw from a separate, smaller budget (default 20 MB, aggressively compressed, low-resolution, fetched opportunistically and never blocking the base pack's availability).

**Freshness is disclosed, not hidden.** Every pack carries `generatedAt`, and the client shows it verbatim — "prices as of 14:20, offline" — for as long as the device has no connection. This is not a courtesy; it is the same disclosure discipline cart spec §5.3 requires for an in-session re-price, stretched over a much longer window (hours to days instead of the 30-minute staleness budget cart spec §5.2 trigger 4 uses), which is exactly why it must be **more** visible here, not less.

**Manifest + delta, so a brief moment of signal doesn't restart the download.** A lightweight `GET .../offline-pack/manifest` call (§5) returns just the current `version` and a checksum — cheap enough to poll the instant a bar of signal appears. If the version matches what the client already has, nothing else happens. If it does not, `GET .../offline-pack?since=<version>` returns only the entries that changed and the ids that dropped out of scope, not the whole pack again — unless the client's `since` is unrecognized (too old, or a first fetch), in which case the server returns the full set. Given the pack's hard size ceiling, a full resend is cheap enough to be an acceptable fallback rather than something requiring unbounded version history on the server.

**Cache keying follows ADR-7's amendment, not around it.** The manifest and pack responses are cached exactly like every other buyer-aware surface in `storefront-public-api.md` §9 — through `buildStorefrontCacheKey`, keyed on the pack's own named scope components (`assortmentScopeHash`, `priceScopeKey`, `customerOverlayId`, and `contentOwnerId` when non-null), never on a digest of the whole `BuyerContext`. The pack endpoint's key additionally carries the pack `version` and the normalized `since` value, so a full fetch and deltas from different base versions never collide (§5.2). This is not a new caching decision; it is the existing one, applied to a fourth surface.

### 3.3 Write: the outbox

**What it is.** A client-local, bounded queue of `OfflineIntent` records (§4.2) — product, variant, configuration, quantity, and the timestamp and pack version the buyer saw when they queued it. **No price. No total. No tax.** An intent is a request to add a line, structurally identical to what `cart.lines.add` already accepts, minus the network round trip.

**The outbox belongs to one identity, and so does its key.** Each buyer who enables field mode on a device enrolls their **own** local gate — their own WebAuthn credential or their own PIN (§6) — and gets their own key hierarchy; the pack and the outbox are encrypted under the key of the buyer they belong to. A shared tablet therefore holds one encrypted *profile* per buyer, and Buyer B passing B's own gate yields no key that decrypts Buyer A's pack or outbox. The only plaintext per profile is an `ownerTag` — HMAC-SHA-256 of the customer-user id under a random per-device salt — so the client can tell, without decrypting anything, whether the identity resolved online matches a profile. Replay proceeds **only** when the identity re-resolved in step 1 below matches the profile whose outbox is being replayed. On a mismatch — Buyer B logs in on a tablet that still holds Buyer A's unsynced profile — nothing is replayed: B sees only that the device holds another buyer's unsynced queue (no content, which B could not decrypt anyway) and can hand the device back or delete that profile explicitly. A queue is never replayed into a cart its owner does not hold. While offline there is no resolved identity to compare, and none is needed: a profile opens only for whoever passes that profile's own gate.

**Replay, on reconnect.** The client never addresses cart directly. Cart's token lives in an httpOnly cookie that client code never reads (storefront-app R7), and cart requires `assortmentScope` to come from a route handler that has already called `storeContextService.resolve()` (cart spec §6a.1, the control behind cart R11) — a scope supplied by the client could be widened by whoever controls the client. Replay therefore goes through `apps/storefront`'s own server route handlers, exactly like the normal add-to-cart path, and the client sends only the intents and each chunk's idempotency key:

1. The route handler re-resolves `BuyerContext` server-side — **not** the possibly-stale scope embedded in the offline pack — and the client compares the resolved identity to the outbox owner (above). This is the step that makes a wrong-identity pack safe rather than merely disclosed (§9 R5).
2. The route handler reads the cart token from the httpOnly cookie and attempts `GET /carts/:token`. If the cart is gone or in a terminal status (`converted`, `expired`, `merged` — cart spec §4.1, §9), it falls back to the existing `POST /carts` (cart spec §10) and sets the new token cookie — no cart change, no new cart endpoint; this *is* what "replay lands in a new cart, not a 404" means (§9 R3). The handler returns to the client the pre-replay `cart.lines`, the cart's `updatedAt`, and a `cartFingerprint` — HMAC-SHA-256 of the cart token under a server-side secret, which identifies the cart without being usable as a credential. The client persists all three in the encrypted replay record (§4.2) **before** sending the first chunk. A `locked` cart (`423`, cart spec §9 — checkout in progress) pauses replay: nothing is sent, the queue is kept, and the buyer is told to finish or leave checkout first.
3. The route handler calls the existing `POST /carts/:token/lines/bulk` (cart spec §10, §6a.1) with the queued intents mapped 1:1 to `bulkAdd` line inputs, the server-resolved `assortmentScope`, and the expected `updatedAt` the client supplies — the pre-replay one for the first chunk, the previous chunk response's `cart.updatedAt` after that (cart spec §8.1). Because a full outbox (200 lines, R7) exceeds the bulk endpoint's 100-lines-per-call cap (cart R10), replay is **chunked**: when replay starts, the client freezes the outbox into ordered chunks of at most 100 intents and assigns each chunk its own `Idempotency-Key`, persisted with the frozen chunk. A retry after a flaky reconnect re-sends the identical chunk under the identical key, so nothing double-adds (cart spec §8.2); the buyer cannot edit a frozen chunk, so a retry can never send a different body under the same key and trip `422 idempotency_key_mismatch`. Edits made after replay starts go into a new chunk with a new key. **A replay is pinned to one cart:** every chunk request carries the persisted `cartFingerprint`, and the handler refuses the chunk (without calling cart) when the cookie's cart no longer matches it — because idempotency keys are stored per cart (cart spec §8.2), re-sending a chunk into a different cart would apply it fresh and strand the settled chunks in the old one. On that refusal, the settled chunks are reconciled against their own baselines, and the unsent chunks start a new replay (new snapshot, new fingerprint, new keys). A `409` from the optimistic lock (a concurrent edit or a re-price, cart spec §8.1, R3) is not an error: the handler returns the current cart from the `409` body, that cart becomes the new baseline for this chunk, and the chunk is re-sent under its same key and body with the new `updatedAt`.
4. Each chunk's response is the cart's own unmodified envelope (cart spec §10.1): `cart`, `priceChanges`, `warnings`, and `mergeSummary` only if a guest→customer login merge also fired (§2.3). The client persists each settled chunk's baseline lines and response in the encrypted replay record, so an app closed mid-replay resumes by sending only the unsettled chunks and still reconciles every chunk against its own baseline — never against a fresh snapshot that already contains the chunks it settled.

**Reconciliation without a second screen.** `reconcileOfflineReplay` (§4.3) — a pure function shipped in `packages/shared`, not duplicated per channel — diffs each chunk's intents against the *change* in `cart.lines` between that chunk's baseline (the pre-replay snapshot, the previous chunk's response, or the cart carried by a `409`) and that chunk's response, matched by the exact `(productId, variantId, configuration)` triple cart spec §4.2 already uses as the line-uniqueness key. Diffing against the delta, not the absolute resulting quantity, matters: when the cart already held the same line (edited on a desktop, say), the resulting quantity is `existing + intent`, and comparing it to the intent alone would misread an accepted add as `quantity_adjusted`, or a capped add as `accepted`. Every intent is classified `accepted`, `quantity_adjusted`, or `rejected`; rejections attach the matching `warnings` entry where cart's own `lineId` correlation makes that possible, and otherwise surface as an unattributed but still visible "N items did not make it" alongside the full `warnings` list (see §9's named limitation). The output feeds into the same `priceChanges` / `warnings` presentation, and the same visual pattern as the merge summary, that the cart page and checkout already render — no new component contract, per §2.3.

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
  buyerPinningEnabled: boolean        // default true once §12 OQ7 (pin storage) is decided; forced false until then
  buyerPinCap: number                 // default 50, counted within maxProducts
}
```

No FK, no new table: this is a settings-blob extension exactly like the branding fields `storefront-app.md` §6 already reads from `EcommerceStore.settings`.

**Validation and bounds.** A zod schema `offlinePackPolicySchema` lives in `ecommerce`'s `data/validators.ts` and is applied on every write of the key; unknown keys are rejected. Bounds:

| Field | Bound |
|---|---|
| `maxProducts` | integer, 1–500 (500 is the ceiling, not just the default; raising it is a spec change, because the full-resend fallback in §3.2 depends on it) |
| `maxVariants` | integer, 1–1500, and `≥ maxProducts` |
| `imageBudgetBytes` | integer, 0–50_000_000 |
| `offlineTtlHours` | integer, 8–72 |
| `buyerPinCap` | integer, 0–`maxProducts` |

**Where the merchant sets it.** The key is edited through `ecommerce`'s existing store-settings admin surface for `EcommerceStore` (the backoffice store edit form and its `/api/ecommerce/*` update route, roadmap §9), as one more field group — no new route, no new page. Writing it requires the same `ecommerce.*` store-management feature that already guards other `EcommerceStore.settings` writes; this spec adds no ACL feature. The exact feature id is whatever `ecommerce`'s own `acl.ts` names for store settings, which the `ecommerce` spec owns. Turning `enabled` from `true` to `false` is honored by every client on its next manifest poll (§5.1: the endpoints then return `404`), which purges the local pack (§6, purge trigger 5).

### 4.2 `packages/shared/src/lib/offline/` — the contract

```typescript
// manifest.ts
type OfflinePackScope = {
  assortmentScopeHash: string          // named BuyerContext component, roadmap ADR-7 (amended)
  priceScopeKey: string
  customerOverlayId: string | null
  contentOwnerId: string | null        // customer id when content is per-customer (previously_ordered / combined / pins), else null — §3.2
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

type OfflineOutbox = {
  owner: { customerUserId: string; customerId: string | null }   // bound on first enqueue; replay only when the re-resolved identity matches (§3.3)
  storeId: string
  intents: OfflineIntent[]             // max 200 (R7)
  replay: {
    startedAt: string
    cartFingerprint: string            // pins the replay to one cart (§3.3 step 3)
    preReplayLines: CartLineSnapshot[]
    preReplayUpdatedAt: string
    chunks: Array<{
      idempotencyKey: string
      localIds: string[]               // frozen at replay start, ≤100 intents each (§3.3 step 3)
      status: 'pending' | 'sent' | 'settled'
      baselineLines: CartLineSnapshot[] | null   // set when sent; replaced by a 409's cart
      response: CartMutationResponse | null      // set when settled
    }>
  } | null
}
```

The whole `OfflineOutbox` record is stored encrypted at rest under its owner's key (§6); the only plaintext beside it is the profile's `ownerTag` (§3.3), which reveals nothing without the per-device salt and a candidate id.

`CartWarning`, `CartLineSnapshot` and `CartMutationResponse` below are **introduced by this spec** in `packages/shared/src/lib/offline/cart-envelope.ts` as structural mirrors of cart spec §10.1's inline response envelope (`warnings?: Array<{ code: string; lineId?: string; message: string }>`, and the `cart.lines` / `priceChanges` / `mergeSummary` fields). Cart spec §10.1 does not name them; defining them here does not amend cart's contract, and they are kept structurally assignable from cart's inline shape so either side can change them only together. `PriceChange` and `MergeSummary` are cart's own names (cart spec §10.1) and are referenced, not redefined.

```typescript
// cart-envelope.ts
type CartWarning = { code: string; lineId?: string; message: string }
type CartLineSnapshot = { lineId: string; productId: string; variantId: string | null; configuration: Record<string, unknown> | null; quantity: number }
type CartMutationResponse = {
  cart: { token: string; updatedAt: string; lines: CartLineSnapshot[] }   // subset of cart §10.1's `cart` object the reconciliation reads
  priceChanges?: PriceChange[]
  mergeSummary?: MergeSummary
  warnings?: CartWarning[]
}
```

```typescript
// outbox.ts (continued)
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
  chunks: Array<{
    localIds: string[]                       // the intents frozen into this chunk
    baselineLines: CartLineSnapshot[]        // cart.lines this chunk was applied to; [] for a fresh cart
    response: CartMutationResponse           // cart spec §10.1's envelope, unmodified
  }>,
): OfflineReplayReconciliation
```

A pure function, dependency-free, matching intents to lines by the `(productId, variantId, configuration)` triple cart spec §4.2 already treats as the line-uniqueness key. Per chunk and per triple it compares the requested quantity (the sum of that triple's intents in the chunk) with the **delta** between the chunk's `baselineLines` and its response's `cart.lines` — never with the absolute resulting quantity, which would include whatever the cart already held (§3.3). Because each chunk carries the expected `updatedAt` of its own baseline (§3.3 step 3), a concurrent edit surfaces as a `409` and moves the baseline instead of polluting the delta, so for a settled chunk the delta lies in `[0, requested]`: equal → `accepted`; between → `quantity_adjusted`; zero → `rejected`. A delta outside that range can then only mean an unexpected concurrent write the lock did not catch; the intent is classified `quantity_adjusted` with the observed resulting quantity, never silently `accepted`. `warnings` and `priceChanges` are concatenated across chunks; `mergeSummary` is passed through only when a chunk carried one.

---

## 5) API Contracts

Two new routes, both under the existing `/api/ecommerce/storefront/*` namespace (roadmap §9), both cached and keyed exactly like every other surface in `storefront-public-api.md` §9. No route on `cart`, `sales`, or `checkout` changes.

**Access.** Unlike the rest of the public storefront API, both routes **require an authenticated buyer session**; a request without one gets `401`, the same for every store whether field mode is enabled, disabled or the store does not exist. Field mode exists for identified buyers (the outbox is bound to an identity, §3.3, and R5's purge compares identities), and a 500-product priced catalog in one anonymous call would be a scraping aid at any rate limit. For an authenticated buyer, both routes return the same `404` — identical body, no distinguishing header — when the store has field mode disabled (`enabled: false`) and when the store does not exist, so the feature's presence cannot be probed (the same no-oracle rule as storefront-public-api R4). Keeping the no-session case a distinct `401` matters to the client: a lapsed login session must not look like "field mode disabled", or it would fire purge trigger 5 (§6) every time the session expires, contradicting the pack's session-independent TTL. Whether anonymous buyers should ever get a pack (for example scope-level, anonymous-priced content only) is left open (§12 Open Question 8).

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
| `/offline-pack/manifest` | 30s | `assortmentScopeHash` + `priceScopeKey` + `customerOverlayId` + `contentOwnerId` | Cheap; safe to poll aggressively the instant signal returns |
| `/offline-pack` | 60s | the same four components + current pack `version` + normalized `since` | `since` is normalized to the literal `full` when absent or unrecognized, so every full fetch of one version shares one entry and every delta `(since → version)` has its own; no two payload shapes can collide under one key. Authenticated responses `Cache-Control: private, no-store` at the HTTP layer per the existing convention (storefront-public-api §9.1) — the key above governs the server-side cache only |

`contentOwnerId` is `null` for scope-level content (§3.2), so buyers sharing a scope still share cache entries; it is the customer id for per-customer content, so they never do. A `null` component is encoded by `buildStorefrontCacheKey` the same way it encodes a `null` `customerOverlayId`.

Rate limits, per IP per store: `/offline-pack/manifest` 120/min (cheap poll), `/offline-pack` 30/min (bounded payload, but still a real query).

### 5.3 What is deliberately reused, unchanged

`POST /carts`, `GET /carts/:token`, `POST /carts/:token/lines/bulk` — all cart spec §10, all called by `apps/storefront`'s server route handlers exactly as the normal add-to-cart path calls them (cookie-held token, server-resolved `assortmentScope`; §3.3). The field-mode client never calls cart directly. This spec makes **no** amendment to cart-module.md. If a future implementation finds it needs the queued-intent order preserved across a partial rejection more precisely than `(productId, variantId, configuration)` matching allows, that is a cart-module amendment to propose there, not something this spec pre-empts (see §9's residual note on this and §12 Open Question 5).

---

## 6) Offline Data Protection

This is the section the brief for this spec insists on by name, because the threat model here is not "a cache header was wrong" — it is "a priced catalog is sitting, unencrypted, on a tablet a shift worker left on a shelf."

**Opt-in, not ambient.** Field mode does not activate itself. `OfflinePackPolicy.enabled` defaults to `false` (§8 — flagged for explicit human confirmation, not shipped on by default); a buyer or operator must explicitly enable it for a device, and the enable flow states plainly what will be stored locally and for how long.

**Encrypted at rest, under a key the gate actually produces.** The pack payload and the outbox record (§4.2 `OfflineOutbox`) in IndexedDB are each encrypted with AES-GCM under their own data key. Neither data key is ever stored in usable form: each is stored only **wrapped** (AES-KW or AES-GCM) under a key-encryption key (KEK) that exists solely in memory, and only after the local gate (below) has been passed. A UI-only gate — a prompt that, once dismissed, lets code read a usable key already sitting in IndexedDB — does **not** satisfy this section: a non-extractable key persisted in IndexedDB can be used by any script on the origin, gate or no gate. The KEK is dropped from memory when the app is backgrounded past the re-prompt interval or closed.

**A local passcode/biometric gate that derives the key, not just a session cookie.** The KEK comes from the gate itself:

- **Per buyer, never per device.** Every gate below is enrolled by one buyer for their own profile (§3.3); a device shared by several buyers holds several independently-keyed profiles. A device-wide PIN shared by a shift would defeat this, so enrollment is per buyer and the enable flow says so.
- **WebAuthn with the PRF extension (preferred).** Where a platform authenticator supports `prf` (Face ID / fingerprint / device PIN via the OS, not a network round trip), the KEK is derived with HKDF-SHA-256 from the PRF output of that buyer's own credential, with a random per-profile salt. No PRF output, no KEK. `largeBlob` holding the wrapped data keys is an acceptable alternative where PRF is missing but `largeBlob` is supported.
- **App PIN (fallback).** Where neither is available, the KEK is derived from the buyer's own app-level passcode with Argon2id (memory-hard, ≥ 64 MiB, ≥ 3 iterations; or, where Argon2id is unavailable in the runtime, PBKDF2-SHA-256 at ≥ 600 000 iterations) over a random per-profile salt. The passcode is at least 8 characters and may not be all digits: the attempt limit below guards only the in-app prompt, and a copy of IndexedDB taken off the device can be attacked offline without any counter, so the passcode's own entropy is what bounds that attack.
- **Never a UI-only gate.** A WebAuthn assertion without PRF or `largeBlob` proves presence but yields no key; on such a device the client falls back to the PIN derivation rather than treating the assertion as sufficient.
- **Attempt limit.** Wrong PINs incur exponential backoff; after 10 consecutive failures the client wipes that profile's pack and wrapped key (purge trigger 6 below). The limit bounds guessing at the prompt only — not an offline attack on exfiltrated storage (R1 residual). Whether that wipe also destroys an unsynced outbox — safer, but it loses the buyer's queued intent — is left to the maintainers (§12 Open Question 9); until decided, the outbox's wrapped key is wiped too, because an outbox that survives unlimited PIN guessing would defeat the limit.

This is the concrete answer to "what mitigates R1 beyond TTL and logout-purge": **the device being unlocked is not sufficient to read the pack; a second, local gate is required, and it is cryptographic** — the gate re-prompts each time the app is (re)opened, not once per session.

**TTL shorter than the underlying session, and configurable down to a shift.** Default `offlineTtlHours: 72`; a merchant with more sensitive pricing can configure it as low as a single shift (8 hours). The pack's own TTL is independent of, and normally shorter than, the buyer's ordinary authentication session — field-mode freshness is a data-protection control, not an auth control (§3.3 makes the same point about replay re-authenticating separately from pack freshness).

**Purge triggers — six:**

1. explicit logout;
2. an identity resolved online whose scope no longer matches the profile pack's embedded `OfflinePackScope`, including `contentOwnerId` — for example the buyer's groups or contract prices changed (§9 R5);
3. TTL expiry;
4. an explicit "Clear field data" control for a buyer who wants to hand the device to someone else immediately;
5. field mode disabled — by the buyer on the device, or by the merchant (`enabled: false`, observed as a `404` on the next manifest poll made with a valid session, §5; a `401` never triggers a purge);
6. the PIN attempt limit (above).

Triggers 1–5 remove the pack; they do **not** remove a non-empty outbox (§9 R8) — those are different lifetimes for a reason (§3.3). The outbox stays encrypted and bound to its owner (§3.3), so surviving a purge does not let the next person on the device read or replay it. Trigger 6 also wipes the outbox (above). "Clear field data" offers to discard the outbox as a separate, explicit choice.

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
| 4 | Multi-device conflict | §3.3, §9 R4: replay is an ordinary `bulkAdd` into the same cart — identical `(product, variant, configuration)` lines sum by quantity (cart §4.2), no `mergeSummary` is produced, and `reconcileOfflineReplay` discloses the sum by diffing against the pre-replay lines (§4.3) | None — deliberately no new policy |
| 5 | Delta protocol / versioning | §3.2, §5: monotonic `version` per scope, manifest poll before a full/delta fetch, full resend as an acceptable fallback given the pack's hard size ceiling | None — the size ceiling is what makes this acceptable; revisit if a merchant's pack routinely approaches the cap |
| 6 | `apps/storefront` vs. a separate deliverable | §3.4: a client-only route subtree in `apps/storefront`, own bundle budget, `storefront-ui`'s 45 kB / 24-export budget untouched | None — matches ADR-8's "commerce components live in the app" rule |
| 7 | Offline session token lifetime | §3.3, §6, §9 R8: no new token type — the pack's TTL is independent of the buyer's ordinary auth session; the outbox is not purged by pack expiry and survives until a normal re-login **by its owner** enables replay | `offlineTtlHours` bounds the pack only, by design |

**⚠ NEEDS HUMAN CONFIRMATION:** `OfflinePackPolicy.enabled` defaults to `false` — field mode ships opt-in per store, not ambient. This is a genuine product/legal call (does this platform want a priced catalog ever able to leave the server as a local artifact, for any tenant, by default) and is deliberately not decided unilaterally here. If confirmed, no further change is needed; if the platform wants it enabled by default for a subset of tenants (e.g. any store with a B2B customer group), that policy belongs in this spec's Implementation Phase 1 and should be confirmed before Phase 2 starts.

---

## 9) Risks & Impact Review

| # | Risk | Severity | Area | Failure scenario | Mitigation | Residual |
|---|---|---|---|---|---|---|
| R1 | Priced catalog at rest on an uncontrolled device | **Critical** | Client, security | A shared warehouse tablet is handed between staff, or a device is lost or stolen within the TTL window; whoever holds it can read another buyer's negotiated prices. | Opt-in only (§8); AES-GCM encryption under a data key that is only ever stored wrapped by a gate-derived KEK (WebAuthn PRF, or an Argon2id/PBKDF2 PIN derivation with an attempt limit) — a cryptographic, not UI-only, local gate independent of device unlock, re-prompted on every app open (§6); default 72h TTL, configurable down to a single shift; automatic purge on logout, identity mismatch, and TTL | Medium — an already-unlocked profile within TTL and before the local gate re-prompts is not protected beyond app-backgrounding behavior; and on a passcode-only profile, a copy of IndexedDB taken off the device can be attacked offline, bounded only by the passcode's entropy and the Argon2id cost, not by the attempt limit (§6). WebAuthn PRF profiles are hardware-bound and not exposed to that attack. Stated, not hidden |
| R2 | Stale offline price read as a locked-in commitment (Omnibus / legal) | **High** | Legal | A buyer queues at a promotional price shown when the pack was built; by reconnect the promotion has ended and the price is higher. If nothing discloses this, the buyer reasonably believes they already secured the lower price. | The "prices as of `generatedAt`, offline" banner is persistent while disconnected (§3.2); the reconciliation screen's `priceChanges` (§3.3) is mandatory before the buyer returns to the normal cart flow; checkout's own `StorefrontPriceChangedError` re-confirmation (storefront-app §5.5) remains the final legal gate — cart mutation alone is never a purchase commitment | Low — no money changes hands before checkout re-confirms |
| R3 | Replay targets an expired or missing cart | Medium | `cart`, UX | The buyer is offline long enough that `Cart.expires_at` (cart §4.1) passes; the remembered token 404s or reports a terminal status on reconnect. A naive client shows a dead end and the queued outbox looks lost. | §3.3 step 2: `GET` failure or a terminal status falls back to `POST /carts` transparently; the outbox replays into the fresh cart; the reconciliation screen states plainly that the saved cart had expired and a new one was started | Low |
| R4 | Multi-device conflict | Medium | `cart` | The buyer queues offline on a warehouse tablet while also editing the same cart live from a desktop; on replay, a product already added on the desktop is added again and the buyer ends up with more than intended without noticing. | Replay is a plain `bulkAdd` into the same cart, not a login merge: identical `(product, variant, configuration)` lines sum by quantity (cart §4.2) and cart produces no `mergeSummary` for it (cart §7.1–§7.2 cover guest→customer login only). `reconcileOfflineReplay` diffs against the pre-replay lines (§4.3), and the reconciliation screen must show, per line, that the queued quantity was **added to** a quantity already in the cart. A server `mergeSummary` is shown only when replay follows a guest→customer login merge | Low — the sum is disclosed, not prevented; the buyer can correct quantities on the cart page before checkout |
| R5 | Pack built for the wrong identity | **Critical** | Security | A device is shared between two buyers — plausible on exactly this hardware profile — and Buyer A's pack is still present when Buyer B opens field mode. | The manifest embeds its `OfflinePackScope`, including `contentOwnerId` whenever content is per-customer (§3.2), so two buyers who share price scope but not order history still differ; every online identity resolution compares it to the profile's scope and purges the pack on mismatch (§6). Each buyer has their own gate-derived key (§3.3, §6), so Buyer B cannot decrypt Buyer A's pack or outbox at all, online or offline; the outbox replays only for a matching identity, so Buyer A's queued intents never land in Buyer B's cart. Replay always re-resolves `BuyerContext` server-side, in the app's route handler, before mutating the cart (§3.3 step 1), so cart spec §6a.1's storefront assortment check runs against a server-resolved scope regardless of what the pack or the client believed — a wrong-identity pack can produce a bad **preview**, never an unauthorized **purchase** | Low for purchasing; Medium for the preview-only disclosure window until the mismatch purge fires |
| R6 | Delta protocol keyed on the wrong granularity | Medium | `ecommerce`, cache | The pack's cache key omits a named scope component and falls back toward a whole-context digest, the way storefront-public-api §9.1 initially did for `priceRange` before it was fixed — or keys only on the price components while the *content* is per-customer, serving one buyer's history-derived pack to another buyer in the same groups; or omits `version`/`since`, so a full fetch and a delta collide. | The pack and manifest endpoints key on the same three named `BuyerContext` components as every other post-ADR-7-amendment surface plus `contentOwnerId` for per-customer content, and the pack endpoint adds `version` and normalized `since` (§5.2), all through the same `buildStorefrontCacheKey` helper storefront-public-api §9 already requires | Low — same helper-enforced discipline as the rest of the suite |
| R7 | Outbox growth exhausts device storage or the cart's own limits | Low/Medium | Client, `cart` | A buyer stays offline for an unusually long field trip and queues far more than a normal cart would ever hold. | Outbox capped to mirror cart's own limits (200 lines per cart, cart §13 R10; bulk calls chunked at 100 per cart R10, each chunk frozen with its own `Idempotency-Key`, §3.3 step 3); once full, further offline adds are refused with a clear "sync to add more" state, never silently dropped | Low |
| R8 | Offline session left stranded past every TTL | Medium | Auth | Both the buyer's ordinary auth session and the pack's own TTL lapse before signal returns, while the outbox still holds real, unsynced intent. | The outbox is not purged by pack expiry (§6) — only the pack read-cache is; reconnect requires an ordinary re-login before replay proceeds, the same flow that already exists, with no bespoke recovery path — and replay proceeds only when the re-logged-in identity matches the outbox owner (§3.3); a different buyer logging in sees a held queue they can neither read nor replay | Low — bounded only by how long the buyer is willing to hold an unsynced queue |
| R9 | A future generic service-worker cache reintroduces R1 | Medium | Architecture | A later contributor adds a common PWA pattern — cache-first across the whole storefront — without realizing it would cache buyer-priced pages exactly the way storefront-app §11 R1 already forbids. | The service-worker precache scope is explicitly restricted to the `/field/*` shell's own assets (§3.4), documented as a boundary in both this spec and storefront-app §3.3a; a test asserts no service-worker registration intercepts `/products`, `/categories`, or any other buyer-aware route | Low |

**A named limitation, not a risk:** reconciliation attribution for a **rejected new addition** depends on cart's `warnings[].lineId`, which cart spec §6a.1 sets to `null` for a line that was never added — so when several *new* offline-queued products are rejected in one replay, the reconciliation screen can show the full `warnings` list but cannot always attribute a specific rejection to a specific queued item beyond what `(productId, variantId, configuration)` matching already resolves. This is not worked around by amending cart-module here (out of this spec's scope, §5.3); it is recorded as Open Question 5 (§12) for whoever picks up a future cart-module amendment.

---

## 10) Test Coverage

Integration coverage for every API path this spec adds, and the key client-side flows, ships in the same change per `.ai/qa/AGENTS.md`. IDs below are the ones the implementation PR must use, so it can be checked line-for-line. Target locations follow the preferred module `__integration__` convention:

- **API** (`TC-FIELD-API-*`): `packages/core/src/modules/ecommerce/__integration__/`
- **Client** (`TC-FIELD-UI-*`): `apps/storefront`'s Playwright suite, next to the storefront-app §12 suites
- **Shared contract** (`TC-FIELD-CONTRACT-*`): unit tests in `packages/shared/src/lib/offline/__tests__/`

**Pack (read side):**

| ID | Scenario |
|---|---|
| TC-FIELD-API-001 | Two buyers with different `priceScopeKey`/`customerOverlayId` get non-interfering packs (R5) |
| TC-FIELD-API-002 | Two buyers in the **same** groups, both with `customerOverlayId = null`, under `selectionMode: 'previously_ordered'` or `'combined'`: each receives a pack built from their own order history, never the other's cached one; their `contentOwnerId`s differ (blocker case, §3.2, R6) |
| TC-FIELD-API-003 | The same two buyers under `selectionMode: 'price_list'` share one cache entry (`contentOwnerId = null`) — the per-customer component is not added where it isn't needed |
| TC-FIELD-API-004 | Pack respects `maxProducts`/`maxVariants`; never returns the whole catalog regardless of policy |
| TC-FIELD-API-005 | `/offline-pack/manifest` returns quickly and cheaply when nothing changed; a version match short-circuits the client without a full fetch |
| TC-FIELD-API-006 | `/offline-pack?since=<version>` returns only `changed`/`removed` entries for a recognized version; an unrecognized `since` returns the full set |
| TC-FIELD-API-007 | A full fetch, `?since=v1` and `?since=v2` for the same scope each receive their own payload — no cache collision (§5.2) |
| TC-FIELD-API-008 | Pack and manifest cache keys use the named scope components (+ `contentOwnerId`, `version`, `since` as specified), never a whole-context digest (R6) — same assertion style as storefront-public-api §12's buyer-isolation suite |
| TC-FIELD-API-009 | For an authenticated buyer, `enabled: false` and a nonexistent store return an identical `404` on both endpoints; without a session, every store — enabled, disabled or nonexistent — returns an identical `401` (§5) |
| TC-FIELD-API-010 | Writing `offlineFieldMode` with out-of-bounds values (e.g. `offlineTtlHours: 4`, `maxProducts: 600`) is rejected by `offlinePackPolicySchema`; writing without the store-settings feature is denied (§4.1) |
| TC-FIELD-UI-001 | `generatedAt`/`expiresAt` surface correctly through to the client banner |

**Device protection (§6):**

| ID | Scenario |
|---|---|
| TC-FIELD-UI-002 | The local gate blocks pack access even with the OS-level device unlocked; without passing the gate, no usable data key exists in IndexedDB or memory (automated where WebAuthn PRF can be simulated via a virtual authenticator; otherwise a documented manual security-review step per release, mirroring storefront-app §8's manual accessibility pass) |
| TC-FIELD-UI-003 | On a device without PRF/`largeBlob`, the gate falls back to the PIN derivation — a bare WebAuthn assertion does not unlock the pack |
| TC-FIELD-UI-004 | 10 consecutive wrong PINs wipe the pack and its wrapped key (purge trigger 6) |
| TC-FIELD-UI-005 | Each of purge triggers 1–5 (logout, identity mismatch, TTL expiry, "Clear field data", field mode disabled) purges the pack automatically (R1, R5) |
| TC-FIELD-UI-006 | A non-empty outbox survives purge triggers 1–5 and remains encrypted (R8) — asserted explicitly, since the two lifetimes are easy to conflate |

**Outbox and replay (write side):**

| ID | Scenario |
|---|---|
| TC-FIELD-CONTRACT-001 | Intents never carry a price or total field anywhere in their wire or storage shape (ADR-2 extended) |
| TC-FIELD-UI-007 | Outbox persists across app reload/relaunch while offline |
| TC-FIELD-UI-008 | Replay goes through the app's route handlers: the client never sends a cart token or an `assortmentScope`; the scope cart receives is the server-resolved one (§3.3, cart R11) |
| TC-FIELD-UI-009 | Buyer B logging in on a device holding Buyer A's outbox: nothing is replayed, no queue content is shown, and B can only hand back or discard it (§3.3, R5, R8) |
| TC-FIELD-UI-010 | A 150-intent outbox replays as two frozen chunks with distinct `Idempotency-Key`s; a retried chunk after a flaky reconnect does not double-add; editing the queue after replay starts never produces `422 idempotency_key_mismatch` (cart §8.2) |
| TC-FIELD-UI-011 | Replay against an expired/terminal cart transparently creates a new one via `POST /carts`; disclosed on the reconciliation screen (R3) |
| TC-FIELD-UI-012 | Replay re-resolves `BuyerContext` server-side before mutating the cart — a membership that lapsed entirely during the offline window is rejected by cart's own §6a.1 check even though the pack still showed the product as available (R5's TOCTOU extension of cart §14's existing fixture) |
| TC-FIELD-UI-013 | Multi-device: device B adds 2 × SKU-X live, device A replays an intent of 3 × SKU-X; the cart holds 5, no `mergeSummary` is returned, and the reconciliation screen shows the intent as `accepted` and the 3 as added to the 2 already there (R4) |
| TC-FIELD-CONTRACT-002 | `reconcileOfflineReplay` classifies `accepted`/`quantity_adjusted`/`rejected` from per-chunk `(baselineLines, response)` pairs, including a fixture where the baseline already holds the same line, one where that line is then capped, and one where a `409` replaced a chunk's baseline (§4.3) |
| TC-FIELD-UI-014 | The outbox cap (200 lines) is enforced; hitting it blocks further offline adds with a visible state, never a silent drop (R7) |
| TC-FIELD-UI-015 | No route in `/field/*` reaches checkout without a live connectivity check |
| TC-FIELD-UI-018 | App closed after chunk 1 of 2 settles: on resume only chunk 2 is sent, and chunk 1's intents are still reconciled as accepted against their own baseline (§3.3 step 4) |
| TC-FIELD-UI-019 | The cookie's cart changes mid-replay (expired and replaced between chunks): the handler refuses the stale-fingerprint chunk without calling cart; the unsent chunk starts a new replay into the new cart; nothing is applied twice (§3.3 step 3) |
| TC-FIELD-UI-020 | A `locked` cart (`423`) pauses replay with the queue intact; a concurrent desktop edit mid-replay surfaces as a `409` and the chunk is re-sent against the new baseline (§3.3 steps 2–3) |
| TC-FIELD-UI-021 | Two buyers with their own profiles on one device: B passing B's gate cannot decrypt A's pack or outbox; the mismatch is detected from `ownerTag` alone (§3.3, §6) |

**Architecture boundary:**

| ID | Scenario |
|---|---|
| TC-FIELD-UI-016 | The registered service worker's precache/fetch scope covers only the `/field/*` shell; no interception of `/products`, `/categories`, or any other buyer-aware route (R9) |
| TC-FIELD-UI-017 | Field mode's JS is a separate, route-level chunk absent from the catalogue and checkout bundle budgets (storefront-app §9) |

**Contract conformance (shared, channel-agnostic):**

| ID | Scenario |
|---|---|
| TC-FIELD-CONTRACT-003 | `packages/shared`'s own test suite exercises `OfflinePackManifest`/`OfflinePackEntry`/`OfflineIntent`/`OfflineOutbox`/`reconcileOfflineReplay` against a fixture with no storefront-specific assumptions, so a future POS implementation (§7) can assert conformance against the same fixture rather than the storefront's own test suite |
| TC-FIELD-CONTRACT-004 | `CartMutationResponse`/`CartWarning`/`CartLineSnapshot` stay structurally assignable from cart spec §10.1's inline envelope (type-level test) |

---

## 11) Implementation Phases

### Phase 1 — Contract and pack read path
`packages/shared/src/lib/offline/` types (incl. `cart-envelope.ts`) and `reconcileOfflineReplay`; `ecommerce`'s two new authenticated endpoints; `OfflinePackPolicy` settings key with `offlinePackPolicySchema` and its admin field group; cache keying on the named scope components plus `contentOwnerId`, `version` and `since`.

**Gate:** buyer-context isolation tests pass for the pack and manifest endpoints (TC-FIELD-API-001–003, 007–009), and TC-FIELD-API-004–006, TC-FIELD-API-010 and TC-FIELD-CONTRACT-001–004 pass, mirroring storefront-public-api's own Phase 1 gate; the enabled-by-default question (§8) and §12 Open Questions 6 and 7 (per-customer content in v1, pin storage) are answered before this phase ships to any tenant. Until Open Question 7 is answered, `buyerPinningEnabled` is forced `false`.

### Phase 2 — Client shell and device protection
`apps/storefront` `/field/*` routes; IndexedDB storage; AES-GCM encryption with gate-wrapped data keys; the WebAuthn-PRF / PIN-derived local gate and its attempt limit; TTL and purge triggers; the scoped service worker.

**Gate:** the pack is unreadable without passing the local gate, even with the device unlocked at the OS level, and no usable key exists before the gate is passed (TC-FIELD-UI-002–004); all six purge triggers verified (TC-FIELD-UI-004, 005); per-buyer profiles isolated (TC-FIELD-UI-021); no service-worker interception of a buyer-aware route (R9, TC-FIELD-UI-016).

### Phase 3 — Outbox and replay
Encrypted, owner-bound intent queue; frozen chunks with per-chunk idempotency keys; the reconnect replay algorithm through the app's route handlers (§3.3); the reconciliation screen reusing the `priceChanges`/`warnings` presentation and the merge-summary visual pattern.

**Gate:** the full offline → reconnect → reconcile flow passes, including the expired-cart fallback (R3), the multi-device fixture (R4, TC-FIELD-UI-013) the shared-device identity mismatch (TC-FIELD-UI-009), and interrupted, cart-changed, locked and conflicting replays (TC-FIELD-UI-018–020); no offline route reaches checkout.

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
6. **Per-customer pack content in v1 — keep it, or defer it?** (for the author and @zielivia / @pat-lewczuk) This spec keeps `previously_ordered`, `combined` and buyer pins, and makes them safe by adding `contentOwnerId` to the cache key and the embedded scope (§3.2, §5.2). That costs per-customer cache entries — no sharing between buyers for those modes. The simpler alternative, raised in review, is to ship v1 with scope-level content only (`price_list` + `merchant_curated`), which removes the per-customer key, Open Question 7, and part of the shared-device outbox concern at once, and to add history and pins once the per-customer key is designed. Either is consistent with the rest of this spec; it is a product call.
7. **Where buyer pins live.** The server builds the pack, so pins must reach it, and this spec adds zero tables. The options: (a) the client sends its pins as a query parameter on each pack fetch, which then also enters the cache key (per-buyer entries, no storage); (b) a pins list in an existing per-customer settings/preferences store, if the `customers` / `customer_accounts` modules offer one; (c) a small new table, reversing this spec's zero-tables stance. Pinning is disabled (`buyerPinningEnabled` forced `false`) until this is decided.
8. **Anonymous buyers.** This spec requires an authenticated buyer session for both endpoints (§5). Whether an anonymous visitor should ever get a pack — e.g. a smaller, anonymous-priced, scope-level one — is left open; it would need its own scraping analysis.
9. **Does the PIN attempt-limit wipe also destroy an unsynced outbox?** §6 wipes it by default, because an outbox that survives unlimited PIN guessing would defeat the limit. The alternative — keep the outbox but make it unreadable until an online re-login by its owner re-issues a key — preserves the buyer's queued work at the cost of a server-assisted key-recovery path this spec otherwise avoids.
10. **Spec number.** This spec is numbered 14 in the roadmap while row 13 is reserved for POS's non-suite offline spec. Renumbering this to 13 and referencing POS by name instead is a roadmap-housekeeping choice for the roadmap's owner; it has no design impact.

---

## 13) Final Compliance Report

| Requirement | Status |
|---|---|
| No cross-module ORM relations | The pack reads `catalog`/`availability` through the same DI services `ecommerce`'s public API already uses; the outbox reaches `cart` only through its existing public HTTP contract |
| Tenant/organization scoping | Every pack and manifest response scoped through the same `StoreContext` resolution as every other `storefront-public-api.md` surface; both endpoints require an authenticated buyer session and return a non-probeable `404` otherwise (§5) |
| Input validation / RBAC | `offlinePackPolicySchema` (zod, bounded) in `ecommerce`'s `data/validators.ts`; writes guarded by the existing `ecommerce.*` store-settings feature, no new ACL feature (§4.1) |
| No new `SPEC-*` filename prefix | `{YYYY-MM-DD}-{kebab-case}.md` |
| Backward compatibility | Additive only: two new `ecommerce` GET endpoints, one new settings key on `EcommerceStore.settings`; zero changes to `cart`, `sales`, or `checkout` contracts |
| Optimistic locking | Not applicable — this spec introduces no new server-side user-editable entity; the pack is a computed, cached read, and the outbox is client-local only |
| No offline checkout / no client arithmetic | ADR-2 and this spec's own hard boundary (§1, §3.3); asserted by test (§10) |
| Buyer-context cache keying | Named scope components only, per ADR-7 amended, plus `contentOwnerId` for per-customer content and `version`/`since` on the pack endpoint (§3.2, §5.2, R6) |
| Write-path scope and token handling | Replay goes through the app's server route handlers: cookie-held cart token (storefront-app R7), server-resolved `assortmentScope` (cart §6a.1, R11) — never client-supplied (§3.3) |
| Device-at-rest protection | Opt-in, encrypted under gate-derived keys (WebAuthn PRF / Argon2id-PIN, attempt-limited), TTL-bounded, auto-purged; outbox encrypted and owner-bound (§3.3, §6); residual risk stated, not hidden (R1) |
| Second consumer named | POS (SPEC-022 §3), with explicit exclusions (§7) |
| Integration coverage | §10, with TC IDs and target locations, shipping in the same change |

---

## 14) Changelog

### 2026-09-27 — review fixes
Addresses the 2026-09-25 self-review (2 blockers, 5 majors, 6 minors). All text changes; the two-halves design is unchanged.
- **Per-customer pack content no longer shares a cache key across customers (blocker 1).** Added `contentOwnerId` to `OfflinePackScope`, the manifest/pack cache keys and the R5 mismatch purge (§3.2, §4.2, §5.2, R5, R6). The review's alternative — scope-level content only in v1 — is recorded as Open Question 6 for the maintainers rather than chosen here.
- **Replay no longer reads as client-supplied scope (blocker 2).** Replay goes through `apps/storefront`'s server route handlers, which read the httpOnly cart-token cookie and resolve `assortmentScope` server-side; the client sends only intents and chunk keys (§3.3, §5.3).
- **R4 / §8 item 4 / §2.3 restated against cart's real behavior (major 3).** A replay is a plain `bulkAdd`; identical lines sum (cart §4.2) and no `mergeSummary` is produced — cart only emits one for a guest→customer login merge (cart §7.1–§7.2). Roadmap ADR-10 and storefront-app §5.8 / US-F5 / §12 amended to match.
- **`reconcileOfflineReplay` takes the pre-replay lines and all chunk responses and classifies on the delta (major 4).** `CartWarning`, `CartLineSnapshot` and `CartMutationResponse` are now explicitly introduced by this spec in `packages/shared` as mirrors of cart §10.1's inline envelope (§4.2, §4.3).
- **The outbox is bound to its owner and encrypted at rest (major 5).** Each buyer enrolls their own gate and gets their own key hierarchy, so a shared device holds independently-keyed profiles; a plaintext salted `ownerTag` detects a mismatch without decrypting; replay only for a matching re-resolved identity (§3.3, §4.2, §6, R5, R8).
- **The local gate is cryptographic (major 6).** Data keys are stored only wrapped under a KEK derived from WebAuthn PRF (or `largeBlob`), else an Argon2id/PBKDF2 PIN derivation; a bare WebAuthn assertion is not sufficient; 10-attempt wipe (§6). Whether the wipe also destroys the outbox is Open Question 9.
- **Delta caching keys on `version` + normalized `since` (major 7)** (§3.2, §5.2).
- **Replay survives interruption and concurrency (found in re-review).** The replay record persists the pre-replay snapshot, each chunk's baseline and response, and a `cartFingerprint` that pins the replay to one cart; each chunk sends the expected `updatedAt`, so a concurrent edit becomes a `409` that moves the baseline; `merged` added to the terminal statuses; a `locked` cart (`423`) pauses replay (§3.3, §4.2, §4.3).
- No-session requests get a uniform `401`, distinct from the disabled-store `404`, so a lapsed login never fires the field-mode-disabled purge (§5, §6). Passcode fallback raised to ≥ 8 non-numeric characters with explicit Argon2id cost, and the R1 residual now names offline attack on exfiltrated storage.
- Minors: frozen per-chunk idempotency keys for >100-line replays (§3.3 step 3); authenticated-only endpoints with a non-probeable `404` when disabled or anonymous (§5; anonymous packs are Open Question 8); `offlinePackPolicySchema` bounds, admin surface and ACL (§4.1); pin storage left as Open Question 7 with pinning disabled until decided; purge triggers counted consistently as six, including "field mode disabled" (§6, Phase 2 gate); TC IDs and target locations for every §10 scenario.
- Nits: spec numbering recorded as Open Question 10; storefront-app §17's misdated "§16 user story map" bullet given its own heading; the prototype README now says it is illustrative only.

### 2026-09-22
- Initial specification. Split reading (server-built offline pack) and writing (client-side intent outbox) into two independently-risked halves per this run's brief, after concluding — consistent with storefront-app §11 R1 and storefront-public-api §11 R1 — that a naive service-worker catalog cache fails for the same buyer-aware-pricing reason a naive ISR cache does.
- Reused, without modification: `cart.lines.bulkAdd`'s existing idempotency (cart §8.2) and partial-success behavior (cart §6a.1) for replay; the existing `mergeSummary`/`priceChanges`/`warnings` envelope (cart §7.2, §10.1) for reconciliation, rather than designing a second screen. No amendment to `cart-module.md` was made or required.
- Placed the contract — pack manifest, outbox intent, and the one shared reconciliation function — in `packages/shared`, and named POS (SPEC-022 §3, line 36's "Offline mode and sync (Phase 3)" non-goal) as the contract's explicit second consumer, with cash handling, register session state, and hardware integration excluded on purpose (§7).
- **Resolves [Storefront Application](./2026-08-14-storefront-app.md) §14 Open Question 4.** That question characterized offline as something "the roadmap listed... as a non-goal" — the word "offline" does not appear anywhere in `2026-08-14-ecommerce-suite-roadmap.md` prior to this change; no such non-goal exists to reverse. This spec does not treat OQ4 as overturning a prior decision, only as answering a question the roadmap had never actually foreclosed. The storefront-app.md edit accompanying this change records the same discrepancy in that document's own changelog.
- Flagged one assumption for explicit human confirmation (§8): whether `OfflinePackPolicy.enabled` should default to `false` (opt-in per store, as specified) or `true` for some tenant segment. Everything else in §8 is a resolved autonomous default with a stated override path.
