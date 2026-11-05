# PR #4175 — dictionary entries: teach consumers to page

**PR:** #4175 (`fix/issue-3847-dictionary-entries-page-size-cap`)
**Issue:** #3847
**Status:** in-progress

## Context

PR #4175 caps `GET /api/dictionaries/<id>/entries` at `DICTIONARY_ENTRIES_MAX_LIMIT = 500` rows per
request. It was opened by the autofix fleet without a tracking plan; this plan covers the follow-up
work identified in review.

Review finding (blocking): `useDictionaryEntries` issues a single `apiCall` and ignores the new
`hasMore` field. Every full-list consumer therefore silently truncates at 500 entries once a
dictionary grows past the ceiling:

- `DictionaryEntriesEditor` (settings UI — the admin cannot see or reorder entries 501+)
- `DictionarySelectControl` and `fields/dictionary.tsx` (a value beyond entry 500 becomes unselectable)
- `ensureDictionaryEntries` → `CustomDataSection`, `useCustomFieldDisplay` (label lookup misses)

The cap traded a latent DoS for silent data loss in the UI. The consumer must page.

## Constraint discovered while planning

Page *membership* is decided by the database (`ORDER BY position, id`), but page *display order*
comes from `sortDictionaryEntries(entries, sortMode)`, which runs in memory and compares with
`localeCompare(..., { sensitivity: 'base' })`. Postgres cannot reproduce that collation, so the sort
cannot simply be pushed into the query without changing the order existing consumers already see.

Consequence: concatenating pages that were each sorted in isolation yields a list ordered only
*within* each page. The client must therefore re-sort the assembled set with the same comparator,
which means it needs the dictionary's `sortMode` — currently absent from the response.

## Phases

### Phase 1: expose the sort mode on the entries response

- Return the resolved `sortMode` in the `GET` payload (additive; the cache key already varies by it).
- Extend `dictionaryEntryListResponseSchema` so OpenAPI documents the new field.

### Phase 2: page through `hasMore` in the shared hook

- `dictionaryEntriesQueryOptions.queryFn` loops `offset += limit` until `hasMore` is false, with a
  hard page-count guard so a bad `total` cannot spin forever.
- Re-sort the assembled list with `sortDictionaryEntries(all, sortMode)` **only** when more than one
  page was fetched. A single-page dictionary keeps the server's ordering byte-for-byte, so the
  common path (every dictionary at or below 500 entries) is unchanged.

### Phase 3: tests

- Cover: single page issues exactly one request and preserves server order; a truncated first page
  triggers follow-up requests until `hasMore` is false; the assembled multi-page list is globally
  sorted by `sortMode`; the page-count guard stops a runaway `hasMore`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: expose the sort mode

- [x] 1.1 Return `sortMode` from the entries GET payload + OpenAPI schema — 32b248a36

### Phase 2: page through hasMore

- [x] 2.1 Page and re-sort in `useDictionaryEntries` — 32b248a36

### Phase 3: tests

- [x] 3.1 Hook paging tests — 32b248a36

## Phase 4: page the remaining consumers (review follow-up, 2026-07-31)

@pkarw's review found that only `useDictionaryEntries` was taught to page. Every other consumer
still issued a single `apiCall` and read `.items`, so a dictionary above the ceiling silently lost
everything past entry 500 — the exact regression #3847 warned to coordinate against. The broadest
path was `loadRemoteOptions`, the generic `optionsUrl` loader behind every custom-field
`select`/`currency`/`relation`/multi-`dictionary`/multi-`text` field.

Resolution: the review's option (1) — one shared walk, reused everywhere — split across the two
layers, because `packages/ui` peer-depends on `@open-mercato/shared` only and can never import
`@open-mercato/core`:

- `packages/ui/src/backend/utils/fetchAllPages.ts` — `fetchAllOffsetPages(url)`, a sort-agnostic
  offset walker for any list route. A route that does not report `hasMore` resolves in one request,
  so it is a drop-in replacement for a one-shot `apiCall`.
- `packages/core/src/modules/dictionaries/lib/fetchAllEntries.ts` — `fetchAllDictionaryEntries(id)`,
  the dictionary-aware wrapper that adds the `sortMode` re-sort across page boundaries.

Accepted, scoped limitation: `loadRemoteOptions` is generic and has no dictionary semantics, so a
dictionary above the ceiling reached through `optionsUrl` yields options ordered page-by-page rather
than globally. Every entry is present and selectable — the data loss is closed; only cross-page
ordering is approximate on that one path.

- [x] 4.1 Shared offset walker in `@open-mercato/ui` + dictionary-aware wrapper in core
- [x] 4.2 `loadRemoteOptions` pages (fixes every `optionsUrl` custom field)
- [x] 4.3 `clientEntries`, planner, staff, resources and the workflows order-approval widget page
- [x] 4.4 `useDictionaryEntries` re-based on the shared wrapper (behavior unchanged)
- [x] 4.5 Tests: walker, `optionsUrl` loader paging, dictionary wrapper re-sort
