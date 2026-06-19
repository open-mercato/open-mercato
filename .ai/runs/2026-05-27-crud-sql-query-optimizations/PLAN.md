# PLAN — CRUD API SQL Query Quick Wins (100% BC)

**Run slug:** `2026-05-27-crud-sql-query-optimizations`
**Branch:** `feat/crud-sql-query-optimizations`
**Base:** `develop`
**Brief:** Analyze SQL queries used by CRUD APIs across modules (CRM/customers, sales, catalog, staff, resource, workflows, others). Catalogue backward-compatible quick wins. Implement the top two. File GitHub issues for the rest.

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Seed run folder (PLAN, HANDOFF, NOTIFY) | done | ac97a27c0 |
| 2 | 2.1 | Push DB-level pagination to currencies + exchange-rates list routes | done | 4a8bb2b0b |
| 2 | 2.2 | Parallelize entity + profile decryption fetch in customers people afterList | done | e4b809875 |
| 3 | 3.1 | File GitHub issues for the remaining catalogued quick wins | done | pending |
| 4 | 4.1 | Final gate + PR summary | done | pending |

## GitHub Issues filed (Step 3.1)

| Finding | Issue | URL |
|---------|-------|-----|
| C — sales shipments DictionaryEntry parallelize | #2131 | https://github.com/open-mercato/open-mercato/issues/2131 |
| D — QueryEngine gate cf:* joins | #2132 | https://github.com/open-mercato/open-mercato/issues/2132 |
| E — thread CF def index through QueryEngine | #2133 | https://github.com/open-mercato/open-mercato/issues/2133 |
| F — sales shipments orderLines batching | #2134 | https://github.com/open-mercato/open-mercato/issues/2134 |
| G — makeCrudRoute cache-tag loop flatten | #2135 | https://github.com/open-mercato/open-mercato/issues/2135 |
| H — audit em.findAndCount callers | #2136 | https://github.com/open-mercato/open-mercato/issues/2136 |
| I — customers activities decorator parallelize | #2137 | https://github.com/open-mercato/open-mercato/issues/2137 |
| J — auth roles ACL parallelize | #2138 | https://github.com/open-mercato/open-mercato/issues/2138 |

## Goal

Land two concrete, 100%-backward-compatible CRUD SQL optimizations and capture the rest as tracked GitHub issues so the team can pick them up incrementally.

## Scope

- Modify only the two route files that ship Step 2.1 and the one route file that ships Step 2.2.
- Add unit tests covering the new pagination behavior and the parallel-fetch behavior.
- File GitHub issues for every other catalogued optimization with concrete file:line citations and BC notes.
- Touch nothing else.

## Non-goals

- No public API contract change. Response shape stays identical.
- No DB schema change. No new migrations, no new indexes (those go in follow-up issues if warranted).
- No refactors to `makeCrudRoute`, `QueryEngine`, or any shared CRUD plumbing in this PR (those are issue candidates, not in-scope changes).
- No DS / UI changes — this PR is server-side only.

## Risks

- **Pagination behavior change risk**: switching from "fetch all, slice in JS" to "LIMIT/OFFSET in SQL" changes the row set under unstable sort orders. Mitigation: both routes already define stable `orderBy` (`date DESC` for exchange-rates, `code ASC` for currencies) before the slice, and we keep the same `orderBy`. We also preserve the `findAndCount` shape so `total` is unchanged.
- **Promise.all error propagation**: in `afterList` for people, switching two awaits to `Promise.all` changes failure semantics slightly (first-failure-aborts vs. sequential-stops-at-first). Mitigation: both calls already throw on failure; the user-visible behavior is unchanged.
- No mutation safety risk — all changes are read-path only, so `withAtomicFlush` rules do not apply.

## External References

None. No `--skill-url` arguments were supplied. All guidance taken from in-repo AGENTS.md files (root, `packages/core`, `packages/core/src/modules/customers`, `packages/core/src/modules/sales`) and from `BACKWARD_COMPATIBILITY.md` implicitly via the BC self-review step.

## Findings catalogue

Findings labelled "implemented" land in this PR (Steps 2.1 and 2.2). Everything else gets a GitHub issue in Step 3.1.

### A. (IMPLEMENTED — Step 2.1) Currencies + Exchange-rates list: fetch-all-then-slice anti-pattern

- **Files**:
  - `packages/core/src/modules/currencies/api/currencies/route.ts:175-177`
  - `packages/core/src/modules/currencies/api/exchange-rates/route.ts:172-174`
- **Problem**: `em.findAndCount(Entity, where, { orderBy })` is called without `limit`/`offset`, then `paged = all.slice(start, start + pageSize)` slices in JS. With thousands of rows this loads the entire table per request.
- **Why this is the strongest win**: trivial single-line edit, two routes, identical pattern, no semantic change (same `orderBy`, same `findAndCount` total, same response shape). Wire-format unchanged.
- **Fix**: push `limit: pageSize, offset: (page - 1) * pageSize` into the `findAndCount` options. Keep the JS structures so we still compute `totalPages`.
- **BC**: 100% — same `orderBy`, same response keys, same `total` semantics. Behavior is bit-identical when `total <= pageSize`.

### B. (IMPLEMENTED — Step 2.2) Customers people `afterList`: sequential decryption fetches

- **File**: `packages/core/src/modules/customers/api/people/route.ts:429-459`
- **Problem**: Two `findWithDecryption` calls run sequentially — `CustomerEntity` (line 429) and `CustomerPersonProfile` (line 453). Both depend only on the page item ids that are already known when `afterList` starts; they are independent of each other.
- **Fix**: wrap both calls in `Promise.all([...])`. Saves one DB round-trip per list page across the highest-traffic CRM endpoint.
- **BC**: 100% — same queries, same scope, same decryption. Only the await ordering changes.

### C. (ISSUE) Sales shipments `afterList`: DictionaryEntry fetch sequential after Promise.all

- **File**: `packages/core/src/modules/sales/api/shipments/route.ts:272`
- **Problem**: First `Promise.all([shipmentItems, shippingMethods])` runs in parallel. Then `em.find(SalesOrderLine, ...)` (line 211) depends on the result. But the subsequent `em.find(DictionaryEntry, ...)` (line 272) depends ONLY on `items` (the input page), not on the first round-trip — so it could join the first `Promise.all` and save one round-trip.
- **Fix**: extract `statusIds` synchronously from `items` before the first `Promise.all` and add a third independent fetch to that `Promise.all`.

### D. (ISSUE) QueryEngine custom-field joins built even when no cf field is requested

- **File**: `packages/shared/src/lib/query/engine.ts:254-256`
- **Problem**: `buildFilterableCustomFieldJoins(opts.customFieldSources)` is appended to the joins list unconditionally. If the caller did not request any `cf:*` field, did not filter on any `cf:*`, and did not pass `includeCustomFields: true`, the extra LEFT JOINs are dead weight on every query.
- **Fix**: gate the join construction on `hasCfRequest = includeCustomFields || fields.some(f => f.startsWith('cf:')) || filters.some(f => f.field.startsWith('cf:'))`.
- **BC**: result rows identical (LEFT JOIN of dead aggregates yields no extra rows); only the SQL plan changes.

### E. (ISSUE) Custom field definitions loaded twice on every decorated list

- **Files**:
  - `packages/shared/src/lib/query/engine.ts:517-592` (QueryEngine loads `custom_field_defs` for the entity)
  - `packages/shared/src/lib/crud/factory.ts:891-916` (factory calls `loadCustomFieldDefinitionIndex()` again for `decorateItemsWithCustomFields`)
- **Problem**: Same `custom_field_defs` rows are fetched twice per request.
- **Fix**: have the QueryEngine expose the resolved definitions in its result (additive, optional field), and let the factory reuse them instead of reloading. Internal-only contract addition; no public type change.

### F. (ISSUE) Sales shipments orderLines fetch could batch with another lookup

- **File**: `packages/core/src/modules/sales/api/shipments/route.ts:211-213`
- **Problem**: `em.find(SalesOrderLine, { id: { $in: orderLineIds } })` runs alone after the first Promise.all. If `statusIds` extraction is moved earlier (see C), the `orderLines` and `DictionaryEntry` fetches could also be `Promise.all`'d.
- **Fix**: after the first Promise.all returns, run a second small Promise.all combining orderLines and any other deferred-but-independent lookups.

### G. (ISSUE) Cache tag computation in `makeCrudRoute` loops can be flattened

- **File**: `packages/shared/src/lib/crud/factory.ts:1280-1293`
- **Problem**: Collection-tag loop runs inside the record-id loop on multi-org/multi-alias resources, recomputing the same tags repeatedly. They are then deduped via a `Set`, so correctness is fine, but we allocate N×M intermediate tags.
- **Fix**: precompute collection tags once before the record-id loop.
- **Impact**: micro — but trivially safe and free.

### H. (ISSUE) Audit `em.findAndCount` callers for additional fetch-all-then-slice bugs

- **Pattern**: `em.findAndCount(Entity, filter, { orderBy })` followed by JS slicing.
- **Candidates** (from grep over `packages/core/src/modules`):
  - `catalog/api/categories/route.ts:226-228` — categories hierarchy; needs careful inspection because the tree build may require the full set
  - `customers/api/activities/route.ts:181-183` — activities are unioned from multiple sources before paging; structurally requires JS slice but worth confirming
  - `customers/api/labels/route.ts:122-124` — labels list
  - `customers/api/assignable-staff/route.ts:208-210` — assignable staff list
  - `customers/api/deals/[id]/people/route.ts:136-138` — relational list
  - `customers/api/deals/[id]/companies/route.ts:157-159` — relational list
  - `customers/api/companies/[id]/people/route.ts:195-197` — relational list
  - `customers/api/people/[id]/companies/enriched/route.ts:374-376` — enriched relational list
  - `directory/api/tenants/route.ts:197-199` — tenants list
  - `directory/api/organizations/route.ts:376-378, 475-477` — organizations list
- **Fix**: per route, decide whether the JS slice is structurally required (multi-source merge/dedup) or just legacy. Push to DB where possible.

### I. (ISSUE) Customers activities decorator: two batched but un-parallelized lookups

- **File**: `packages/core/src/modules/customers/api/activities/route.ts:210-217` and `~360`
- **Problem**: After fetching activities, the decorator runs `em.find(User)` and `em.find(CustomerDeal)` (and a third `CustomerInteraction` lookup elsewhere). Each is batched via `$in`, but they are sequential.
- **Fix**: `Promise.all` the three lookups.

### J. (ISSUE) Auth roles ACL: two sequential `em.findOne` on Role + RoleAcl

- **File**: `packages/core/src/modules/auth/api/roles/acl/route.ts:67-96` (GET), `137-174` (PUT)
- **Problem**: ACL fetch and mutate paths run two sequential `findOne` calls. They could be a single join or a Promise.all.
- **Fix**: prefer Promise.all (lower risk than touching ORM relations). Impact is small — ACL changes are rare — but free latency win.

## Implementation Plan

### Phase 1 — Run setup

#### Step 1.1 — Seed run folder

- Create `.ai/runs/2026-05-27-crud-sql-query-optimizations/PLAN.md`, `HANDOFF.md`, `NOTIFY.md`.
- Commit + push.

### Phase 2 — Implement the two quick wins

#### Step 2.1 — Currencies + exchange-rates: push pagination to DB

- Edit `packages/core/src/modules/currencies/api/currencies/route.ts`: include `limit: pageSize, offset: (page - 1) * pageSize` in the `em.findAndCount` options. Remove the JS `.slice` since `findAndCount` now returns the page.
- Edit `packages/core/src/modules/currencies/api/exchange-rates/route.ts`: same change.
- Add unit tests under each module's `__tests__/` (or extend if existing): assert that `findAndCount` is called with `limit`/`offset` matching the requested page, that the returned `items` reflect the DB page directly, and that `total` and `totalPages` remain consistent.
- Single commit. Push.

#### Step 2.2 — Customers people afterList: parallelize entity + profile fetch

- Edit `packages/core/src/modules/customers/api/people/route.ts`: replace the sequential `await findWithDecryption(...CustomerEntity...)` + `await findWithDecryption(...CustomerPersonProfile...)` with a single `Promise.all([...])` returning `[entities, profiles]`. Keep all filter clauses, scope, and post-processing identical.
- Add a unit test in `packages/core/src/modules/customers/__tests__/` (if missing, create) verifying that both `findWithDecryption` calls are invoked concurrently (e.g., assert the slower mock resolves before sequential awaits would allow) and that the final mapped output matches the existing baseline.
- Single commit. Push.

### Phase 3 — File issues for the remainder

#### Step 3.1 — Open GitHub issues C, D, E, F, G, H, I, J

- Use `gh issue create` (or `gh api graphql`) to file one issue per remaining catalogued win. Each issue must include: problem statement, file/line citation, proposed BC-safe fix, BC assessment, and suggested labels (`refactor`, `performance`, and a relevant category if applicable).
- Track the created issue URLs back into `NOTIFY.md` and append a `## GitHub Issues` section at the bottom of this PLAN.md with the issue numbers and URLs (separate commit, fine; not a Step requirement but the table row covers it as one commit).

### Phase 4 — Final gate + PR

#### Step 4.1 — Final gate + PR summary

- Run focused validation (typecheck + targeted tests for currencies and customers modules; full gate per the workflow). Document in `final-gate-checks.md`.
- Open the PR against `develop`. Apply labels per AGENTS.md (`review` + `refactor` + `performance` if exists, `skip-qa` because this is server-side perf with no customer-facing UI change). Claim with the three-signal lock.
- Run `auto-review-pr` in autofix mode.
- Post the comprehensive summary comment.

## Verification strategy

- **Currencies + exchange-rates**: existing integration tests under `.ai/qa/tests/api/currencies` (if present) verify pagination round-trips; add a unit test that asserts `findAndCount` was called with `limit`/`offset` for a non-first page.
- **People afterList**: existing customers integration tests under `.ai/qa/tests/admin/customers` exercise the people list endpoint and will catch any regression in the returned shape.
- **Issue PRs**: out of scope for this run; only filing the issues.

## Out-of-scope reminders

- No changes to `engine.ts` or `factory.ts` in this PR — they all become Step-3 issues.
- No DS, UI, or response-shape changes.
- No new database migrations.
