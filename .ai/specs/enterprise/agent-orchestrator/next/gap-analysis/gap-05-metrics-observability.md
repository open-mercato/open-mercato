> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# Metrics & Observability Substrate — Design Analysis

> **Gap:** GAP-05 · **Priority:** P1 · **Status:** Design analysis (not a spec)
> **Module:** `agent_orchestrator` (core) · **subdomain:** metrics (`lib/metrics/`)
> **Related specs:** trace (`2026-06-19-agent-trace-eval-capture.md`), cockpit (`2026-06-19-agent-operations-ui.md`), lifecycle (`2026-06-19-agent-deployment-and-regression-gating.md`), comply (`2026-06-19-agent-decision-transparency-and-ai-act.md`)
> **Reuses:** `dashboards` (`WidgetDataService`), `packages/scheduler`, `packages/queue`, `storage-s3`, trace tables

## 1. Gap statement

Four specs assume a metrics surface that no spec owns. The cockpit needs Admin fleet KPIs
(auto-completion %, override rate, eval-pass rate, queue depth, cost). Lifecycle needs a
windowed **per-agent override rate** to drive the autonomy ramp and a baseline for the eval
gate. Comply needs post-market monitoring volumes and **fairness-by-cohort** rollups. The
trace spec declares "metrics rollups (this module's tables) → cockpit" as Phase 8 but does
not design the rollup tables, the refresh mechanism, the read API, or how it wires into
`dashboards`. There is **no `telemetry-and-otel` module and no `health-monitoring` module**
(both spec-only), so there is no telemetry substrate to adopt — the metrics plane is net-new
and must be built from the trace tables (`agent_runs`, `agent_eval_results`,
`agent_corrections`, `agent_guardrail_checks`) plus existing OM infra.

GAP-05 owns: the rollup data model, `MetricsService`, the refresh workers, the read API,
the `dashboards` wiring, and the **OTel-emit decision**.

## 2. Architectural drivers

- **Query latency at scale.** The trace spec projects ~9M `agent_spans` rows/yr and
  thousands of runs/week. Override rate and eval-pass rate are `COUNT(...)/COUNT(*)` over
  `agent_runs` ⋈ `agent_corrections`/`agent_eval_results` windowed by time and grouped by
  agent. Computed live on every cockpit tile render and every autonomy-ramp worker tick,
  these scans dominate cost as history grows.
- **Freshness vs cost.** The autonomy ramp tolerates window-level staleness (it reads a
  multi-hour/day window). Cockpit KPIs tolerate minutes. Ad-hoc trace-inspector filtering
  ("low-confidence runs in the last hour") must be live. One freshness policy does not fit all.
- **Tenant scoping.** Every metric is `(tenant_id, organization_id)`-scoped; rollups must
  carry both columns and all reads filter by `organizationId`. Cross-tenant aggregation is a
  hard isolation violation.
- **OM-fit.** `dashboards` already owns the KPI-tile display contract; `WidgetDataService`
  already runs cached, tenant-scoped, on-demand aggregation (`aggregate`/`groupBy`/`dateRange`
  /`comparison`/`filters`) against indexed entities with `CacheStrategy` tag invalidation.
  `packages/scheduler` already owns DB-managed cron/interval jobs targeting a queue or command,
  scoped system/org/tenant. Reusing both beats inventing a parallel metrics runtime.
- **External-tooling interop (OTel).** Operators with existing Grafana/Tempo/Prometheus stacks
  want agent telemetry in their tools. OTel GenAI semantic conventions are already the
  *naming target* for `agent_spans.attributes` (trace spec). Emitting real OTel spans is the
  interop lever — but with no in-repo telemetry module it is net-new, opt-in infra.
- **Build cost.** P1, but it sits behind the trace tables (its only data source). Rollups are
  a few entities + workers + a read API; OTel export is an isolated, deferrable add-on.

## 3. Approaches considered

- **(a) Periodic rollup tables.** A `packages/scheduler` cron job (per tenant, e.g. every
  5 min) aggregates trace tables into `agent_metric_rollups` (pre-aggregated per
  agent/capability × window-bucket) and `agent_fairness_metrics` (already in comply). Hot KPIs
  read a single indexed rollup row. Bounded, predictable cost; reads are O(buckets).
- **(b) On-demand aggregation.** Compute every metric live over `agent_runs`/
  `agent_eval_results` via `WidgetDataService`. Always fresh, zero extra storage, zero refresh
  machinery — but every tile/worker tick scans growing history; degrades at 9M-span / multi-
  year volume; repeated identical scans for the same KPI.
- **(c) Postgres materialized views** refreshed on a schedule. DB-native pre-aggregation, no
  app rollup code. But `REFRESH MATERIALIZED VIEW` is coarse (whole view, not incremental
  unless `CONCURRENTLY` + unique index), awkward to scope per tenant, hard to migrate/version
  under OM's MikroORM snapshot workflow, and outside the module's entity/CRUD/indexer
  conventions. Poor OM-fit.
- **(d) Emit OTel GenAI spans to an external backend** (Grafana/Tempo/Prometheus). Best-in-
  class dashboards/alerting for free *if* the operator already runs the stack. But no
  telemetry module exists, so this is net-new exporter infra, an added runtime dependency, and
  cannot serve the in-app cockpit/lifecycle/comply consumers on its own (those read OM tables,
  not Prometheus).

## 4. Trade-off matrix

| Criterion | (a) Rollup tables | (b) On-demand | (c) Mat. views | (d) OTel export |
|---|---|---|---|---|
| Read latency at scale | High (O(buckets)) | Low (full scans) | High | High (external) |
| Freshness | Window-stale (mins) | Live | Refresh-stale | Near-live |
| Storage cost | Small (aggregated) | None | Moderate | None (external) |
| Refresh/build cost | Scheduler + workers | None | DB refresh | Exporter infra + dep |
| Tenant scoping | Native (2-col rows) | Native (scope) | Awkward | Per-export attrs |
| OM-fit | High (entities/CRUD) | High (`WidgetDataService`) | Low (snapshot/migration) | Low (no telemetry mod) |
| Serves in-app consumers | Yes | Yes | Yes | No (external only) |
| External-tooling interop | No | No | No | Yes |
| AI-Act post-market fit | Strong (durable rollups) | Weak (recompute each time) | Medium | Medium (off-platform) |

## 5. Recommendation

**HYBRID: rollup tables for hot KPIs (a) + on-demand for ad-hoc (b) + optional OTel export (d).
Reject standalone materialized views (c).**

- **Rollup tables (a) for the hot, repeated, windowed KPIs** every consumer polls: per-agent
  override rate, eval-pass rate, latency p50/p95, token/cost, guardrail trip rate, queue
  depth/backlog snapshot, and fairness-by-cohort. These are read on every cockpit render and
  every autonomy-ramp tick — exactly the access pattern that justifies pre-aggregation. Refresh
  via a `packages/scheduler` job per tenant; aggregate in a `packages/queue` worker.
- **On-demand (b) via `dashboards`/`WidgetDataService` for ad-hoc and live slices** — the
  trace-inspector's "low-confidence runs last hour", arbitrary filter/group-by exploration, and
  any KPI not worth a rollup bucket. This path already exists, is tenant-scoped, and is cached;
  GAP-05 reuses it rather than rebuilding aggregation. New rollup entities register with the
  analytics registry so on-demand and rollup share field semantics.
- **OTel export (d): YES, but optional and behind config (off by default).** `agent_orchestrator`
  SHOULD be able to emit OTel GenAI spans for external tooling — the span attributes already
  target OTel GenAI conventions, so the mapping is cheap — but only when an operator opts in
  (`OM_AGENT_OTEL_EXPORT=on` + OTLP endpoint config). It is an additive exporter on the trace
  ingest/eval path, never a dependency of the in-app metrics; the cockpit/lifecycle/comply
  consumers always read OM rollup tables so the platform works with the export disabled.
- **Reject (c).** Materialized views fight OM's migration/snapshot workflow, scope poorly per
  tenant, and duplicate what rollup entities do with worse OM-fit.

**Justification.** No single approach satisfies all drivers: (a) is fast and durable but stale
and adds refresh machinery; (b) is fresh and free but scans growing history; (d) gives interop
but cannot serve in-app readers and needs net-new infra. The hybrid assigns each access pattern
to the path that fits it — pre-aggregate the high-frequency windowed KPIs, compute the long-tail
live on the existing `WidgetDataService`, and make external-tooling interop an opt-in side
channel. It maximizes reuse (`dashboards`, `scheduler`, `queue`) and minimizes net-new surface.

## 6. Effort, risks, dependencies

**Effort: M.** Rollup entities + Zod + migrations (S); `MetricsService` aggregation + scheduler
job + queue worker (M); read API + `dashboards` wiring (S); optional OTel exporter (S, isolated,
deferrable). Larger than a single-entity feature, smaller than the trace plane itself.

**Dependencies (ordering):**
- **Hard:** trace spec tables (`agent_runs`, `agent_eval_results`, `agent_corrections`,
  `agent_guardrail_checks`) must exist first — they are the only data source. GAP-05 lands after
  trace Phases 1–4.
- `packages/scheduler` (refresh cadence), `packages/queue` (aggregation worker), `dashboards`
  (`WidgetDataService` + analytics registry, tile display), `storage-s3` (already used by trace;
  not needed for rollups).
- comply's `AgentFairnessMetric` is a rollup target — coordinate so fairness rollups are produced
  by GAP-05's worker, not duplicated.

**Risks:**

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Stale rollups mislead the autonomy ramp ("ratio mirage") | High | Stamp each rollup row with `computedAt` + `windowStart/End`; ramp worker reads window-complete buckets only and re-checks the eval gate before widening | Medium |
| Aggregation scans still heavy on first/backfill run | Medium | Incremental rollup keyed on last-processed `created_at` watermark (progress-job pattern); index trace tables on `(agentDefinitionId, createdAt)` | Low |
| Cross-tenant leak in rollups | High | Two-column tenancy on every rollup row; per-tenant scheduler scope; all reads filter `organizationId`; isolation integration test | Low |
| OTel export becomes a de-facto dependency | Low | Off by default, fail-open: export errors never block ingest; in-app consumers never read the exporter | Low |
| Fairness rollup exposes protected attributes | High | Aggregate privacy-safe cohorts only; no per-subject attributes (per comply) | Low |
| Rollup vs on-demand divergence (two code paths, different numbers) | Medium | Share aggregation definitions via the analytics registry; one `MetricsService` computes both rollups and ad-hoc | Low |

## 7. Deliverables + Acceptance

**Deliverables:**
- **Rollup entities** (`data/entities.ts`, `agent_` prefix, append-only, two-column tenancy,
  `[OptionalProps]`, `/legacy` decorators): `AgentMetricRollup` (`tenantId`, `organizationId`,
  `agentDefinitionId`/`capability`, `metricKey`, `window` bucket, `windowStart`/`windowEnd`,
  `value` jsonb {count, rate, p50, p95, tokens, costMinor}, `computedAt`, indexed
  `(organizationId, agentDefinitionId, metricKey, windowStart)`). Fairness rollups land in
  comply's `AgentFairnessMetric` (produced here). Zod in `data/validators.ts`.
- **`MetricsService`** (`lib/metrics/`) — one aggregation surface computing override rate,
  eval-pass rate, latency p50/p95, token/cost, guardrail trip rate, queue depth/backlog, and
  fairness-by-cohort; used by both the refresh worker (rollup writes) and ad-hoc reads. Shares
  field definitions with the `dashboards` analytics registry.
- **Refresh workers** — a `packages/scheduler` registration (per-tenant cron/interval, e.g.
  5 min) targeting a `packages/queue` worker that runs `MetricsService` incrementally off a
  `created_at` watermark; idempotent, tenant-scoped payloads.
- **Read API + dashboards wiring** — extend the trace spec's `GET /agents/:id/metrics` to serve
  rollup rows; CRUD reads for rollups via `makeCrudRoute` + `indexer` + `openApi`; register the
  rollup entity types with the analytics registry so cockpit KPI tiles and on-demand
  `WidgetDataService` queries resolve. Events: `agent_orchestrator.metrics.rolled_up`.
- **OTel-emit decision (documented):** opt-in OTLP exporter behind `OM_AGENT_OTEL_EXPORT`,
  off by default, fail-open, mapping `agent_spans.attributes` → OTel GenAI conventions; never a
  runtime dependency of the in-app metrics path.

**Acceptance:**
- Per-agent override rate, eval-pass rate, latency p50/p95, token/cost, guardrail trip rate,
  and queue depth are readable from rollup tables over any standard window in ≤ 1s p95 at
  multi-year volume, scoped per `organizationId`.
- The autonomy-ramp worker reads window-complete rollups (never a partial bucket) and the
  eval gate reads a stable baseline.
- Ad-hoc trace-inspector slices (arbitrary filter/group-by, last-hour) resolve live via
  `WidgetDataService` without a rollup.
- Cockpit Admin KPI tiles render from rollup rows through the `dashboards` tile contract.
- Fairness-by-cohort rollups populate comply's `AgentFairnessMetric`; threshold breach flags.
- With `OM_AGENT_OTEL_EXPORT=off` (default) the full metrics plane works; with it on, spans
  appear in the external OTLP backend and exporter failures never block ingest.
- No rollup or read endpoint returns cross-tenant rows (isolation integration test).

## Changelog

- **2026-06-19:** Initial design analysis. Recommends a HYBRID — rollup tables (scheduler+queue)
  for hot windowed KPIs, reuse of `dashboards` `WidgetDataService` for ad-hoc/live slices, and an
  opt-in (default-off, fail-open) OTel GenAI exporter for external-tooling interop. Rejects
  standalone Postgres materialized views (poor OM-fit). Confirms no telemetry/health-monitoring
  substrate exists; metrics are net-new, sourced from the trace tables, sequenced after trace
  Phases 1–4. Verified substrate: `WidgetDataService.fetchWidgetData` (cached on-demand
  aggregation), `SchedulerService`/`ScheduleRegistration` (DB-managed cron/interval → queue/command),
  `dashboards` analytics registry, progress-job watermark pattern.
