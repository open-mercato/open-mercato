# List Views at Scale — filter, search, count, and pagination architecture

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Created** | 2026-07-29 |
| **Builds on** | 2026-06-15-query-index-orm-backed-classification-hardening, 2026-05-24-crud-api-performance-quick-wins |
| **Related** | `query_index` module, `@open-mercato/shared/lib/query`, issues #2966 / #2968 / #2353 / #4552 |
| **Evidence** | Measured on a production deployment: 1,424,903 `sales_orders`, `entity_indexes` 30 GB / 4.16M rows, single org+tenant, Postgres 16. Code refs pinned to `develop@4efa7961c6` |

## TLDR

**Problem.** At 1.4M rows, every list-view mechanism in the platform degrades at once — and the
degradations share one root shape. Measured on a production deployment:

| Symptom | Measured | Root shape |
|---|---|---|
| Order-number search | **366 s** | `search_tokens` relevance semantics compiled to a correlated `EXISTS … GROUP BY … HAVING` — a SubPlan executed once per outer row, 1.38M times |
| Custom-field filtered list (527 matches, `LIMIT 50`) | **94 s** | no index on any `entity_indexes.doc` key (~44 s) + fixed base→index join order (~50 s) |
| Unfiltered `count(*)` | **170 s** | exact count over 1.4M rows with the list's joins |
| `does_not_contain`, `has_all_of` filters | returns **every row** | operators silently dropped server-side — a wrong answer, not a slow one |
| Search shorter than 3 chars | returns **every row** | zero token hashes produced; the filter is silently discarded |
| Coverage check picking the engine | **4.0 s** full scan, inline on the request thread | cardinality comparison over a 30 GB table |

None of this is a Postgres capacity problem — the same data answers an indexed predicate in
under a millisecond (28 ms measured for the search once the query shape allows an index). The
structural defect is that **the generic query builder is allowed to emit predicates against
shapes no index can serve, and the system answers slowly — or wrongly — instead of refusing.**

**Solution.** Adopt the five principles every mature ERP/commerce platform converges on
(Salesforce skinny tables, Magento flat/index tables, Odoo `store=True`, Shopify/Stripe on
counts, Salesforce governor limits), mapped onto the mechanisms Open Mercato already has:

1. **Finish the flat read model** — a declarative index contract that makes the already-declared
   `filterable`/`indexed` custom-field flags load-bearing: declared fields get real expression
   indexes on `entity_indexes.doc`, and a custom-field predicate is allowed to drive the scan.
2. **Split search from filter** — relevance semantics ("match at least N prefixes") never compile
   into the SQL predicate builder; they route to the search subsystem, which returns ids and
   facet counts.
3. **Abandon exact counts** — capped counts (#4552) and keyset pagination as the default contract.
4. **A query governor** — unknown operators, unindexed fields, and too-short search terms fail
   fast and visibly instead of silently degrading to "no predicate".
5. **Coverage is a metric, not a router** — stop letting a racy cardinality comparison choose
   the engine per-request.

Everything here is additive and per-workstream shippable; nothing proposes a rewrite, removing
the basic engine, or moving custom fields into real columns.

## Open Questions

- **Q1** — Should the index contract live in the module DSL alongside `CustomFieldDefinition`
  (making the existing `indexed`/`filterable` flags authoritative), or as a separate per-entity
  declaration? The flags are already declared, codegen-carried, checksummed, and persisted —
  only DDL emission is missing — which argues for the former.
- **Q2** — Expression indexes per declared field, a `jsonb_path_ops` GIN per field, or both?
  Btree expression indexes serve `eq`/range/`like`/sort; GIN serves only the `@>` containment
  arm. See Finding 3 for why one btree index alone changes nothing today.
- **Q3** — Migration story for the legacy bare-key doc spelling (`doc->>'x'` vs `doc->>'cf:x'`):
  rewrite existing docs, or accept the residual and split the SQL helper by doc source
  (Finding 2 shows the bare arm is dead on the `entity_indexes` branch)?
- **Q4** — When an entity declares an index contract, should the basic-engine fallback become an
  explicit per-entity capability rather than a per-request coverage race (Finding 5)? What is the
  contract for fresh installs where `entity_indexes` is empty?
- **Q5** — For search-active list requests, does the search subsystem return ids that feed the
  SQL path (one tenancy/RBAC enforcement point, second round trip), or become the row source?
- **Q6** — Is keyset pagination acceptable as the default list contract (it removes "jump to
  page N"), with `OFFSET` retained only under a bounded window?

## Problem Statement

The shared CRUD factory + query engine + `query_index` hybrid path serve every backend list view.
They work well at 10⁴–10⁵ rows. At 10⁶ the emergent behavior is:

1. **Wrong answers**: two advertised filter operators return the full table; a 1–2 character
   search returns the full table. Silent degradation, no error, no log, no UI signal.
2. **Unbounded latency**: predicates against unindexed JSONB keys, a join order that prevents
   the selective side from driving, and relevance semantics inside SQL each produce plans whose
   cost is a function of table size. With `statement_timeout = 0` these present as outages, not
   errors (a live request was observed holding a connection for 17m 53s).
3. **Per-request meta-work**: the coverage check that picks the engine full-scans a 30 GB table
   inline on the request thread when its snapshot is stale, and the read-path gap handler emits
   undeduplicated persistent full-reindex events (72 duplicates were found queued behind one
   staging gap).

These are not independent bugs. Each one is an instance of *the system answering a request it
cannot serve well instead of refusing it* — the defect class this spec exists to close.

### Measurements

Production deployment, 2026-07-28. Queries hand-written to match the engine's emitted shape
(`applyEntityIndexesJoin`, the `cf:` coalesce expressions), `EXPLAIN (ANALYZE, BUFFERS)`,
`LIMIT 50`. (Caveat: shapes reproduced from code reading, not captured engine output —
`pg_stat_statements` was not installed; worth capturing real statements before any PR quotes
these numbers.)

| Query | Time | Plan |
|---|---|---|
| Base coverage `count(*)` on `sales_orders` | 445 ms | parallel seq scan |
| Index coverage `count(*)` on `entity_indexes` | **4.0 s** | parallel seq scan of the whole 30 GB table; `entity_indexes_type_tenant_idx` not selective enough to be chosen |
| List, ~20 cf fields selected, sort on a base column | 1.18 s | nested loop via `entity_indexes_entity_idx` — fine; base sort spills ~90 MB external merge |
| List, **cf filter + cf sort** | **94.1 s** | parallel hash left join materializing all 1.4M index rows (width 897) into 256 spilling batches; cf predicate applied *after* the join |
| …same, join order forced (`entity_indexes` first) | **44.3 s** | seq scan + JSONB extraction over 4.16M rows |
| Order-number token search (7 matches) | **366 s** (196 s data + 170 s count) | correlated `EXISTS … GROUP BY … HAVING` SubPlan, executed 1.38M times; planner cost 1.02e9 |
| …rewritten as `IN (select entity_id …)` + `::uuid` cast | **28 ms / 147 ms** | identical rows returned |

The cf filter matches 527 of 1,424,903 rows. Returning 50 of them costs 94 seconds.

## Findings

All verified against `develop@4efa7961c6` unless noted.

### F1 — the hybrid path has no index on the values it stores

Every index on `entity_indexes` is scalar (`entity_type`, `entity_id`, `organization_id`,
`(entity_type, tenant_id)`, plus the unique constraint). There is **no GIN index on `doc` and no
expression index on any `doc` key**, and no code path that creates one. The only doc-related
indexes are six hand-written partials for `customers:customer_*` — and those are
`INCLUDE ("doc")` covering indexes for `entity_id` lookups, useless for a `doc->>'x'` predicate
or sort. Someone hit this wall for one entity, fixed it by hand, and moved on.

So filtering or sorting by a custom field on the hybrid path detoasts and JSON-extracts every
document of the entity type: 44 s with a favourable join order, 94 s with the emitted one.

### F2 — the emitted expression is not indexable as written

For `cf:x` the engine emits `coalesce(doc ->> 'cf:x', doc ->> 'x')`
(`query_index/lib/engine.ts:1218,1227`, multi-alias variant `:1232-1244`) to tolerate a legacy
bare-key spelling. Postgres matches expression indexes by shape, so neither `((doc->>'cf:x'))`
nor `((doc->>'x'))` can serve that predicate.

The bare arm is **dead on the `entity_indexes` branch**: all three writers into
`entity_indexes.doc` (`indexer.ts` `buildIndexDoc`, `document.ts` `buildIndexDocument`, the
customers CLI backfill) emit only `cf:<key>`. The coalesce was introduced for the
`custom_entities_storage` read path, where bare keys are written by design. The cheap fix is to
**split the helper by doc source** — keep the coalesce for `custom_entities_storage` callers,
emit a plain indexable `doc ->> 'cf:x'` for `entity_indexes` callers. ~10 lines, no data rewrite.
Residual exposure (rows written before 2025-10 carrying bare keys) is cheaply quantifiable per
key with `doc ? 'x' and not (doc ? 'cf:x')`.

### F3 — `eq`/`in` compile to an OR no single index can serve

`eq` does not emit a simple comparison (`engine.ts:1279-1294`): it ORs the text comparison with
an array-containment arm `${jsonExpr} @> '["v"]'::jsonb` to tolerate multi-valued fields. A btree
expression index covers only the first arm; Postgres cannot use an index for an `OR` unless it
can `BitmapOr` **both** arms. So with a btree index alone, the measured 94 s query (an `eq`)
would *still* seq-scan — this is the finding that would sink a naive "just add an expression
index" PoC. Fix: a declared, single-valued field has no reason to emit the containment arm;
drop it for non-`multi` fields (or pair a GIN on the extracted expression for `multi` ones).
`like`/`ilike` and sort use only the text expression — single-index wins with no OR problem.

### F4 — the join order prevents a selective cf predicate from ever driving

`applyEntityIndexesJoin` (`engine.ts:577`, applied unconditionally at `:764`) always joins
base → index with a `LEFT JOIN`. The planner therefore materializes the entire index side into a
spilling hash and applies the cf filter afterwards. Measured cost of the join order alone:
**~50 s** (94.1 → 44.3 when forced the other way). With an index contract in place (F1–F3), a
query with a cf predicate should let the index side drive — `INNER JOIN` or a semi-join
pre-filter, base table reached by PK. An index nothing can reach is worth nothing.

### F5 — the coverage check that picks the engine is unsound

`coverage.ts:440-441` runs two `count(*)` queries with no transaction and no shared snapshot,
and `gap != 0` in **either direction** flips the engine per-request. Consequences: a row landing
between the two counts on a live write feed reads as a gap even with a perfectly caught-up
indexer (`gap == 0` is not a reachable steady state); offsetting errors (5 missing + 5 stale)
read as healthy; the incremental delta path clamps at 0 so drift only reconciles on full refresh.
On top of that, the count itself is a 4.0 s full scan run inline on the request thread when the
snapshot is stale, with herding at TTL expiry — pure overhead on requests that were going to hit
the index anyway. Related: the read-path gap handler fire-and-forgets a *persistent*
`query_index.reindex` event with no dedup key and no `updated_at >` incremental predicate, so
each detection queues another full rebuild (72 duplicates observed).

### F6 — two filter operators compile to no predicate at all

The advanced-filter UI offers `does_not_contain` and `has_all_of`; they compile to `$not` /
`$contains` (`shared/lib/query/advanced-filter.ts:197,264`) — which fail the `VALID_OPS` test in
`shared/lib/query/join-utils.ts:10,72`, so nothing is pushed and **no `WHERE` is emitted**. No
throw, no log. Both engines share this helper. The filter silently returns every row. No test
covers either operator. This is the smallest, least arguable item and it returns wrong answers
rather than late ones — it should lead.

### F7 — range operators on custom fields are uncast string comparisons

`gt`/`gte`/`lt`/`lte` are emitted against the jsonb `->>` text expression with no cast to the
declared field type. A date range on a `cf.text` field is a lexicographic comparison — correct
only while values happen to be zero-padded ISO strings; `'9' > '10'` for numeric-valued text
fields.

### F8 — the filterable surface is unbounded and the declaring flags are decorative

`CustomFieldDefinition` already declares `filterable` and `indexed`
(`shared/modules/entities.ts:49,52`); both are carried through codegen, included in the install
checksum, and persisted into `custom_field_defs.configJson`. But server-side, **nothing reads
them**: list schemas are `.passthrough()`, the cf-filter builder gates on `isActive`/tenant only,
and `indexed` has exactly one reference in the repo — its own declaration. Meanwhile the
advanced-filter builder auto-offers every cf definition. Net: an unbounded accepted filter
surface, 0 indexed fields, 2 operators that return everything, and an unindexed predicate that
presents as an unexplained 94-second page.

### F9 — relevance semantics compiled into SQL

The `search_tokens` path compiles "match at least N of these prefix hashes" into
`GROUP BY … HAVING count(distinct token_hash) >= N` (`engine.ts:1186,1368`) inside an `EXISTS`.
The `HAVING` prevents Postgres from flattening it into a semi-join — that is the whole 366 s.
Two adjacent defects: terms shorter than the minimum token length produce zero hashes and the
filter is **silently dropped** (full table returned); broad terms send every prefix ≥3 and
require all of them, so a 4-character year like `2022` intersects millions of token rows and
never completes. A selective-term rewrite (`IN (select …)`) is verified at 28 ms, but the
layering point stands: relevance ranking does not belong in the SQL predicate builder at all —
the search subsystem (Meilisearch driver) is where it lives, and it returns facet counts for
every status bucket in one request as a bonus.

## Proposed Solution

Five principles → six workstreams. Each ships independently; ordered by certainty × value.

### WS0 — operator correctness (lead with this)

- `does_not_contain` / `has_all_of` compile to real predicates (`$not`/`$contains` handling in
  `join-utils.ts`) — or unknown ops **throw**, never drop (F6).
- Range operators cast to the declared field type (F7).
- Sub-minimum search terms return a visible validation error, never a silently unfiltered list (F9).

General principle to land alongside: *an unrecognized operator or unsupported field must never
silently degrade to "no predicate".*

### WS1 — declarative index contract

Make `filterable`/`indexed` load-bearing: at `mercato entities install` time (the
`install-from-ce.ts` seam, which already aggregates all module declarations and is
checksum-gated on exactly these flags), emit the matching expression indexes on `entity_indexes`
— `CREATE INDEX CONCURRENTLY`, partial on `entity_type`, off an autocommit connection (in-repo
precedent: the pgvector driver's runtime DDL). Replaces the hand-written `customers:customer_*`
migration with something uniform across all entities.

Prerequisites, both cheap (F2, F3): split the coalesce helper by doc source; stop emitting the
containment arm for non-`multi` fields.

Cardinality note, so it isn't relitigated: for **filters** this is N indexes, not 2^N —
`BitmapAnd` combines single-key indexes, and in practice one predicate carries the selectivity.
**Sort** is the genuine composite constraint (`filter(A) + sort(B)` wants `(A,B)`), and only
bites under a non-selective filter; the practical shape is a composite for the default sort plus
single-key indexes for the declared filterable set.

Undeclared fields keep working at today's cost (monotonic — nothing regresses), but emit a
metric/warning ("cf predicate on unindexed field") instead of presenting as a mystery hang.
Expected win from the measurements: a partial expression index turns the 4.16M-row scan into a
527-row lookup, removing ~44 s of the 94 s.

### WS2 — let a declared predicate drive the scan

When a query has a cf predicate on a contract-declared field, the index side becomes the driving
table (inner/semi-join, base reached by PK) instead of the unconditional base→index `LEFT JOIN`
(F4). Removes the other ~50 s. WS1 and WS2 only pay together.

### WS3 — coverage is a metric, not a router

- The two counts become one consistent statement (or a shared snapshot).
- `gap != 0` stops being a per-request routing decision; it becomes a metric plus a
  sustained-percentage alert. An entity with a declared contract never silently falls back —
  fallback becomes an explicit per-entity capability (Q4).
- The count becomes cheap (index-only-scannable) or moves off the request thread.
- The auto-reindex event gets a dedup key and an incremental `updated_at >` predicate.

### WS4 — search ≠ filter

List-view relevance search routes to the search subsystem (Meilisearch driver) which returns
**ids + facet counts**; rows always come from the SQL path so tenancy scoping, soft deletes, and
field-level access keep exactly one enforcement point (Q5). `search_tokens` retires from the SQL
predicate path. Interim triage for installs on the tokens path: the `IN (…)` rewrite plus
longest-prefix-only token selection (verified 366 s → 28 ms for selective terms).

### WS5 — counts and pagination

Capped counts (#4552) as the platform default, `totalIsCapped` surfaced through the shared list
UI, and keyset pagination replacing `OFFSET` on the default list contract (Q6). Note a cap does
not protect the selective-search case (7 matches never reach the cap) — the count there must
ride the same indexed shape as the data query.

## Phasing

1. **Phase 1 — correctness (WS0).** Small, provable, testable, independent. Wrong answers first.
2. **Phase 2 — contract + join order (WS1+WS2).** One RFC-shaped change: the module DSL and the
   migration/DDL story are owned here, which is why this is a spec and not a drive-by PR.
3. **Phase 3 — coverage soundness (WS3).** Independent of Phase 2; kills the per-request
   full-scan and the reindex storms.
4. **Phase 4 — search split (WS4).** Independent of Phases 2–3 (that independence *is* P2).
5. **Phase 5 — counts/pagination (WS5).** Rides on #4552.

## What this spec explicitly does not propose

- **A rewrite, or removing `BasicQueryEngine`.** Fresh installs and entities without contracts
  legitimately need it; the proposal is that fallback becomes declared, not raced.
- **Moving custom fields into real columns.** `entity_indexes` is exactly the flat-read-model
  mechanism mature platforms use (Salesforce skinny tables, Magento flat tables); it is simply
  unfinished. Per-deployment column workarounds fix one entity and leave the mechanism broken.
- **A search-vendor mandate.** The principle is the split; the Meilisearch driver is simply the
  one that already exists.

## Prior art

- **#2966** (closed) — added scalar hot-path indexes on `entity_indexes`, explicitly evaluated a
  composite, stopped at scalar columns; nobody looked inside `doc`. Also sets the evidence bar
  this spec follows: *optional and EXPLAIN-verified first, not shipped blindly*.
- **#2968 / #2353** — coverage snapshot refresh mechanics; neither questions the soundness of
  the comparison itself (F5).
- **#4552** — list count cap (WS5).
- No open or closed issue mentions expression/GIN indexes on `doc` keys, the coalesce shape, the
  containment-arm OR, or the join order. **F1–F4 are novel here.**

## Changelog

| Date | Change |
|------|--------|
| 2026-07-29 | Initial draft — findings and measurements from a 1.4M-row production deployment, verified against `develop@4efa7961c6` |
