# Business Process ↔ Workflow Unification

**Date:** 2026-09-06 · **Status:** in progress
**Supersedes:** [`2026-08-11-triggered-process-model.md`](./2026-08-11-triggered-process-model.md) (W1) — its rename lands, its three-record model does not.
**Companion:** [`2026-08-11-agent-taxonomy.md`](./2026-08-11-agent-taxonomy.md) (W2) owns the proposal envelope this consumes; §7 below extends its result vocabulary.
**Scope:** enterprise `agent_orchestrator`, plus two additive changes to core `workflows` (a step milestone annotation, §6).
**Breaking:** yes, deliberately and without shims — the branch is unpublished.

## TLDR

The module runs **two execution engines**. `AgentProcessRun` owns a `running →
completed|failed` lifecycle of its own, and a `WorkflowInstance` owns another, and a business
process can bypass the workflow engine entirely (`target_type = 'agent'`). Everything awkward
in the module follows from that split.

This spec collapses it to **one durable execution with one lifecycle owner:
`WorkflowInstance`**. A business process becomes a business-facing *projection* over workflow
execution, never a second engine.

## The five rules

1. **One durable execution, one lifecycle owner: `WorkflowInstance`.**
2. **Agents produce intelligence; workflows orchestrate; commands mutate the domain.**
3. **`AgentRun` records one agent execution. It is not a business process.**
4. **Milestones are business events emitted by workflows, never aliases for workflow steps.**
5. **Business Process is a stable business-facing abstraction over workflow execution, never
   a second workflow engine.**

## Problem statement

### 1. Two lifecycles for one execution

`agent_process_runs.status` and `workflow_instances.status` both claim to say whether the
business execution is finished. They are kept in sync by a pair of subscribers
(`task-run-workflow-completed` ↔ `agent-process-workflow-completed`) that can diverge on
redelivery, on a worker crash between the two writes, or when the instance parks at a
`USER_TASK` for a week. Two statuses is one status too many.

### 2. A process can skip the engine

`target_type = 'agent'` runs `agentRuntime.run()` directly from a queue worker. That path has
no retry semantics, no wait states, no signals, no cancellation, no branch context and no
recovery — every capability the workflow engine already implements, absent because the
process declined to use it. It exists only because a one-agent process felt too small to
deserve a workflow.

### 3. `AgentRun` is correlated by time, not by identity

`workers/task-run-executor.ts` finds the run it just caused with

```ts
em.find(AgentRun, { organizationId, agentId, createdAt: { $gte: startedBefore } },
        { orderBy: { createdAt: 'desc' }, limit: 1 })
```

Two concurrent runs of the same agent in the same organization are indistinguishable. The
same shape appears in `invokeAgentForWorkflow` (`orderBy: { createdAt: 'DESC' }` over pending
proposals). Correlation must be an explicit identifier, never a temporal lookup.

### 4. Milestones are step aliases

`ProcessMilestone = { id, label, stepId, order }` binds a business stage to one workflow step.
A stage reached after a `PARALLEL_JOIN`, after a retry, or after ten steps has no honest
representation, and the mapping silently drifts when a step is renamed —
`collectMilestoneIssues` exists solely to report that drift.

### 5. Two execution-identity subsystems

`agent_process_definitions` provisions a `task:<id>` `AgentPrincipal` from its own
`granted_features`. Core `workflows` already provisions an `auth` execution principal from
`WorkflowDefinition.grantedFeatures`, per version, behind a dedicated
`workflows.definitions.grant_features` gate. Two least-privilege systems for one run.

### 6. The external surface leaks internal topology

`AgentRun` — an immutable telemetry record — is reachable as if it were a durable business
job, and `POST /agents/:id/run` reads like a business API. An external caller should never
have to know how many agents a process uses, which runtime executed them, or which workflow
step they sat on.

### 7. Auto-approval is a bare confidence comparison

`confidence >= threshold` (plus an optional near-tie margin) authorizes a mutation. Confidence
is the model's evidence about itself; it is not an authorization decision, and it knows
nothing about the risk of the action, the guardrail verdict, the completeness of the trace or
the tenant's policy.

## Target model

```
ProcessDefinition ──1:1──> WorkflowDefinition ──1:N──> WorkflowInstance
       │                     (owns grantedFeatures        SOURCE OF TRUTH:
       │                      → execution identity)       status, retry, waiting,
       │                                                  cancellation, context
       │                                                        │
       └── declares: input schema, outcome schema,              ├──> AgentRun (N)
           milestone vocabulary, triggers, UI meta              └──> workflow activities
                                                                     │
                          ProcessInstance  <──── projection ─────────┘
                          derived status · milestones reached · proposals
                          dispositions · outcome · subject · aggregates
```

```
AgentRun ──> ResearchResult   enriches context (workflow decides what to keep)
         ──> ProposalResult ──> Disposition ──> Effector ──> Command ──> Domain effect
         ──> ArtifactResult   produces a file/document, mutates nothing
```

### `ProcessDefinition` (`process_definitions`)

The business definition: *why* we do this. It points at a workflow; it never restates the
workflow's execution semantics.

| Field | Note |
|---|---|
| `name`, `description` | |
| `workflowId` | **required** — `WorkflowDefinition.workflowId`, FK id only |
| `inputSchema`, `inputDefaults` | unchanged (`inputDefaults` stays encrypted) |
| `outcomeSchema` | **new** — the business outcome contract |
| `milestones` | `{ key, label, order }` — a **vocabulary**, no `stepId` |
| `triggers` | unchanged: `schedule` \| `event` \| `manual`, jsonb, GIN-indexed |
| `uiMetadata` | **new**, optional |
| `enabled`, `createdBy`, timestamps | unchanged |

**Removed:** `targetType`, `targetAgentId`, `executionPrincipalId`, `grantedFeatures`.

### `ProcessInstance` (`process_instances`)

One row per `WorkflowInstance` that a business reader cares about. A **projection**: every
field is recomputed from the instance, the agent rows and the milestone events, and the row is
fully rebuildable (`rebuild-processes` CLI). It decides nothing.

It absorbs the columns that only the deleted ledger carried — `processDefinitionId`
(nullable: a Studio-started instance still projects), `triggeredBy`, `idempotencyKey`,
`input`, `sourceEntityType/Id`, `outcomeType/Id/Label`, `failureReason` — plus a new
`milestonesReached` (`[{ key, at, data? }]`).

Two indexes carry meaning:

- live partial-unique on `(tenant_id, organization_id, workflow_instance_id)` — the 1:1;
- partial-unique on `(organization_id, process_definition_id, idempotency_key)` — the
  business-execution idempotency lock (§8).

`status` remains **derived** (`lib/processes/agentProcessProjection.ts`) and is never
independently transitioned. There is exactly one authoritative status in the system and it
lives on `workflow_instances`.

### Deleted outright

`AgentProcessRun` / `agent_process_runs`, `lib/tasks/resolveWorkflowProcessRun.ts`, the three
`subscribers/task-run-workflow-*.ts`, `lib/tasks/executionPrincipal.ts` and the `task:<id>`
principal path, `backend/agentic-tasks/*`, and `executeAgentTarget` in the run worker.

## §1 A single-agent process is still a workflow

Removing `target_type = 'agent'` must not remove the ability to say *"run this agent every
morning"*. Choosing **Single agent** in the definition form **materializes a real
`WorkflowDefinition`**:

```
START ──> INVOKE_AGENT(agentId, onResult, review?, subject?) ──> END
```

- a normal, enabled, **Studio-visible and Studio-editable** row, stamped
  `metadata.generatedFrom = { module: 'agent_orchestrator', processDefinitionId }`;
- created and updated through the `workflows` peer resolved with `tryResolve` — never by
  writing core's tables directly;
- carries the `signalConfig: { signalName: 'agent_orchestrator.proposal.ready' }` the human
  disposition path needs to resume (the shape `examples/deals-health-check-workflow.json`
  already proves).

The simple UX survives, one engine executes it, and the user can graduate the process by
opening the generated workflow and adding steps — at which point it is an ordinary workflow
and the form stops regenerating it.

## §2 Execution identity vs invoker identity

Two identities, deliberately separate:

- **Invoker** — who started it. `ProcessInstance.triggeredBy` `{ kind, ref? }`. Provenance
  only. **Never** an ACL identity.
- **Execution** — what the run may do. The `WorkflowDefinition`'s own least-privilege
  principal, provisioned by core from `grantedFeatures` behind
  `workflows.definitions.grant_features`.

*Permission to start a process ≠ the permission set the process runs with.* The process
definition form edits `grantedFeatures` only for a workflow it generated (writing through
core's `authorizeWorkflowGrantChange` + `syncWorkflowDefinitionPrincipal`); for a
hand-authored workflow it shows the grant read-only and links to Studio.

## §3 Triggers start processes, never agents

`schedule`, `event`, `manual` and the external API all converge on one command,
`agent_orchestrator.processes.startExecution`, which ends in `workflowExecutor.startWorkflow`.
The only caller of `agentRuntime.run()` outside a workflow activity is the Playground.

## §4 The external contract

```
POST /api/agent_orchestrator/processes/{definitionId}/executions
  → 202 { executionId }

GET  /api/agent_orchestrator/executions/{executionId}
  → { status, milestonesReached[], proposals[], dispositions[], outcome | null }
```

Plus the existing lifecycle events, renamed: `agent_orchestrator.process.execution.started` /
`.completed` / `.failed`.

An external client is never coupled to `AgentRun`, to the number of agents involved, to the
runtime, or to a workflow step id. `POST /agents/:id/run` is re-gated behind a new
`agent_orchestrator.agents.playground` feature and documented as a development, eval and
diagnostics primitive — an engineering primitive, not a business orchestration primitive.

## §5 Idempotency at two levels

| Level | Key | Guarantee |
|---|---|---|
| Business execution | `(organizationId, processDefinitionId, idempotencyKey)` | never two `WorkflowInstance`s |
| Agent invocation | `(workflowInstanceId, stepId, invocationId)` | one `AgentRun` per attempt, identified not guessed |

Correlation is always an explicit identifier. `agentRuntime.run()` therefore returns
`{ runId, result }` rather than a bare result, and every temporal lookup is deleted.

## §6 Milestones are business events

The definition declares a **vocabulary** (`{ key, label, order }`). A workflow step declares
`milestone: '<key>'` in its advanced config; the engine emits

```
workflows.instance.milestone_reached { instanceId, milestoneKey, data }
```

when that step completes. An annotation rather than a step type, so a milestone can be reached
after a `PARALLEL_JOIN`, after a retry, or after ten steps — the business reader sees
`analysis_completed` and never learns there were two branches.

`collectMilestoneIssues` keeps its contract: a declared key that no step in the bound workflow
emits is a **warning** in the `WorkflowValidationIssue` shape core already emits (a definition
mid-edit must stay saveable), and an unresolvable step list reports nothing.

## §7 Three agent result kinds

| Kind | Shape | Effect |
|---|---|---|
| `research` (was `researcher`) | `{ kind, data }` | enriches context; the workflow decides what to keep |
| `proposal` | `{ kind, proposal: { options[], rationale? } }` | intent, never effect |
| `artifact` **(new)** | `{ kind, artifacts[], summary? }` | produces a file/document via the existing `agent_run_artifacts` plane |

The rename to `research` also removes a long-standing trap: `agentType: 'researcher'` (the
authoring declaration) and `resultKind: 'research'` (the runtime fact) can no longer be
confused for the same word.

Workflow context stays the only durable process context. An agent receives a *selected* input
and returns a typed result; `outputMapping` is the only path back into context. No agent
writes to global workflow state — which is what makes parallel branches safe.

## §8 Auto-approval is a policy, not a threshold

```
evaluateAutoApproval({ confidence, margin, actionRisk, guardrailVerdict,
                       traceComplete, principalFeatures, tenantPolicy })
  → { decision: 'auto' | 'review',
      block?: 'below_threshold' | 'near_tie' | 'risk' | 'guardrail'
            | 'trace_incomplete' | 'policy' }
```

A pure function in `lib/disposition/autoApprovalPolicy.ts`. Action risk tiers are declared in
`lib/runtime/actionVocabulary.ts`; the tenant ceiling lives in module settings. The current
threshold-plus-margin rule is the **default** policy, so existing behaviour and its tests are
preserved exactly.

**Confidence is evidence, not authorization.** Propose-only remains a hard platform invariant:
nothing in this spec gives an agent a write path that skips
proposal → disposition → effector → command.

## Migration

Migrations in this module are **squashed, not stacked**. The single create-schema file and
`migrations/.snapshot-open-mercato.json` are regenerated together from `data/entities.ts`; the
`to_regclass`-guarded data rewrites that touch core `workflows` tables are carried over
verbatim. No data migration from `agent_process_runs` is written: the branch is unpublished,
so the table is dropped.

`encryption.ts` keys `defaultEncryptionMaps` by a plain-string `entityId` that nothing
type-checks — the map entries move with the entity renames, and
`__tests__/encryption-map-entity-ids.test.ts` is the guard that this happened.

## Out of scope

Renaming the module id: `agent_orchestrator` owns the file-agent convention, the ACL
namespace and the generated registries, and a cosmetic rename would touch all three for no
architectural gain.

## Changelog

- 2026-09-06 — spec written.
