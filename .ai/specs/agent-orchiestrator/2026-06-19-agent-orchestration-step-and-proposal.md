# Agent Orchestration — Step & Proposal/Disposition

> **Status:** Draft · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19 · **Module:** `agent_orchestrator` · **subdomain:** `orchestration` · **Depends:** `workflows`, `business_rules`, `audit_logs`, `auth`, dispatch (`2026-06-19-agent-dispatch.md`), trace (`2026-06-19-agent-trace-eval-capture.md`), context (`2026-06-19-agent-context-knowledge-plane.md`), guardrails (`2026-06-19-agent-runtime-guardrails.md`), identity (`2026-06-19-agent-identity-and-on-behalf-of.md`), conventions (`2026-06-19-agent-orchestrator-conventions.md`)

## TLDR

The keystone that wires agents into Open Mercato's workflow engine. It defines (1) how a `workflows` process invokes an agent and parks for its answer, (2) a typed **AgentProposal** an agent produces, and (3) the convention by which `business_rules` **disposes** of that proposal (auto-approve under threshold, else raise a `USER_TASK`). This is the concrete implementation of "workflows is the spine, agents are steps, business_rules disposes — the LLM proposes, OM disposes." Crucially, `workflows` has **no pluggable activity registry**, so agent invocation ships in two stages: Phase 1 uses existing core activities with zero core change; Phase 2 promotes invocation to a first-class `INVOKE_AGENT` activity type via an additive, contract-governed change to the `workflows` module.

## Overview

`workflows` controls process flow with versioned immutable definitions, event sourcing, compensation/saga, async queue activities, `USER_TASK` (role/dynamic assignment, `formSchema`, SLA, escalation), `WAIT_FOR_SIGNAL` (`workflows/lib/signal-handler.ts`), `SUB_WORKFLOW`, and parallel fork-join. `business_rules` gates transitions with `RuleType` GUARD|VALIDATION|CALCULATION|ACTION|ASSIGNMENT, priorities, and an execution log; GUARD rules already fire on `pre_transition` via `workflows/lib/transition-handler.ts` calling `ruleEngine.executeRules({ eventType: 'pre_transition' })`.

What neither knows: how to call an agent, represent its output as a reviewable proposal, or route that proposal to auto-approval vs. a human. This spec supplies that glue and lives in the `agent_orchestrator` core module (`packages/core/src/modules/agent_orchestrator/`), with orchestration code under `lib/orchestration/`.

## Problem Statement

Agents cannot participate in orchestrated business processes today. There is no way to (a) suspend a workflow while an agent works asynchronously, (b) capture the agent's output as a typed, auditable artifact, (c) decide automatically whether to trust that output or escalate to a person, or (d) guarantee that an agent only ever *proposes* — never executes a side effect under its own authority.

A correctness trap must be avoided: the original design assumed `workflows` exposes a pluggable "activity registry" to register a custom `INVOKE_AGENT` activity and an "agent-proposal step handler." **It does not.** `workflows` activity types are a **fixed enum** dispatched by a `switch` in `workflows/lib/activity-executor.ts` (`SEND_EMAIL`, `CALL_API`, `CALL_WEBHOOK`, `UPDATE_ENTITY`, `EMIT_EVENT`, `WAIT`, `EXECUTE_FUNCTION`). Any design that "registers" a new activity is wrong; agent invocation must either reuse existing activities or modify the enum as a governed contract change.

## Proposed Solution

### Invocation in two stages

**Phase 1 — zero core change (prove the spine).** Model an agent step in a workflow definition as two existing core activities in sequence:

1. An `EXECUTE_FUNCTION` activity that calls `agent_orchestrator`'s `DispatchService.enqueue(...)` (see dispatch spec), creating an `AgentTask` and returning immediately. The function records `{ proposalId, taskId }` into the workflow context.
2. A `WAIT_FOR_SIGNAL` activity that parks the instance until the resume signal `agent_orchestrator.proposal.ready` `{ processId, stepId, proposalId }` fires (handled by `workflows/lib/signal-handler.ts`).

This proves end-to-end orchestration with **no modification to `packages/core/src/modules/workflows`**. The "agent step" is a two-activity convention, documented as a reusable definition snippet.

Parking and resuming an instance here is cheap: `workflows` keeps no snapshot table — instance state is the live `WorkflowInstance.context` jsonb and events are audit-only (their PK is a single global bigint sequence), so rebuilding state on resume reads the current context directly rather than replaying. The throughput risk is not park/resume but the **monitor's timeline-read path** over that global event sequence under load — see GAP-20 for the scaling analysis and indexing/scoping mitigation.

**Phase 2 — promote to first-class (optional, contract-governed).** Add `INVOKE_AGENT` as a new value in the core `workflows` activity-type enum and a corresponding `case` in `workflows/lib/activity-executor.ts` that performs the enqueue-and-park atomically (enqueue the `AgentTask`, then transition the step into the same wait state the signal resumes). This is an **additive change to a contract surface** — the `workflows` activity-type list — governed by `BACKWARD_COMPATIBILITY.md` (types/DB-schema are STABLE/ADDITIVE-ONLY). It therefore requires: the `workflows` module owner's sign-off, a deprecation-safe additive enum extension (existing definitions and the executor `switch` default path unaffected), migration + snapshot for the enum column, and tests. This is **not** "registering in an activity registry" — there is no registry; it is editing the enum and the executor switch.

### Disposition (genuinely Adopt — uses `business_rules` as-is)

When the proposal is ready, a `business_rules` rule pack with `entityType` `'agent_orchestrator:proposal'` decides:

- **VALIDATION rules** encode auto-approve thresholds as composite condition trees — e.g. `confidence ≥ 0.8 AND fraud < 0.4 AND payout ≤ 10000`. This expressiveness is **confirmed in code**, not assumed: `business_rules` evaluates a recursive `GroupCondition`/`SimpleCondition` tree with `AND`/`OR`/`NOT` and numeric operators (`>=`, `<`, `<=`, `>`), bounded by a depth-cap of 10 and 50 rules per group. The disposition gate (`confidence ≥ x AND fraud < y AND payout ≤ z`) is therefore genuinely **Adopt** — wiring an existing capability, not inventing one. Pass → mark the proposal `auto_approved` and let the workflow transition proceed.
- **Otherwise** raise a `workflows` `USER_TASK` (the Decide / Answer / Do / Know verbs) with the proposal payload surfaced via `formSchema`; the instance parks until a human disposes.
- **GUARD rules** on `pre_transition` keep policy enforcement *before* any effector fires. This wiring is **confirmed in code**: `workflows/lib/transition-handler.ts` resolves GUARD rules through the `business_rules` rule-engine and gates the transition with `allowed = guardRules.every(...)` (cf. `workflows/examples/order-approval-guard-rules.json`). See GAP-20 for the read-path scaling considerations when these gates run at volume.

On human disposition: `approved` → proceed; `edited` / `rejected` → write an `AgentCorrection` (append-only; see trace spec) and route per the rule (retry agent, escalate, alternate branch).

### Effectors stay OM-owned

Approved side effects execute via **standard `workflows` activities** — `CALL_API`, `UPDATE_ENTITY`, `CALL_WEBHOOK`, payment activities — **unchanged**. An agent never holds execute rights: it produces a proposal; OM's own authority runs the effector *after* the disposition gate.

### Propose-only is structural, not just policy

Orchestrated agents run in **object mode** (`runAiAgentObject`), and object mode passes **no tools** — the runtime explicitly `void tools` in `agent-runtime.ts` before the model call. So for an orchestrated capability the propose-only guarantee is **structural**, not merely an authorization policy: read context is pre-assembled and fed in via the `ContextBundle` (context spec), the agent emits a single typed `AgentProposal`, and it holds no mutating tools to invoke even if it tried. The INVOKE_AGENT step therefore produces a Proposal by *construction* — the model returns a structured object, never a tool-call side effect. A read-only tool loop (giving the agent scoped read tools to pull additional context mid-run) is an **additive follow-on**, not assumed by this spec; if added later it stays read-only and never grants effector tools.

### Disposition is a non-CRUD Command write

`POST /api/agent_orchestrator/proposals/:id/dispose` `{ disposition, payload?, reason? }` is **not** a `CrudForm` submission, so the automatic guard/lock path does not apply. It MUST:

- run through the **Command pattern** so audit, events, cache, and indexing side effects fire;
- wire the mutation-guard contract: `validateCrudMutationGuard` before, `runCrudMutationGuardAfterSuccess` after;
- enforce **optimistic locking** on `AgentProposal` (which carries `updated_at`) via `enforceCommandOptimisticLock` and surface 409s with `surfaceRecordConflict`.

This explicit Command routing is also what makes the identity-spec invariant "every agent write is audited like a human" *true* (see Architecture → audit invariant), not free.

## Architecture

### Authorization & on-behalf-of

Each agent capability maps to an `agent_orchestrator.*` ACL feature set. The agent runs under a scoped on-behalf-of principal (see identity spec): it may only **PROPOSE** within its grant. **Execution of a disposed proposal runs under OM's own authority** via standard `workflows` effector activities, *after* the gate — agents never hold execute rights directly. External agents authenticate via `api_keys` / A2A and are capability-scoped (see dispatch spec).

### Audit invariant (load-bearing, enforced — not inherited)

`audit_logs` `ActionLog` writes are **not** universally automatic; modules write through the Command path or call `actionLogService.log()`. So "every agent write is audited identically to a human" is an **invariant to enforce**, per the identity spec:

- All agent-originated mutations route through Commands/CRUD (which emit audit + events + index), never raw `EntityManager` writes.
- A **no-bypass test** asserts that no `kind='agent'` actor ever appears on a write that did not pass the audited Command path. Treat this test as a release gate.

### Arbitration

When two agents produce conflicting proposals for the same step (e.g. two damage estimates), a `business_rules` ACTION/CALCULATION rule selects one (highest confidence / policy precedence) or raises a `USER_TASK`. The outcome is recorded as a disposition event (`agent_orchestrator.proposal.disposed`), plus an `AgentCorrection` if a human made the call.

### Flow

```
workflow step (Phase 1: EXECUTE_FUNCTION → WAIT_FOR_SIGNAL | Phase 2: INVOKE_AGENT)
  → DispatchService.enqueue() → AgentTask (dispatch spec)
  → agent runs in object mode (no tools; reads pre-fetched ContextBundle) → emits typed AgentProposal
  → output passes guardrails (guardrails spec)
  → AgentRun + AgentProposal captured (trace spec)
  → emit agent_orchestrator.proposal.ready {processId, stepId, proposalId}  ← resume signal
  → business_rules pack (entityType 'agent_orchestrator:proposal'):
        VALIDATION pass → disposition = auto_approved → transition
        else            → raise USER_TASK → park → human dispose endpoint
  → GUARD (pre_transition) re-checks policy
  → standard effector activity executes under OM authority
```

## Data Models

`AgentProposal` is editable (carries `updated_at` for OSS optimistic locking) and is the canonical entity for this subdomain. Full MikroORM v7 definition (per the conventions doc; `ProposalDisposition` is a varchar string-union, payload is `jsonb` shape-enforced by Zod in `data/validators.ts`):

```typescript
import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type ProposalDisposition =
  | 'pending' | 'auto_approved' | 'approved' | 'edited' | 'rejected'

@Entity({ tableName: 'agent_proposals' })
@Index({ name: 'agent_proposals_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_proposals_process_idx', properties: ['processId', 'stepId'] })
export class AgentProposal {
  [OptionalProps]?: 'disposition' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_id', type: 'uuid' })
  processId!: string // FK id → workflows instance; NOT an ORM relation

  @Property({ name: 'step_id', type: 'varchar', length: 100 })
  stepId!: string

  @Property({ name: 'agent_run_id', type: 'uuid' })
  agentRunId!: string // FK id → agent_runs

  @Property({ name: 'capability', type: 'varchar', length: 100 })
  capability!: string

  @Property({ name: 'payload', type: 'jsonb' })
  payload!: any // shape enforced by per-capability Zod in data/validators.ts

  @Property({ name: 'confidence', type: 'float', nullable: true })
  confidence?: number | null

  @Property({ name: 'disposition', type: 'varchar', length: 20, default: 'pending' })
  disposition: ProposalDisposition = 'pending'

  @Property({ name: 'disposition_by', type: 'varchar', length: 100, nullable: true })
  dispositionBy?: string | null // userId | 'rule:<ruleId>' | null

  @Property({ name: 'disposition_reason', type: 'text', nullable: true })
  dispositionReason?: string | null

  @Property({ name: 'guard_results', type: 'jsonb', nullable: true })
  guardResults?: any | null // from guardrails spec

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
```

Referenced from sibling specs (FK ids only, no cross-module ORM relations): `AgentTask`, `AgentTaskEvent`, `AgentTaskLease` (dispatch spec); `AgentRun`, `AgentSpan`, `AgentToolCall`, `AgentCorrection` (trace spec); `AgentGuardrailCheck` (guardrails spec); `AgentPrincipal`, `AgentDelegationGrant` (identity spec). Per-capability proposal payload schemas are Zod contracts in `data/validators.ts`, re-exported from `index.ts`.

## API Contracts

- **Agent step definition (Phase 1)** — a `workflows` definition snippet: `EXECUTE_FUNCTION` (calls `DispatchService.enqueue({ capability, contextRef, guardrailSet, timeoutMs })`) followed by `WAIT_FOR_SIGNAL` keyed on `agent_orchestrator.proposal.ready`.
- **Agent step definition (Phase 2)** — `INVOKE_AGENT` activity config `{ capability, contextRef, guardrailSet, timeoutMs }`; additive enum value + executor case (contract change).
- **Resume signal** — event `agent_orchestrator.proposal.ready` `{ processId, stepId, proposalId }`.
- **Dispose** — `POST /api/agent_orchestrator/proposals/:id/dispose` `{ disposition, payload?, reason? }`: non-CRUD Command write; mutation-guard + optimistic lock (see Proposed Solution). Callable by the cockpit and by `business_rules` actions.
- **Reads** — `GET /api/agent_orchestrator/proposals` via `makeCrudRoute` + `indexer: { entityType: 'agent_orchestrator:proposal' }`; route file `export const openApi`.
- **Events** (in `events.ts`, `createModuleEvents`, `as const`): `agent_orchestrator.proposal.ready`, `agent_orchestrator.proposal.disposed`, `agent_orchestrator.proposal.corrected` (plus task lifecycle events from the dispatch spec).
- **ACL features** (`acl.ts` + `setup.ts` `defaultRoleFeatures`): `agent_orchestrator.invoke`, `agent_orchestrator.proposal.dispose`, `agent_orchestrator.proposal.view`.

## Phases

1. **Spine, zero core change** — `AgentProposal` entity + Zod + CRUD read route; the Phase-1 two-activity agent-step convention (`EXECUTE_FUNCTION` enqueue → `WAIT_FOR_SIGNAL`); `proposal.ready` resume; internal agents only.
2. **Disposition** — `business_rules` rule pack (`entityType 'agent_orchestrator:proposal'`): VALIDATION auto-approve thresholds, GUARD `pre_transition` policy, `USER_TASK` raise/resume; dispose Command (mutation-guard + optimistic lock); `AgentCorrection` write on edit/reject.
3. **Authz** — on-behalf-of principal binding (identity spec), capability → `agent_orchestrator.*` ACL mapping, no-bypass audit test as a release gate.
4. **Arbitration** — ACTION/CALCULATION rule for multi-proposal selection or `USER_TASK`; disposition event + correction.
5. **First-class invocation (optional)** — additive `INVOKE_AGENT` enum value + executor case in `workflows`, with owner sign-off, migration/snapshot, tests; Phase-1 convention remains supported as the fallback.

## Acceptance

- A workflow whose step uses the Phase-1 convention runs an internal agent, produces an `AgentProposal`, and a VALIDATION rule auto-approves it under threshold; over threshold it raises a `USER_TASK` that, when completed, resumes the workflow.
- An `edited` / `rejected` disposition writes an `AgentCorrection`.
- An agent cannot execute a side effect directly; only a disposed (auto- or human-approved) proposal triggers the standard effector activity, run under OM authority.
- `POST .../dispose` rejects a stale write with a 409 surfaced via the conflict bar (optimistic lock).
- The no-bypass audit test passes: no `kind='agent'` write bypasses the Command path.
- Phase-2 `INVOKE_AGENT` (when shipped) is a strictly additive enum change; all pre-existing workflow definitions execute unchanged.

## Risks & Impact Review

| Scenario | Severity | Area | Mitigation | Residual |
|---|---|---|---|---|
| Implementer assumes a pluggable activity registry that does not exist | High | workflows integration | Phase-1 convention uses only existing activities; Phase-2 is an explicit enum+switch edit, never "registration" | Low |
| `INVOKE_AGENT` enum extension breaks existing definitions/executor | High | contract surface | Additive-only per `BACKWARD_COMPATIBILITY.md`; owner sign-off; migration/snapshot; executor default path untouched; tests | Low |
| Dispose endpoint bypasses audit/events (raw write) | High | audit/security | Command pattern + mutation-guard mandatory; no-bypass test as release gate | Low |
| Concurrent disposition (rule vs human) causes lost update | Medium | data integrity | Optimistic lock on `AgentProposal.updated_at`; 409 + `surfaceRecordConflict` | Low |
| Agent gains de-facto execute rights via overbroad capability | High | authz | Propose-only principal; effectors run under OM authority post-gate; GUARD `pre_transition` | Low |
| Parked instance never resumes (lost `proposal.ready`) | Medium | reliability | Dispatch lease/timeout sweeper (dispatch spec); `dead_lettered` task → failure signal | Medium |
| Cross-tenant proposal exposure | High | tenancy | Dual `tenant_id`+`organization_id`, org-scoped queries, tenant-scoped index | Low |
| Arbitration picks wrong proposal silently | Medium | correctness | Disposition event + `AgentCorrection` audit trail; human override path | Medium |

## Integration Coverage

> Per repo rule, this feature ships executable Playwright integration tests with the change.
> Location: `packages/core/src/modules/agent_orchestrator/__integration__/TC-AGENT-DISP-<NNN>.spec.ts` (orchestration sub-area `DISP`).
> Helpers: `@open-mercato/core/helpers/integration/{auth,api,authFixtures,generalFixtures}` (+ this module's
> `__integration__/helpers/agentFixtures.ts`). All fixtures created in setup (prefer API), cleaned in `finally`/teardown.
> No seeded/demo data; deterministic across retries; rely on global config (`timeout 10s`, `expect.timeout 10s`, `retries 1`).

| API path / UI flow | Method | Must-have tests |
|--------------------|--------|-----------------|
| `POST /api/agent_orchestrator/proposals/:id/dispose` | `POST` | happy path (approve / edit / reject); RBAC/feature-gate (403 without `agent_orchestrator.proposal.dispose`); tenant-isolation (org B token → 404 on org A proposal, never the row); optimistic-lock 409 on stale `updatedAt` surfaced via `surfaceRecordConflict`; `edit`/`reject` persists an `AgentCorrection` |
| `GET /api/agent_orchestrator/proposals` | `GET` | list returns `updatedAt`; org-scoped (org B never sees org A rows); RBAC read (`agent_orchestrator.proposal.view`) |

**Headline E2E — `propose → dispose → effector`:** drive a workflow whose step uses the Phase-1 convention (`EXECUTE_FUNCTION` enqueue → `WAIT_FOR_SIGNAL`) so an internal agent produces an `AgentProposal`, then assert both disposition branches:
- **Auto-approve branch:** with the proposal under the VALIDATION threshold (`confidence ≥ x AND fraud < y AND payout ≤ z`), the `business_rules` pack disposes `auto_approved` (`dispositionBy = 'rule:<ruleId>'`), the instance resumes, the GUARD `pre_transition` re-check passes, and the **downstream standard effector activity executes under OM authority** (assert the effector's observable side effect, e.g. the `UPDATE_ENTITY`/`CALL_API` result).
- **Escalate branch:** over threshold raises a `workflows` `USER_TASK`; a human disposes via `POST .../dispose`; on `approved` the effector runs, on `edited`/`rejected` an `AgentCorrection` is written and the effector does **not** run.

**Propose-only assertion:** assert that an agent step cannot trigger an effector directly — only a disposed (auto- or human-approved) proposal does. (Structural: the object-mode run holds no tools.)

**Dispose RBAC / feature-gate:** a token without `agent_orchestrator.proposal.dispose` gets 403; a token with it succeeds.

**Optimistic-lock 409 on dispose:** read a proposal, mutate it once (rule auto-disposition or a first human dispose), then replay a stale `dispose` with the old `updatedAt` → 409 with the structured conflict body, surfaced via the conflict bar.

**Tenant-isolation (Critical):** two orgs/tenants via `createUserFixture` per org; seed an `AgentProposal` in org A; assert org B's token gets 404/403 (never the row) on dispose, single-read, and CRUD list. Cleanup both in teardown.

**Arbitration of conflicting proposals:** seed two proposals for the same `(processId, stepId)`; assert the ACTION/CALCULATION arbitration rule selects one (highest confidence / policy precedence) and records a `agent_orchestrator.proposal.disposed` event, **or** raises a single `USER_TASK` whose human resolution writes an `AgentCorrection`; assert the non-selected proposal is not auto-effected.

## Migration & Backward Compatibility

- **Phase 1 adds only new tables** (`agent_proposals`, dispatch tables) and a new module — no change to any existing contract surface. Fully backward compatible.
- **Phase 2** touches the `workflows` activity-type enum (a STABLE/ADDITIVE-ONLY contract). Follow the deprecation protocol's additive path: add the enum value without removing or renaming existing ones; the executor `switch` keeps its existing cases and default; ship the migration + `.snapshot-open-mercato.json`; coordinate with the `workflows` owner. Definitions authored before Phase 2 (and the Phase-1 two-activity convention) continue to work indefinitely — Phase 2 is sugar, not a replacement.
- New events, ACL features, and API routes are all additive; no existing ids change.

## Final Compliance Report

- [x] Module at `packages/core/src/modules/agent_orchestrator/`, id `agent_orchestrator`; orchestration under `lib/orchestration/`.
- [x] `AgentProposal` is MikroORM v7 `/legacy`, explicit `@Property`, `tenant_id` + `organization_id`, soft-delete, `updated_at` for optimistic locking.
- [x] FK ids only across modules — no cross-module ORM relations (`processId`, `agentRunId`).
- [x] Zod in `data/validators.ts`; shared contracts re-exported from `index.ts`.
- [x] CRUD reads via `makeCrudRoute` + `indexer` + `openApi`; dispose via Command + mutation-guard + optimistic lock (`surfaceRecordConflict`).
- [x] Events in `events.ts` (`as const`, `module.entity.action` past tense); ACL in `acl.ts` + `setup.ts`.
- [x] No invented workflows "activity registry"; Phase 2 is an additive enum+switch contract change with owner sign-off.
- [x] Disposition uses `business_rules` (VALIDATION/GUARD/ACTION) genuinely as-is; effectors are standard `workflows` activities.
- [x] Audit treated as an enforced invariant (Commands-only + no-bypass test), not inherited.
- [x] i18n via `i18n/<locale>.json`, `useT()`/`resolveTranslations()`; DS status tokens; `apiCall*`; `useGuardedMutation` for non-`CrudForm` writes.

## Changelog

- **2026-06-20:** Applied code-verified cross-cutting corrections and added an `## Integration Coverage` section (per the repo QA rule and GAP-17 template/matrix). Corrections: (1) noted that orchestrated agents run in object mode (`runAiAgentObject`), which passes **no tools** (`void tools` in `agent-runtime.ts`), so propose-only is **structural** — read context is pre-fetched via the `ContextBundle`, the agent emits a typed Proposal, holds no mutating tools; a read-only tool loop is an additive follow-on; (2) recorded that `workflows` has **no snapshot table** (live `WorkflowInstance.context` jsonb; audit-only events keyed on a global bigint sequence) so park/resume is cheap, and flagged the monitor timeline-read path as the throughput risk (cross-ref GAP-20); (3) confirmed in code that `business_rules` supports recursive `GroupCondition`/`SimpleCondition` trees (`AND`/`OR`/`NOT`, numeric `>= < <= >`, depth-cap 10, 50 rules/group) and that GUARD `pre_transition` is wired via `workflows/lib/transition-handler.ts` (`allowed = guardRules.every(...)`), making the disposition gate genuinely Adopt (cross-ref GAP-20). Integration Coverage adds the `propose→dispose→effector` E2E (auto-approve vs USER_TASK escalation), dispose RBAC/feature-gate, optimistic-lock 409, cross-tenant denial, and conflicting-proposal arbitration, anchored to the `.ai/qa` Playwright harness with self-contained fixtures + teardown.
- **2026-06-19:** Rewrote `SPEC-AGENTINT-01` to match real OM conventions and verified architecture. Replaced the non-existent "activity registry / agent-proposal step handler" with a two-stage model (Phase 1: `EXECUTE_FUNCTION`+`WAIT_FOR_SIGNAL` convention, zero core change; Phase 2: additive `INVOKE_AGENT` enum+executor change governed by `BACKWARD_COMPATIBILITY.md`). Replaced pseudocode `@Json()`/`@Enum()` entity with the full MikroORM v7 `AgentProposal` (dual tenancy, optimistic lock). Specified the dispose endpoint as a non-CRUD Command write with mutation-guard + optimistic locking. Tied the "every agent write audited" claim to the enforced no-bypass invariant rather than automatic audit. Corrected module/URL/event/ACL naming to `agent_orchestrator`. Confirmed `business_rules` disposition and standard effector activities as genuine Adopt.
