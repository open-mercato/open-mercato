> Cache-performance Feature Request — round-2 candidate 16
> Endpoint: `GET /api/catalog/product-media` · Verdict: good
> Source: `packages/core/src/modules/catalog/api/product-media/route.ts`
> Added 2026-06-09 (round 2): verified non-cached; invalidation rides the existing `crud:catalog.product:*:record:<id>` tag + a short TTL for attachment-only changes.

## Summary

Product media is fetched on every product detail open and media-tab render. The custom GET runs two queries per call — a product scope check (`em.findOne(CatalogProduct)`) and the attachments fetch (`em.find(Attachment, { entityId: catalog_product, recordId })`) — plus URL building (`route.ts:36-69`).

Cache the media payload per product, tagged with the **already-flushed** `crud:catalog.product:tenant:<T>:record:<productId>` tag (every product command flushes it via the command bus). Attachment upload/delete does **not** go through the command bus (the attachments module has events but its writes are route-level), so attachment-only changes converge via a deliberately short **60 s TTL** — no bespoke subscriber in v1.

## Why (impact)

- **Hotness — medium**: product detail/media tab during catalog browsing; bursty during merchandising sessions.
- **Cost** — 2 queries + URL mapping per call.
- **Est. win** — repeat opens within a minute become a cache `get`; pairs well with FR 06's product-list caching for browse flows.

## Current behavior

`api/product-media/route.ts:36-69` — `em.findOne(CatalogProduct, { id, organizationId, tenantId })` scope check, `em.find(Attachment, { entityId: E.catalog.catalog_product, recordId: productId, … })`, `buildAttachmentImageUrl` mapping. Custom handler; no module cache. Writes affecting the payload: attachment upload/delete via `/api/attachments` routes (module declares `attachments.attachment.created/updated/deleted` events in `attachments/events.ts` but writes are not command-bus commands), and product delete via `catalog.products.delete` (command).

## Proposed cache

```ts
import { buildRecordTag, isCrudCacheEnabled } from '@open-mercato/shared/lib/crud/cache'

const PRODUCT_MEDIA_TTL_MS = 60_000 // short: attachment writes have no command-bus flush

const cacheEnabled = isCrudCacheEnabled()
const cache = cacheEnabled ? (() => { try { return container.resolve('cache') } catch { return null } })() : null
const cacheKey = `catalog:product-media:${productId}:org=${orgId ?? 'null'}`

if (cache) {
  const cached = await cache.get(cacheKey)
  if (cached) return NextResponse.json(cached)
}
// ... existing scope check + find + mapping → payload ...
if (cache) {
  try {
    await cache.set(cacheKey, payload, {
      ttl: PRODUCT_MEDIA_TTL_MS,
      tags: [buildRecordTag('catalog.product', tenantId, productId)],
    })
  } catch {}
}
return NextResponse.json(payload)
```

## Cache tags

- `crud:catalog.product:tenant:<T>:record:<productId>` — **reused**, flushed by the command bus on every `catalog.products.update/delete` execute/undo. Covers product deletion/update (and media changes made through product commands, if any).

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| Product update/delete (commands, resourceKind `catalog.product`) | command bus — existing | `crud:catalog.product:…:record:<id>` |
| Attachment upload/delete (`/api/attachments` routes — no command) | none in v1 — **60 s TTL backstop** | (TTL) |
| Optional v2 (only if 60 s lag is unacceptable) | one ephemeral subscriber on `attachments.attachment.created/deleted` (events already declared in `attachments/events.ts`) flushing the product record tag — MUST wrap in `runWithCacheTenant(payload.tenantId, …)` | `crud:catalog.product:…:record:<id>` |

## Safety / non-invalidation risks (double-checked)

- **The dominant risk is attachment-write staleness**, which is why the TTL is 60 s (not minutes): after uploading media, the editor's own media tab could show the old set for ≤60 s on a cached read. If product-edit UX refetches with cache-busting or the v2 subscriber ships, this disappears. Decide v1-acceptability with the product-team; the spec defaults to v1 + explicit callout.
- **Gate:** the record-tag flush no-ops while `ENABLE_CRUD_API_CACHE` is off — cache gated on `isCrudCacheEnabled()`.
- **Scope check stays live**: the 404/forbidden early-return for a wrong-org product is never cached (only the successful payload is), so the cache cannot leak media across orgs; key carries org, namespace carries tenant.
- **v2 subscriber namespace rule**: subscriber flushes run outside the request ALS context — the `runWithCacheTenant(payload.tenantId, …)` wrap is mandatory or the flush lands in the `global` namespace and never matches (see README doctrine §2).
- **No-op without cache service.**

## Implementation steps

- [ ] Add the gated get-then-set to `api/product-media/route.ts`.
- [ ] Confirm with UX whether the product media editor refetches after upload (if it posts then refetches the same GET, consider the v2 subscriber in the same PR).
- [ ] Unit tests: per-product key; record-tag shape; flag-off ⇒ no caching; 404 branch never cached.
- [ ] Integration: product update → media payload recomputed immediately; attachment upload → converges ≤60 s (or immediately with v2).
- [ ] `yarn workspace @open-mercato/core build && test`.

## Labels

`feature`, `performance`, `priority-low`
