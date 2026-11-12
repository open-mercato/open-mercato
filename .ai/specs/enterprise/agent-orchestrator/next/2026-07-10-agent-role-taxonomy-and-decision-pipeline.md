# Agent Role Taxonomy & Decision Pipeline — Extractor / Decision / Executor

> **Status:** DRAFT (Open Questions resolved 2026-07-10). Roadmap overlay on top of
> [`../00-IMPLEMENTED-BASELINE.md`](../00-IMPLEMENTED-BASELINE.md). Feasibility grounded in a
> code-level investigation (2026-07-10) of the shipped module.

## TLDR

**Key Points:**
- Introduce a first-class **agent role taxonomy** — **Extractor** (perceive → durable findings), **Decision** (decide → route, don't execute), **Executor** (act → propose concrete mutations) — so multi-agent business processes (negotiation, claim triage, financial-alert response) are composed as pipelines, not crammed into one agent.
- Add a third `AgentResult` kind, **`decision`**, plus a **human-dispositionable, append-only-audited `AgentDecision`** artifact, so "the agent decided X (accept / reject / need-more-data / counter-propose)" is an auditable, gatable, routable record.
- Add a durable **`AgentFinding`** store for extractor output, and a **closed action catalog** for executors.
- Preserve **propose-only** end-to-end: the decision role *routes*, the executor role *proposes*, and every domain write still flows `proposal → disposition → effector (command)`.

**Scope:**
- `decision` result kind + `AgentDecision` entity/commands/migration + multi-signal disposition routing.
- `AgentFinding` durable, cited, reusable extractor-output store, surfaced as a TDCR context source.
- Closed action catalog for executors (verb → param schema → command), superseding the freeform `actionCommandMap`.
- Pipeline substrate on the workflows engine: decision-outcome transitions, loop-backs, negotiation `WAIT_FOR_SIGNAL` template + inbound-reply→signal bridge + timer-race SLA.
- Cockpit + evals + guardrails extended to the new role/kind.

**Concerns:**
- The negotiation reply-loop needs net-new, cross-module plumbing (Phase 4) — an inbound-event→signal subscriber and a trusted-scope emit fix in `packages/webhooks` (**Ask First** — touches a core/webhooks contract).
- Adding a third `AgentResult` union member touches every exhaustive `informative|actionable` switch; the blast radius is enumerated and all consumers are updated in-repo.

## Overview

The `agent_orchestrator` module runs propose-only AI agents: each returns a typed `AgentResult`, persists an `AgentRun` (+ an `AgentProposal` for actionable results), and never writes domain state directly. Today an agent is one of exactly two shapes — `informative` (returns data) or `actionable` (returns a proposal). That binary cannot express how real business processes decompose: *perceive many sources → decide with a closed set of outcomes → act by mutating objects*, often with loops (decide → gather more → re-decide) and long waits (send a counter-offer → wait days for a reply).

This overlay makes that decomposition first-class as a **role taxonomy** and adds the missing middle — a **decision** that is neither raw data nor a mutation proposal, but an audited, routable verdict subject to human oversight.

> **Market Reference:** Anthropic's orchestrator-worker / evaluator-optimizer agent patterns (perceive/decide/act separation), LangGraph's stateful cyclic agent graphs, and the "LLM proposes, system disposes" discipline from the module's own `agent_orchestration_security_analysis.md`. We **adopt** role separation and closed-contract decision/action surfaces; we **reject** building a bespoke agent-graph runtime — the shipped workflows engine already provides durable execution, cyclic graphs, human-in-the-loop, and external-signal waits (validated 2026-07-10).

## Problem Statement

Four structural limits in the shipped module, each anchored in code:

1. **Decision and action are collapsed into one `actionable` proposal.** `AgentResult` is a two-kind union (`data/validators.ts:25`). A decision that ends in *reject / need-more-data / counter-propose* has **no representation**. The proposed-action verb is a freeform `z.string()` (`validators.ts:8`); one verb ships module-wide (`set_stage`).
2. **Extractor output is ephemeral.** `informative` results land in `AgentRun.output` and are not a durable, queryable, reusable store — the user's "need to write it somewhere."
3. **No real agent pipeline.** Agents chain only via workflow `INVOKE_AGENT` steps (one shipped example is *decision-agent → non-agent effector*) or depth-1 informative-only `delegate_agent` fan-out. Neither is extractor→decision→executor.
4. **Disposition is a single-threshold, 2-way gate** (`confidence ≥ threshold` → auto vs `USER_TASK`, `dispositionService.ts:39`) — no routing on a decision outcome, no multi-signal autonomy (security analysis §5 wants `f(confidence, risk, category, amount, guardResults)`).

## Proposed Solution

A first-class **`role`** on the agent registry (`extractor | decision | executor`, additive; default derived from `resultKind`), three data-plane additions, and a workflow pipeline convention.

| Role | Result kind | Domain writes? | Persisted artifact | Routes to |
|------|-------------|----------------|--------------------|-----------|
| **Extractor** | `informative` | Findings only (via command) | `AgentFinding` (durable, cited) | Decision |
| **Decision** | **`decision`** (new) | No | `AgentDecision` (append-audited, dispositionable) | Executor / loop-back / signal-wait |
| **Executor** | `actionable` | Proposes mutations | `AgentProposal` (unchanged) | effector command |

- **Extractors write findings, not domain state.** An extractor returns `informative` data; the runtime persists each finding as an `AgentFinding` (subject-keyed, cited via the existing context-provenance schema). Findings become (a) queryable inputs for decision agents, (b) the pipeline's shared memory, (c) a new **TDCR context source kind** so the context resolver feeds them downstream for free.
- **Decisions route, they don't execute.** A decision agent returns the new `decision` kind; the runtime persists an `AgentDecision`. `outcome` is a per-workflow closed enum (negotiation: `ACCEPT | REJECT | COUNTER | REQUEST_INFO | ESCALATE`). The decision is **human-dispositionable** (Caseload review/override) under the same multi-signal disposition gate. It then routes via workflow transitions: `REQUEST_INFO` → loop back to an extractor; `COUNTER` → emit an artifact + park on `WAIT_FOR_SIGNAL`; `ACCEPT/REJECT` → hand a typed intent to an executor.
- **Executors keep propose-only**, but their verbs become a **registered, closed action catalog** (`send_email`, `create_object`, `schedule_technician`, `set_stage`, …) binding each verb to a Zod param schema + command id — realizing security-analysis §3's closed action contract and turning "unmapped verb silently skipped" (`executeProposal.ts:35`) into "unknown verb rejected."
- **Pipelines run on the workflows engine.** Each role is an `INVOKE_AGENT` step; branches are JSON-predicate transitions on `context.decision.outcome`; loop-backs and a negotiation template (timer-race SLA + inbound-reply→signal subscriber) are the only net-new orchestration.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| One phased overlay (Q1) | The capabilities share the role taxonomy and cross-reference; matches house style (the lightweight-runtime overlay bundles runtime + custom agents + UI). **Phase dependency is not uniform:** P1 (findings) and P3 (action catalog) are each independently deployable; P2 (decision kind) is independent; **P4 (pipelines) depends on P1–P3.** P3 (closed action catalog) is an orthogonal `security` hardening with standalone value — kept here for narrative cohesion per Q1, but it is the natural candidate to extract into its own `security`-labeled spec if the maintainer prefers (noted, not re-gated). |
| `AgentDecision` is human-dispositionable (Q2) | A decision is the highest-stakes artifact; security-analysis §5 mandates human oversight on autonomy. Reuses the shipped `AgentProposal` disposition machinery, generalized. |
| New `AgentFinding` entity (Q3) | Context bundles are per-run immutable evidence; findings must be cross-run, queryable, and reusable — a distinct lifecycle. |
| Autonomy matrix on `INVOKE_AGENT` node config + DI resolver seam (Q4) | Matches the deliberate no-`module_configs` autonomy choice (`setup.ts:98`, avoids cross-tenant leakage); the seam lets a tenant-scoped table supersede it later without a contract change. |
| New `role` field; finding persistence gated on **explicit** `role: extractor` | Additive/BC: derivation is display-only; existing agents write no findings and keep working byte-for-byte. Emitting findings is an intentional authoring act, never a side effect of being `informative`. |
| Reuse the workflows engine, not a new agent-graph runtime | Durable execution, cyclic graphs, HITL, and external-signal waits are already validated in-engine (2026-07-10). Two orchestration models = two sources of truth. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Overload `actionable` proposals with a reserved `decide` verb | Keeps decision and action conflated — the core defect. No place to gate/override a decision independently of the action it implies. |
| Bespoke multi-agent pipeline runtime inside `agent_orchestrator` | Duplicates the workflow engine's durable execution, HITL, signals; risks divergent semantics. |
| Findings inside `AgentContextBundle` | Bundles are immutable per-run evidence; forcing reusable cross-run findings into them couples extractor output to context-assembly lifecycle. |
| Keep freeform `actionCommandMap`, add verbs ad hoc | Violates security-analysis §3 closed-contract requirement; unmapped verbs silently skip — a correctness and safety hole. |

## User Stories / Use Cases

- A **sales manager** wants the system to **watch a stalled negotiation, decide accept/counter/reject on each client reply, and auto-send low-risk counters** so that routine back-and-forth doesn't need a human until the terms cross a threshold.
- A **claims operator** wants an **extractor to summarize a claim packet, a decision agent to propose approve/request-documents/escalate, and a human to override high-value decisions** so that low-risk claims clear automatically with a full audit trail.
- A **finance lead** wants an **extractor to flag alarming financial-report findings, a decision agent to escalate, and an executor to send a notification** so that anomalies surface without manual monitoring.
- A **compliance auditor** wants **every decision recorded with its outcome, rationale, confidence, risk signals, and the findings it was based on** so that an automated decision is explainable months later.

## Architecture

### Data flow (negotiation pipeline)

```
                          ┌──────────────── workflow instance (correlationKey = deal id) ───────────────┐
 client proposition ──▶ [INVOKE_AGENT: extractor] ──▶ AgentFinding rows ──┐
                                                                          ▼
                                                   [INVOKE_AGENT: decision] ──▶ AgentDecision (dispositioned)
                                                                          │
        ┌───────────── context.decision.outcome (JSON-predicate transitions) ─────────────┐
        ▼                        ▼                          ▼                              ▼
   REQUEST_INFO             COUNTER                    ACCEPT / REJECT                  ESCALATE
   → loop back to        → [INVOKE_AGENT: executor]   → [INVOKE_AGENT: executor]     → USER_TASK
     extractor             emits counter-offer          emits mutation proposal        (human)
                           proposal → effector          → disposition → effector
                                  │
                          WAIT_FOR_SIGNAL (counterparty.replied)  ◀── inbound webhook → signal subscriber
                          ‖ raced by WAIT_FOR_TIMER (SLA) ‖ → ESCALATE on timeout
```

Every domain write (counter-offer persisted, deal updated, email sent) is an executor **proposal** → **disposition** → **effector command** — propose-only is never bypassed. Extractors write only `AgentFinding` rows (via an audited `findings.record` command). Decisions write only `AgentDecision` rows.

### Commands & Events

- **Commands** — the command-id resource segment is **plural** (`findings`/`decisions`) to mirror the shipped module convention (`agent_orchestrator.proposals.dispose`, `commands/proposals.ts`); **events stay singular** (`decision.disposed`). This plural-command / singular-event split is intentional and consistent with the shipped baseline, not an oversight.
  - `agent_orchestrator.findings.record` — persist an extractor finding. **Reversibility:** none by design — findings are immutable audit rows; a correction is a *new* finding, never an in-place edit or undo.
  - `agent_orchestrator.decisions.create` — persist an `AgentDecision`. **Reversibility:** the decision row is immutable audit; a changed verdict is a *new* decision in the next pipeline round, not a mutation of this one.
  - `agent_orchestrator.decisions.dispose` — apply a disposition (auto or human) to a decision; optimistic-locked. **Reversibility:** terminal, mirroring `proposals.dispose` — a disposed decision is not re-opened; re-evaluation happens via a fresh decision run/round (auditable), never by reversing the disposition.
- **Events** (`module.entity.action`, singular entity, past tense; declared in `events.ts` `as const`):
  - `agent_orchestrator.finding.recorded`
  - `agent_orchestrator.decision.created` (`clientBroadcast: true` for the cockpit)
  - `agent_orchestrator.decision.disposed`
  - `agent_orchestrator.decision.ready` — resume signal for the parked `INVOKE_AGENT` step (decision analog of `proposal.ready`).
  - `agent_orchestrator.counterparty.replied` — the negotiation resume signal name (emitted by the inbound bridge; Phase 4).

### Blast-radius manifest (adding the `decision` kind)

`AgentRun.result_kind` is `varchar(20)` with no DB enum/CHECK (`entities.ts:143`) — **no migration for the kind itself**. All constraints are Zod/TS:

- **Discriminator:** `agentResultSchema` union + `AgentResult` TS type + `runListQuerySchema.resultKind` enum (`validators.ts:25,33,53`); `completeAgentRunSchema.resultKind` (`commands/runs.ts:37`).
- **Both runtimes:** symmetric `else if (result.kind === 'decision')` persisting an `AgentDecision` (`agentRuntime.ts:415`, `openCodeAgentRunner.ts:219`); `shapeResult` decision branch + `completeRun` signature (`persistence.ts:138,191`).
- **SDK:** `AgentResultKind`/`OutcomeKind`/`compileOutcome`/`parseOutcomeKind` gain `'decision'` (`defineAgent.ts:8`, `outcomeSchema.ts:24`, `defineFileAgent.ts:94`).
- **Workflow bridge/context:** `InvokeAgentForWorkflowOutcome` + `AgentResultEnvelope` gain a decision variant exposing `decision.*` for `outputMapping` (`invokeAgentForWorkflow.ts:31`, core `agent-result-mapping.ts:16`); downstream envelope consumers in `activity-executor.ts`, `step-handler.ts`, `activity-worker-handler.ts`.
- **Cockpit:** playground/traces/agents/overview 2-way branches, a `DecisionCard`, `components/types.ts` `resultKind` widening + `mapAgent`, and `.decision`/role i18n in en/es/de/pl (missing key renders raw).
- **`delegate_agent`:** decide policy (`ai-tools.ts:60,80`) — decisions are **not** delegatable sub-agents (sub-agents stay informative-only).

## Data Models

### AgentFinding (`agent_findings`) — append-only, immutable
- `id`: uuid PK
- `tenant_id`, `organization_id`: uuid (mandatory scope)
- `agent_id`: varchar(100) — the extractor that produced it
- `run_id`: uuid — FK id → `agent_runs` (provenance; not an ORM relation)
- `process_id`: uuid, nullable — FK id → workflow instance (the pipeline it belongs to)
- `subject_type`: varchar(64), `subject_id`: varchar(100) — what the finding is about (e.g. `deal`/`123`), FK id only — the query key for decision agents
- `finding_type`: varchar(64) — e.g. `momentum`, `financial_alert`, `client_proposition`
- `summary`: text — **encrypted** (may contain PII)
- `data`: jsonb — **encrypted** typed payload (may contain PII)
- `citations`: jsonb, nullable — array of `contextProvenanceSchema` (`sourceKind`/`sourceRef`/`locator`) — reuse the shipped provenance shape. `locator` is a pointer (e.g. `page:3#bbox`), not content — non-PII by the shipped provenance contract, so unencrypted; the PII lives in `summary`/`data`, which are encrypted.
- `confidence`: float, nullable
- `created_at`: Date — **append-only: no `updated_at`/`deleted_at`** (immutable audit; re-extraction inserts a new row). Allowlisted in `optimistic-lock-editable-entities.test.ts` as non-editable.
- Indexes: `(organization_id, subject_type, subject_id, created_at)`, `(organization_id, process_id)`.

### AgentDecision (`agent_decisions`) — append-audited, human-dispositionable
Mirrors `AgentProposal` (`entities.ts:891`) so the disposition machinery is reused:
- `id`, `tenant_id`, `organization_id`, `agent_id`, `run_id` (FK id), `process_id` (nullable), `step_id` (varchar(100), nullable)
- `outcome`: varchar(40) — the closed-enum value the agent emitted (validated by the agent's decision schema; stored as string because the enum is per-workflow)
- `payload`: jsonb — **encrypted** typed decision body (counter-offer terms, requested documents, …; may contain PII)
- `rationale`: text — **encrypted**
- `confidence`: float, nullable — denormalized for the gate
- `risk_score`: float, nullable — **derived at persistence** from `guard_results` severities (and, once threaded, the input-phase injection score); the multi-signal input security-analysis §5 needs
- `guard_results`: jsonb, nullable — the output-phase guardrail verdict `checks` (mirror `AgentProposal.guardResults`)
- `disposition`: varchar(20), default `'pending'` — reuse `AgentProposalDisposition` values (`pending|auto_approved|approved|edited|rejected`)
- `disposition_by`: varchar(100), nullable; `disposition_reason`: text, nullable — **unencrypted, matching the shipped `AgentProposal.disposition_reason`**: operator-authored review notes, not raw subject PII by contract. If a tenant's review process risks entering subject PII here, add it to `encryption.ts` alongside `payload`/`rationale`.
- `created_at`, **`updated_at`** (editable → optimistic-lock default-ON), `deleted_at`
- Indexes: `(organization_id, disposition, created_at)`, `(organization_id, process_id)`.

### Agent registry `role` (additive)
`DefineAgentInput.role?: 'extractor'|'decision'|'executor'` + `AgentRegistryEntry.role` + file-agent `AGENT.md` frontmatter `role?`. When **unset**, `role` is *derived* for classification/display only (`informative→extractor`, `decision→decision`, `actionable→executor`).

**Finding persistence is opt-in, never derived.** The runtime persists `AgentFinding` rows ONLY when `role` is **explicitly** `extractor` (an author must set it). A plain `informative` agent with no explicit role — including every already-shipped informative agent and every `delegate_agent` sub-agent — is classified as an extractor for display but writes **no** findings, so its runtime behavior is unchanged. This keeps the "existing agents unchanged" guarantee literal (no new writes, no storage growth) and makes finding-emission an intentional authoring act.

### Action catalog (executor verbs)
`defineActionVerb({ verb: string, paramSchema: ZodTypeAny, commandId: string, requiredFeatures?: string[] })`, collected into a module-scoped catalog. `executeProposal` resolves `action.type` → catalog entry, validates `action.payload` against `paramSchema`, then runs `commandId` via the command bus. **Unknown verb → reject** (not skip). Shipped `set_stage` gets a catalog entry; the freeform `actionCommandMap` is retained as a `@deprecated` fallback for ≥1 minor (BC bridge).

### Autonomy policy (Q4)
`DispositionOnResult` node config extended (additive) with optional:
```
autonomyMatrix?: Array<{ category?: string; maxAmount?: number; autoApproveThreshold: number; requireHuman?: boolean }>
```
plus a DI seam `autonomyPolicyResolver` (default reads node config; a tenant-scoped table can be registered to override). `evaluateAutonomy({ confidence, riskScore, category, amount, guardResults }, policy)` is the shared, fail-closed function used by both proposal and decision disposition.

**Where each signal comes from at dispose time** (the artifact carries only `confidence`/`risk_score`/`guard_results` — `category`/`amount` are resolved, not stored on the row):
- `confidence`, `guardResults` — read directly off the `AgentDecision`/`AgentProposal`.
- `riskScore` — derived from `guard_results` severities (persisted as `risk_score`).
- `category` — resolved from the `INVOKE_AGENT` node config (per-step `category`), falling back to `agent_id`; never free-text from the model.
- `amount` — extracted from `decision.payload` via a configured `amountPath` dot-path on the node (same dot-path mechanism as `FACTS.json`), or absent when the workflow declares none (a null amount fails closed against any `maxAmount` band).

Fail-closed: any signal a matched matrix band requires but cannot resolve → treat as below threshold (route to human), never auto-approve.

## API Contracts

Read/list routes use the shipped `proposals`/`runs` convention — **`makeCrudRoute`** where the shape fits (Zod query, `openApi` export, tenant scope, `pageSize ≤ 100`); the custom dispose action endpoint wires the **mutation-guard registry** (`runMutationGuards` + `bridgeLegacyGuard(container)`), never a hand-rolled guard. Only the deltas are documented.

### `GET /api/agent_orchestrator/decisions` — feature `agent_orchestrator.decisions.view`
- List + `?id=` detail (via `makeCrudRoute`). Filters: `agentId`, `processId`, `disposition` (single or comma list), `outcome`. The `outcome` filter is a per-workflow string that can collide across pipelines (e.g. `ESCALATE`), so it is only meaningful when combined with `agentId`/`processId`; unscoped `outcome` filtering is documented as best-effort within the tenant.

### `POST /api/agent_orchestrator/decisions/:id/dispose` — feature `agent_orchestrator.decisions.dispose`
- Custom action route (not `makeCrudRoute`): wires the mutation-guard registry. Body mirrors `disposeProposalSchema`: `{ disposition: 'approved'|'edited'|'rejected', payload?, reason? }` (edit/reject require `reason`; edit requires `payload`). Optimistic-locked on `updated_at` via `buildOptimisticLockHeader`; conflicts surfaced with `surfaceRecordConflict`.

### `GET /api/agent_orchestrator/findings` — feature `agent_orchestrator.findings.view`
- List + detail (via `makeCrudRoute`). Filters: `subjectType`+`subjectId`, `processId`, `agentId`, `findingType`. Reads route through `findWithDecryption` (encrypted columns).

### Changed responses
- `GET /agents`, `/agents/:id`: response gains `role`; `resultKind` enum gains `'decision'`.
- `POST /agents/:id/run`: `AgentResult` response gains the `{ kind: 'decision', decision }` variant (OpenAPI regenerates from `baseAgentResultSchema`).

## Internationalization (i18n)
Add to en/es/de/pl: `agent_orchestrator.agents.list.resultKind.decision`, `…role.{extractor,decision,executor}`, decision-outcome labels (`…decision.outcome.*`, per-catalog), Caseload decision strings (`…caseload.decision.*`), findings inspector strings (`…findings.*`). Internal-only `throw`/`toast` messages prefixed `[internal]`.

## UI/UX
- **Caseload decision surface** — a `DecisionCard` (analogous to `ProposalCard`) rendering outcome, rationale, confidence, risk signals, and the **findings the decision was based on** (linked `AgentFinding` rows, **batch-loaded in a single `?processId=`/subject query — no per-finding N+1**). The dispose dialog is a non-`CrudForm` write, so it uses **`useGuardedMutation(...).runMutation(...)`** with `retryLastMutation` in the injection context (never raw `fetch`). Approve/override/reject with the same disposition affordances. DS-compliant: `StatusBadge` for disposition, semantic status tokens (no `text-red-*`/`bg-green-*`), shared `Alert`/`FormField`/`SectionHeader`, lucide-react icons, dialog `Cmd/Ctrl+Enter` submit + `Escape` cancel, `aria-label` on icon-only buttons.
- **Findings inspector** — read-only `DataTable` under traces, filterable by subject/process.
- **Overview/Agents** — extend the 2-way autonomy chip mapping to the 3 roles.

### Frontend Architecture Contract
All new UI is backend cockpit under `packages/enterprise/src/modules/agent_orchestrator/backend/**`. Server/Client boundary: list/detail pages are Server Components fetching via the module APIs; only the dispose dialog + interactive `DecisionCard` are `"use client"` (justified: form state + keyboard handlers). No new shared providers, no client-blob growth beyond the dialog. Reuses existing Caseload data-loading patterns; no new route/bundle budget impact.

## Configuration
- No new env vars for Phases 1–3. Phase 4 negotiation SLA reuses `WAIT_FOR_TIMER` (queue-backed) durations authored on the workflow node. The inbound-bridge emit-scope fix and subscriber are code, not config.

### Caching
- **Findings-by-subject** is the read-hot path (a decision agent queries findings for its subject on every round; the inspector lists them). Cache it with a DI-resolved `@open-mercato/cache` store, tenant-scoped, tagged by `subject:<type>:<id>` and `process:<id>`, invalidated on `agent_orchestrator.finding.recorded`. Findings are immutable, so the only invalidation trigger is a *new* finding for that subject/process — no update/delete churn.
- **Decisions** are operator-facing and low-volume; no cache (freshness of disposition state matters more than read cost), matching the shipped proposals Caseload.

### Pagination at scale
- Findings/decisions are append-only and grow unboundedly. List routes ship with the shipped offset pagination (`pageSize ≤ 100`) for parity with proposals; **keyset (created_at, id) pagination is a recommended scale follow-up** for the findings inspector before large tenants accumulate deep history.

## Migration & Compatibility

**Fully additive — no breaking changes.**
- **Schema:** two new tables (`agent_findings`, `agent_decisions`) + snapshot; `result_kind` stays `varchar(20)` (no enum change).
- **`AgentResult` union:** adding a third member is ADDITIVE per `BACKWARD_COMPATIBILITY.md`, but every internal exhaustive `informative|actionable` switch is updated in the same change (see blast-radius manifest). External TS consumers of the exported `AgentResult` type get a new variant → documented in `RELEASE_NOTES.md`.
- **Action catalog:** `set_stage` gets a catalog entry; the freeform `actionCommandMap` path is kept as `@deprecated` for ≥1 minor with a bridge, per the deprecation protocol.
- **Contract surfaces (all additive):** new event ids, new ACL features (added to `setup.ts` `defaultRoleFeatures` + `yarn mercato auth sync-role-acls`), new command ids, new API routes, `role`/`decision` OUTCOME.md frontmatter.
- **Existing `deals.health_check`:** unchanged; `role` derives to `executor`. A reference migration to a 3-stage pipeline ships as an example, not a breaking change.
- **Phase 4 webhooks emit-scope fix:** **Ask First** — changes a `packages/webhooks` inbound-route emit to carry trusted tenant/org in options; coordinate as a core/webhooks change (also unlocks event-triggered starts for inbound webhooks).

## Implementation Plan

### Phase 1 — Findings + extractor role (independently shippable)
1. Add `role` to `DefineAgentInput`/`AgentRegistryEntry`/file-agent frontmatter + descriptor; derive for display only (never for persistence).
2. `AgentFinding` entity + migration + snapshot; `encryption.ts` maps for `summary`/`data`; register non-editable in the optimistic-lock allowlist.
3. `agent_orchestrator.findings.record` command; runtime persists findings **only for agents with an explicit `role: extractor`** (with run/subject/citations provenance) — informative agents without the explicit role write nothing.
4. Surface findings as a new TDCR **context source kind** in the context resolver.
5. `GET /findings` route (+ `openApi`, `findWithDecryption`); findings inspector UI; ACL `findings.view` + setup sync; i18n.
6. Tests: extractor-run→finding persistence, subject query, cross-tenant isolation, encryption round-trip, context-source assembly.

### Phase 2 — `decision` kind + `AgentDecision` + multi-signal disposition
1. Add `'decision'` across the discriminator, SDK, both runtimes, `shapeResult`, `completeRun` (blast-radius manifest).
2. `AgentDecision` entity + migration + snapshot + `encryption.ts` maps; `decisions.create`/`decisions.dispose` commands.
3. Generalize `DispositionService`: shared fail-closed `evaluateAutonomy` reading `confidence`+`guardResults` (+ derived `risk_score`); `autonomyMatrix` node config + `autonomyPolicyResolver` DI seam.
4. Workflow bridge: `decision` variant in `InvokeAgentForWorkflowOutcome` + core `AgentResultEnvelope` (`decision.*` mapping) + downstream consumers; `decision.ready` resume signal.
5. Caseload `DecisionCard` + `/decisions` + `/decisions/:id/dispose` (optimistic-locked) + ACL `decisions.view`/`decisions.dispose` + setup sync + i18n; a new `allowed_outcome` deterministic eval scorer + gate assertion.
6. Tests: decision persistence (both runtimes), auto vs human gate across the matrix, fail-closed on null/blocked, dispose optimistic-lock 409, eval outcome-gating.

### Phase 3 — Closed action catalog
1. `defineActionVerb` + module catalog; register `set_stage`; refactor `executeProposal` to resolve+validate against the catalog; unknown verb → reject.
2. Keep freeform `actionCommandMap` as `@deprecated` fallback; RELEASE_NOTES entry.
3. Tests: verb param-schema validation, unknown-verb rejection, deprecated-fallback path, effector command dispatch.

### Phase 4 — Pipeline templates (negotiation) — depends on P1–P3
1. Decision-loop + negotiation workflow example subgraphs (JSON-predicate transitions on `context.decision.outcome`, loop-backs, `WAIT_FOR_SIGNAL` + `WAIT_FOR_TIMER` race).
2. **Ask First:** inbound-webhook emit-scope fix (`packages/webhooks`) + persistent subscriber calling `sendSignalByCorrelationKey` (signal `agent_orchestrator.counterparty.replied`, `correlationKey` = subject id).
3. Per-pipeline iteration budget guard (max decision rounds in context) to bound `REQUEST_INFO` loops.
4. (Optional) real USER_TASK escalation sweep for stalled decisions/negotiations.
5. Integration tests: full extractor→decision→executor pipeline, loop-back, negotiation reply resume, SLA-timeout escalation, iteration-budget cap.

### File Manifest (key files)
| File | Action | Purpose |
|------|--------|---------|
| `data/entities.ts` | Modify | `AgentFinding`, `AgentDecision` entities |
| `data/validators.ts` | Modify | `decision` union member, decision/finding schemas, `runListQuerySchema` |
| `encryption.ts` | Modify | maps for finding `summary`/`data`, decision `payload`/`rationale` |
| `lib/runtime/{agentRuntime,openCodeAgentRunner,persistence}.ts` | Modify | decision branch, finding persistence, `shapeResult` |
| `lib/sdk/{defineAgent,outcomeSchema,defineFileAgent}.ts` | Modify | `role`, `decision` kind |
| `lib/disposition/*` | Modify | `evaluateAutonomy`, decision dispose, autonomy matrix + resolver seam |
| `lib/runtime/executeProposal.ts` | Modify | action-catalog resolution |
| `lib/actionCatalog.ts` | Create | `defineActionVerb` + catalog |
| `lib/context/*` | Modify | findings as a context source |
| `commands/{findings,decisions}.ts` | Create | audited commands |
| `api/{findings,decisions}/**` | Create | routes + `openApi` |
| `backend/caseload/**`, `components/DecisionCard.tsx` | Create/Modify | decision review UI |
| `packages/core/src/modules/workflows/lib/agent-result-mapping.ts` | Modify | `decision` envelope variant |
| `packages/webhooks/.../inbound/[endpointId]/route.ts` + subscriber | Modify/Create | Phase 4 emit-scope + signal bridge (**Ask First**) |
| `acl.ts`, `setup.ts`, `events.ts`, `i18n/*` | Modify | features, sync, events, strings |
| `migrations/*` + `.snapshot-open-mercato.json` | Create | new tables |

### Testing Strategy
- **Unit:** decision-kind parse/persist (both runtimes), `evaluateAutonomy` matrix + fail-closed, action-catalog validation/rejection, finding provenance + encryption round-trip, `allowed_outcome` scorer.
- **Integration:** end-to-end extractor→decision→executor pipeline; negotiation loop with inbound-reply resume + SLA-timeout escalation; loop-back with iteration-budget cap; cross-tenant isolation on findings/decisions; dispose optimistic-lock 409. Self-contained fixtures (API-created), cleaned up in teardown.

## Risks & Impact Review

### Data Integrity Failures
Decision/finding writes go through audited commands within the run's transaction; a crash mid-pipeline leaves the workflow parked at its last durable step (re-entry creates fresh step/run instances — no half-written state). Dispose is optimistic-locked (`updated_at`) so concurrent operator edits 409 rather than lost-update.

### Cascading Failures & Side Effects
Extractors depend on the context resolver; a resolver failure fails the extractor run (no partial finding). Decisions consume findings by subject query — a missing finding is a normal `REQUEST_INFO` loop, not a crash. Executor proposals still gate through disposition; an effector command failure surfaces as a proposal error, not a silent skip (catalog rejects unknown verbs).

### Tenant & Data Isolation Risks
Findings, decisions, and signals are tenant/org-scoped; `sendSignalByCorrelationKey` filters by scope. The Phase 4 emit-scope fix is a **precondition** for the inbound bridge — without trusted scope in emit options, the subscriber must not resume (fail-closed).

### Migration & Deployment Risks
Additive tables + additive union member → deployable without downtime; no backfill. The `AgentResult` union change is the only source-compat consideration (external TS consumers) — mitigated by in-repo updates + RELEASE_NOTES.

### Operational Risks
Blast radius of a bad pipeline is one tenant/one workflow instance; the iteration-budget guard bounds runaway `REQUEST_INFO` loops; the SLA timer bounds stalled negotiations. Storage growth: append-only findings/decisions follow the existing trace-retention/archival plan (gap-19).

### Risk Register

#### Decision loop non-termination
- **Scenario:** A decision agent repeatedly returns `REQUEST_INFO`, looping decision→extractor→decision forever.
- **Severity:** High
- **Affected area:** workflows engine, agent runtime cost.
- **Mitigation:** Per-pipeline iteration budget in workflow context; a guard transition routes to `ESCALATE`/USER_TASK when the budget is exceeded. (The engine's 100-iteration synchronous cap does **not** help — each loop parks on an agent run and resets it.)
- **Residual risk:** A misconfigured budget could escalate too early; tunable per workflow.

#### Stalled negotiation (no native signal timeout)
- **Scenario:** The counterparty never replies; the instance waits forever at `WAIT_FOR_SIGNAL` (`signalConfig.timeout` is parsed but never scheduled).
- **Severity:** Medium
- **Affected area:** negotiation pipeline.
- **Mitigation:** `PARALLEL_FORK` racing the signal wait against a `WAIT_FOR_TIMER` (queue-backed) that routes to `ESCALATE` on expiry.
- **Residual risk:** USER_TASK escalation itself is schema-only today (no overdue sweep) — Phase 4 optional item; until built, escalation lands as a pending task with no auto-nudge.

#### Autonomy miscalibration
- **Scenario:** A high-confidence-but-wrong decision auto-approves a harmful outcome (confidence is self-reported, injectable).
- **Severity:** High
- **Affected area:** disposition gate.
- **Mitigation:** Multi-signal `evaluateAutonomy` (confidence is necessary-not-sufficient; deterministic guardrails always active); fail-closed on null/blocked; per-category/amount matrix; recommend a standing random-sample-to-human rate (security-analysis §5).
- **Residual risk:** `risk_score` initially derives only from output guardrail severities (input-phase injection score is discarded today); threading it is a follow-up.

#### PII in findings/decisions
- **Scenario:** Extracted client data / counter-offer terms persist in plaintext.
- **Severity:** High
- **Affected area:** `agent_findings`, `agent_decisions`.
- **Mitigation:** `encryption.ts` maps on `summary`/`data`/`payload`/`rationale`; reads via `findWithDecryption`; append-only findings follow retention tiers.
- **Residual risk:** Denormalized `confidence`/`risk_score` are non-PII numerics (intentionally unencrypted for gating).

#### Action-catalog migration regressions
- **Scenario:** Tightening freeform verbs breaks an existing actionable agent.
- **Severity:** Medium
- **Affected area:** effector.
- **Mitigation:** `set_stage` catalog entry ships with Phase 3; freeform `actionCommandMap` retained `@deprecated` for ≥1 minor; unknown-verb rejection is opt-in per workflow until the fallback is removed.
- **Residual risk:** None once the fallback is removed on the announced schedule.

## Final Compliance Report — 2026-07-10

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/enterprise/src/modules/agent_orchestrator/AGENTS.md`
- `packages/enterprise/AGENTS.md`
- `packages/core/AGENTS.md` (API routes, encryption, events, setup, optimistic locking)
- `packages/core/src/modules/workflows/AGENTS.md`
- `packages/webhooks/AGENTS.md`, `packages/events/AGENTS.md`, `packages/ui/AGENTS.md`
- `.ai/ds-rules.md`, `.ai/ui-components.md`, `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | `run_id`/`process_id`/`subject_id` are FK ids only |
| root AGENTS.md | Filter by `organization_id` | Compliant | All new entities/queries tenant+org scoped |
| root AGENTS.md | Propose-only (module) | Compliant | Decisions route; executors propose; writes via effector command |
| root AGENTS.md | Optimistic locking default-ON | Compliant | `AgentDecision.updated_at` + dispose header; `AgentFinding` append-only (allowlisted) |
| core AGENTS.md | Encryption maps for PII columns | Compliant | `encryption.ts` maps + `findWithDecryption` |
| core AGENTS.md | API routes export `openApi`, wire mutation guard | Compliant | New routes specified with both |
| agent_orchestrator AGENTS.md | New ACL features → `setup.ts` + sync | Compliant | `findings.view`, `decisions.view`, `decisions.dispose` |
| agent_orchestrator AGENTS.md | Append-only audit rows immutable | Compliant | `AgentFinding` no `updated_at`/`deleted_at` |
| BACKWARD_COMPATIBILITY.md | Additive contract changes only | Compliant | Union member additive; deprecation bridge for `actionCommandMap` |
| workflows AGENTS.md | INVOKE_AGENT / signal semantics reuse | Compliant | No engine fork; JSON-predicate transitions |
| webhooks AGENTS.md | Inbound emit-scope change | Ask First | Phase 4, flagged; coordinated core/webhooks change |
| ds-rules.md | Semantic tokens, no arbitrary sizes, dialog keys | Compliant | `DecisionCard`/inspector spec'd DS-compliant |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `decisions`/`findings` fields ↔ routes |
| API contracts match UI/UX | Pass | Caseload dispose ↔ `/decisions/:id/dispose` |
| Risks cover all write operations | Pass | findings.record, decisions.create/dispose, effector proposals |
| Commands defined for all mutations | Pass | findings.record, decisions.create, decisions.dispose |
| Autonomy/guardrail signals reachable | Pass | confidence+guardResults on-artifact; risk derived; seam for the rest |

### Non-Compliant Items
- **Rule:** Inbound webhook emit carries trusted scope — **Source:** `packages/webhooks` / `packages/events` (`bus.ts:230`). **Gap:** current inbound route emits scope in payload, not options, so subscribers see null scope. **Recommendation:** Phase 4 emit-scope fix, gated **Ask First** (core/webhooks contract change), fail-closed until landed.

### Verdict
- **Fully compliant** for Phases 1–3 (self-contained in `agent_orchestrator`). **Phase 4** is compliant conditional on maintainer sign-off for the `packages/webhooks` emit-scope change (**Ask First**). Approved for phased implementation in that order.

## Changelog
### 2026-07-10
- Initial specification. Open Questions (Q1 scope-split, Q2 decision dispositionability, Q3 findings entity, Q4 threshold home) resolved: one phased overlay; human-dispositionable `AgentDecision`; new `AgentFinding` entity; node-config autonomy matrix + DI resolver seam. Feasibility grounded in the 2026-07-10 code investigation.
- Folded in fresh-context review: finding persistence gated on **explicit** `role: extractor` (no behavior change for existing informative agents); corrected phase-independence (P4 depends on P1–P3; P3 separable); resolved `category`/`amount` signal sources for the autonomy gate; added findings cache + keyset-pagination follow-up; named canonical primitives (`makeCrudRoute`, mutation-guard registry, `useGuardedMutation`); added per-command reversibility notes; clarified plural-command/singular-event convention and the `disposition_reason`/`citations.locator` encryption boundary.
