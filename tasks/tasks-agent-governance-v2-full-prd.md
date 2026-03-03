## Relevant Files

- `.ai/specs/SPEC-050-2026-03-03-agentic-operations-and-governance-module.md` - Source PRD (V2) for all scope and acceptance gates.
- `.ai/specs/analysis/ANALYSIS-050-2026-03-03-agent-governance-planning-gate.md` - Planning gate outcomes and critical pre-implementation checks.
- `packages/core/src/modules/agent_governance/index.ts` - Module metadata and discovery registration.
- `packages/core/src/modules/agent_governance/acl.ts` - Feature IDs and RBAC contract.
- `packages/core/src/modules/agent_governance/setup.ts` - Default role features setup.
- `packages/core/src/modules/agent_governance/di.ts` - DI wiring for services and adapters.
- `packages/core/src/modules/agent_governance/events.ts` - Typed events.
- `packages/core/src/modules/agent_governance/ai-tools.ts` - MCP tool surface.
- `packages/core/src/modules/agent_governance/search.ts` - Search/retrieval config.
- `packages/core/src/modules/agent_governance/data/entities.ts` - Core entities.
- `packages/core/src/modules/agent_governance/data/validators.ts` - Zod schemas + inferred types.
- `packages/core/src/modules/agent_governance/commands/*.ts` - All write operations via command pattern.
- `packages/core/src/modules/agent_governance/services/*.ts` - Policy, orchestration, telemetry, retrieval services.
- `packages/core/src/modules/agent_governance/api/**/route.ts` - API contracts with `openApi`.
- `packages/core/src/modules/agent_governance/subscribers/*.ts` - Event subscribers.
- `packages/core/src/modules/agent_governance/workers/*.ts` - Queue/scheduler workers.
- `packages/core/src/modules/agent_governance/backend/**` - Backend UI pages.
- `packages/core/src/modules/agent_governance/__tests__/**` - Unit + integration tests.
- `apps/mercato/src/modules.ts` - App module enablement.
- `RELEASE_NOTES.md` - Migration and release communication.

## Notes

- This file is the single canonical execution checklist for SPEC-050 V2.
- Keep changes additive-only for frozen/stable contract surfaces.
- Do not hand-write migrations; use `yarn db:generate`.
- Run `yarn generate` whenever auto-discovery surfaces change.
- All API write paths must use commands and zod validation.

## Instructions for Completing Tasks

**IMPORTANT:** As you complete each task, you must check it off in this markdown file by changing `- [ ]` to `- [x]`.

Update this file after each completed sub-task, not only after parent task completion.

## Master Tasks (Full PRD)

- [x] 0.0 Program setup and execution hygiene (Reference: SPEC-050 §Implementation Plan, §Phase Exit Gates)
  - [x] 0.1 Create and checkout branch `feature/agent-governance-v2-full-prd`.
  - [x] 0.2 Confirm PRD, analysis gate, and this task file are aligned before coding.
  - [x] 0.3 Define weekly cadence for status updates (completed tasks, blocked tasks, gate status).
  - [x] 0.4 Acceptance: single source of truth is established for scope tracking.

- [x] 1.0 Freeze contracts and guardrails (Phase 0) (Reference: SPEC-050 §Decision Telemetry Contract, §Migration & Backward Compatibility)
  - [x] 1.1 Finalize `DecisionTelemetryEnvelope` required fields and serialization format.
  - [x] 1.2 Finalize immutable event strategy (`immutable_hash`, supersede-only correction path).
  - [x] 1.3 Finalize `HarnessAdapter` contract (`invoke`, `stream`, `session`, typed capability errors).
  - [x] 1.4 Finalize risk blocking policy (high-risk fail-closed, low-risk fail-soft + repair queue).
  - [x] 1.5 Write ADR for trace retention + redaction policy.
  - [x] 1.6 Acceptance: Phase 0 gate criteria are documented and testable.

- [x] 2.0 Scaffold module foundation (Phase 1 prep) (Reference: SPEC-050 §Architecture, §System Boundaries)
  - [x] 2.1 Create module folder and optional contract files (`index.ts`, `acl.ts`, `setup.ts`, `di.ts`, `events.ts`, `search.ts`, `ai-tools.ts`).
  - [x] 2.2 Register module exports and ensure auto-discovery compatibility.
  - [x] 2.3 Add default role features in `setup.ts` for every feature defined in `acl.ts`.
  - [x] 2.4 Run `yarn generate` and verify generated artifacts are stable.
  - [x] 2.5 Acceptance: module boots without discovery/runtime errors.

- [x] 3.0 Implement core data model and migrations (Phase 1) (Reference: SPEC-050 §Data Models)
  - [x] 3.1 Implement entities: `AgentPolicy`, `RiskBand`, `AgentPlaybook`, `AgentRun`, `AgentRunStep`.
  - [x] 3.2 Implement entities: `DecisionEvent`, `DecisionEntityLink`, `DecisionWhyLink`, `PrecedentIndex`.
  - [x] 3.3 Implement entities: `AgentSkill`, `AgentSkillVersion`, `AgentApprovalTask`.
  - [x] 3.4 Ensure tenant/org scoping and no cross-module ORM relationships.
  - [x] 3.5 Run `yarn db:generate` and review migration for additive-only changes.
  - [x] 3.6 Acceptance: schema supports all PRD APIs with compatibility rules intact.

- [x] 4.0 Build validation and command contracts (Phase 1) (Reference: SPEC-050 §Commands, §API Contracts)
  - [x] 4.1 Add zod schemas and derived TS types for all payloads.
  - [x] 4.2 Implement command handlers for all write operations (policy/risk/playbook/run/approval/skill).
  - [x] 4.3 Enforce idempotency keys for sensitive mutation paths.
  - [x] 4.4 Add typed domain errors for policy violations, approval states, and adapter capabilities.
  - [x] 4.5 Acceptance: no write route bypasses command + validator flow.

- [x] 5.0 Ship governance APIs and pages (Phase 1) (Reference: SPEC-050 §API Contracts, §UI/UX)
  - [x] 5.1 Implement policy/risk/playbook CRUD APIs with `openApi` + RBAC metadata.
  - [x] 5.2 Implement run lifecycle APIs (`start`, `pause`, `resume`, `terminate`) and timeline read APIs.
  - [x] 5.3 Implement approval APIs (`/approvals/:id/approve`, `/approvals/:id/reject`).
  - [x] 5.4 Build backend pages using `DataTable` + `CrudForm` for governance entities.
  - [x] 5.5 Build run detail UI with status, checkpoint controls, and timeline stream.
  - [x] 5.6 Acceptance: end-to-end governed run and approvals work in UI + API.

- [x] 6.0 Implement run orchestration and interference controls (Phase 1) (Reference: SPEC-050 §Run Interference Controls, §Autonomy Modes)
  - [x] 6.1 Implement orchestration state machine (`queued|running|checkpoint|paused|failed|completed|terminated`).
  - [x] 6.2 Implement checkpoint creation rules by risk band and action class.
  - [x] 6.3 Implement operator controls: pause/resume/terminate/reroute with audit trail.
  - [x] 6.4 Implement propose/assist/auto autonomy mode policy gates.
  - [x] 6.5 Acceptance: deterministic run control behavior under concurrent operator actions.

- [x] 7.0 Implement decision telemetry durability and blocking semantics (Phase 1) (Reference: SPEC-050 §Capture and Blocking Policy)
  - [x] 7.1 Persist telemetry envelope for every governed write path.
  - [x] 7.2 Enforce high-risk fail-closed on telemetry persistence failure.
  - [x] 7.3 Enforce low-risk fail-soft with repair queue marker + alert signal.
  - [x] 7.4 Implement append-only correction via superseding records only.
  - [x] 7.5 Acceptance: trace durability policy passes high-risk and low-risk integration tests.

- [x] 8.0 Build harness adapter layer and MCP control plane (Phase 1-2) (Reference: SPEC-050 §Harness Adapter Model, §MCP Tool Surface)
  - [x] 8.1 Implement provider registry and `HarnessAdapter` interface tests.
  - [x] 8.2 Implement `opencode` adapter compatibility path.
  - [x] 8.3 Implement `claude_agent_sdk` adapter behind config selection.
  - [x] 8.4 Register MCP tools (`agent_run`, `risk_check`, `precedent_search`, `precedent_explain`, `context_expand`, `skill_capture`).
  - [x] 8.5 Enforce `requiredFeatures` and policy-aware tool grants at tool execution time.
  - [x] 8.6 Acceptance: tool calls remain provider-agnostic in core services.

- [x] 9.0 Build context graph projection and retrieval APIs (Phase 2) (Reference: SPEC-050 §Data Models, §Search and Retrieval Configuration)
  - [x] 9.1 Implement projector pipeline from `DecisionEvent` to link/index entities.
  - [x] 9.2 Add checksum-based incremental projection/reindex behavior.
  - [x] 9.3 Implement `/precedents/search` with hybrid signature + semantic strategy.
  - [x] 9.4 Implement `/precedents/explain` rationale chain response.
  - [x] 9.5 Implement `/context_graph/neighbors` with deny-by-default scope controls.
  - [x] 9.6 Configure `search.ts` field policy (`excluded`, `hashOnly`, presenter, checksum).
  - [x] 9.7 Acceptance: tenant-scoped precedent retrieval with explainability works reliably.

- [x] 10.0 Implement retrieval planner (prompt-as-external-object) (Phase 2) (Reference: SPEC-050 §Retrieval Model: Prompt as External Object)
  - [x] 10.1 Build retrieval planner that selects context slices before model invocation.
  - [x] 10.2 Implement budget guardrails (token/cost/time budget per run).
  - [x] 10.3 Add trace links from retrieved context bundles to resulting decisions.
  - [x] 10.4 Add fallback behavior for unavailable retrieval components.
  - [x] 10.5 Acceptance: context selection is deterministic, bounded, and auditable.

- [x] 11.0 Build tacit knowledge capture and skill lifecycle (Phase 3) (Reference: SPEC-050 §Tacit Knowledge Capture and Skill Lifecycle)
  - [x] 11.1 Implement skill capture pipeline from traces and postmortems.
  - [x] 11.2 Implement skill versioning and status lifecycle (draft/validated/promoted/deprecated).
  - [x] 11.3 Implement skill validation workflow with approval checkpoints.
  - [x] 11.4 Wire active skills into run guidance and playbook generation paths.
  - [x] 11.5 Implement skill APIs and management UI.
  - [x] 11.6 Acceptance: approved skills influence runs and produce measurable outcome deltas.

- [x] 12.0 Add scheduler and agentic automation readiness (Phase 2-3) (Reference: SPEC-050 §Queue/Scheduler Strategy, §Run Interference Controls)
  - [x] 12.1 Implement schedule-triggered playbook execution.
  - [x] 12.2 Add idempotent queue workers for dispatch, projection, and repair workflows.
  - [x] 12.3 Implement anomaly-triggered interrupt events for human intervention.
  - [x] 12.4 Ensure scheduled runs follow the same governance and telemetry contracts as manual runs.
  - [x] 12.5 Acceptance: cron-like automation is controllable, auditable, and interruptible.

- [x] 13.0 Implement observability, risk monitoring, and anti-fatigue controls (Phase 5 prep) (Reference: SPEC-050 §Success Metrics, §Risks & Impact Review)
  - [x] 13.1 Implement metrics: governance, memory quality, operations, learning.
  - [x] 13.2 Add run and decision anomaly detection subscribers/workers.
  - [x] 13.3 Add severity-based routing for alerts and checkpoint volume throttling.
  - [x] 13.4 Build dashboard views for trace completeness, precedent usefulness, and intervention latency.
  - [x] 13.5 Acceptance: monitoring surfaces detect failure patterns without overwhelming operators.

- [x] 14.0 Security, compliance, and compatibility hardening (Cross-phase) (Reference: SPEC-050 §Migration & Backward Compatibility, §Testing Strategy Security)
  - [x] 14.1 Add integration tests for tenant isolation on all retrieval/graph APIs.
  - [x] 14.2 Add tests for approval spoofing rejection and immutable trace tamper detection.
  - [x] 14.3 Validate event IDs/API URLs/MCP names against frozen contract rules.
  - [x] 14.4 Add deprecation annotations + release notes for any additive contract expansion.
  - [x] 14.5 Acceptance: compatibility and security checks pass with no critical findings.

- [x] 15.0 Full testing, reliability drills, and phase gates (Cross-phase) (Reference: SPEC-050 §Testing Strategy, §Phase Exit Gates)
  - [x] 15.1 Implement and run unit tests for policy, risk matching, envelope validation, supersede logic.
  - [x] 15.2 Implement and run integration tests for lifecycle, checkpoints, retrieval, and scheduler paths.
  - [x] 15.3 Execute reliability scenarios: duplicate jobs, worker restart mid-run, provider failure fallback.
  - [x] 15.4 Validate Phase 0 gate.
  - [x] 15.5 Validate Phase 1 gate.
  - [x] 15.6 Validate Phase 2 gate.
  - [x] 15.7 Validate Phase 3 gate (skills impacting run guidance).
  - [x] 15.8 Validate Phase 5 gate (production hardening readiness).
  - [x] 15.9 Acceptance: all required gates are explicitly passed or blocked with remediation plans.

- [x] 16.0 Optional external retrieval adapters and benchmarks (Phase 4) (Reference: SPEC-050 §External Accelerators, §Implementation Plan Phase 4)
  - [x] 16.1 Define external retrieval adapter interface extension points.
  - [x] 16.2 Implement LightRAG adapter prototype.
  - [x] 16.3 Implement graphrag-rs adapter prototype.
  - [x] 16.4 Benchmark native vs adapter retrieval quality, latency, and cost.
  - [x] 16.5 Decide production posture while retaining Open Mercato as canonical decision memory.
  - [x] 16.6 Acceptance: adapter decision is evidence-based and does not violate source-of-truth boundaries.

- [x] 17.0 Documentation, open-source packaging, and release readiness (Cross-phase) (Reference: SPEC-050 §Final Compliance Report, §Migration Notes)
  - [x] 17.1 Update SPEC-050 changelog with implementation progress per phase.
  - [x] 17.2 Add architecture docs for adapters, telemetry envelope, and context graph model.
  - [x] 17.3 Add operator runbook for interventions, kill-switch, and incident procedures.
  - [x] 17.4 Add developer onboarding docs for module extension and MCP tool additions.
  - [x] 17.5 Prepare release notes and migration notes for all newly published contracts.
  - [x] 17.6 Acceptance: board-facing and open-source-facing docs are complete and reviewable.

- [x] 18.0 Final board handoff package (Program close-out)
  - [x] 18.1 Produce one-page executive summary: delivered scope, non-goals, residual risks.
  - [x] 18.2 Produce KPI baseline and first operating cadence recommendations.
  - [x] 18.3 Produce known gaps backlog for post-v2 increments.
  - [x] 18.4 Acceptance: board packet is complete and implementation can continue without ambiguity.
