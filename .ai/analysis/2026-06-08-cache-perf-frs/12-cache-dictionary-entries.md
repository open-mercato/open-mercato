> Cache-performance Feature Request — round-2 candidate 12
> Endpoint: `GET /api/dictionaries/[dictionaryId]/entries` · Verdict: strong-quick-win
> Source: `packages/core/src/modules/dictionaries/api/[dictionaryId]/entries/route.ts`
> Added 2026-06-09 (round 2): this is the **actually-hot** dictionaries surface (replaces demoted FR 05); invalidation piggybacks on existing `crud:dictionaries.entry:*` tags.

## Summary

Every **dictionary-backed custom field** renders a select whose options come from this endpoint — `packages/core/src/modules/entities/api/definitions.ts:366` wires `optionsUrl = /api/dictionaries/${dictionaryId}/entries` into custom-field definitions, so every CrudForm open with a dictionary CF hits it (often several times per form for multiple CFs). Each call runs `findWithDecryption(DictionaryEntry, …)` (per-row decryption) plus a `sortDictionaryEntries` pass.

Unlike dictionary *definitions* (plain `em.flush()` routes — see demoted FR 05), dictionary **entries are written through commands** with `resourceKind: 'dictionaries.entry'` (`commands/entries.ts:36`, `commands/entry-operations.ts:189/387`, factory-based commands `commands/factory.ts:278/376/456`). The command bus therefore already flushes `crud:dictionaries.entry:tenant:<T>:org:<O>:collection` post-commit on every entry write — tag the cached options payload with that and invalidation is free.

## Why (impact)

- **Hotness — high**: fires on form bootstrap for every dictionary-backed CF across all modules; read:write ratio is extreme (entries are admin-curated).
- **Cost** — decryption-decorated `find` + sort per call.
- **Est. win** — options lists become a single cache `get` for the 5-minute window; forms with several dictionary CFs save several decrypted queries per open.

## Current behavior

`api/[dictionaryId]/entries/route.ts` — `loadDictionary` (`em.findOne`), then `findWithDecryption(DictionaryEntry, { dictionary, organizationId, tenantId }, …)` (route.ts:71-81), `sortDictionaryEntries(entries, sortMode)` (route.ts:82), DTO mapping. Custom handler; no module cache. (The separately-cached `customers:dictionaries:*` surface covers only the customers module's own kinds API — different endpoint, no overlap.)

## Proposed cache

```ts
import { buildCollectionTags, buildRecordTag, isCrudCacheEnabled } from '@open-mercato/shared/lib/crud/cache'

const ENTRIES_TTL_MS = 5 * 60_000

const cacheEnabled = isCrudCacheEnabled()
const cache = cacheEnabled ? (() => { try { return ctx.container.resolve('cache') } catch { return null } })() : null
const cacheKey = `dictionaries:entries:${dictionaryId}:org=${ctx.organizationId ?? 'null'}:sort=${sortMode}`

if (cache) {
  const cached = await cache.get(cacheKey)
  if (cached) return NextResponse.json(cached)
}
// ... existing load + sort + mapping → payload ...
if (cache) {
  try {
    await cache.set(cacheKey, payload, {
      ttl: ENTRIES_TTL_MS,
      tags: [
        ...buildCollectionTags('dictionaries.entry', ctx.tenantId, [ctx.organizationId ?? null]),
        buildRecordTag('dictionaries.dictionary', ctx.tenantId, dictionaryId), // definition rename/delete (PATCH/DELETE are plain routes — TTL backstop, see Safety)
      ],
    })
  } catch {}
}
return NextResponse.json(payload)
```

## Cache tags

- `crud:dictionaries.entry:tenant:<T>:org:<O>:collection` — **reused**, flushed post-commit by the command bus on every entry create/update/delete/undo. Zero new wiring.
- `crud:dictionaries.dictionary:tenant:<T>:record:<dictionaryId>` — carried for forward-compatibility: it becomes live automatically if/when definition writes are migrated to commands. Today definition PATCH/DELETE are plain `em.flush()` routes, so definition-level changes (rename, `entrySortMode`, soft-delete) converge via the 5-minute TTL — acceptable for admin-curated metadata. (Alternative if faster convergence is required: one `deleteByTags` line after the flush in the two definition write routes.)

## Invalidation

| Trigger | Where the flush already happens | Tags |
|---|---|---|
| Entry create/update/delete (commands, resourceKind `dictionaries.entry`) | command bus — existing | `crud:dictionaries.entry:…:collection` |
| Entry command undo/redo | command bus — existing | same |
| Dictionary definition PATCH/DELETE (plain routes) | none — **TTL backstop (5 min)**; or one optional inline flush | (TTL) |

## Safety / non-invalidation risks (double-checked)

- **Gate:** the entry-tag flush no-ops while `ENABLE_CRUD_API_CACHE` is off — cache gated on `isCrudCacheEnabled()`.
- **Definition-change staleness:** a renamed/soft-deleted dictionary's *entries* payload may be served ≤5 min (the entries themselves are unchanged; the parent rename does not alter option values, and a deleted dictionary's options stop being requested once the CF definition refreshes). If this window matters, add the optional inline flush noted above.
- **Org inheritance:** the entries query is org-scoped (`organizationId` in filter and in the key). Entry writes in a parent org flush the parent-org collection tag; if the read path resolves inherited entries across orgs, include the resolved org set in the key (mirror the route's actual filter — verify during implementation).
- **Coarse flush:** any entry write in the org flushes all dictionaries' options for that org — costs a recompute, never staleness.
- **Encrypted values:** cached payload contains decrypted labels — tenant-namespace isolation (dispatcher wrapper) is mandatory and automatic; never cache cross-tenant.
- **No-op without cache service; never cache 401/404 branches.**

## Implementation steps

- [ ] Add the gated get-then-set to `api/[dictionaryId]/entries/route.ts`; assemble the response into a `payload` first.
- [ ] Mirror the route's exact filter axes in the key (org / sortMode / any inactive flag).
- [ ] Unit tests: key axes; tag shapes match the command-bus flush; no caching when flag off.
- [ ] Integration: create/update an entry via the API → options reflect it immediately (command flush); definition rename converges ≤ TTL.
- [ ] `yarn workspace @open-mercato/core build && test`.

## Labels

`feature`, `performance`, `priority-medium`
