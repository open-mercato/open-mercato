> 🗂️ **Reorg 2026-06-22 · Status: NOT STARTED (roadmap overlay).** Build this ON TOP of the implemented Agent Orchestrator. Treat the in-process + OpenCode runtimes, the registry/SDK, proposal/disposition, and the data model as already-shipped substrate — align new entities/APIs/events with the live module before implementing. Baseline: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md` · live OpenCode spec: `.ai/specs/2026-06-22-opencode-file-defined-agents.md` · code: `packages/enterprise/src/modules/agent_orchestrator/`.

# Agent Deployment, Budgets & Regression Gating

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Module:** `agent_orchestrator` (core) · **subdomain:** lifecycle · **Depends:** `feature_toggles`, `ai_assistant`, trace spec (`2026-06-19-agent-trace-eval-capture.md`), dispatch spec (`2026-06-19-agent-dispatch.md`)
> **Conventions:** Follows `2026-06-19-agent-orchestrator-conventions.md` (normative for entities, layout, naming).

## TLDR

How agents and their config change safely over time: shadow mode, canary / gradual rollout, gradual autonomy widening, per-tenant/process cost budgets, model routing, and **regression gating**. New agent/model versions must pass an eval gate — run by **this module's own eval harness** over the trace spec's eval-case export — before they are promoted to active. This closes the "ratio mirage" and "silent degradation" risks.

## Overview

The lifecycle subdomain owns the *release* of agent behavior changes. It introduces two entities — `AgentRelease` (a versioned, staged release of an agent definition + model) and `AgentBudget` (token/cost caps per scope) — and a set of capabilities that reuse existing Open Mercato infrastructure rather than building new harnesses:

- **`feature_toggles`** drives canary/gradual rollout by gating the dispatch spec's `TaskRouter` capability→binding selection per tenant. Note (cross-ref GAP-14, dispatch spec): `feature_toggles` has **no native percentage rollout** — it stores boolean/string/number/json values with only per-(toggle, tenantId) overrides, and does **not** bucket dispatches. The deterministic canary split is **computed in `ReleaseService`/`TaskRouter`**: read the toggle value as the rollout percentage, then hash a stable key (e.g. tenant + dispatch key) to bucket each dispatch. The toggle store supplies the percentage; the split logic lives in this module.
- **`ai_assistant`** supplies the runtime levers: per-agent models (`AiModelFactory` / `defaultModel`), mutation-policy, and loop controls including `loop.budget`. Cost budgets and model routing hook into these.
- **The trace spec** supplies the eval-case export and the model-comparison view used for shadow comparison and for the override-rate / eval-pass metrics that drive the autonomy ramp.

There is **no external eval harness** (no `eval-runner`, no Inspect AI, no `x_om` task format, no telemetry/OTel module). The eval harness is **net-new and built inside `agent_orchestrator`** — now detailed in the consolidating spec `2026-06-20-agent-eval-harness-and-metrics.md` (cross-ref). Regression gating is a CI step that runs **this module's own eval harness** over the trace spec's eval-case export and enforces the gate at promotion time.

## Problem Statement

`ai_assistant` has per-agent runtime config (models, mutation-policy, loop controls) but no controlled rollout, no autonomy ramp tied to override rate, no enforced cost budgets, and no gate that blocks promotion on eval regressions. Today changes go straight to production with no shadow comparison, no canary, and no safety-assertion regression check. A regressed model or prompt can silently degrade quality or widen autonomy beyond what its measured override rate justifies.

## Proposed Solution

1. **Shadow mode.** Run a candidate `AgentRelease` (`stage='shadow'`) alongside the production binding on identical inputs, producing **no side effects** (mutation-policy forced to propose-only; no Commands executed). Compare candidate vs production using the trace spec's model-comparison view.
2. **Canary / gradual rollout.** `stage='canary'` with `rolloutPct`. A per-tenant `feature_toggles` flag stores the rollout percentage; `feature_toggles` does **not** bucket dispatches itself (cross-ref GAP-14, dispatch spec). The dispatch `TaskRouter` reads that percentage and **computes the deterministic split** by hashing a stable key (tenant + dispatch key) so the configured percentage of dispatches route to the candidate.
3. **Gradual autonomy.** `AgentRelease.autonomy` (`gated → review → auto`) widens at most one step per evaluation window when the agent's override rate (trace metrics) stays below a configured threshold, subject to a `minSamples` floor and hysteresis. The ramp logic lives in a `packages/scheduler` worker (cross-ref GAP-14). The final jump to `'auto'` is **human-confirmed via the audited promote command, never machine-made**. Surfaced read-only in the cockpit registry.
4. **Cost budgets.** `AgentBudget` per `tenant | processType | agent`. `onExceed` (`warn | gate | block`) is enforced via `ai_assistant` `loop.budget` as the runtime hook. Breaching the budget emits `agent_orchestrator.budget.exceeded` → notifications.
5. **Model routing.** Select a model per task (cheap vs capable) under the active budget and the capability's constraints, via `AiModelFactory`.
6. **Regression gating.** A CI step runs **this module's own eval harness** (detailed in `2026-06-20-agent-eval-harness-and-metrics.md`) over the trace spec's eval-case export (production corrections + golden runs). Promoting an `AgentRelease` to `stage='active'` is blocked unless the candidate meets `evalGate` and introduces no safety-assertion regressions.

## Architecture

- **Placement:** `packages/enterprise/src/modules/agent_orchestrator/`, lifecycle code under `lib/lifecycle/` (`ReleaseService`, `BudgetService`, `EvalGateRunner`). **No `EvalHarness` here** — the harness lives in `lib/eval/`, owned by `2026-07-19-agent-eval-workbench-and-gate.md`; `EvalGateRunner` only calls its exported `runEvalGate()`. Entities in `data/entities.ts`; Zod in `data/validators.ts`.
- **Rollout control:** `ReleaseService` reads/writes `feature_toggles` flags (one flag per agent rollout, e.g. `agent_orchestrator.release.<agentDefinitionId>`) whose value is the per-tenant rollout **percentage**. `feature_toggles` does not bucket — it only stores the percentage with per-(toggle, tenantId) overrides (cross-ref GAP-14, dispatch spec). The deterministic split is computed in code: the dispatch `TaskRouter` reads the toggle value and hashes a stable key (tenant + dispatch key) to decide whether each dispatch routes to the candidate. Lifecycle does not duplicate routing logic; it supplies the percentage and the bucketing contract.
- **Autonomy ramp:** the gradual-autonomy controller is a `packages/scheduler` worker (cross-ref GAP-14) that reads override-rate metrics from the trace spec's tables and advances `AgentRelease.autonomy` **at most one step per evaluation window** (`gated → review → auto`), gated by an override-rate threshold **plus** a `minSamples` floor **plus** hysteresis (so it does not flap around the threshold). It never *narrows* autonomy automatically beyond raising it. The final jump to `'auto'` is **never machine-made**: the worker may surface a release as eligible, but promotion to full autonomy is **human-confirmed** via the audited promote command.
- **Budget enforcement:** `BudgetService` resolves the applicable `AgentBudget` for a dispatch and projects it into the `ai_assistant` agent loop as a `loop.budget` constraint. The loop reports consumption; on exceed the service applies `onExceed` policy and emits the event.
- **Eval harness:** the harness itself is **owned by `2026-07-19-agent-eval-workbench-and-gate.md`**, which exports `runEvalGate({ agentDefinitionId, evalSetVersion, baselineSuiteRunId?, repeatCount?, scope }) => { suiteRunId, passScore, safetyRegressions, outcome }` and owns `agent_eval_suite_runs`. `EvalGateRunner` (this spec, `lib/lifecycle/`) is a thin caller: it invokes `runEvalGate`, compares `passScore` against `evalGate.requiredPassScore`, and blocks on a non-empty `safetyRegressions`. **Dependency arrow: lifecycle → eval, one-way** — this spec must not own eval entities. Until that spec's Phase 5 lands, degrade the gate to advisory (`outcome: 'advisory'`), as originally planned. Invoked from CI and from the promote endpoint.
- **Tenancy:** every row carries `tenant_id` and `organization_id`; all reads filter by `organizationId`. No cross-module ORM relations — `agentDefinitionId`, `processType`, etc. are FK ids only.

## Data Models

Both entities are user-editable, so both expose `updated_at` and return `updatedAt` in their list/detail APIs (optimistic locking, default ON).

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type ReleaseStage = 'shadow' | 'canary' | 'active' | 'retired'
export type ReleaseAutonomy = 'gated' | 'review' | 'auto'

@Entity({ tableName: 'agent_releases' })
@Index({ name: 'agent_releases_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_releases_agent_stage_idx', properties: ['agentDefinitionId', 'stage'] })
export class AgentRelease {
  [OptionalProps]?:
    | 'stage' | 'rolloutPct' | 'autonomy' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'agent_definition_id', type: 'varchar', length: 150 })
  agentDefinitionId!: string // FK id → ai_assistant agent definition

  @Property({ name: 'version', type: 'varchar', length: 50 })
  version!: string

  @Property({ name: 'model', type: 'varchar', length: 150 })
  model!: string // resolved via ai_assistant AiModelFactory

  @Property({ name: 'stage', type: 'varchar', length: 20, default: 'shadow' })
  stage: ReleaseStage = 'shadow'

  @Property({ name: 'rollout_pct', type: 'int', default: 0 })
  rolloutPct: number = 0 // canary percentage, gated via feature_toggles

  @Property({ name: 'autonomy', type: 'varchar', length: 20, default: 'gated' })
  autonomy: ReleaseAutonomy = 'gated'

  // Subject-under-test pinning — added by 2026-07-19-agent-eval-workbench-and-gate.md §3.6.
  // Without these, `agentDefinitionId` + a free-form `version` + a `model` id string pin NOTHING
  // reproducible: two gate runs of the same release id can execute different prompts, and the gate
  // certifies code that no longer runs (see gap-analysis/2026-07-07-security-analysis-gap-review.md).
  @Property({ name: 'prompt_hash', type: 'varchar', length: 64 })
  promptHash!: string // sha256 over resolved instructions + tool ids + skill ids

  @Property({ name: 'definition_snapshot', type: 'jsonb' })
  definitionSnapshot!: any // resolved instructions, tool/skill ids, default model, resultKind, output JSON Schema

  @Property({ name: 'eval_gate', type: 'jsonb' })
  evalGate!: any // { requiredPassScore: number; evalSetVersion: string }; Zod in data/validators.ts
  // NOTE: safety-regression blocking is UNCONDITIONAL — deliberately not a configurable flag.

  @Property({ name: 'eval_result', type: 'jsonb', nullable: true })
  evalResult?: any | null // denormalized copy of the latest gate AgentEvalSuiteRun; Zod in data/validators.ts

  @Property({ name: 'promoted_by', type: 'varchar', length: 100, nullable: true })
  promotedBy?: string | null // userId

  @Property({ name: 'promoted_at', type: Date, nullable: true })
  promotedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export type BudgetScope = 'tenant' | 'process_type' | 'agent'
export type BudgetOnExceed = 'warn' | 'gate' | 'block'

@Entity({ tableName: 'agent_budgets' })
@Index({ name: 'agent_budgets_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_budgets_scope_idx', properties: ['scope', 'scopeRef'] })
export class AgentBudget {
  [OptionalProps]?:
    | 'onExceed' | 'windowTokens' | 'windowCostMinor' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'scope', type: 'varchar', length: 20 })
  scope!: BudgetScope

  @Property({ name: 'scope_ref', type: 'varchar', length: 150, nullable: true })
  scopeRef?: string | null // processType id or agentDefinitionId; null for tenant scope

  @Property({ name: 'window_tokens', type: 'bigint', nullable: true })
  windowTokens?: number | null

  @Property({ name: 'window_cost_minor', type: 'bigint', nullable: true })
  windowCostMinor?: number | null // minor currency units

  @Property({ name: 'currency', type: 'varchar', length: 3, nullable: true })
  currency?: string | null

  @Property({ name: 'on_exceed', type: 'varchar', length: 10, default: 'warn' })
  onExceed: BudgetOnExceed = 'warn'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

## Capabilities

- **Shadow mode** — `stage='shadow'` runs the candidate on the same inputs as production with mutation-policy forced to propose-only (no Commands, no side effects). Comparison uses the trace spec's model-comparison view; the trace spec owns that view.
- **Canary / gradual rollout** — a per-tenant `feature_toggles` flag stores the rollout percentage; `feature_toggles` does not bucket (cross-ref GAP-14, dispatch spec). The dispatch `TaskRouter` reads the percentage and computes the deterministic split by hashing a stable key (tenant + dispatch key). `rolloutPct` on the release mirrors the flag's configured percentage.
- **Gradual autonomy ramp** — a `packages/scheduler` worker (cross-ref GAP-14) advances `autonomy` (`gated → review → auto`) at most one step per evaluation window as the agent's override rate (trace metrics) drops below the configured threshold, gated by a `minSamples` floor and hysteresis. Surfaced read-only in the cockpit registry. Never widened past what the metrics justify, and the final jump to `'auto'` is **human-confirmed via the audited promote command, never machine-made**.
- **Cost budgets** — `AgentBudget` per `tenant | processType | agent`. Enforced at runtime via `ai_assistant` `loop.budget`; `onExceed` warns (log + event), gates (route to human review), or blocks (refuse dispatch). Breach emits `agent_orchestrator.budget.exceeded` → notifications.
- **Model routing** — select a model per task under the active budget and the capability's constraints, resolved through `ai_assistant` `AiModelFactory` (cheap model when budget is tight or task is simple; capable model otherwise).
- **Regression gating** — **this module's own eval harness** (detailed in `2026-06-20-agent-eval-harness-and-metrics.md`) runs the trace spec's eval-case export (production corrections + golden runs) in CI and at promotion. Promotion to `stage='active'` is blocked unless the candidate meets `evalGate` and introduces no safety-assertion regressions versus the production baseline.

## API Contracts

CRUD reads via `makeCrudRoute` + indexer (`entityType: 'agent_orchestrator:agent_release'` / `'agent_orchestrator:agent_budget'`) + `export const openApi`. Routes under `/api/agent_orchestrator/lifecycle/...`.

- `GET /api/agent_orchestrator/lifecycle/releases` — list releases (CRUD, returns `updatedAt`).
- `GET /api/agent_orchestrator/lifecycle/releases/:id` — release detail.
- `POST /api/agent_orchestrator/lifecycle/releases/:id/promote` — **custom write.** Promotes to the next stage; promotion to `active` runs the eval harness via `EvalGateRunner` (→ `runEvalGate`) and blocks (409/422) on gate failure or safety-assertion regression. **Additionally recomputes `promptHash` from the live agent definition and returns 409 on mismatch** — a gate verdict is only valid for the subject it was measured against. Wired through the Command pattern with mutation-guard (`validateCrudMutationGuard` / `runCrudMutationGuardAfterSuccess`) and optimistic locking (`enforceCommandOptimisticLock`, surface 409 via `surfaceRecordConflict`).
- `GET /api/agent_orchestrator/lifecycle/budgets?scope=<tenant|process_type|agent>[&scopeRef=...]` — list budgets for a scope (CRUD).
- Budgets are created/edited via `makeCrudRoute` write paths; `agent_orchestrator.budget.exceeded` is emitted at runtime by `BudgetService`, not by an API call, and fans out to notifications.

CI does **not** call `eval-runner`. The regression-gate CI step invokes **this module's own eval harness** (detailed in `2026-06-20-agent-eval-harness-and-metrics.md`; e.g. `yarn mercato agent-orchestrator eval --release <id> --gate`) over the trace spec's eval-case export and fails the job on gate failure.

## Phases

1. `AgentRelease` entity + Zod + CRUD + shadow mode (propose-only candidate run) + wiring to the trace spec's model-comparison view.
2. Canary rollout via `feature_toggles` gating the dispatch `TaskRouter`; gradual-autonomy ramp worker from override-rate metrics.
3. `AgentBudget` entity + CRUD + budget enforcement via `ai_assistant` `loop.budget`, `budget.exceeded` event + notifications, and model routing via `AiModelFactory`.
4. `prompt_hash` + `definition_snapshot` on `AgentRelease`; `EvalGateRunner` as a thin caller of `runEvalGate()` (harness owned by `2026-07-19-agent-eval-workbench-and-gate.md`, **not built here**); regression-gated `promote` endpoint, incl. the 409 on prompt-hash mismatch, and the CI gate step. Blocked on that spec's Phase 5; degrade to advisory until then.

## Acceptance

- A candidate `AgentRelease` runs in shadow on identical inputs with no side effects and is comparable to production via the trace spec's model-comparison view.
- A new release cannot be promoted to `active` if it fails `evalGate` or regresses a safety assertion in the eval set; the `promote` endpoint returns a blocking error.
- An agent's `autonomy` widens automatically only when its override rate is under threshold for the window (subject to `minSamples` + hysteresis), and only one step at a time; the final jump to `'auto'` is human-confirmed via the audited promote command, never machine-made.
- A dispatch exceeding its `AgentBudget` warns / gates / blocks per `onExceed`, emits `agent_orchestrator.budget.exceeded`, and notifies.
- Canary rollout routes the configured per-tenant percentage of dispatches to the candidate via `feature_toggles`.
- `releases` and `budgets` list/detail APIs return `updatedAt`; `promote` enforces optimistic locking.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual |
|------|----------|---------------|------------|----------|
| The eval harness this gate depends on is net-new — built in the trace spec, **not** an existing `eval-runner` — so the gate cannot ship before the trace spec's harness + eval-case export exist | High | Regression gating, CI | Sequence phases behind the trace spec; treat the harness as an explicit cross-spec dependency; degrade the CI gate to advisory until the harness lands | Gate inert until trace spec ships its harness |
| Shadow candidate accidentally produces side effects | High | Data integrity | Force mutation-policy to propose-only for `stage='shadow'`; no Commands executed; covered by a no-side-effect test | Low |
| Autonomy ramp widens on a misleading override rate ("ratio mirage") | High | Safety | Window-based threshold over trace metrics with a `minSamples` floor + hysteresis; one-step widening per window via the `packages/scheduler` worker; eval gate must still pass; the final jump to `'auto'` is human-confirmed via the audited promote command, never machine-made | Low |
| Budget enforcement diverges from real `ai_assistant` loop consumption | Medium | Cost control | Enforce via `loop.budget` (single source of truth for consumption); reconcile in `BudgetService` | Medium |
| `feature_toggles` canary flag drifts from `rolloutPct` | Medium | Rollout correctness | `ReleaseService` is the only writer of both; flag is derived from the release | Low |
| Misreading `feature_toggles` as a native %-rollout bucketer | Medium | Rollout correctness | `feature_toggles` only stores the percentage (per-(toggle, tenantId) overrides); the deterministic split is computed in `ReleaseService`/`TaskRouter` by hashing a stable key — never delegated to the toggle store (cross-ref GAP-14) | Low |
| Promote endpoint bypasses audit/lock | Medium | Governance | Command pattern + mutation-guard + optimistic lock on `/promote` | Low |
| Cross-tenant leakage of releases/budgets | High | Tenant isolation | `tenant_id` + `organization_id` on every row; all reads filter by `organizationId` | Low |

## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change (see `.ai/qa/AGENTS.md` + `.ai/skills/om-integration-tests/SKILL.md`, GAP-17).
> Location: `packages/enterprise/src/modules/agent_orchestrator/__integration__/TC-AGENT-LIFE-<NNN>.spec.ts`
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` (+ this module's
> `__integration__/helpers/agentFixtures.ts` — release/budget fixtures + two-org isolation helper). All fixtures created in setup (prefer API), cleaned in `finally`/teardown.
> No seeded/demo data; deterministic across retries; rely on global config (`timeout 10s`, `expect.timeout 10s`, `retries 1`).

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| `POST /api/agent_orchestrator/lifecycle/releases/:id/promote` | `POST` | **Promote-gate E2E (headline):** promotion to `active` runs the eval harness (`EvalGateRunner`) over the trace eval-case export and **blocks (409/422) on gate failure or safety-assertion regression**; happy promote on pass; **optimistic-lock 409** on stale `updatedAt` via `surfaceRecordConflict`; RBAC (403 without `agent_orchestrator.release.promote`); Command-path audited (`promotedBy`/`promotedAt` set); **tenant-isolation** (org B cannot promote org A's release) |
| `GET /api/agent_orchestrator/lifecycle/releases` · `/releases/:id` | `GET` | list/detail return `updatedAt`; org-scoped; RBAC read; **tenant-isolation** (org B 404 on org A release) |
| `GET /api/agent_orchestrator/lifecycle/budgets?scope=` | `GET` | list returns `updatedAt`; scope filter (`tenant`/`process_type`/`agent`); org-scoped; RBAC read; **tenant-isolation** |
| Budget create/edit (CRUD write paths) | `POST`/`PUT` | happy path; RBAC (`agent_orchestrator.budget.*`); **optimistic-lock 409** on stale edit; **tenant-isolation** |
| Candidate shadow run | E2E | a `stage='shadow'` candidate runs on **identical inputs** with **no side effects** — mutation-policy forced to propose-only, **no Commands executed, no workflow resume** (isolation assertion); comparable to production via the trace model-comparison view |
| Autonomy ramp | E2E | `autonomy` widens **only when override-rate is under threshold** for the window (subject to `minSamples` + hysteresis) and **one step per window**; the worker never auto-jumps to `'auto'` — the final jump requires **human confirmation via the audited promote command** |
| Canary split determinism | E2E | for a fixed `rolloutPct` and tenant, the computed split (hash of stable tenant + dispatch key) is **deterministic per tenant** across repeated dispatches; `feature_toggles` only supplies the percentage, the bucketing is computed in code |
| Budget breach | E2E | a dispatch exceeding its `AgentBudget` **warns / gates / blocks per `onExceed`** (`block` refuses dispatch); emits `agent_orchestrator.budget.exceeded` → notification |

**Tenant-isolation harness (mandatory for every entity surface):** create two orgs/tenants
(`createUserFixture` per org), seed an `AgentRelease` and `AgentBudget` in org A, assert org B's token gets 404/403 (never the row)
on read, the `promote` custom write, and CRUD list. Cleanup both in teardown.

## Migration & Backward Compatibility

- Net-new entities (`agent_releases`, `agent_budgets`) and net-new routes under `/api/agent_orchestrator/lifecycle/` — additive, no existing contract changes. Ship migration + `.snapshot-open-mercato.json`.
- New event id `agent_orchestrator.budget.exceeded` declared in `events.ts` (`as const`, `module.entity.action`, past tense). Additive.
- New ACL features (`agent_orchestrator.release.*`, `agent_orchestrator.budget.*`) in `acl.ts` + `setup.ts` `defaultRoleFeatures`; run `yarn mercato auth sync-role-acls`. Additive.
- Reuses existing `feature_toggles` and `ai_assistant` contracts (`loop.budget`, `AiModelFactory`) without modifying them — depends on, does not extend.
- No `eval-runner`, Inspect AI, `x_om`, or telemetry/OTel module is introduced or referenced; the eval harness is internal to `agent_orchestrator` (trace spec).

## Final Compliance Report

- Core module `agent_orchestrator`; tables prefixed `agent_` (`agent_releases`, `agent_budgets`). ✓
- Both `tenant_id` and `organization_id`; all reads filter by `organizationId`. ✓
- MikroORM v7 `/legacy` decorators, `OptionalProps`, explicit `@Property` snake-case names, UUID PK `defaultRaw`, `created_at`/`updated_at`/`deleted_at`, editable entities expose `updated_at`, JSON→`jsonb` (Zod in `data/validators.ts`), enums→`varchar` + TS union, no shorthand, no cross-module ORM relations (FK ids only). ✓
- CRUD reads via `makeCrudRoute` + indexer + `openApi`; custom write (`promote`) via Command + mutation-guard + optimistic lock. ✓
- ACL `agent_orchestrator.*` in `acl.ts` + `setup.ts`; events via `createModuleEvents` (`agent_orchestrator.budget.exceeded`); i18n for all user-facing strings. ✓
- Reuses `feature_toggles` (canary), `ai_assistant` (`loop.budget`, `AiModelFactory`, mutation-policy), trace spec (eval cases, model-comparison, metrics), dispatch spec (`TaskRouter`). ✓
- No external eval harness / telemetry module referenced. ✓

## Changelog

- **2026-07-19:** Reconciled with `2026-07-19-agent-eval-workbench-and-gate.md`, which owns the eval harness and `agent_eval_suite_runs`. This spec **retains** `AgentRelease`, `AgentBudget`, the `/lifecycle/releases` routes, `release.*`/`budget.*` ACLs, shadow/canary and the autonomy ramp; the dependency arrow stays **lifecycle → eval, one-way** (an earlier draft of that spec absorbed `AgentRelease`, which would have inverted it into a cycle and left Phases 1–3 here blocked on the last phase there). Three upstream additions accepted from it: `prompt_hash` varchar(64) and `definition_snapshot` jsonb on `AgentRelease` — without them `version` is a free-form label and a gate run is not reproducible (`gap-analysis/2026-07-07-security-analysis-gap-review.md`) — and a **409 on prompt-hash mismatch** at `promote`, additional to the existing gate blocks. `EvalGateRunner` reduced to a thin caller of the exported `runEvalGate()`. Recorded that safety-regression blocking is **unconditional** and deliberately not a configurable flag.
- **2026-06-20:** Corrected the canary-rollout framing — `feature_toggles` has **no native percentage rollout** (it stores boolean/string/number/json with only per-(toggle, tenantId) overrides and does not bucket); the deterministic split is now stated as **computed in `ReleaseService`/`TaskRouter`** by reading the toggle value as the percentage and hashing a stable key to bucket each dispatch (cross-ref GAP-14, dispatch spec; added a Risks row). Clarified the gradual-autonomy controller as a `packages/scheduler` worker that advances `gated → review → auto` **one step per window** under override-rate threshold + `minSamples` + hysteresis, with the final jump to `'auto'` **human-confirmed via the audited promote command, never machine-made** (Overview, Solution, Architecture, Capabilities, Acceptance, Risks). Cross-referenced the consolidating eval-harness spec `2026-06-20-agent-eval-harness-and-metrics.md` everywhere the regression gate runs **this module's own eval harness**. Added a `## Integration Coverage` section (per GAP-17) covering the promote-gate E2E, shadow no-side-effect/no-resume isolation, autonomy widening + human-confirm, deterministic per-tenant canary split, budget breach `onExceed`, promote RBAC + optimistic lock, and the mandatory two-org tenant-isolation harness, anchored to the `.ai/qa` Playwright helpers with self-contained fixtures + teardown.
- **2026-06-19:** Rewritten from `SPEC-LIFECYCLE-01` to real Open Mercato conventions and the verified architecture. Corrected: package framing → core module `agent_orchestrator`; pseudocode entities → full MikroORM v7 `AgentRelease` + `AgentBudget` (renamed from `Budget`); single-column tenancy → dual `tenant_id`/`organization_id`; URLs → `/api/agent_orchestrator/lifecycle/...`. Removed all references to `eval-runner` / Inspect AI / `x_om` / telemetry-OTel; regression gating now runs **this module's own eval harness** (built in the trace spec) over the trace spec's eval-case export as a CI step. Budgets enforced via `ai_assistant` `loop.budget`; rollout via `feature_toggles` gating the dispatch `TaskRouter`.
