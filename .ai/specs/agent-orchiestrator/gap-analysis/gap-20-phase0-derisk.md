# Phase-0 De-Risk — Validation Plan

> **Status:** Draft (validation plan) · **Owner:** Patryk Lewczuk (Comerito) · **Created:** 2026-06-19
> **Gap:** GAP-20 · **Priority:** P0-gate (validation) · **Related:** `ADR-001`, `SPEC-00` (§ Consequences "To validate"; § 4 Phase 0), `workflows`, `business_rules`
> **Scope:** The go/no-go gate before committing the agent-orchestration layer to ADOPT `workflows` + `business_rules`. This is a **validation plan**, not a build spec. It does not change `ADR-001` or `SPEC-00`.

---

## 1. Gap statement

`ADR-001` adopts the OM `workflows` engine as the orchestration spine and `business_rules` as the disposition gate ("LLM proposes, OM disposes"). The decision is sound on a code read, but `ADR-001` § Consequences and `SPEC-00` Phase 0 list **three unresolved validations** that must clear before the keystone build (`AGENTINT-01`) starts:

1. **Throughput** — does `workflows` event-sourcing survive thousands of process instances/week × millions of `workflow_events` rows at acceptable p95 step latency and storage growth?
2. **Expressiveness** — can `business_rules` conditions express the composite disposition gate `confidence >= x AND fraud < y AND payout <= z` (nested AND/OR, numeric comparisons) natively?
3. **Edition** — are the `workflows` features the layer relies on (USER_TASK assignment/SLA/escalation, saga/compensation, WAIT_FOR_SIGNAL, parallel fork-join, monitoring) all in `packages/core` (OSS) and not enterprise-gated?

Invariant under test for all three: **"LLM proposes, OM disposes."** The orchestration layer ADOPTS these two modules; this gate confirms that adoption is safe at scale (1), expressive enough (2), and edition-clean (3). Note: `telemetry-and-otel` **does not exist** (spec-only per `SPEC-00` gaps #19/#36) — these spikes must not assume OTel-based metrics; instrument via the engine's own tables.

---

## 2. The three spikes

### Spike 1 — `workflows` event-sourcing throughput  *(the only spike needing a real runtime load test)*

- **Hypothesis:** the executor + event store + `workflow-activities` queue sustain thousands of instances/week × millions of `workflow_events` rows with acceptable p95 step latency and bounded storage growth.
- **Method:** seed a representative claim-shaped definition (USER_TASK + 2 async activities + 1 WAIT_FOR_SIGNAL); drive N=10k instances through `workflowExecutor.startWorkflow()` against Postgres + the real BullMQ queue; backfill `workflow_events` to ~10M rows; measure p95 enter→transition step latency, instance-timeline read latency (`getWorkflowEvents` / instance viewer), queue depth/lag, and table+index growth.
- **Target / pass:** p95 step latency within interactive budget (propose < 250 ms engine overhead excluding activity work); instance-timeline read < 1 s at 10M events; `workflow_events` index growth linear and bounded; no queue starvation at `WORKFLOW_WORKER_CONCURRENCY`.
- **If it FAILS (fallback):** (a) **partition / archive** `workflow_events` by `tenant_id` or time (PK is `bigint autoincrement` — a global sequence, not partitioned today); (b) introduce **snapshotting** — there is currently **no snapshot table**; state is the live `WorkflowInstance.context` jsonb (audit-only events), so timeline reads are the scaling risk, not state rebuild; (c) **queue tuning** (concurrency, batch `logWorkflowEvents`, separate read replica for the monitor). All three are additive and do not change the adoption decision.

### Spike 2 — `business_rules` composite-condition expressiveness  *(verified from code — see § 3)*

- **Hypothesis:** a GUARD/VALIDATION rule can encode `confidence >= 0.9 AND fraud_score < 0.2 AND payout <= 5000` as nested AND/OR with numeric comparisons, no engine change.
- **Method:** author a test rule pack against the real engine (`evaluateExpression`) — a `GroupCondition` tree with the three numeric leaves plus one nested OR — and assert disposition (`allowed`) for pass/fail fixtures. The existing unit suite (`lib/__tests__/expression-evaluator.test.ts`) already covers this shape.
- **Target / pass:** the composite tree evaluates correctly; numeric operators (`>=`, `<`, `<=`, `>`) coerce as expected; nesting within the depth cap (10) and rules cap (50/group) holds.
- **If it FAILS (it does not, for this shape):** extend the `comparisonOperatorSchema` enum **additively** (a contract surface under `BACKWARD_COMPATIBILITY.md`), or precompute a composite score in a `CALCULATION` rule and gate on the scalar.

### Spike 3 — OSS vs Enterprise edition coverage  *(verified from code — see § 3)*

- **Hypothesis:** every `workflows` feature the layer uses ships in `packages/core` (OSS), nothing is enterprise-gated.
- **Method:** enumerate the features in use (USER_TASK assignment/SLA/escalation, saga/compensation, WAIT_FOR_SIGNAL, SUB_WORKFLOW, PARALLEL_FORK/JOIN, monitoring UI) and confirm their definitions + handlers live under `packages/core/src/modules/workflows` with no `feature_toggles`/`license`/edition branch; confirm no `workflows` or `business_rules` module exists under `packages/enterprise`.
- **Target / pass:** all features in core; no edition branch in the hot path.
- **If it FAILS (it does not):** make an explicit edition decision — depend on the enterprise feature (and document the edition requirement) or replace it with a core-equivalent composition (e.g. WAIT_FOR_SIGNAL + EXECUTE_FUNCTION, as `INVOKE_AGENT` already plans).

---

## 3. Evidence already gathered from the code

**`workflows` is OSS, full-featured, event-sourced (`packages/core/src/modules/workflows`):**

- **Event store** — `WorkflowEvent` (`data/entities.ts:565`), append-only, **PK `bigint autoincrement`** (global sequence — relevant to Spike 1 partitioning), indexed `(workflowInstanceId, occurredAt)`, `(eventType, occurredAt)`, `(tenantId, organizationId)`. **No snapshot table** — state is `WorkflowInstance.context` jsonb mutated per step; events are audit/replay-for-read, not the state source. `lib/event-logger.ts` exposes both `logWorkflowEvent` (per-event flush) and batched `logWorkflowEvents` (single flush) — a tuning lever for Spike 1.
- **Step types** (`StepType`): `START | END | USER_TASK | AUTOMATED | PARALLEL_FORK | PARALLEL_JOIN | SUB_WORKFLOW | WAIT_FOR_SIGNAL | WAIT_FOR_TIMER`. **Activity types**: `SEND_EMAIL | CALL_API | EMIT_EVENT | UPDATE_ENTITY | CALL_WEBHOOK | EXECUTE_FUNCTION | WAIT`. Saga/compensation is real (`lib/compensation-handler.ts`, reverse-order, `COMPENSATION_*` events).
- **USER_TASK** carries dynamic assignment (`assignedTo`, `assignedToRoles`), `formSchema`, SLA (`dueDate`, indexed `(status, dueDate)`), and escalation (`escalatedAt`/`escalatedTo`; config `escalationRules` with `sla_breach|no_progress|custom`).
- **Queue** — async activities enqueue to BullMQ `workflow-activities` (`lib/activity-executor.ts`, worker `workers/workflow-activities.worker.ts`, `WORKFLOW_WORKER_CONCURRENCY`); instance parks at `WAITING_FOR_ACTIVITIES` and resumes via `resumeWorkflowAfterActivities()`.
- **Edition** — no `feature_toggles`/`license`/edition branch inside the module (only normal `requireFeatures: ['workflows.*']` ACL guards); **no `workflows` module under `packages/enterprise`** (enterprise has only `record_locks`, `security`, `sso`, `system_status_overlays`).

**`business_rules` condition format is a recursive AND/OR/NOT tree (`packages/core/src/modules/business_rules`):**

The literal schema (`lib/expression-evaluator.ts:8`):

```typescript
export type ConditionExpression = SimpleCondition | GroupCondition
export interface SimpleCondition { field: string; operator: ComparisonOperator; value: any; valueField?: string }
export interface GroupCondition { operator: LogicalOperator /* 'AND' | 'OR' | 'NOT' */; rules: ConditionExpression[] }
```

`evaluateGroupCondition` recurses: `AND → rules.every(...)`, `OR → rules.some(...)`, `NOT → negate`. Operators (`data/validators.ts:28` `comparisonOperatorSchema`): `= == != > >= < <= IN NOT_IN CONTAINS NOT_CONTAINS STARTS_WITH ENDS_WITH MATCHES IS_EMPTY IS_NOT_EMPTY`; numeric coercion via `compare()` (Number-coerces both sides). DoS caps: depth 10, 50 rules/group, 200-char field paths (`createConditionExpressionSchema` superRefine). The requested gate is expressible verbatim:

```json
{ "operator": "AND", "rules": [
  { "field": "confidence",  "operator": ">=", "value": 0.9  },
  { "field": "fraud_score", "operator": "<",  "value": 0.2  },
  { "field": "payout",      "operator": "<=", "value": 5000 } ] }
```

**GUARD pre_transition wiring is real:** `workflows/lib/transition-handler.ts:802` evaluates `eventType: 'pre_transition'` with `ruleType: 'GUARD'`; "if any GUARD rule fails, the transition is blocked" (l.731). `business_rules/lib/rule-engine.ts:417` computes `allowed = guardRules.every(r => r.conditionResult)`. Five rule types confirmed: `GUARD | VALIDATION | CALCULATION | ACTION | ASSIGNMENT`. **This is the "OM disposes" gate already present** — adoption is wiring, not invention.

> **Edition nuance to record, not block:** `business_rules/index.ts` declares `license: 'Proprietary'` in module metadata — but this is a non-gating descriptive field present on 24 core modules (incl. `auth`, `catalog`), not an edition switch. It does not move the module out of OSS placement and has no runtime effect. Flagging so a reader doesn't misread it as an enterprise gate.

---

## 4. Recommendation / preliminary verdict per spike

| Spike | Preliminary verdict | Basis |
|---|---|---|
| 1 — throughput | **INCONCLUSIVE — runtime load test still required** | Architecture supports it (queue, indexes, append-only log), but the global `bigint` event sequence + no-snapshot + monitor-read path are unproven at 10M events. This is the one real spike left. |
| 2 — expressiveness | **PASS (from code)** | Recursive `GroupCondition`/`SimpleCondition` tree with AND/OR/NOT and numeric `>= < <=`; the exact gate is already a tested fixture shape. No engine change needed. |
| 3 — edition | **PASS (from code)** | All used features in `packages/core/workflows`; no enterprise `workflows`/`business_rules` module; no license/edition branch in the engine. `license: 'Proprietary'` metadata is descriptive, not a gate. |

**Overall:** proceed toward adoption; Spikes 2 and 3 clear on code evidence and only need a thin confirming test artifact. **Spike 1 is the single remaining go/no-go** and gates the Phase-0 exit before `AGENTINT-01`.

---

## 5. Effort + who / deps

| Spike | Effort | Owner | Depends on |
|---|---|---|---|
| 1 — throughput load test | **M** (3–5 d) | Platform/backend eng | local Postgres + Redis/BullMQ; a representative claim definition; a seed/driver script |
| 2 — expressiveness test pack | **S** (≤0.5 d) | Backend eng | `business_rules` engine (present); existing `expression-evaluator.test.ts` |
| 3 — edition coverage check | **S** (≤0.5 d) | Backend eng | repo only (static check) |

**Combined effort: M** (Spike 1 dominates). **Key dependency: a runtime load harness against Postgres + BullMQ** (drives Spike 1; Spikes 2–3 are static/unit-level).

---

## 6. Deliverables + Acceptance

**Test artifacts (the deliverables):**

1. **Throughput harness** — a seed/driver (script or integration test) that starts N claim instances, backfills `workflow_events`, and records p95 step latency, timeline-read latency, queue lag, and table/index size. Output: a short results table + a captured pass/fail against § 2 targets.
2. **Composite-condition rule pack + test** — a `GroupCondition` fixture for `confidence>=x AND fraud<y AND payout<=z` (plus one nested OR) with pass/fail data asserting `allowed`, run against the real engine.
3. **Edition coverage report** — a static checklist (feature → file path → OSS/enterprise) covering USER_TASK/saga/WAIT_FOR_SIGNAL/parallel/monitor, asserting all-core and no enterprise `workflows`/`business_rules`.

**Acceptance (Phase-0 exit gate):**

- Spike 1 harness run, results recorded, p95 + storage within § 2 targets — **or** a chosen fallback (partition / snapshot / queue tuning) scoped as an additive follow-up before pilot scale.
- Spike 2 test green: the composite tree disposes correctly; verdict **PASS** confirmed.
- Spike 3 report shows 100% core coverage, no enterprise gate; verdict **PASS** confirmed.
- A one-line go/no-go recorded in `SPEC-00` Phase 0; on go, `AGENTINT-01` unblocks.

---

## Changelog

- **2026-06-19:** Initial validation plan for the Phase-0 de-risk gate (GAP-20). Specified the three spikes (throughput / expressiveness / edition) with hypotheses, methods, pass criteria, and fallbacks; recorded code evidence from `workflows` (event-sourced, OSS, full step/activity/saga/USER_TASK set, BullMQ queue, `bigint` event PK, no snapshot table) and `business_rules` (recursive AND/OR/NOT `ConditionExpression` tree, numeric operators, GUARD pre_transition wiring); preliminary verdicts — Spike 2 **PASS**, Spike 3 **PASS** (both from code), Spike 1 **INCONCLUSIVE** pending a runtime load test (the only remaining spike). Noted the `license: 'Proprietary'` metadata is descriptive, not an edition gate.
