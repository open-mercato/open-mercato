> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/core/src/modules/agent_orchestrator/`.

# Agent Eval Harness & Metrics

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-20 · **Module:** `agent_orchestrator` · **subdomains:** trace (eval) + lifecycle (gate) + metrics · **Depends:** trace spec (`AgentRun`/`AgentEvalAssertion`/`AgentEvalResult`/`AgentEvalCase`/`AgentCorrection`), `ai_assistant` (`AiModelFactory`), `packages/{queue,scheduler,storage-s3}`, `dashboards`, Jest 30 · **Consolidates:** GAP-04 (eval harness), GAP-05 (metrics/observability) · **Links:** GAP-14 (override-rate consumer + autonomy gate), GAP-19 (retention of eval/metric tiers)
> **Conventions:** governed by `2026-06-19-agent-orchestrator-conventions.md` (normative; wins on any entity/structure conflict).

## TLDR

The build detail behind two assertions the sibling specs make but no spec owns: (1) the **eval harness** the trace spec calls "this module's own eval harness", and (2) the **metrics substrate** the cockpit, lifecycle, and compliance specs read. Both are **net-new**: there is no `eval-runner`, no Inspect AI, no Vitest, no `x_om`, and no `telemetry-and-otel` module in the codebase — none may be cited as reuse. The repo test runner is **Jest 30**.

The harness is a **shared-scorer** library: an assertion is a pure function `(run, expected?, config?) => { passed, score?, evidence? }` authored once and run on **two planes** — online inside `EvalRuntimeService` per `AgentRun` (writing `AgentEvalResult`), and offline as a Jest-based CI gate over the trace spec's eval-case export (the LIFECYCLE promotion gate). The metrics substrate is a **hybrid**: pre-aggregated rollup tables for hot windowed KPIs (scheduler + queue), on-demand aggregation via the `dashboards` `WidgetDataService` for ad-hoc slices, and an optional default-OFF OTel GenAI exporter for external tooling.

## Overview

The trace spec **owns** `AgentRun` / `AgentSpan` / `AgentToolCall` / `AgentEvalAssertion` / `AgentEvalResult` / `AgentEvalCase` / `AgentCorrection` and the *agent_orchestrator eval-case export* contract. This spec does **not redefine them** — it details the executable layer that consumes and produces them: the scorer framework, the online `EvalRuntimeService`, the offline Jest CI gate, the `llm_judge` async tier, and the metrics rollup plane that converts the trace tables into the KPIs the cockpit / lifecycle / compliance specs poll.

Two pillars, one module subdomain set:
- **Eval Harness** (`lib/trace/eval/`) — shared scorers, online deterministic evaluation, offline regression gate, sampled `llm_judge`.
- **Metrics Substrate** (`lib/metrics/`) — rollup tables + `MetricsService` + refresh worker + reads, with `WidgetDataService` for ad-hoc and an optional OTel side channel.

## Problem Statement

- **No eval harness exists.** `eval-runner` / Inspect AI / `x_om` are all absent. The trace spec defines eval *entities* and an *export format*; the lifecycle spec defines a *gate* that consumes the export — but nothing runs scorers, replays cases, or computes a gate verdict. Without the harness, "regression gating" has no source of truth and the online `evalPassed` flag has no implementation.
- **No metrics rollup substrate exists.** `telemetry-and-otel` and any `health-monitoring` module are absent. Four specs assume a metrics surface: cockpit fleet KPIs, the lifecycle autonomy-ramp's windowed override rate, and compliance post-market monitoring + fairness rollups. The trace spec lists "metrics rollups → cockpit" as a phase but designs neither the tables, the refresh mechanism, the read API, nor the `dashboards` wiring. Computed live on every tile render and ramp tick, `COUNT(...)/COUNT(*)` over `agent_runs ⋈ agent_corrections/agent_eval_results` degrades as history grows toward ~9M spans/yr.

## Proposed Solution

**Pillar 1 — Eval Harness.**
1. **Shared scorers.** A registry of pure functions in `lib/trace/eval/scorers/`, keyed by assertion `key`, with no runtime-only dependencies (no `EntityManager`, no request scope). One source of truth so an online warn and an offline gate can never disagree.
2. **Online plane.** `EvalRuntimeService` runs the deterministic `gate`-severity scorers inline at trace ingest, writes `AgentEvalResult`, sets `AgentRun.evalScore`/`AgentRun.evalPassed`, and enqueues sampled `llm_judge` jobs.
3. **Offline plane.** A Jest-based CI runner (or the equivalent CLI) loads the eval-case export, replays each approved `AgentEvalCase` against the candidate `AgentRelease`, applies the same scorers, and emits a gate summary the LIFECYCLE `promote` path consumes.
4. **`llm_judge` tier.** A sampled, async, `warn`-only scorer variant that resolves a model via `createModelFactory(container).resolveModel(...)`; runs in a `packages/queue` worker; never blocks production.

**Pillar 2 — Metrics Substrate.**
1. **Rollup tables** computed by a `packages/scheduler` job → `packages/queue` worker for hot windowed KPIs.
2. **On-demand aggregation** via the `dashboards` `WidgetDataService` for ad-hoc/live slices.
3. **Optional OTel GenAI exporter**, default-OFF, fail-open, for external Grafana/Tempo/Prometheus tooling.

## Architecture

```
                         lib/trace/eval/scorers/  ← ONE registry of pure functions
                         scorer(run, expected?, config?) → {passed, score?, evidence?}
                                  │                                   │
                ┌─────────────────┘                                   └──────────────────┐
                ▼ ONLINE                                                       OFFLINE ▼
   AgentRun (ingest) ──▶ EvalRuntimeService                       eval-case export (versioned)
                          │ deterministic gate inline                     │  approved AgentEvalCase[]
                          │ writes AgentEvalResult                        ▼
                          │ sets AgentRun.evalPassed             Jest CI runner / `eval --release <id> --gate`
                          ▼                                               │ replay cases → apply same scorers
              packages/queue ──▶ llm_judge worker                        ▼
                          (sampled, warn-only, AiModelFactory)   agent_eval_suite_runs (gate summary)
                                                                          │
                                                                          ▼
                                                          LIFECYCLE promote gate (block on regression)

   trace tables (agent_runs/eval_results/corrections/guardrail_checks)
        │  scheduler (per-tenant cron) ──▶ queue worker ──▶ MetricsService (incremental, watermark)
        ▼                                                          │ writes
   on-demand: dashboards WidgetDataService              agent_metric_rollups (+ comply AgentFairnessMetric)
   (ad-hoc/live slices, 120s cache)                               │ reads
                                                       GET /agents/:id/metrics, /metrics?scope&window
                                                                  │
                                                       cockpit KPIs · lifecycle ramp · comply post-market
                                                                  ┊ optional, default-OFF
                                                       OTel GenAI exporter → external OTLP backend
```

- **No cross-module ORM relations.** Other modules referenced by FK id only (`agentDefinitionId`, `agentRunId`, `processId`).
- **Trace entities are owned by the trace spec** and not redefined here. `AgentFairnessMetric` is owned by the compliance spec; this spec's worker *produces* it (no duplicate rollup).

## Eval Harness

### The two eval planes

| | Online (deterministic gate) | Offline (regression gate) |
|---|---|---|
| Trigger | Each `AgentRun` at trace ingest | CI step at promotion of an `AgentRelease` |
| Runner | `EvalRuntimeService` (inline) | Jest job / `yarn mercato agent-orchestrator eval --release <id> --gate` |
| Input | Live run output + assertion config | Approved `AgentEvalCase[]` from the export, replayed against candidate |
| Output | `AgentEvalResult` rows, `AgentRun.evalPassed` | `agent_eval_suite_runs` summary; non-zero exit on gate fail |
| Blocks? | A failed `gate` assertion marks `evalPassed=false` | A safety-assertion regression blocks `promote → active` |

### The shared-scorer pattern (load-bearing seam)

A scorer is a **pure function** — inputs in, verdict out — authored once in `lib/trace/eval/scorers/` and consumed by **both** planes:

```typescript
export type ScorerVerdict = { passed: boolean; score?: number; evidence?: Json }
export type Scorer = (
  run: ScorerRunView,          // normalized, dependency-free view of an AgentRun (output, tokens, confidence, spans summary)
  expected?: Json,             // AgentEvalCase.expected (offline) or null (online)
  config?: Json,               // AgentEvalAssertion.config
) => ScorerVerdict
```

- **Deterministic tier** (`severity: 'gate'` permitted): schema validation, numeric thresholds, PII detection. Same input → same verdict, every run, in CI and at ingest. **Only deterministic scorers may carry `severity: 'gate'`** — non-determinism in the gate path makes CI flaky and promotion non-reproducible.
- **`llm_judge` tier** (always `severity: 'warn'`): a scorer variant that resolves a model via `createModelFactory(container).resolveModel(...)` and `generateObject` for a structured rubric verdict. **Sampled, async via `packages/queue`, never on the critical path, never blocks production.** Online it runs on a sampled subset; offline (CI) on a capped sample of the export.

A **parity test** (Jest) asserts a fixed fixture set produces identical verdicts online and offline — the guard that keeps the two planes a single source of truth.

### Owned eval-case dataset / export format

The *agent_orchestrator eval-case export* is **owned by the trace spec** as a contract; this spec is its primary consumer. It is a **versioned envelope** — explicitly **NOT** an `x_om` / Inspect task format — emitted by `EvalCaseExporter` from approved `AgentEvalCase` rows:

```
{ version: '1', evalSetVersion: '<stamp>', generatedAt, cases: AgentEvalCaseExport[] }
```

The gate pins `evalSetVersion` (the lifecycle `AgentRelease.evalGate.evalSetVersion` already references it) so a promotion is reproducible against a known dataset snapshot.

### Gate / pass semantics for LIFECYCLE promotion

`EvalGateRunner` (lifecycle spec) calls this harness, comparing the candidate summary against `evalGate.requiredPassScore` + `evalSetVersion` and the production baseline:
- **Any deterministic safety-assertion regression blocks promotion to `active`.** The promote endpoint returns 409/422.
- `llm_judge` (`warn`) results are reported but **never** change a gate outcome.
- The autonomy ramp (GAP-14) reads the eval-gate verdict as one of its widening preconditions; the ramp re-checks the gate before each widening step.

### Jest-based CI runner (no second test runner)

The offline runner is an ordinary Jest job (or a thin CLI calling the same library). **`vitest-evals` was considered and rejected**: it is built on Vitest, which would become a *second* test runner in a Jest-only monorepo (separate config, separate CI lane, two contributor mental models, shared-tsconfig divergence risk). Per the GAP-04 runtime-options reasoning, the CI-runner sub-choice is inconclusive on ergonomics alone (both call the same library), so the **deciding factor is: avoid a second test runner**. Even an isolated `eval` workspace would still need the shared scorers + export reader built here, so Vitest would only replace the runner shell, not the work. Revisit only with evidence that `describeEval` DX outweighs the second-runner tax.

### Retention

`AgentEvalResult` / `AgentEvalCase` and the gate-run summaries (`agent_eval_suite_runs`, `AgentRelease.evalResult`) are append-only and retained **≥6 years** (EU AI Act Art. 12) — the harness's *outputs are legal records*, not CI-log ephemera. PII inside eval artifacts is stored in `storage-s3` by key, encrypted via `TenantDataEncryptionService`; row summaries are redacted. These tiers are marked `immutable: true` in the GAP-19 retention policy (never tiered out, never pruned).

## Metrics Substrate

**HYBRID — reject standalone Postgres materialized views** (poor OM-fit: coarse `REFRESH`, awkward per-tenant scoping, fights the MikroORM snapshot/migration workflow).

**(a) Periodic rollup tables.** A `packages/scheduler` job (per tenant, e.g. every 5 min, `scheduleType:'cron'`, `targetType:'queue'`, `scopeType:'tenant'`) enqueues a `packages/queue` worker that runs `MetricsService` incrementally off a `created_at` watermark (progress-job pattern) and upserts `agent_metric_rollups`. Hot KPIs read a single indexed rollup row. These cover the high-frequency windowed KPIs every consumer polls: **per agent/capability/window** — override rate, eval-pass rate, latency p50/p95, token/cost, guardrail trip rate, queue depth/backlog snapshot, and fairness-by-cohort aggregate (the last produced *into* the compliance spec's `AgentFairnessMetric`, not duplicated).

**(b) On-demand aggregation.** Ad-hoc and live slices (the trace inspector's "low-confidence runs in the last hour", arbitrary filter/group-by, any KPI not worth a rollup bucket) resolve live via the `dashboards` `WidgetDataService` (cached on-demand aggregation, 120s cache, tenant-scoped). New rollup entity types register with the analytics registry so on-demand and rollup share field semantics — one `MetricsService` defines both.

**(c) Optional OTel GenAI exporter.** Behind `OM_AGENT_OTEL_EXPORT=on` + an OTLP endpoint, **off by default, fail-open** (export errors never block ingest). Maps `agent_spans.attributes` → OTel GenAI conventions (already the trace spec's naming target). It is an additive side channel — the cockpit / lifecycle / compliance consumers always read OM rollup tables, so the platform works fully with the export disabled. `telemetry-and-otel` does **not** exist; this is a thin opt-in exporter, not a dependency.

**`MetricsService`** (`lib/metrics/`) is the single aggregation surface used by both the refresh worker (rollup writes) and the ad-hoc reads, computing every KPI above. The **refresh worker** is idempotent, tenant-scoped, watermark-driven; it reads only window-complete buckets so the autonomy ramp never widens off a partial window ("ratio mirage" mitigation — each rollup row stamps `computedAt` + `windowStart`/`windowEnd`).

## Data Models

> Eval entities (`AgentRun`, `AgentEvalAssertion`, `AgentEvalResult`, `AgentEvalCase`, `AgentCorrection`) are **owned by the trace spec** — not redefined here. `AgentFairnessMetric` is owned by the compliance spec; produced by this spec's worker. Two net-new entities below. Both: MikroORM v7 `/legacy`, dual `tenant_id`+`organization_id`, UUID PK `gen_random_uuid()`, `agent_` prefix, append-only/upsert as noted. Zod shapes in `data/validators.ts`.

### `AgentMetricRollup` (`agent_metric_rollups`) — upsert-by-key (append-only history optional via `windowStart`)

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type MetricWindow = 'hour' | 'day' | 'week'

@Entity({ tableName: 'agent_metric_rollups' })
@Index({ name: 'agent_metric_rollups_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'agent_metric_rollups_lookup_uq',
  properties: ['organizationId', 'agentDefinitionId', 'capability', 'metricKey', 'window', 'windowStart'],
})
export class AgentMetricRollup {
  [OptionalProps]?: 'capability' | 'computedAt' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_definition_id', type: 'varchar', length: 150 })
  agentDefinitionId!: string // FK id → ai_assistant agent definition; '*' for fleet-wide

  @Property({ name: 'capability', type: 'varchar', length: 100, nullable: true })
  capability?: string | null // null = all capabilities for the agent

  @Property({ name: 'metric_key', type: 'varchar', length: 60 })
  metricKey!: string // 'override_rate' | 'eval_pass_rate' | 'latency' | 'cost' | 'guardrail_trip_rate' | 'queue_backlog' | 'fairness'

  @Property({ name: 'window', type: 'varchar', length: 10 })
  window!: MetricWindow

  @Property({ name: 'window_start', type: Date })
  windowStart!: Date

  @Property({ name: 'window_end', type: Date })
  windowEnd!: Date

  @Property({ name: 'measures', type: 'jsonb' })
  measures!: any // { count, rate?, p50?, p95?, inputTokens?, outputTokens?, costMinor?, currency? }; Zod in data/validators.ts

  @Property({ name: 'sample_size', type: 'integer', default: 0 })
  sampleSize: number = 0 // drives autonomy-ramp minSamples gate

  @Property({ name: 'computed_at', type: Date, onCreate: () => new Date() })
  computedAt: Date = new Date()

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
```

### `AgentEvalSuiteRun` (`agent_eval_suite_runs`) — append-only (CI gate history; ≥6yr)

```typescript
export type EvalSuiteOutcome = 'passed' | 'failed' | 'advisory'

@Entity({ tableName: 'agent_eval_suite_runs' })
@Index({ name: 'agent_eval_suite_runs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_eval_suite_runs_release_idx', properties: ['releaseId', 'createdAt'] })
export class AgentEvalSuiteRun {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'release_id', type: 'uuid' })
  releaseId!: string // FK id → agent_releases (lifecycle spec)

  @Property({ name: 'eval_set_version', type: 'varchar', length: 100 })
  evalSetVersion!: string // pinned dataset snapshot

  @Property({ name: 'case_count', type: 'integer' })
  caseCount!: number

  @Property({ name: 'pass_score', type: 'float' })
  passScore!: number // aggregate score against evalGate.requiredPassScore

  @Property({ name: 'outcome', type: 'varchar', length: 12 })
  outcome!: EvalSuiteOutcome

  @Property({ name: 'safety_regressions', type: 'jsonb', nullable: true })
  safetyRegressions?: any | null // assertion keys that regressed vs baseline; non-empty ⇒ block

  @Property({ name: 'summary', type: 'jsonb' })
  summary!: any // per-assertion pass/fail + llm_judge warn counts; Zod in data/validators.ts

  @Property({ name: 'triggered_by', type: 'varchar', length: 100, nullable: true })
  triggeredBy?: string | null // 'ci' | userId

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
```

## API Contracts

Routes mounted under the underscore module id `/api/agent_orchestrator/...`.

**Reads (`makeCrudRoute` + `indexer` + `export const openApi`):**
- `GET /api/agent_orchestrator/agents/:id/metrics` — per-agent rollup KPIs (override rate, eval-pass rate, latency p50/p95, token/cost, guardrail trip rate) over a window. (Extends the trace spec's declared route to serve rollup rows.) Feature `agent_orchestrator.metrics.view`.
- `GET /api/agent_orchestrator/metrics?scope=<agent|capability|tenant>[&scopeRef=...]&window=<hour|day|week>` — windowed rollup slice; fleet KPIs use `scope=tenant`.
- `GET /api/agent_orchestrator/eval-cases/export` — the versioned eval-case export consumed by the CI gate (owned/emitted per the trace spec; listed here as the harness input). Feature `agent_orchestrator.eval.export`.
- `GET /api/agent_orchestrator/eval-suite-runs[?releaseId=...]` — CI gate history (`agent_eval_suite_runs`). Feature `agent_orchestrator.eval.manage`.

**CLI (regression-gate CI step):**
- `yarn mercato agent-orchestrator eval --release <id> --gate` — runs the **Jest-based harness** over the eval-case export, replays cases against the candidate release, writes an `AgentEvalSuiteRun`, prints a summary, and exits non-zero on gate failure (safety-assertion regression or `passScore < requiredPassScore`). No `eval-runner`, no Vitest.

**Events** (`createModuleEvents`, `module.entity.action`, past tense, `as const` in `events.ts`):
- `agent_orchestrator.run.evaluated` — emitted by `EvalRuntimeService` after deterministic scoring of a run.
- `agent_orchestrator.eval_case.created` / `agent_orchestrator.eval_case.approved` — owned by the trace spec (flywheel); referenced here as the inputs that grow the export.
- `agent_orchestrator.metrics.rolled_up` — emitted by the refresh worker after a rollup batch.

**ACL** (in `acl.ts` + `setup.ts` `defaultRoleFeatures`): `agent_orchestrator.metrics.view`, `agent_orchestrator.eval.manage`, `agent_orchestrator.eval.export`. Run `yarn mercato auth sync-role-acls`.

## Phases

1. **Shared scorer framework + online deterministic eval.** `lib/trace/eval/scorers/` registry of pure functions (schema / threshold / PII deterministic built-ins); `EvalRuntimeService` runs `gate`-severity scorers inline at ingest, writes `AgentEvalResult`, sets `AgentRun.evalPassed`; emits `agent_orchestrator.run.evaluated`. Parity-test scaffold.
2. **Eval-case export + Jest CI runner + LIFECYCLE gate semantics.** Offline runner/CLI replays the export against a candidate release, applies the same scorers, writes `AgentEvalSuiteRun`, pins `evalSetVersion`; `EvalGateRunner` blocks `promote → active` on safety-assertion regression. Parity test (online ≡ offline on fixtures) gates this phase.
3. **`llm_judge` sampled tier.** Async scorer variant via `packages/queue` + `createModelFactory(container).resolveModel(...)`; `severity: 'warn'`, sampled online + capped offline; never on the critical path.
4. **Metrics rollup tables + worker + reads.** `AgentMetricRollup` entity + Zod + migration; `MetricsService`; `packages/scheduler` per-tenant job → `packages/queue` watermark worker; `GET /agents/:id/metrics` + `/metrics` reads; register with the `dashboards` analytics registry; emit `agent_orchestrator.metrics.rolled_up`; produce fairness rollups into the compliance spec's `AgentFairnessMetric`.
5. **Optional OTel exporter + anti-rubber-stamp signals.** `OM_AGENT_OTEL_EXPORT` opt-in OTLP exporter (default-OFF, fail-open); surface anti-rubber-stamp signals (approve-unchanged rate, sampled re-review, persistent warns) computed from this module's tables for the cockpit (AI Act Art. 14).

**Sequencing.** Hard-blocked behind trace Phases 1–4 (the tables are the only data source). Phases 1–2 are the critical path for the LIFECYCLE gate; Phase 4 unblocks the cockpit KPIs and the GAP-14 autonomy ramp.

## Acceptance

- A scorer produces **identical verdicts online (ingest) and offline (CI)** for the same fixture — parity test passes.
- The CI gate **blocks** promotion of an `AgentRelease` that fails `evalGate` or regresses a safety assertion; **passes** otherwise; runs as a Jest/CI job with **no Vitest** dependency; the export carries a `version` + `evalSetVersion` and the gate pins/reports the dataset version.
- `llm_judge` runs only on a sampled subset, async, `warn`-only, and **never changes a gate outcome**.
- Per-agent override rate, eval-pass rate, latency p50/p95, token/cost, guardrail trip rate, and queue backlog are readable from rollup tables over any standard window in **≤1s p95** at multi-year volume, scoped per `organizationId`.
- The autonomy-ramp worker reads **window-complete** rollups (never a partial bucket) with `sampleSize ≥ minSamples`; ad-hoc trace-inspector slices resolve live via `WidgetDataService` without a rollup.
- Cockpit Admin KPI tiles render from rollup rows through the `dashboards` tile contract; fairness-by-cohort rollups populate the compliance spec's `AgentFairnessMetric`.
- With `OM_AGENT_OTEL_EXPORT=off` (default) the full metrics plane works; with it on, spans appear in the external OTLP backend and exporter failures never block ingest.
- `AgentEvalResult` / `AgentEvalCase` / `AgentEvalSuiteRun` persist append-only, retained **≥6 years**, with PII artifacts encrypted in `storage-s3`.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| **Eval harness + metrics substrate are net-new, not reuse of `eval-runner`/`telemetry-and-otel`.** Earlier drafts cited absent tooling. | High | Scope, schedule | This spec scopes both as net-new owned work; lifecycle/cockpit/comply consume *these* outputs. Phase deterministic-first; sequence behind trace tables. | Build cost lands here; mitigated by phasing |
| Online/offline scorer drift defeats the shared-scorer premise | High | Gate correctness | One registry, pure fns, no runtime deps; parity test on a fixed fixture set gates Phase 2 | Low |
| Non-determinism leaks into the gate tier | High | CI flakiness, reproducibility | Only deterministic scorers may carry `severity:'gate'`; `llm_judge` is always `warn` | Low |
| `llm_judge` cost/latency in CI or online | Medium | Cost, queue | Sampled, async, warn-only, capped sample in CI; never on critical path | Sampling can miss issues; tunable |
| Export format churns as a contract surface | Medium | BC | Versioned envelope from day one; ADDITIVE-ONLY per `BACKWARD_COMPATIBILITY.md` | Low |
| Stale rollups mislead the autonomy ramp ("ratio mirage") | High | Safety (GAP-14) | Stamp `computedAt`+`windowStart/End`; ramp reads window-complete buckets only + re-checks eval gate | Medium |
| Aggregation scans heavy on first/backfill run | Medium | DB | Incremental rollup on a `created_at` watermark; index trace tables `(agentDefinitionId, createdAt)` | Low |
| Cross-tenant leak in rollups/reads | High | Tenant isolation | Two-column tenancy on every rollup row; per-tenant scheduler scope; all reads filter `organizationId`; isolation integration test | Low |
| OTel export becomes a de-facto dependency | Low | Coupling | Off by default, fail-open; in-app consumers never read the exporter | Low |
| Rollup vs on-demand divergence (two paths, different numbers) | Medium | Trust | One `MetricsService` defines both; share field defs via the `dashboards` analytics registry | Low |
| Second-runner creep if Vitest added later | Low | CI complexity | Decision recorded: stay Jest/CLI; revisit only with evidence | Low |

## Integration Coverage (GAP-17)

- **Metrics read APIs + tenant scoping** — `GET /agents/:id/metrics` and `GET /metrics?scope&window` return only the caller's-org rollup rows; an explicit cross-tenant isolation test asserts no rollup or read endpoint returns another org's data.
- **Eval CI gate pass/fail** — a fixture release that regresses a safety assertion exits non-zero and writes an `AgentEvalSuiteRun{ outcome:'failed' }`; a passing candidate exits zero and records `passed`; both pin `evalSetVersion`.
- **Online assertion gate** — ingesting a run that fails a deterministic `gate` assertion sets `AgentRun.evalPassed=false`, writes an `AgentEvalResult{ severity:'gate', passed:false }`, and emits `agent_orchestrator.run.evaluated`; an `llm_judge` `warn` result never flips `evalPassed`.
- **Export format** — `GET /eval-cases/export` returns the versioned envelope (`version`, `evalSetVersion`, `generatedAt`, `cases[]`); a round-trip test feeds it to the CLI gate unchanged.
- **Parity** — the same fixture yields identical verdicts through `EvalRuntimeService` (online) and the Jest runner (offline).

## Migration & Backward Compatibility

- Net-new entities `agent_metric_rollups`, `agent_eval_suite_runs` (`agent_` prefix) — additive; no existing module schema changes. Ship MikroORM migration + `.snapshot-open-mercato.json`.
- The **eval-case export format** and the **metric rollup schema** are this module's own contract surfaces. The export envelope (owned by the trace spec) is versioned from day one; the rollup `metricKey` / `measures` shape follows `BACKWARD_COMPATIBILITY.md` STABLE/ADDITIVE-ONLY (new `metricKey`s and new `measures` fields are additive).
- New events (`agent_orchestrator.run.evaluated`, `agent_orchestrator.metrics.rolled_up`), ACL features (`agent_orchestrator.metrics.*`, `agent_orchestrator.eval.*`), and routes are additive.
- New CLI command `agent-orchestrator eval` is additive; it does **not** introduce, depend on, or reference `eval-runner` / Inspect AI / `x_om` / Vitest / `telemetry-and-otel`.
- Reuses `packages/{queue,scheduler,storage-s3}`, `dashboards` `WidgetDataService` + analytics registry, and `ai_assistant` `AiModelFactory` **without modifying** their contracts — depends on, does not extend.

## Final Compliance Report

- **Tenancy:** `agent_metric_rollups` / `agent_eval_suite_runs` carry `tenant_id` + `organization_id`; all reads filter by `organizationId`; per-tenant scheduler scope. ✓
- **ORM:** MikroORM v7 `/legacy`, explicit `@Property`, UUID PK `gen_random_uuid()`, JSON→`jsonb` (Zod in `data/validators.ts`), enums→`varchar` + TS union, no cross-module ORM relations (FK ids only). ✓
- **Append-only / locking:** `agent_eval_suite_runs` append-only (≥6yr); `agent_metric_rollups` upsert-by-key (derived data, not user-editable — no optimistic lock needed). Trace eval tiers append-only per the trace spec. ✓
- **Writes/reads:** rollup/suite-run reads via `makeCrudRoute` + indexer + `openApi`; the rollup write path is a queue worker (derived data, not a user mutation); the CLI gate writes via the harness. ✓
- **Events/ACL:** `module.entity.action` past tense in `events.ts`; `agent_orchestrator.metrics.*` / `agent_orchestrator.eval.*` in `acl.ts` + `setup.ts`. ✓
- **i18n/DS:** any cockpit-facing strings via `i18n/` + `useT`/`resolveTranslations`; status via DS tokens. ✓
- **AI Act:** Art. 12 (≥6yr append-only eval/suite records), Art. 14 (anti-rubber-stamp signals, post-market monitoring metrics). ✓
- **No absent tooling referenced:** harness is Jest-only; metrics are net-new from the trace tables; OTel is an opt-in default-OFF exporter, not a dependency. ✓

## Changelog

- **2026-06-20:** Created. Consolidates GAP-04 (eval harness) + GAP-05 (metrics/observability) into one build spec behind the trace spec's "own eval harness" and the metrics the cockpit/lifecycle/compliance specs consume. Specifies the shared pure-function scorer pattern (online `EvalRuntimeService` ≡ offline Jest CI gate), the sampled `llm_judge` tier via `packages/queue` + `AiModelFactory`, the LIFECYCLE promotion gate semantics, and the hybrid metrics substrate (scheduler+queue rollup tables + `dashboards` `WidgetDataService` ad-hoc + optional default-OFF OTel exporter). Adds two net-new entities (`AgentMetricRollup`, `AgentEvalSuiteRun`); references trace/lifecycle/compliance-owned entities without redefining them. Rejects `vitest-evals` (second-runner tax) and standalone Postgres materialized views (poor OM-fit). Links GAP-14 (override-rate consumer + autonomy gate) and GAP-19 (≥6yr retention of eval/metric tiers).
```
