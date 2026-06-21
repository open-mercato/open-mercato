# Retention, Partitioning & ≥6yr Archival — Design Analysis

> **Category:** Build · **Gap:** GAP-19 · **Priority:** P3
> **Related:** trace spec (`2026-06-19-agent-trace-eval-capture.md`), compliance spec (`2026-06-19-agent-decision-transparency-and-ai-act.md`), conventions (`2026-06-19-agent-orchestrator-conventions.md`), `packages/scheduler`, `packages/queue`, `packages/storage-s3`
> **Status:** Draft · **Created:** 2026-06-19

## 1. Gap Statement

The trace spec **scopes** the constraint — "partition `agent_spans` by `created_at` and tier retention (hot N
days → archive)", `AgentToolCall` follows the same tiering, and the high-value/low-volume audit tiers
(`AgentEvalResult` / `AgentCorrection` / `AgentEvalCase`, plus the compliance spec's `AgentDecisionRecord` /
`AgentGuardrailCheck` / `AgentTaskEvent`) are append-only and retained **≥6 years** for EU AI Act Art. 12. But
the *machinery* is net-new and unbuilt: there is no partitioned-table DDL, no partition-rotation job, no
archival worker, and no tiered-retention policy table. MikroORM `db:generate` emits a plain `CREATE TABLE`, not
a `PARTITION BY RANGE` parent; nothing in the repo creates future monthly partitions or detaches/exports old
ones. The only retention precedent is `integrations/workers/log-pruner.ts` — a queue worker that hard-deletes
rows older than N days — which is the *wrong* primitive here: append-only audit rows must never be deleted, and
hard-deleting 9M+ span rows row-by-row is operationally hostile.

GAP-19 designs the missing data-lifecycle plane for `agent_orchestrator`: a **native Postgres declarative
partition scheme** for the two high-volume append-only logs, a **`packages/scheduler`-driven maintenance job**
that pre-creates future partitions and detaches/archives expired ones, a **`packages/queue` archival worker**
that exports detached cold partitions to `storage-s3` (and tombstones them in the hot DB), and a
**tiered-retention policy table** that encodes per-entity hot-window / archive / immutability rules so the
≥6yr audit tiers are *never* pruned while the high-volume telemetry tiers tier to cheap cold storage.

## 2. Architectural Drivers

- **Write & read perf at 9M+ rows/yr.** `agent_spans` reaches ~9M rows/yr (and `agent_tool_calls` tracks it);
  a single monolithic table degrades insert throughput (index bloat, autovacuum pressure) and cockpit query
  latency (the trace inspector's ≤5s p95 acceptance target). Range partitioning by `created_at` keeps the hot
  window small and lets the planner prune to the relevant month(s).
- **≥6yr immutability for audit tiers.** AI Act Art. 12 requires `AgentEvalResult` / `AgentCorrection` /
  `AgentEvalCase` / `AgentDecisionRecord` / `AgentGuardrailCheck` / `AgentTaskEvent` to survive ≥6 years,
  append-only and queryable. These are **low-volume** — they must stay in the hot DB, immutable, never pruned;
  retention machinery must *protect* them, not tier them out.
- **Storage cost.** Keeping 6+ years of 9M-rows/yr spans + their jsonb payloads in primary Postgres is
  expensive and pointless — cold spans are read rarely (forensic replay, an incident). Detaching old partitions
  and exporting them to `storage-s3` (object storage) is an order of magnitude cheaper per GB.
- **Hot vs cold query latency.** The cockpit reads recent runs constantly; cold forensic reads are rare and
  latency-tolerant. The design must keep the hot path fast (small partitions) while leaving cold data
  *recoverable* (re-attachable / re-importable), not silently lost.
- **Operational simplicity in a Postgres + MikroORM v7 shop.** No `pg_partman` extension is assumed (managed-PG
  parity); partition management must be plain SQL run by the existing `scheduler` + `queue`, not a new daemon.
  MikroORM v7 does not manage partitioned parents, so the partition DDL must live in hand-authored migrations
  with the snapshot updated by hand (the conventions doc's "scoped SQL migration" exception).
- **Multi-tenancy.** Every row carries `tenant_id` + `organization_id`; partitioning is by `created_at` (time),
  **not** by tenant — tenant isolation stays at the query/index layer. Archive exports and the policy table are
  tenant-scoped so cold reads and retention windows can differ per tenant where required.

## 3. Approaches Considered

### A. Postgres native declarative partitioning + scheduler maintenance (pg_partman-style, no extension)
Declare `agent_spans` / `agent_tool_calls` as `PARTITION BY RANGE (created_at)` parents with **monthly** child
partitions. A `packages/scheduler` maintenance schedule (`scheduleType: 'cron'`, monthly) targets a Command/queue
job that (a) `CREATE`s the next N months' partitions ahead of time, (b) `DETACH`es partitions older than the hot
window, and (c) hands detached partitions to the archival worker. Pure SQL via the existing scheduler+queue — no
extension, no daemon. The planner prunes by `created_at` predicate; the cockpit's window filter already supplies
one. Caveat: **MikroORM v7 does not emit `PARTITION BY`** — the parent + initial partitions ship as a
hand-authored migration, and inserts must always set `created_at` (the partition key), which the `onCreate`
default guarantees.

### B. App-managed monthly tables (no native partitioning)
The app maintains `agent_spans_2026_06`, `_2026_07`, … as ordinary tables and a routing layer (a view or
service-side dispatch) picks the right month on write/read. Portable to any SQL engine and fully MikroORM-visible
per table, but it pushes partition routing into application code: every span insert and every cross-month cockpit
query must union/route by hand, the entity↔table mapping becomes dynamic, and `UNION ALL` reads lose the
planner's native partition pruning. More code, more failure surface, and it reinvents what Postgres does natively
— justified only if engine-portability were a hard requirement, which it is not (OM is Postgres-only).

### C. Hot DB + cold archive to storage-s3 (detach → export → tombstone)
Orthogonal to A/B: once a partition ages past the hot window, **detach** it, **export** its rows + jsonb payloads
to `storage-s3` as compressed Parquet/JSON-Lines under a tenant-scoped key
(`agent-archive/<tenantId>/agent_spans/2026-06.parquet.gz`), record an `AgentArchivePartition` metadata row
(partition key range, object key, row count, checksum, `archivedAt`), then **drop** the detached partition from
hot storage. Cold reads go through an "archive read" path that streams the object back (or re-attaches it for a
bulk forensic job). Cheapest cold storage, meets ≥6yr cheaply for the **high-volume** tiers — but only the
high-volume telemetry tiers tier out; the ≥6yr **audit** tiers stay hot and queryable, never exported-and-dropped.

## 4. Trade-off Matrix

| Driver | A. Native partitioning + scheduler | B. App-managed monthly tables | C. Cold archive to storage-s3 |
|---|---|---|---|
| Hot write/read perf @ 9M/yr | Native pruning, small partitions | Manual routing, `UNION ALL` reads | (pairs with A) shrinks hot set further |
| Operational simplicity (PG+MikroORM) | SQL via existing scheduler/queue | Heavy app-side routing code | Adds export/restore path |
| MikroORM v7 fit | Parent invisible to ORM (hand DDL) | Each table ORM-visible, dynamic map | N/A (metadata row only) |
| Storage cost (6yr) | Still all in PG (expensive) | Still all in PG (expensive) | **Cheapest** — object storage |
| Cold-read latency | Fast (still in PG) | Fast | Slower (stream/re-attach) — acceptable |
| ≥6yr audit immutability | Native, stays hot | Native, stays hot | **Must exempt audit tiers from export** |
| Portability | Postgres-only | Engine-portable | Engine-agnostic cold format |
| Code / infra added | Migration + 1 maint job | Routing layer everywhere | Archival worker + read path |
| Net-new failure surface | Low | High | Medium |

## 5. Recommendation

**Adopt A + C: native declarative monthly partitioning for the high-volume append-only logs, a
`packages/scheduler` maintenance job for partition rotation, and a `packages/queue` archival worker that exports
detached cold partitions to `storage-s3` — governed by a tiered-retention policy table.** Reject B
(app-managed routing reinvents native partitioning, adds the most code, and loses planner pruning, with
portability as its only upside — and OM is Postgres-only).

The split is the load-bearing decision:

- **High-volume telemetry tiers** (`agent_spans`, `agent_tool_calls`): `PARTITION BY RANGE (created_at)`,
  monthly. Hot window = N days/months in PG; older partitions **detach → export to storage-s3 → drop** (jsonb
  payloads already live in storage-s3 by key per the trace spec, so the export carries row data + redacted
  summaries; full artifacts stay encrypted under their existing keys). Cold reads via an archive-read path.
- **Low-volume audit tiers** (`agent_eval_results`, `agent_corrections`, `agent_eval_cases`,
  `agent_decision_records`, `agent_guardrail_checks`, `agent_task_events`): **stay hot, queryable, immutable,
  ≥6yr — never exported-and-dropped, never pruned.** The retention policy marks them `immutable: true` so the
  maintenance job refuses to touch them. (Optional defense-in-depth: partition these too, but only ever
  pre-create + retain — the maintenance job's drop/detach step is policy-gated off for immutable tiers.)
- **GDPR erasure** is the trace/compliance spec's artifact-tombstone pattern, not a row delete: redact the PII
  payload in storage-s3, keep the row/tombstone. Archival must preserve this — exported cold partitions are
  re-tombstoned on erasure (the archive read path applies the current redaction map), so the legal record
  survives in cold storage exactly as it does hot.

Why native over app-managed: the planner prunes by the `created_at` predicate the cockpit already sends, the
maintenance/archival logic is plain SQL on the existing `scheduler`+`queue`+`storage-s3` rails (no new daemon,
no extension), and the only real cost — MikroORM v7 not managing the partitioned parent — is contained by
hand-authored migrations + a hand-updated `.snapshot-open-mercato.json`, which the conventions doc already
sanctions for scoped SQL.

## 6. Effort, Risks & Dependencies

**Effort: M.** Hand-authored partition migration (parent + seed partitions + the `AgentArchivePartition` +
`AgentRetentionPolicy` tables), one scheduler-registered maintenance Command, one queue archival worker, the
storage-s3 export/import codec (Parquet or JSON-Lines + gzip), an archive-read path on the trace read API, and
the policy seed in `setup.ts`. Entities/storage/scheduler/queue rails all exist; the codec + the archive-read
fallback are the main net-new build.

**Risks**

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Maintenance job fails → no future partition → inserts error (no target range) | High | Pre-create N months ahead; alert + default partition catch-all; idempotent retry on the queue | Low |
| Audit tier accidentally tiered/pruned (Art. 12 breach) | High | Policy `immutable: true` gates drop/detach off; integration test asserts immutable tiers never detach/export | Low |
| MikroORM v7 / `db:generate` clobbers the partitioned parent | Medium | Partition DDL in hand-authored migration; hand-update snapshot; never re-`db:generate` these tables | Low |
| Cold export corrupts / loses forensic data | High | Row-count + checksum in `AgentArchivePartition`; verify-after-export before drop; re-attach path for recovery | Low |
| GDPR erasure misses cold-archived PII | High | Erasure redacts storage-s3 artifacts by key (shared with hot); archive-read applies current redaction map | Medium |
| Cold-read latency surprises cockpit users | Medium | UI flags "archived" runs; archive-read is async/streamed; hot window sized to cover normal review horizon | Low |
| Multi-tenant: a tenant's window/erasure differs | Medium | Policy table is tenant-scoped; export keys are tenant-prefixed; queries filter `organizationId` | Low |

**Dependencies:** trace spec entities (`agent_spans`/`agent_tool_calls` + storage-s3 artifact keys) and
compliance spec audit entities (hard — define the tiers); `packages/scheduler` (`SchedulerService.register`,
`scheduleType:'cron'`, `targetType:'queue'|'command'`, `sourceType:'module'`) for rotation; `packages/queue`
(worker `metadata = { queue, id, concurrency }`, `createModuleQueue`) for the archival worker; `packages/storage-s3`
(`StorageService`: `upload`/`download`/`delete`/`getSignedUrl`/`list`/`toLocalPath`, DI key `storageService`,
`TenantScope`) for cold objects + `TenantDataEncryptionService` for encryption-at-rest of exports.

## 7. Deliverables & Acceptance

**Deliverables**

1. **Partition scheme** — hand-authored migration declaring `agent_spans` and `agent_tool_calls` as
   `PARTITION BY RANGE (created_at)` parents with monthly children + a default catch-all partition; PK/indexes
   replicated to the partition key; `.snapshot-open-mercato.json` updated by hand. Inserts always set
   `created_at` (the `onCreate` default).
2. **Tiered-retention policy table** — `AgentRetentionPolicy` (`agent_retention_policies`, editable): per
   `entityType` per tenant, `hotWindowDays`, `archiveTarget` (`'none'|'storage_s3'`), `immutable` (bool — true
   for the ≥6yr audit tiers, blocks detach/drop), `minRetentionYears` (default 6 for audit tiers); seeded in
   `setup.ts` with sane defaults and the audit tiers locked `immutable: true`.
3. **Maintenance job** — a Command registered via `SchedulerService.register({ scheduleType:'cron', monthly,
   targetType:'command'|'queue', sourceType:'module', sourceModule:'agent_orchestrator' })` that, per
   non-immutable tier: pre-creates the next N months' partitions, detaches partitions older than
   `hotWindowDays`, and enqueues each detached partition for archival. Idempotent; never touches `immutable`
   tiers' data.
4. **Archival worker** — a `packages/queue` worker (`workers/agent-archive-partition.ts`) that exports a
   detached partition to `storage-s3` as compressed Parquet/JSON-Lines under
   `agent-archive/<tenantId>/<entityType>/<range>.gz` (encrypted via `TenantDataEncryptionService`), writes an
   `AgentArchivePartition` metadata row (range, object key, rowCount, checksum, archivedAt), verifies
   row-count+checksum, then drops the detached hot partition. Re-attach/restore path for forensic recovery.
5. **Archive-read path** — the trace read API transparently falls back to streaming a cold partition from
   storage-s3 (flagged "archived" in the UI) for runs outside the hot window; applies the current GDPR
   redaction map on read so cold reads honor erasure.

**Acceptance**

- `agent_spans` / `agent_tool_calls` are range-partitioned by `created_at`; a windowed cockpit query prunes to
  the relevant partition(s) and meets the ≤5s p95 target on the hot window.
- The scheduler maintenance job pre-creates future partitions (no insert ever lacks a target range) and detaches
  expired non-immutable partitions; it **never** detaches, drops, or prunes an `immutable` tier.
- A detached high-volume partition is exported to storage-s3 (encrypted), verified by row-count + checksum,
  recorded in `AgentArchivePartition`, then dropped from hot storage; a forensic read re-streams it.
- `AgentEvalResult` / `AgentCorrection` / `AgentEvalCase` / `AgentDecisionRecord` / `AgentGuardrailCheck` /
  `AgentTaskEvent` remain hot, append-only, queryable, and retained ≥6 years — proven by a test that asserts the
  maintenance job leaves immutable tiers untouched.
- GDPR erasure redacts PII in both hot rows/artifacts and cold-archived partitions while preserving the audit
  tombstone; the cold read path reflects the current redaction.
- The retention policy is tenant-scoped; no archival export or archive-read returns cross-tenant rows.

## Changelog

- **2026-06-19:** Initial GAP-19 design analysis. Recommends native Postgres declarative monthly range
  partitioning (by `created_at`) for the high-volume append-only logs (`agent_spans`, `agent_tool_calls`),
  rotated by a `packages/scheduler` maintenance job, with detached cold partitions exported to `storage-s3` by a
  `packages/queue` archival worker, all governed by a tiered-retention policy table. Splits high-volume
  telemetry tiers (tier to cold after N days) from low-volume ≥6yr audit tiers (stay hot, immutable, never
  pruned). Rejects app-managed monthly tables (reinvents native partitioning, most code, loses planner pruning;
  portability is its only upside and OM is Postgres-only). Notes MikroORM v7's lack of partitioned-parent
  support (hand-authored migration + hand-updated snapshot) and that GDPR erasure stays the artifact-tombstone
  pattern across hot and cold storage.
