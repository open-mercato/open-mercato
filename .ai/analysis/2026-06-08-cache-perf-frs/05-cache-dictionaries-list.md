> Auto-generated cache-performance Feature Request — candidate 5 of 9
> Endpoint: `GET /api/dictionaries` · ROI 82 → re-audited · Verdict: **skip — overlaps an existing cache / low hotness**
> Source: `packages/core/src/modules/dictionaries/api/route.ts`
> Revised 2026-06-09: overlap audit against existing caches demoted this FR. Recommendation: close issue #2910 (or keep as low-priority backlog) — see analysis below.

## Summary (revised verdict)

The original FR proposed a manual cache for the custom `GET /api/dictionaries` list handler. The 2026-06-09 overlap audit found that **the hot dictionary read surface is already cached elsewhere**, and this endpoint itself is not hot enough to justify new cache code:

1. **The hot path is the customers module's dictionary API, which is already cached.** Dictionary-backed select controls in customer forms hit `GET /api/customers/dictionaries/[kind]`, which has a full get-then-set cache with 5-minute TTL and tag invalidation (`packages/core/src/modules/customers/api/dictionaries/cache.ts` — keys `customers:dictionaries:<T>:<kind>:org=…`, tags `customers:dictionaries:<T>:<kind>[…:org:<O>]`, flushed by `invalidateDictionaryCache` on entry writes).
2. **Dictionary-backed custom-field selects hit the entries endpoint, not this list.** `packages/core/src/modules/entities/api/definitions.ts:366` wires `optionsUrl = /api/dictionaries/${dictionaryId}/entries` — that per-dictionary entries endpoint is the genuinely hot, uncached surface, and it is now covered by **FR 12** (`12-cache-dictionary-entries.md`), where invalidation piggybacks on the already-flushed `crud:dictionaries.entry:*` tags.
3. **What remains for `GET /api/dictionaries`** is the admin dictionaries manager page listing dictionary *definitions* — an admin-only, low-frequency surface (a handful of requests per admin session). Its cost (one org-ancestor lookup + one `em.find(Dictionary)`) does not clear the bar for new cache code plus three bespoke inline invalidation sites (the module's definition writes are plain `em.flush()` routes with no commands and no events, so there is **no existing flushed tag to connect to** — invalidation would have to be hand-wired, which is the complexity this backlog avoids for low-value surfaces).

## Recommendation

- **Close #2910** as not-planned (or relabel `priority-low` backlog). Implementing it would duplicate freshness machinery for a cold endpoint.
- Implement **FR 12** instead — same module, the actually-hot endpoint, with zero new invalidation wiring.
- If the dictionaries manager page ever becomes hot (e.g. embedded as a picker), revisit with the then-current write-path situation; if dictionary-definition writes are migrated to commands by then, the cache can ride `crud:dictionaries.dictionary:*` tags for free.

## Original analysis (kept for the record)

The original proposal (manual cache keyed by `readableOrganizationIds` + `includeInactive` + selected org, 5-minute TTL, tenant-wide `dictionaries:list` tag, inline `deleteByTags` after `em.flush()` in the three definition write routes) is preserved in git history (PR #2905, commit `3616b2071`). Its correctness analysis remains valid; only its cost/benefit verdict changed:

- Hotness was overestimated: form selects do not call this endpoint (see audit above).
- Invalidation required three bespoke inline flush sites because definition writes bypass the command bus — against the revised doctrine of connecting to already-flushed tags.

## Labels

`performance`, `priority-low` (recommended: close)
