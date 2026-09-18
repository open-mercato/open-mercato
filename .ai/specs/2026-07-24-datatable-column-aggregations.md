# Filter-Equivalent CRUD Aggregation Service

> **Status**: Draft — ready for implementation
> **Scope**: OSS (`packages/shared`, `packages/core`)
> **Created**: 2026-07-24
> **Revised**: 2026-08-01
> **First consumer**: [`2026-08-01-sales-orders-aggregation-consumer.md`](./2026-08-01-sales-orders-aggregation-consumer.md)

## TLDR

Add one cohesive backend capability: an optional, bounded, aggregate-only Query Engine path that lets an opted-in CRUD list endpoint return exact summaries over the same scoped and filtered result set as its normal list query. Unsupported engines and storage paths fail closed; decimal and count values remain strings through the public boundary; joins cannot multiply base rows; and every aggregate statement has field, group, and database-time limits.

This service is dormant until a route declares its public aggregate fields. Native table footer presentation, the Sales Orders consumer, and persisted per-column controls are separate linked specifications.

## Overview

This specification defines one backend infrastructure capability: compute bounded aggregates over the same scoped, filter-equivalent relation as an existing CRUD list without hydrating list rows. It covers the Query Engine contract, Basic and Hybrid execution, route opt-in, OpenAPI/error behavior, precision, performance evidence, and compatibility. It introduces no UI and opts in no production business route by itself.

## Resolved assumptions

| Question | Decision | Rationale |
|---|---|---|
| Scope | Keep only Query Engine execution plus opt-in CRUD/OpenAPI exposure | The service is independently deployable and useful to more than one UI/route consumer |
| Engine compatibility | Add an optional capability and fail with 501 when an opted-in route's engine lacks it | Existing third-party engines compile; a requested summary is never silently empty |
| Scalar representation | Canonical strings for decimal and integer results | Avoids IEEE-754 precision loss for PostgreSQL `numeric` and `bigint` |
| Selector ownership | Route declarations map public fields to physical selectors | Request text cannot select arbitrary columns or grouping expressions |
| Hook behavior | Reuse before-query shape modifications, exclude row-result hooks/enrichers | Aggregates must match filtering while avoiding row-only work and ambiguous aggregate mutations |
| Custom document storage | Fail closed in the first release | Correct aggregate semantics for document/custom storage require a separate design |

No decision weakens tenant isolation, security, or backward compatibility.

## Problem Statement

CRUD list endpoints can return only paged rows and a record count. Consumers that need totals across the entire filtered result set cannot sum the current page, and they should not reimplement tenant, organization, soft-delete, custom-field, search-token, extension, and join semantics in a second endpoint.

Adding aggregation to the existing `query()` path would also be unsafe: that path performs page/count selection, hydration, decryption, decoration, and row enrichers that an aggregate request neither needs nor can interpret. A dedicated capability must reuse the query shape while skipping row-result work.

The design must prevent:

1. cross-tenant or cross-organization aggregation;
2. join multiplication inflating `sum` and `avg`;
3. arbitrary selector access through request text;
4. unsupported engines returning a plausible empty success;
5. numeric precision loss;
6. unbounded group cardinality or database execution time;
7. divergence between Basic and Hybrid list filters.

## Research and alternatives

- PostgreSQL recommends `numeric` for exact calculations; results therefore stay decimal strings rather than JavaScript numbers ([PostgreSQL numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html)).
- PostgreSQL supports transaction-local `statement_timeout`, which bounds work without changing process-wide configuration ([PostgreSQL client defaults](https://www.postgresql.org/docs/current/runtime-config-client.html)).
- The dashboards aggregation API was rejected because its filter DSL is not the CRUD list filter/query shape.
- `SUM(DISTINCT value)` was rejected because separate records can legitimately have equal values; deduplication must use the base record id.
- An overloaded `QueryEngine.query()` response was rejected because aggregate-only execution has different result and lifecycle contracts.

## Goals

- `sum`, `avg`, `min`, `max`, and `count` over route-allow-listed scalar base fields.
- Grouping declared per field, with exact string results for every group and count.
- Identical tenant/organization/deleted scope, filter, search-token, custom-field, join, and extension-before-query semantics to the visible list.
- No page/count query, row hydration, decryption, decoration, list enrichment, or row-result event work.
- Explicit engine/storage/limit/timeout errors.
- Hard route-configured limits and database-side timeout.
- Additive CRUD/OpenAPI contracts with unchanged normal list responses.

## Non-goals

- UI rendering, fetch lifecycle, formatting, table controls, or Perspective persistence.
- FX conversion, pivots, grouped body rows, formulas, caching, or role defaults.
- Custom-field values as aggregate selectors, encrypted aggregate selectors, JSON/JSONB selectors, or custom-entity document storage.
- Aggregate-result hooks or enrichers.

## Proposed Solution

Add an optional `QueryEngine.aggregate` method, implement it against the existing Basic/Hybrid query-shape builders, and let `makeCrudRoute` expose a summary response only for route-declared public fields/functions. Normalize scalars to canonical strings, deduplicate multiplying joins by base id, restrict count to the ungrouped base primary key, and bound work with declaration limits plus a database statement timeout.

## Architecture

The route parses and resolves public summary tokens, then calls the DI-resolved Query Engine capability. Basic and Hybrid engines each construct the same scoped/filter relation used by their normal list paths, but aggregate without pagination, row hydration, decryption, or enrichment. The route maps normalized engine values into the alternate summary envelope. A missing capability or unsupported storage path fails closed; there is no cross-module ORM coupling, worker, event, or cache dependency.

## Data Models

No persisted entity, column, relation, migration, or snapshot changes are introduced. The only data models are additive exported TypeScript contracts for aggregate requests/results and additive route declaration metadata. Values are canonical strings at the service boundary; selectors are trusted declaration-time metadata, never client-provided database identifiers.

## API Contracts

Existing list URLs and ordinary paged envelopes remain unchanged. An opted-in GET list route accepts the documented `summary` query grammar and returns the alternate `{ summary: { values } }` envelope or the standard error shapes defined below. Undeclared routes keep their current parsing, response, and OpenAPI behavior. The detailed request, response, errors, and OpenAPI contract are specified in “Opt-in CRUD summary mode”, “Error contract”, and “OpenAPI contract”.

## Public Query Engine contract

Add exported types and one optional method:

```ts
type AggregateFn = 'sum' | 'avg' | 'min' | 'max' | 'count'
type AggregateScalar = 'decimal' | 'integer'

type AggregateField = {
  key: string
  selector: string
  fn: AggregateFn
  scalar: AggregateScalar
  groupBy?: { key: string; selector: string }
}

type AggregateQueryOptions = Omit<QueryOptions, 'fields' | 'sort' | 'page'> & {
  aggregate: {
    fields: AggregateField[]
    maxGroupsPerField: number
    statementTimeoutMs: number
  }
}

type AggregateValue = {
  field: string
  fn: AggregateFn
  groupBy: string | null
  groups: Array<{ key: string | null; value: string }>
}

type AggregateResult = { values: AggregateValue[] }

interface QueryEngine {
  query<T = unknown>(entity: EntityId, opts?: QueryOptions): Promise<QueryResult<T>>
  aggregate?(entity: EntityId, opts: AggregateQueryOptions): Promise<AggregateResult>
}
```

All selectors originate in trusted route declarations. Engines resolve them against registered entity metadata and reject unknown, encrypted, JSON/JSONB, or incompatible selector types. In the first release, `count` is allowed only for the registered base primary-key selector, is always ungrouped, and means the decimal-string cardinality of distinct scoped base records. `count` declarations for another selector or with `groupBy` fail route registration/generation. Grouped non-count fields must be scalar base columns. Result ordering follows request field order and group keys sort by a deterministic null-last database ordering.

## BasicQueryEngine execution

`BasicQueryEngine.aggregate` factors and reuses the same scope/filter/join builder used by `query`, after the `*.querying` extension pipeline can block or modify filters. It deliberately skips page/count selection, plaintext sort/decryption, item hydration, decoration, query enrichers, `afterList`, and `*.queried`, because those contracts operate on row results.

Fields sharing one group selector share one SQL statement; ungrouped fields share another. When `includeExtensions`, explicit `joins`, or `customFieldSources` can multiply base rows, the engine first projects exactly one row per base id with the required selectors/group key and aggregates that relation. `sum`, `avg`, `min`, and `max` operate on the deduplicated base relation; `count` always uses the distinct base id.

Empty-result normalization is exact: ungrouped or grouped `sum`/`avg`/`min`/`max` returns `groups: []` rather than a nullable or fabricated scalar, while the required ungrouped base-id `count` returns `groups: [{ key: null, value: "0" }]`. Every non-empty scalar remains a canonical decimal string.

Each statement runs in a short transaction with `SET LOCAL statement_timeout` using the internal route-configured bound. Identifiers use Kysely references and registered metadata; values remain parameterized. PostgreSQL SQLSTATE `57014` maps only this operation to `summary_timeout`.

## HybridQueryEngine execution

`HybridQueryEngine.aggregate` implements the Hybrid query shape instead of forwarding blindly to Basic. It reuses Hybrid's organization/tenant/deleted scope, search-token predicates and ciphertext fallback, custom-field sources, extension joins, explicit joins, and `*.querying` modifications.

Its coverage decisions match `query`:

- missing/partial coverage delegates to `fallback.aggregate` only after the same fallback decision the list makes;
- an absent fallback aggregate capability fails closed;
- `forceCustomEntityStorage` and entities classified to document storage return an unsupported-storage error;
- search-token, custom-field, joined-source, extension-modified, missing-base, and partial-coverage branches have list/aggregate parity tests.

Aggregate results do not pass through row enrichers. A future aggregate-specific hook is a separate additive contract.

## Opt-in CRUD summary mode

`makeCrudRoute` gains an optional route-owned declaration:

```ts
summary: {
  maxFields: 3,
  maxDistinctGroupings: 2,
  maxGroupsPerField: 20,
  statementTimeoutMs: 1500,
  fields: {
    amount: {
      selector: 'amount',
      functions: ['sum', 'avg'],
      scalar: 'decimal',
      groupBy: { publicField: 'currencyCode', selector: 'currency_code' },
    },
    id: { selector: 'id', functions: ['count'], scalar: 'integer' },
  },
}
```

The client sends public fields/functions only:

```text
GET /api/example/items?<same filters>&summary=amount:sum,id:count
```

The route parses with zod, caps syntax entries before engine work, resolves each public field/function through the declaration, checks `queryEngine.aggregate`, and invokes aggregate-only execution. It returns:

```json
{
  "summary": {
    "values": [
      {
        "field": "amount",
        "fn": "sum",
        "groupBy": "currencyCode",
        "groups": [
          { "key": "EUR", "value": "12340.5000" },
          { "key": "USD", "value": "4100.0000" }
        ]
      },
      {
        "field": "id",
        "fn": "count",
        "groupBy": null,
        "groups": [{ "key": null, "value": "37" }]
      }
    ]
  }
}
```

Normal list responses remain unchanged. Summary responses never include `items`, `page`, or `total`. The normal route guards, tenant id, organization visibility, soft-delete constraints, and filter parsing apply before the aggregate capability.

## Error contract

| HTTP | Code | Condition |
|---|---|---|
| 400 | `summary_invalid` | malformed syntax, duplicate key, disallowed field/function, or too many fields/groupings |
| 422 | `summary_storage_unsupported` | custom/document storage or unsupported selector type |
| 422 | `summary_group_limit_exceeded` | result exceeds the route group cap; no partial values returned |
| 501 | `summary_engine_unsupported` | installed Query Engine lacks `aggregate` |
| 503 | `summary_timeout` | aggregate statement is cancelled by its configured timeout |

Errors use the standard CRUD error shape and never expose selectors, SQL, or scope values.

## OpenAPI contract

- Extend the shared CRUD OpenAPI factory with an opt-in `summary` query and alternate success envelope.
- Document the route-declared public field/function grammar without exposing physical selectors.
- Include the 400/422/501/503 response schemas only on opted-in routes.
- Preserve the ordinary paged response schema on every route.
- Add schema/snapshot tests proving undeclared routes and their generated specifications are unchanged.

## Limits, performance, and operations

Framework maxima prevent a route from weakening safety beyond:

- 5 requested fields;
- 3 distinct grouping selectors;
- 50 groups per field;
- 5,000 ms statement timeout.

The default/example declaration uses 3 fields, 2 groupings, 20 groups, and 1,500 ms. Values exceeding caps fail before/without returning partial totals.

The framework does not add a universal index or cache. Each consumer must specify evidence-driven indexes for its entity/filter patterns. Summary caching is deferred because invalidation depends on the route's entity and joins. Structured logs include entity id, public requested field/function set, elapsed time, and stable error code; they never include SQL, raw filters, customer data, or result values.

The implementation PR must benchmark the generic path against a representative one-million-row scoped fixture and show:

- aggregate-only execution performs no row hydration/decryption/enrichment calls;
- timeout cancellation returns within the configured bound plus 250 ms application overhead;
- joining a multi-valued source contributes each base id once;
- normal list-query p50 changes by less than 2% because aggregate work is never invoked there.

## Security and edge cases

- Scope identifiers always come from authenticated request context, never query text.
- Two equal-valued base records remain two contributions.
- A record matching several tags/custom values contributes once.
- Null group keys are represented as `null`, not a magic string.
- Empty ungrouped `count` returns `"0"`; grouped aggregates with no groups return an empty group array.
- Driver values arriving as strings, bigint, or wrappers normalize to a canonical string or fail closed; tests cover values beyond `Number.MAX_SAFE_INTEGER`.
- A third-party engine without `aggregate` still compiles and serves ordinary lists, but an opted-in summary returns 501.
- More groups than allowed returns 422 with no partial data.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Join multiplication overstates totals | High | Query correctness | base-id deduplicated relation and multi-source regressions | Low: new join shapes require parity tests |
| Hybrid/list filters diverge | High | Search/custom-field consumers | Hybrid-native implementation and branch parity matrix | Medium: future Hybrid branches must extend the matrix |
| Monetary precision is lost | High | API consumers | canonical strings end to end; no number conversion in the service | Low: consumer formatting remains separately testable |
| Expensive scan harms database | High | Database capacity/latency | field/group caps, route timeout, framework ceiling, consumer index/evidence gate | Medium: consumer-specific filters still require measured indexes |
| Unsupported engine appears successful | High | Third-party engines | explicit optional capability check and 501 | Low: callers must surface the explicit failure |
| Public input reaches physical selectors | High | Security/data access | route-owned allow list and metadata resolution | Low: declaration review remains required |

Rollback removes route `summary` declarations. The optional engine method and additive shared types can remain harmlessly for compatibility; no data rollback exists.

## Test plan

### Shared Query Engine

- Basic grouped/ungrouped `sum`/`avg`/`min`/`max` plus ungrouped base-id `count`, exact strings, empty set, scope/deleted behavior.
- Registration rejects count on a non-primary selector or with grouping; base-id count is distinct under multiplying joins.
- Empty ungrouped/grouped non-count aggregates normalize to `groups: []`, while empty base-id count is one null-key group with value `"0"`.
- Spies prove no page/count select, sort/decrypt, hydration, decoration, row enrichment, `afterList`, or `*.queried` work.
- Multi-valued custom fields, extensions, explicit joins, and tag-shaped joins preserve one contribution per base id.
- Hybrid search-token, ciphertext fallback, custom-field, joined source, extension-modified, missing-base, partial-coverage, and custom-document fail-closed behavior.
- Max fields/groupings/groups, timeout/SQLSTATE mapping, absent capability, unsafe selector, driver normalization, and values beyond IEEE-754 exact range.

### CRUD/OpenAPI

- Public-to-physical mapping for aggregate and group fields.
- Summary success envelope and unchanged normal list envelope.
- 400/422/501/503 codes and no selector/SQL leakage.
- Scope/RBAC/filter parity and no item/count/decryption/enrichment calls.
- Opted-in and undeclared-route OpenAPI snapshots.

### Integration

Create self-contained base records, cross-organization records, and a multi-valued join fixture through APIs/setup; compare the normal list's full filtered id set with known aggregate results, verify scope isolation and join deduplication, then clean up in `finally`. Do not rely on seeded/demo data.

## Phasing and implementation plan

This single capability may land in one infrastructure PR:

1. Add aggregate types, optional `QueryEngine.aggregate`, canonical scalar normalization, and stable errors.
2. Refactor Basic query-shape construction for reuse and implement deduplicated aggregate-only execution/timeout.
3. Implement Hybrid-native aggregate execution and coverage/fallback parity.
4. Add the `makeCrudRoute` declaration/parser/limits, fail-closed capability check, response mapping, and OpenAPI support.
5. Add unit, schema, integration, performance, and backward-compatibility evidence; run the full configured gate.

The service is complete and testable without a production route opting in. The separate Orders consumer is the first adoption, not part of this capability.

## Migration & Backward Compatibility

| Surface | Change | Classification | Compatibility behavior |
|---|---|---|---|
| `QueryEngine` | optional `aggregate?` method | Additive | third-party implementations compile; ordinary lists unchanged |
| Aggregate/result types | new exports | Additive | no existing type is narrowed |
| `makeCrudRoute` options | optional `summary` declaration | Additive | undeclared routes behave exactly as before |
| CRUD query/response | optional mode on declared routes | Additive | normal paged response remains present and unchanged |

No FROZEN id/path/route is renamed or removed. No database change, deprecation bridge, or `UPGRADE_NOTES.md` entry is required by the service itself.

## Frontend Architecture Contract

Not applicable: this specification changes no `.tsx`, `packages/ui`, component, provider, browser dependency, or client boundary. UI ownership and evidence are specified only by consumer documents.

## Final Compliance Report — 2026-08-01

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Evidence |
|---|---|---|---|
| root `AGENTS.md` | Tenant/organization scope must not be bypassed | Compliant | Basic/Hybrid reuse the normal scoped query shape; scope parity is tested |
| root + `packages/shared/AGENTS.md` | Validate input and parameterize queries | Compliant | zod parses public tokens; physical selectors come only from declarations; values remain parameterized |
| `packages/core/AGENTS.md` — API Routes | Extend CRUD through `makeCrudRoute` and document OpenAPI | Compliant | opt-in declaration, alternate envelope, errors, and snapshots are explicit |
| `packages/core/AGENTS.md` — Encryption | Do not expose encrypted/unsafe selectors | Compliant | encrypted/JSON/incompatible selectors reject; no decryption or row exposure occurs |
| `BACKWARD_COMPATIBILITY.md` | Stable surfaces change additively | Compliant | optional engine method/declaration; ordinary responses and undeclared routes remain unchanged |
| `.ai/specs/AGENTS.md` | One capability with complete risks/tests/compliance | Compliant | backend service is independently deployable; risk and validation evidence are enumerated |
| UI/design-system guides | UI rules | N/A | no UI-rendering file or client boundary changes |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | canonical string types match the summary envelope and exact empty semantics |
| API contracts match UI/UX section | N/A | UI is intentionally delegated to linked consumer specs |
| Risks cover all operations | Pass | correctness, precision, scope, capacity, capability, and selector risks are covered |
| Commands defined for all mutations | N/A | summary execution is read-only |
| Cache strategy covers read APIs | Pass | no cache in the first release; hard timeout/caps bound cold execution |
| Linked specs conflict with this contract | Pass | footer, Orders, and controls consume the additive service without changing it |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: approved and ready for implementation.**

## Changelog

| Date | Change |
|---|---|
| 2026-07-24 | Initial combined footer, aggregate, and control proposal. |
| 2026-07-28 | Added join deduplication, grouping, compatibility, and stale-response considerations. |
| 2026-08-01 | Addressed review by isolating the generic backend service; added a fail-closed optional engine method, Basic/Hybrid parity, exact strings, route-owned selectors, OpenAPI/error contracts, hard limits, database timeout, measurable performance gates, and complete compatibility coverage. Footer presentation, Orders adoption, and persisted controls moved to linked specs. |

### Review — 2026-08-01

- **Reviewer**: Codex fresh-context review
- **Security**: Passed
- **Performance**: Passed with mandatory consumer-specific EXPLAIN/index evidence
- **Cache**: Passed; intentionally deferred with no-cache behavior explicit
- **Commands**: N/A; read-only capability
- **Risks**: Passed
- **Verdict**: Approved
