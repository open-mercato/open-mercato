# Findings — Issue #2136: audit `em.findAndCount` / `em.find` fetch-all-then-slice callers

**Issue:** [#2136](https://github.com/open-mercato/open-mercato/issues/2136) (quick-win H)
**Pattern audited:** a list route fetches the full result set via `em.find(...)` / `em.findAndCount(Entity, filter, { orderBy })` **without** `limit`/`offset`, then slices in JS with `array.slice(start, start + pageSize)`.
**Reference fix (proven, trivial case):** `currencies/api/currencies/route.ts` + `exchange-rates/route.ts` (PR #2139 / commit `4a8bb2b0b`).

Each candidate gets an independent decision:
- **PUSH** — slice is pure paging over a single DB-filtered, DB-ordered result set → push `limit`/`offset` to the query and drop the JS slice.
- **STRUCTURAL** — the slice runs over data that was merged, deduplicated, hierarchy-ordered, JS-searched on decrypted fields, or otherwise transformed in JS after the fetch. Pagination cannot be pushed to one query without changing the page contents or the `total`. Keep the JS slice.

## Verdicts

| # | Route (file:line of slice) | Verdict | Why |
|---|---|---|---|
| 1 | `catalog/api/categories/route.ts:228` | STRUCTURAL | `computeHierarchyForCategories(...)` builds the tree from the full set, then status/search filtering runs in JS before the slice. Tree ordering requires all rows. |
| 2 | `customers/api/activities/route.ts:183` | STRUCTURAL | Items are a union of two sources (legacy `CustomerInteraction` + canonical `CustomerActivity`), merged, deduped and re-sorted in JS before paging. (Called out as structural in the issue body.) |
| 3 | `customers/api/labels/route.ts:124` | STRUCTURAL | Fetched via `findWithDecryption`; the `?ids=` narrowing and `?search=` match run in JS against the **decrypted** `label` value, so they cannot be expressed as SQL. `total` derives from the JS-filtered length. |
| 4 | `staff/api/team-members/assignable/route.ts:217` | STRUCTURAL | Members are hydrated (user/team), search-filtered, then **deduplicated by `userId`** in JS. Dedup changes `total`, so paging must follow it. (`customers/api/assignable-staff` is a 308 redirect to this canonical route.) |
| 5 | `customers/api/deals/[id]/people/route.ts:138` | STRUCTURAL | JS `sortItems(...)` (label-asc/label-desc/recent) + JS search run on mapped, enriched items before the slice. |
| 6 | `customers/api/deals/[id]/companies/route.ts:159` | STRUCTURAL | Same as #5, plus profile enrichment merged in JS. |
| 7 | `customers/api/companies/[id]/people/route.ts:197` | STRUCTURAL | Same as #5/#6 (name-asc/name-desc/recent sort + search + profile enrichment in JS). |
| 8 | `customers/api/people/[id]/companies/enriched/route.ts:376` | STRUCTURAL | Seven related-entity batch fetches are merged and enriched (active deals, CLV, last-contact), then JS search + computed-field sort before the slice. |
| 9 | `directory/api/tenants/route.ts` | **PUSH (conditional)** | `name`/`isActive`/`orderBy` are already DB-expressible. Only custom-field filters are matched in JS (CF values live in a separate store). **Fixed:** push `findAndCount` `limit`/`offset` when no CF filter is active (the common case); keep fetch-all only when a CF filter must be matched in memory. |
| 10 | `directory/api/organizations/route.ts:378, 477` | STRUCTURAL | Both slices run over a per-tenant (and, for super-admin, cross-tenant) hierarchy flattened in JS, then status/search/ids filtering. Hierarchy ordering requires the full set. |

Already handled by PR #2217 (server-side sorting via query engine): `customers/api/people/route.ts`, `customers/api/companies/route.ts`. Not re-touched here.

## Outcome

- **1 concrete pushdown** implemented: `directory/api/tenants/route.ts` now pushes pagination to the database via `em.findAndCount(..., { limit, offset })` whenever no JS-side custom-field filter is active, avoiding a full-table scan on every tenants list request. The fetch-all path is preserved (and documented inline at the branch) for the CF-filter case. Regression coverage: `directory/api/tenants/__tests__/list-pagination.test.ts`.
- **9 sites confirmed STRUCTURAL** and intentionally left as JS slices for the reasons above. No further pushdowns are safe without changing wire behavior, so the audit is closed.
