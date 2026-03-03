# SPEC-050: Agentic Operations, Decision Telemetry, and Context Graph Module (V2)

**Date**: 2026-03-03
**Updated**: 2026-03-03
**Status**: Draft for Board Review (V2)
**Scope**: Open Source (`.ai/specs/`)
**Host Package**: `@open-mercato/core`
**Primary Module**: `agent_governance`

---

## TLDR

**Key Points:**
- V2 evolves the module from governance-only to a coherent three-part system: governed execution, immutable decision telemetry, and context-graph retrieval.
- Open Mercato remains the canonical policy/execution/memory substrate; agent runtimes (Claude Agent SDK first, others later) are harness adapters.
- Every governed write produces append-only decision lineage so organizational reasoning compounds into reusable precedent.

**Scope:**
- Governance and execution controls (risk bands, approvals, run controls, scheduler integration).
- Mandatory minimum decision trace envelope for governed writes.
- Context graph as a first-class, queryable decision memory layer.
- Tacit knowledge capture pipeline to convert expert heuristics into validated skills/playbooks.
- Retrieval architecture where context is externalized and programmatically navigated before entering model context windows.

**Concerns:**
- Avoiding a fragmented "Frankenstein" of disconnected AI components.
- Preserving throughput while enforcing traceability.
- Managing provider/runtime lock-in risks and data-governance constraints.

---

## Delta from V1

V1 focused on governance and orchestration. V2 adds:
- Immutable decision telemetry as a hard contract.
- Context graph architecture (decision events + why links + precedents).
- Retrieval/query planner model aligned to external-object context navigation.
- Tacit knowledge extraction and skill lifecycle.
- Explicit harness strategy: Claude Agent SDK as preferred adapter, not a hard platform dependency.

---

## Overview

This specification defines an open-source module for AI-first organizations that need both speed and institutional memory.

The module provides:
1. **Governed execution**: policies, risk bands, approvals, run controls.
2. **Decision telemetry**: append-only, structured "why" lineage for governed actions.
3. **Context graph retrieval**: precedent-aware memory that agents can query at runtime.
4. **Tacit knowledge capture**: converting expert reasoning patterns into reusable skill assets.

The design goal is to create a durable system of record for decisions, not just objects.

---

## First-Principles Design Rules

1. **Execution and memory are inseparable**: if a decision changes state, it must emit lineage.
2. **Append-only truth**: precedent is trustworthy only when historical traces are immutable.
3. **Risk-proportional control**: high-risk actions fail closed; low-risk actions fail soft with repair.
4. **Context outside the window**: retrieval plans operate over external stores and pull only relevant slices.
5. **Model/runtime replaceability**: governance and memory contracts must survive harness changes.
6. **Module isolation**: no cross-module ORM relationships; all joins across modules are logical via IDs.

---

## Problem Statement

Enterprises currently lack a durable layer for reasoning lineage:
- Systems of record capture final state, not decision rationale.
- Exceptions and approvals happen in chat/calls and disappear.
- Agent outputs are often untraceable to policy, precedent, and context.
- Prompt-centric architectures break at large context scales and induce tool/context bloat.

Without a decision-memory substrate, agents execute but do not learn organizationally.

---

## Proposed Solution

Implement `agent_governance` with two bounded domains in one module hosted inside `@open-mercato/core`:

1. **Governance & Execution Domain**
- Policy engine, risk bands, autonomy modes, approvals, run orchestration, scheduler/queue workers.

2. **Decision Memory Domain (Context Graph)**
- Immutable decision events, structured why-links, entity linkage, precedent retrieval, and skill artifacts.

The domains are connected through one strict contract: **decision telemetry envelope**.

### Decision Telemetry Contract (Mandatory)

For every governed write action, persist at least:
- action intent (`action_type`, `target_entity`, `target_id`)
- input evidence references (`source_refs[]`)
- policy evaluation (`policy_id`, `risk_band_id`, `risk_score`)
- control path (`auto|checkpoint|override|rejected`)
- approvals/exceptions (`approver_ids[]`, `exception_ids[]`)
- commit result (`write_set`, `status`, `error_code`)
- provenance (`run_id`, `step_id`, `harness_provider`, timestamps)

### Capture and Blocking Policy

- **Low-risk writes**: do not block execution if enrichment fails; store minimal envelope and queue repair.
- **High-risk/irreversible writes**: block commit if minimal envelope cannot be durably persisted.
- **All traces**: append-only, immutable; corrections use superseding events.

---

## Architecture Options (Evaluated)

| Option | Summary | Pros | Cons |
|---|---|---|---|
| A. Governance-Only Core | Policy + approvals + runs, no context graph | Fastest initial ship | No compounding memory, weak precedent support |
| B. Governance + Native Context Graph (Recommended) | Unified execution + immutable decision graph + retrieval APIs | Coherent architecture, compounding organizational memory | Larger initial scope |
| C. External Graph Platform as Core | Delegate graph memory to third-party stack from day one | Fast access to advanced graph-RAG features | Operational coupling, schema mismatch risk, weaker core ownership |

### Decision Matrix

| Criterion | Weight | A | B | C |
|---|---:|---:|---:|---:|
| Long-term product coherence | 25% | 2 | 5 | 3 |
| Time-to-value | 20% | 5 | 4 | 3 |
| Governance fidelity | 20% | 3 | 5 | 3 |
| Extensibility and portability | 20% | 3 | 5 | 2 |
| Operational risk | 15% | 4 | 4 | 2 |
| **Weighted total** | 100% | **3.35** | **4.65** | **2.65** |

**Recommendation:** Option B with adapter interfaces so external engines can be plugged in for specific retrieval workloads.

---

## External Accelerators (Reference, Not Core)

| Project | What it informs | How we use it |
|---|---|---|
| `anthropics/claude-agent-sdk-typescript` | Agent harness capabilities, tool/runtime patterns | Preferred harness adapter for agent runtime integration |
| `HKUDS/LightRAG` | Practical graph+RAG retrieval patterns and evaluation tooling | Benchmark reference and optional retrieval adapter |
| `automataIA/graphrag-rs` | High-performance graph retrieval implementation ideas | Optional service adapter for heavy retrieval paths |
| `rahulnyk/knowledge_graph` | Knowledge graph extraction heuristics from corpora | Input to tacit knowledge extraction experiments |

Important: these are accelerators, not canonical truth stores.

---

## Octopus Organization Mapping

| Octopus Concept | Product Capability |
|---|---|
| Eight Arms | Delegated edge execution under explicit risk bands and micro-rights |
| Neural Necklace | Shared context graph and evidence APIs across teams/modules |
| Three Hearts | Mode controls: Analytic (strict), Agile (bounded rapid), Aligned (trust/adoption) |
| RNA-Powered Resilience | Continuous policy/skill updates and trace-driven adaptation |

---

## Model Governance Framework (MGF) Mapping

| MGF Dimension | V2 Implementation |
|---|---|
| Assess and bound risks upfront | Risk-band policies, least-privilege tool grants, reversible action tagging |
| Make humans accountable | Explicit ownership, checkpoint approvals, immutable decision lineage |
| Technical controls and processes | Pre-deploy evals, staged rollout, anomaly interrupts, kill switch |
| End-user responsibility | Transparency views, run explanations, training and responsibility hooks |

---

## System Boundaries (Anti-Frankenstein Guardrails)

### In Scope for `agent_governance`
- Policy evaluation and run control.
- Decision telemetry emission and persistence.
- Context graph projections and retrieval APIs.
- Tacit knowledge skill lifecycle governance.

### Out of Scope for `agent_governance`
- Replacing all model runtimes.
- Owning core CRM/ERP business entities.
- Building a generic data lake/warehouse replacement.
- Storing opaque chain-of-thought transcripts.

### Canonical Responsibilities
- **Open Mercato**: truth for policy, execution, decision lineage.
- **Harness provider (Claude SDK/OpenCode/etc.)**: reasoning and orchestration runtime.
- **Domain modules**: business state and domain-specific commands.

---

## Architecture

### Package and Module Layout

- `packages/core/src/modules/agent_governance/`
  - `api/`
  - `commands/`
  - `data/entities.ts`
  - `data/validators.ts`
  - `events.ts`
  - `search.ts`
  - `services/`
  - `subscribers/`
  - `workers/`
  - `backend/`
  - `ai-tools.ts`

### Core Services

1. `policyEngineService`
2. `runOrchestratorService`
3. `approvalService`
4. `decisionTelemetryService`
5. `contextGraphService`
6. `precedentRetrievalService`
7. `skillLifecycleService`
8. `harnessAdapterService`

### Harness Adapter Model

`harnessAdapterService` supports providers:
- `opencode` (existing stack compatibility)
- `claude_agent_sdk` (preferred V2 provider)
- future providers via adapter contract

Provider contract capabilities:
- tool invocation
- session lifecycle
- streamed events
- structured call metadata for telemetry

### Retrieval Model: Prompt as External Object

The orchestrator does not dump full context into model windows.

Instead, it executes:
1. plan retrieval query from intent
2. run graph/search/evidence lookups externally
3. rank and compress relevant slices
4. send compact context bundle to harness
5. iterate only when confidence is below threshold

This supports large corpora and avoids context/tool bloat.

### Autonomy Modes

- `observe`
- `propose`
- `execute_low_risk`
- `execute_bounded`

No unrestricted autopilot mode in V2.

### Run Interference Controls

- tenant/org kill switch
- run pause/resume/terminate
- human takeover at checkpoint or step
- auto-degrade mode on anomaly thresholds

### Commands

- `agent_governance.policy.upsert`
- `agent_governance.risk_band.upsert`
- `agent_governance.playbook.upsert`
- `agent_governance.run.start`
- `agent_governance.run.pause`
- `agent_governance.run.resume`
- `agent_governance.run.terminate`
- `agent_governance.approval.resolve`
- `agent_governance.skill.create`
- `agent_governance.skill.promote`

### Events

- `agent_governance.run.started`
- `agent_governance.run.step_executed`
- `agent_governance.run.checkpoint_reached`
- `agent_governance.run.paused`
- `agent_governance.run.terminated`
- `agent_governance.approval.requested`
- `agent_governance.approval.resolved`
- `agent_governance.telemetry.recorded`
- `agent_governance.precedent.matched`
- `agent_governance.skill.promoted`
- `agent_governance.anomaly.detected`

---

## Data Models

All entities are tenant/org scoped unless explicitly system scoped.
No cross-module ORM relationships.

### AgentPolicy
- `id`
- `tenant_id`, `organization_id`
- `name`
- `autonomy_mode`
- `kill_switch`
- `is_active`
- timestamps

### RiskBand
- `id`
- `tenant_id`, `organization_id`
- `name`
- `min_score`, `max_score`
- `requires_approval`
- `requires_trace_blocking`
- `irreversible_action_blocked`
- `allowed_tool_scopes` (jsonb)
- timestamps

### AgentPlaybook
- `id`
- `tenant_id`, `organization_id`
- `name`, `description`
- `trigger_type` (`manual|api|schedule|event`)
- `schedule_id`
- `policy_id` (id reference)
- `input_schema_json`, `action_schema_json`
- timestamps

### AgentRun
- `id`
- `tenant_id`, `organization_id`
- `playbook_id`
- `triggered_by_type`, `triggered_by_id`
- `status`
- `risk_score`
- `mode_effective`
- `harness_provider`
- `started_at`, `ended_at`
- timestamps

### AgentRunStep
- `id`
- `tenant_id`, `organization_id`
- `run_id`
- `sequence_no`
- `action_type`
- `tool_name`
- `is_irreversible`
- `status`
- `input_json`, `output_json`
- timestamps

### DecisionEvent (append-only)
- `id`
- `tenant_id`, `organization_id`
- `run_id`, `step_id`
- `event_type` (`proposed|evaluated|approved|committed|rejected|superseded`)
- `envelope_json` (minimum trace contract payload)
- `supersedes_event_id` (nullable)
- `immutable_hash`
- timestamps

### DecisionEntityLink
- `id`
- `tenant_id`, `organization_id`
- `decision_event_id`
- `entity_type`
- `entity_id`
- `link_role` (`target|evidence|exception|approval_subject|policy_subject`)

### DecisionWhyLink
- `id`
- `tenant_id`, `organization_id`
- `decision_event_id`
- `why_type` (`policy|precedent|heuristic|constraint|override`)
- `why_ref_id`
- `weight`

### PrecedentIndex
- `id`
- `tenant_id`, `organization_id`
- `decision_event_id`
- `canonical_signature`
- `embedding_vector_ref`
- `search_checksum`
- timestamps

### AgentSkill
- `id`
- `tenant_id`, `organization_id`
- `name`
- `status` (`draft|validated|active|deprecated`)
- `framework_json` (structured heuristic/process)
- `source_type` (`interview|trace_mining|hybrid`)
- timestamps

### AgentSkillVersion
- `id`
- `skill_id`
- `version_no`
- `diff_json`
- `validation_report_json`
- `promoted_by_user_id`
- timestamps

### AgentApprovalTask
- `id`
- `tenant_id`, `organization_id`
- `run_id`, `step_id`
- `required_role_ids`
- `status`
- `decision_note`
- `resolved_by_user_id`
- `resolved_at`
- timestamps

---

## API Contracts

All APIs export `openApi` and use scoped metadata (`requireAuth`, `requireFeatures`).

### Policy and Risk APIs
- `GET /api/agent_governance/policies`
- `POST /api/agent_governance/policies`
- `PUT /api/agent_governance/policies/:id`
- `GET /api/agent_governance/risk_bands`
- `POST /api/agent_governance/risk_bands`
- `PUT /api/agent_governance/risk_bands/:id`

### Playbook and Run APIs
- `GET /api/agent_governance/playbooks`
- `POST /api/agent_governance/playbooks`
- `PUT /api/agent_governance/playbooks/:id`
- `POST /api/agent_governance/playbooks/:id/run`
- `GET /api/agent_governance/runs`
- `GET /api/agent_governance/runs/:id`
- `POST /api/agent_governance/runs/:id/pause`
- `POST /api/agent_governance/runs/:id/resume`
- `POST /api/agent_governance/runs/:id/terminate`

### Approval APIs
- `GET /api/agent_governance/approvals`
- `POST /api/agent_governance/approvals/:id/resolve`

### Telemetry and Context Graph APIs
- `GET /api/agent_governance/decision_events`
- `GET /api/agent_governance/decision_events/:id`
- `GET /api/agent_governance/precedents/search`
- `POST /api/agent_governance/precedents/explain`
- `GET /api/agent_governance/context_graph/neighbors`

### Skill APIs
- `GET /api/agent_governance/skills`
- `POST /api/agent_governance/skills`
- `PUT /api/agent_governance/skills/:id`
- `POST /api/agent_governance/skills/:id/promote`

### MCP Tool Surface

Registered with `registerMcpTool` and strict zod schemas:
- `agent_governance.run.start`
- `agent_governance.run.get`
- `agent_governance.run.control`
- `agent_governance.approval.list`
- `agent_governance.approval.resolve`
- `agent_governance.precedent.find`
- `agent_governance.precedent.explain`
- `agent_governance.context.expand`
- `agent_governance.skill.list`

---

## Search and Retrieval Configuration

The module must provide `search.ts` and follow `packages/search/AGENTS.md`:
- define sensitive fields in `fieldPolicy.excluded`
- apply `fieldPolicy.hashOnly` to PII fields where exact filter is needed
- provide `formatResult` for token strategy surfaces
- include `checksumSource` on vector build pipelines

Entity IDs must match generated entity registry (`module:entity_name`).

---

## Tacit Knowledge Capture and Skill Lifecycle

### Pipeline

1. **Capture**: structured expert interviews, case walkthroughs, and decision-shadowing sessions.
2. **Extract**: convert narratives into candidate heuristics/decision templates.
3. **Validate**: run candidates against historical decision traces and adversarial test cases.
4. **Promote**: move skills from `draft` to `active` only after human approval.
5. **Observe**: monitor skill impact and drift; deprecate when quality declines.

### Skill Artifact Shape

Each skill stores:
- context requirements (what must be gathered)
- policy/risk checks (what must be enforced)
- reasoning framework (decision strategy)
- escalation conditions
- known edge cases and anti-patterns
- measurable success/failure criteria

---

## UI/UX

### Backend Pages
- `/backend/agent-governance`
- `/backend/agent-governance/policies`
- `/backend/agent-governance/risk-bands`
- `/backend/agent-governance/playbooks`
- `/backend/agent-governance/runs`
- `/backend/agent-governance/approvals`
- `/backend/agent-governance/decision-memory`
- `/backend/agent-governance/skills`
- `/backend/agent-governance/runs/[id]`

### UX Rules
- Use `DataTable` for lists and `CrudForm` for create/edit.
- Run detail includes `Pause`, `Resume`, `Terminate`, `Take Over` actions.
- Decision memory page provides precedent search and trace timeline.
- All writes use guarded mutations when not using `CrudForm`.
- Keyboard support in dialogs: submit via `Cmd/Ctrl+Enter`, cancel via `Escape`.

---

## Configuration

### Environment Variables
- `AGENT_GOVERNANCE_ENABLED=1`
- `AGENT_GOVERNANCE_DEFAULT_MODE=propose`
- `AGENT_GOVERNANCE_MAX_RUN_STEPS=200`
- `AGENT_GOVERNANCE_MAX_TOOL_RETRIES=2`
- `AGENT_GOVERNANCE_APPROVAL_TIMEOUT_MIN=60`
- `AGENT_GOVERNANCE_TRACE_ENVELOPE_REQUIRED=1`
- `AGENT_GOVERNANCE_TRACE_BLOCK_HIGH_RISK=1`
- `AGENT_GOVERNANCE_HARNESS_PROVIDER=claude_agent_sdk`

### Queue/Scheduler Strategy
- Dev: `QUEUE_STRATEGY=local`
- Prod: `QUEUE_STRATEGY=async`

### Harness Governance Notes

When using Claude Agent SDK, implementation must support:
- explicit provider abstraction (no hard-coded runtime assumptions)
- per-tenant opt-in and policy controls
- compliance review of provider data usage and retention terms before production enablement

---

## Migration & Backward Compatibility

- Additive migrations only.
- Existing `SPEC-050` V1 API and event contracts remain additive-compatible.
- MCP tool names are stable once published; deprecate before replacement.
- Event IDs are frozen once published; payload fields additive-only.
- Decision events are immutable; corrections occur via superseding events.
- Include migration notes in release docs for any contract surface changes.

---

## Implementation Plan (V2 Roadmap)

### Phase 0: Contract Hardening
1. Finalize telemetry envelope schema and immutability constraints.
2. Implement harness adapter interface and provider registry.
3. Define risk blocking policy and failure handling.

### Phase 1: Governance + Trace Foundation
1. Ship policies, risk bands, playbooks, run controls.
2. Emit and persist decision events for all governed writes.
3. Enforce high-risk trace durability blocking.

### Phase 2: Context Graph and Retrieval
1. Build graph projections (`DecisionEntityLink`, `DecisionWhyLink`, `PrecedentIndex`).
2. Add precedent search/explain APIs and MCP tools.
3. Implement external-object retrieval planner for context bundles.

### Phase 3: Tacit Knowledge Skills
1. Add skill capture/validation/promotion workflows.
2. Wire active skills into playbook generation and run guidance.
3. Measure skill impact and drift.

### Phase 4: Optional Retrieval Adapters
1. Add adapter interfaces for external graph retrieval engines.
2. Benchmark LightRAG/graphrag-rs adapters against native baseline.
3. Keep canonical decision memory in Open Mercato regardless of adapter.

### Phase 5: Production Hardening
1. Large-scale observability and anomaly controls.
2. Incident drills and kill-switch rehearsal program.
3. Board KPI dashboard and operating cadence.

---

## Phase 0-2 Implementation Backlog (Execution-Ready)

### Delivery Principles

- Ship vertical slices that are usable in production-like environments.
- Each story must include tenant/org scoping tests.
- No story is complete without `openApi`, zod validation, and command/event alignment.

### Phase 0 Epics: Contract Hardening

#### Epic P0-E1: Telemetry Envelope Contract

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P0-S1 | Define `DecisionTelemetryEnvelope` zod schema and TS type exports | Schema includes mandatory fields from spec; invalid payloads are rejected with typed errors | None |
| P0-S2 | Implement append-only `DecisionEvent` persistence service | No update/delete paths for events; supersede path creates new record and references prior ID | P0-S1 |
| P0-S3 | Add immutable hash generation and verification | Hash generated on write; tamper check utility flags mismatches | P0-S2 |

#### Epic P0-E2: Harness Adapter Contract

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P0-S4 | Define `HarnessAdapter` interface (`invoke`, `stream`, `session`) | At least one compile-time provider implementation passes interface contract tests | None |
| P0-S5 | Implement `opencode` adapter for backward compatibility | Existing runtime integration path remains functional through adapter | P0-S4 |
| P0-S6 | Implement `claude_agent_sdk` adapter skeleton with feature-flagged activation | Provider can be selected by config; unsupported capability surfaces typed error | P0-S4 |

#### Epic P0-E3: Risk Blocking Semantics

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P0-S7 | Implement high-risk trace durability gate | High-risk/irreversible writes fail when envelope persistence fails | P0-S1, P0-S2 |
| P0-S8 | Implement low-risk fail-soft + repair queue marker | Low-risk writes proceed with minimal envelope and enqueue enrichment repair | P0-S1 |

### Phase 1 Epics: Governance + Trace Foundation

#### Epic P1-E1: Policy, Risk Band, and Playbook CRUD

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P1-S1 | Create entities + migrations (`AgentPolicy`, `RiskBand`, `AgentPlaybook`) | Additive migrations generated; no cross-module relationships | P0 complete |
| P1-S2 | Implement CRUD APIs with `openApi` and RBAC metadata | All routes documented and protected by `requireFeatures` | P1-S1 |
| P1-S3 | Implement backend pages (`DataTable` + `CrudForm`) | Pages support create/edit/list; no raw fetch usage | P1-S2 |

#### Epic P1-E2: Run Orchestration Core

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P1-S4 | Implement `agent_governance.run.start` command | Command creates run + first step with scoped context and status transitions | P1-S1 |
| P1-S5 | Implement checkpoint state and approval task creation | Runs enter `checkpoint` status when policy requires approval | P1-S4 |
| P1-S6 | Implement pause/resume/terminate commands and APIs | Run control actions are idempotent and auditable | P1-S4 |

#### Epic P1-E3: Decision Telemetry Integration

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P1-S7 | Emit decision telemetry on all governed write paths | Every governed write has an associated `DecisionEvent` | P1-S4, P0-E1 |
| P1-S8 | Build run timeline API from decision events | Timeline returns ordered event stream with control-path markers | P1-S7 |
| P1-S9 | Add decision-memory UI panel on run detail page | Operators can inspect `why`, approvals, and commit outcomes | P1-S8 |

### Phase 2 Epics: Context Graph and Retrieval

#### Epic P2-E1: Graph Projection Layer

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P2-S1 | Implement `DecisionEntityLink` and `DecisionWhyLink` projectors | Links generated asynchronously from `DecisionEvent` stream | P1-E3 |
| P2-S2 | Implement `PrecedentIndex` builder with checksum tracking | Re-index skips unchanged records using checksum | P2-S1 |
| P2-S3 | Add module `search.ts` with sensitive field policies | `fieldPolicy.excluded/hashOnly` and presenter formatting satisfy search rules | P2-S2 |

#### Epic P2-E2: Retrieval and Explanation APIs

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P2-S4 | Implement `/precedents/search` API (hybrid signature + semantic) | Returns ranked precedents with confidence and source trace refs | P2-E1 |
| P2-S5 | Implement `/precedents/explain` API | Returns structured rationale chain (`policy`, `precedent`, `exception`) | P2-S4 |
| P2-S6 | Implement `/context_graph/neighbors` API with strict scope controls | Traversal cannot cross tenant boundaries; integration tests enforce denial cases | P2-S1 |

#### Epic P2-E3: MCP Retrieval Tools

| Story ID | Story | Acceptance Criteria | Dependencies |
|---|---|---|---|
| P2-S7 | Register MCP tools for precedent search/explain/context expand | Tools use zod schemas and `requiredFeatures`; responses are serializable | P2-E2 |
| P2-S8 | Add policy-aware tool broker checks on retrieval tools | Tool access obeys `AgentToolGrant` and risk band constraints | P2-S7, P1-E1 |

### Cross-Phase Definition of Done

A story is done only if:
- API and command behavior are covered by tests.
- `openApi` docs are updated for route stories.
- Events are declared in `events.ts` and wired through generator flow.
- Tenant isolation tests pass for new reads/writes.
- Backward compatibility impact is documented when contract surfaces change.

### Phase Exit Gates

| Phase | Gate |
|---|---|
| Phase 0 | Envelope contract stable, adapter contract stable, risk blocking semantics verified |
| Phase 1 | End-to-end governed run with approvals and immutable decision timeline working in UI/API |
| Phase 2 | Precedent retrieval + explanation + MCP tools working with scoped graph queries |

---

## Testing Strategy

### Unit
- policy evaluation
- risk-band matching
- telemetry envelope validation
- superseding-event behavior

### Integration
- run lifecycle with checkpoints
- scheduler-triggered runs
- high-risk trace durability gate
- precedent retrieval correctness
- skill promotion gate

### Security
- tenant isolation on all decision memory APIs
- tool grant enforcement
- approval spoofing rejection
- immutable trace tamper detection

### Reliability
- duplicate job delivery handling
- worker restart mid-run
- harness provider fallback behavior
- telemetry repair queue behavior

---

## Success Metrics

### Governance
- `policy_violation_block_rate`
- `high_risk_trace_block_enforcement_rate`
- `approval_turnaround_median`

### Memory Quality
- `trace_completeness_rate`
- `precedent_hit_rate`
- `precedent_usefulness_score`

### Operations
- `mean_time_to_intervene`
- `run_success_rate_by_risk_band`
- `cost_per_governed_decision`

### Learning
- `skill_promotion_rate`
- `skill_drift_incidents`
- `repeat_exception_reduction`

---

## Transformation Operating Model (Board)

### Five-Phase Organizational Rollout

| Phase | Board Objective | Operating Focus | Exit Criteria |
|---|---|---|---|
| 1. Vision and Boundaries | Set ambition without uncontrolled risk | Define target workflows, risk appetite, and autonomy envelope | Approved risk posture and KPI baseline |
| 2. Capability Preparation | Ready teams for governed autonomy | Champion network, training, policy ownership, accountability map | Trained owner group across core functions |
| 3. Bounded Experimentation | Avoid pilot hell while learning quickly | Time-boxed experiments with explicit go/stop rules and postmortems | 3+ validated experiments with measurable value |
| 4. Infrastructure Scale-up | Make execution repeatable and auditable | Full telemetry, context graph retrieval, scheduler-backed operations | Stable production run lifecycle and audit readiness |
| 5. Continuous Adaptation | Build RNA-like adaptive capability | Quarterly policy/skill updates from trace evidence and incidents | Demonstrated improvement in quality and intervention latency |

### Three-Hearts Leadership Cadence

| Mode | Trigger | Leadership Action |
|---|---|---|
| Analytic | High-impact or ambiguous decisions | Tighten approvals, require explicit scenario rationale |
| Agile | Need for rapid local iteration | Expand bounded autonomy and increase experiment throughput |
| Aligned | Trust, motivation, or adoption risk | Increase transparency, coaching, and purpose communication |

### Anti-Pilot-Hell Rule

Every experiment must include:
- Hypothesis and measurable outcome.
- Predefined risk band and blast radius.
- Explicit scale/stop criteria.
- Captured decision traces and postmortem artifacts.

---

## Risks & Impact Review

### Data Integrity Failures
- Risk: decision write committed without valid trace envelope.
- Mitigation: commit-time envelope requirement and high-risk blocking gate.

### Cascading Failures
- Risk: bad precedent retrieval amplifies wrong patterns.
- Mitigation: confidence thresholds, explainability payload, and human override.

### Tenant Isolation
- Risk: cross-tenant precedent leakage.
- Mitigation: strict tenant filters on all graph queries and search indices.

### Migration and Compatibility
- Risk: contract drift across MCP tools/events/APIs.
- Mitigation: additive-only evolution + deprecation bridges.

### Operational
- Risk: alert fatigue from anomaly and checkpoint volume.
- Mitigation: severity routing, threshold tuning, periodic quality audits.

### Risk Register

#### Missing Trace on High-Risk Commit
- **Scenario**: irreversible action executes while telemetry store is unavailable.
- **Severity**: Critical
- **Affected area**: auditability, compliance, trust
- **Mitigation**: block high-risk commit when envelope persistence fails
- **Residual risk**: Low

#### Precedent Poisoning
- **Scenario**: low-quality or adversarial traces become dominant precedents.
- **Severity**: High
- **Affected area**: retrieval quality, decision quality
- **Mitigation**: provenance scoring, confidence thresholds, human review for high impact
- **Residual risk**: Medium

#### Harness Provider Lock-In
- **Scenario**: agent runtime feature changes break orchestration behavior.
- **Severity**: High
- **Affected area**: runtime continuity
- **Mitigation**: provider adapter abstraction + compatibility tests
- **Residual risk**: Medium

#### Cross-Tenant Graph Leakage
- **Scenario**: graph traversal includes links outside tenant scope.
- **Severity**: Critical
- **Affected area**: data isolation and compliance
- **Mitigation**: tenant-scoped joins, integration tests, deny-by-default query planner
- **Residual risk**: Low

#### Approval Fatigue
- **Scenario**: frequent low-context approvals reduce oversight quality.
- **Severity**: High
- **Affected area**: governance effectiveness
- **Mitigation**: contextual approval bundles and adaptive checkpointing
- **Residual risk**: Medium

---

## Final Compliance Report — 2026-03-03

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`
- `packages/events/AGENTS.md`
- `packages/queue/AGENTS.md`
- `packages/search/AGENTS.md`
- `packages/ui/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Data model uses FK IDs only |
| root AGENTS.md | Organization and tenant scoping required | Compliant | All write/read surfaces explicitly scoped |
| root AGENTS.md | Use zod for input validation | Compliant | API and MCP schemas require zod |
| root AGENTS.md | Command pattern for writes | Compliant | Writes modeled through commands |
| packages/core/AGENTS.md | API routes MUST export `openApi` | Compliant | API contract section mandates it |
| packages/core/AGENTS.md | Event declarations in `events.ts` | Compliant | Explicit event contract section included |
| packages/ai-assistant/AGENTS.md | MCP tools via `registerMcpTool` with RBAC features | Compliant | MCP section mandates requiredFeatures |
| packages/events/AGENTS.md | Persistent subscribers/workers idempotent | Compliant | Reliability section includes idempotency |
| packages/queue/AGENTS.md | Queue strategy and idempotent worker processing | Compliant | Scheduler/queue plan aligns |
| packages/search/AGENTS.md | `search.ts`, field policy protections, checksums | Compliant | Search section defines required rules |
| packages/ui/AGENTS.md | Use CrudForm/DataTable and guarded writes | Compliant | UI section aligned |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | Entities map to policy/run/graph/skill APIs |
| API contracts match UI/UX section | Pass | All listed pages have matching API groups |
| Risks cover all write operations | Pass | Includes trace, commit, retrieval, approvals |
| Commands defined for mutation surfaces | Pass | Command list covers policy/run/skill writes |
| Cache and retrieval strategy coherence | Pass | Context retrieval uses explicit external-object model |

### Non-Compliant Items

None identified at specification stage.

### Verdict

- **Fully compliant**: Approved for board refinement and implementation planning.

---

## Changelog

### 2026-03-03
- V2 rewrite: expanded SPEC-050 from governance-only to governance + decision telemetry + context graph.
- Added mandatory trace envelope contract and append-only immutability policy.
- Added harness adapter strategy with Claude Agent SDK as preferred provider.
- Added context retrieval architecture and tacit knowledge skill lifecycle.
- Added phased V2 roadmap and expanded risk register.
- Added execution-ready Phase 0-2 backlog with epics, stories, acceptance criteria, dependencies, and phase exit gates.
- Added planning-gate sequencing artifacts reference in `.ai/specs/analysis/ANALYSIS-050-2026-03-03-agent-governance-planning-gate.md`.
- Added full-PRD implementation checklist in `tasks/tasks-agent-governance-v2-full-prd.md` with end-to-end phase/subtask tracking.
- Consolidated task tracking into a single canonical file; removed `tasks/tasks-agent-governance-v2-phase0-2.md`.

### 2026-03-03 (Implementation Update)
- Implemented governance APIs/pages, run orchestration controls, and approval lifecycle command paths.
- Added deterministic run control safeguards via `expectedStatus` stale-state checks.
- Implemented scheduler-backed automation workers (`dispatch`, `projection`, `repair`) with idempotency coverage.
- Implemented skill capture/validation/promotion extensions and measurable `skillGuidanceImpact30d` observability metric.
- Implemented alert-routing anti-fatigue metrics (`alertRouting`) and surfaced them on governance dashboard.
- Added reliability scenarios for duplicate deliveries, worker restart idempotence, and harness provider fallback behavior.
- Added initial `agent_governance` migration baseline (`Migration20260303195244.ts`) and module snapshot.
- Added supporting architecture/operator/onboarding/phase-gate/board docs under `docs/agent-governance/`.
- Added external retrieval adapter extension points (`native`, `lightrag`, `graphrag_rs`) with configurable fallback.
- Added retrieval provider benchmark service and API (`POST /api/agent_governance/retrieval/benchmark`) for evidence-based adapter selection.
- Added retrieval adapter production posture docs to keep Open Mercato as canonical decision-memory source.

### Review — 2026-03-03
- **Reviewer**: Agent
- **Security**: Passed
- **Performance**: Passed
- **Cache**: Passed
- **Commands**: Passed
- **Risks**: Passed
- **Verdict**: Approved
