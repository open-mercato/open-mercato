# Execution plan — query index partition race, vector store availability, stale ACL override

Status: complete
Engine: om-auto-create-pr (steps: 9, --loop: no)

## Goal

Make a fresh `yarn dev:greenfield` end with a fully indexed, warning-free instance: no
"Results may be incomplete" banner that only a manual reindex can clear, no per-record
`extension "vector" is not available` error storm, and no stale ACL-override warning on
every module registration.

## Scope

Three independent root causes surfaced by the same greenfield run.

1. **Query index rows lost by the partitioned force reindex.** `mercato init` runs
   `query_index reindex --force` in 5 concurrent partitions. Only partition 0 received
   `resetCoverage: true`, and it issued a scope-wide `DELETE FROM entity_indexes` while its
   siblings were already inserting — deleting whichever partition finished writing first,
   with nothing to rebuild it. Progress counts *attempted* writes, so every partition still
   reported `processed == total` and the run looked successful. Confirmed against the live
   greenfield database: the lost slice was always exactly one whole partition, always the one
   with the earliest `started_at` (`attachments:attachment` 11/12, `auth:user` 2/3,
   `catalog:catalog_product_price` 10/12, `entities:encryption_map` 33/37,
   `entities:custom_field_entity_config` 4/6). The manual reindex button repaired it only
   because the API path defaults to `partitionCount = 1`, so nothing raced.

2. **Vector search error storm without pgvector.** `VectorSearchStrategy.isAvailable()`
   checked only the embedding provider, never the store, so `SearchService` kept the strategy
   in the active set and called `ensureReady()` per record. That reached
   `CREATE EXTENSION IF NOT EXISTS vector` → `58P01 extension "vector" is not available`. The
   driver caught only `42501`, and its failure handler set `ready = null`, discarding the
   memo — so the full DDL block re-ran for every single write and delete, each surfacing as
   an `AggregateError` through `throwOnStrategyFailures`.

3. **Stale ACL override warning.** A live `acl.features: { 'example.manage': null }` override
   in `apps/mercato/src/modules.ts` names a feature the example module never declared, so
   `applyModuleOverridesToModules` skips it and warns on every registration (including each
   HMR pass). It also made `TC-AUTH-055-nulled-feature-policy` pass vacuously — it asserted a
   feature that never existed was denied.

## Non-goals

- Reworking `throwOnStrategyFailures` or the write-failure contract. Writes stay fail-loud
  for available strategies; the #3103 queue-retry behavior is deliberately preserved.
- Changing the reindex partitioning strategy, partition count, or job accounting model.
- Repairing the `create-mercato-app` template ESM-import test, which fails on `develop`
  independently of this work: `packages/create-app/template/scripts/dev-runtime.mjs` imports
  `./dev-memory-monitor.mjs`, a sibling that #4939 added under `apps/mercato/scripts/` and
  never mirrored into the template. `yarn template:sync` does not treat it as drift, so
  fixing it means extending the mirror list as well as copying the file — that belongs with
  the change that introduced it.
- Auto-heal for the runtime (non-CLI) path — the coverage-gap auto-reindex remains gated on
  custom-field entities. Out of scope here; the init-time repair pass covers the reported bug.

## Implementation Plan

### Phase 1 — Query index: stop the partitioned reindex losing rows

- Partition-scope the force purge in `reindexEntity` using the same predicate `purgeOrphans`
  already uses (`mod(abs(hashtext(entity_id::text)), N) = i`), and run it in **every**
  partition rather than only the coverage-resetting one — restricting it to partition 0 would
  otherwise leave the other slices' stale rows behind on a forced rebuild.
- Skip the scope-wide coverage zeroing during partitioned runs: `baseCounts` there holds only
  this partition's slice, so writing it as the scope's base count under-reports by the
  partition factor, and zeroing `indexed_count` discards deltas siblings already applied. The
  end-of-partition `refreshCoverageSnapshot` is authoritative.
- Make `refreshCoverageSnapshot` symmetric: never narrow the index side by a column the base
  table lacks. `organizations` has no `organization_id` (its index rows derive one from the
  record id) and `user_roles` has neither column, so the two sides counted different
  populations; the previous early-return froze the stale snapshot, leaving a permanent
  "out of sync" row for `directory:organization` that no reindex could clear.
- Add `verifyAndRepairIndexCoverage` to the reindex CLI, run after each entity's partitions
  complete on full runs. It recounts the scope from the database and rebuilds single-partition
  when still short, so init cannot finish leaving a gap for a human to notice and repair by
  hand. Two COUNT queries when the counts already agree.

### Phase 2 — Search: degrade instead of erroring when pgvector is missing

- Add a cached `pg_extension` / `pg_available_extensions` probe to the pgvector driver behind
  new optional `isHealthy()` / `getStatus()` members, with a 60s recheck so installing the
  extension recovers without a process restart. Treat the not-installable error class
  (`58P01`, `0A000`, `42704`) and the follow-on `type "vector" does not exist` as unavailable
  and short-circuit `ensureReady()`; keep probe failures optimistic so transient database
  problems retain their existing retry semantics.
- Consult the probe from `VectorSearchStrategy.isAvailable()` so `SearchService` drops the
  strategy before `ensureReady()` is ever called.
- Surface availability: `/api/search/settings/vector-store` returns `available` /
  `unavailableReason` per driver, and the Vector Search settings section renders a warning
  banner carrying the driver's reason.

### Phase 3 — RBAC: retire the stale ACL override warning

- Declare `example.manage` in the canonical example module as an explicit, ungated override
  probe, mirrored byte-exact into the create-app template.
- Guard it with a test asserting every live `entry.overrides.acl.features` key resolves to a
  declared feature.

## Risks

- The purge now runs in every partition instead of once. Each is a bounded `DELETE` over one
  hash slice and the CLI already purges the scope up front, so the extra statements are
  no-ops in the common path.
- `verifyAndRepairIndexCoverage` adds two COUNT queries per entity per full reindex. It only
  triggers a rebuild when a real gap remains, and it is skipped for single-partition-target
  invocations.
- `VectorDriver` gains optional members only, so third-party drivers and the qdrant/chromadb
  stubs stay source-compatible.

## Verification

- Repo `yarn typecheck`, `yarn lint`, `yarn agents:check-budget`.
- `@open-mercato/search` full suite; `query_index` suite.
- New regression tests, including two that were confirmed to fail against the pre-fix
  reindexer and pass after it.
- Full configured gate on the current `develop` head: `yarn build:packages`, `yarn generate`,
  `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`,
  `yarn test`, `yarn build:app`. Everything green except the pre-existing
  `create-mercato-app` template ESM-import failure described under Non-goals.

## Progress

PR: #4944

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Query index partition race

- [x] 1.1 Partition-scope the force purge and run it in every partition — c8303d3
- [x] 1.2 Stop scope-wide coverage zeroing during partitioned runs — c8303d3
- [x] 1.3 Make refreshCoverageSnapshot scope-symmetric and return its counts — c8303d3
- [x] 1.4 Add the post-reindex verify-and-repair pass to the CLI — c8303d3
- [x] 1.5 Add regression tests for the purge scoping and coverage symmetry — c8303d3

### Phase 2: Vector store availability

- [x] 2.1 Add the cached pgvector extension probe and short-circuit ensureReady — 9944485
- [x] 2.2 Consult the probe from the vector strategy and surface it in settings + i18n — 9944485
- [x] 2.3 Add availability regression tests — 9944485

### Phase 3: Stale ACL override

- [x] 3.1 Declare the example.manage override probe and guard it with a test — 2512235
