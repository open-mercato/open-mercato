> 🗂️ **Reorg 2026-06-22 · Status: SUPERSEDED (historical).** Decided or replaced by the implementation and the 2026-06-22 OpenCode specs. Kept for provenance only — do not use as a plan. Current: `.ai/specs/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`.

# Agent Orchestration Layer — Technical Architecture & Build Plan

> Onboarding doc for developers joining the build. Companion specs: `SPEC-00` (program index) + `ADR-001` + the nine specs (see the **Spec file map** in `SPEC-00`). Companion diagram: `agent-orchestration-architecture.html`.
>
> **2026-06-19 correction note.** This onboarding doc predates the codebase audit. Before implementing, read [`2026-06-19-agent-orchestrator-conventions.md`](2026-06-19-agent-orchestrator-conventions.md) (normative) and note: (1) the feature is a **core module `agent_orchestrator`** in `packages/core/src/modules/`, not a `@open-mercato/agent-orchestrator` package; (2) `eval-runner` (Inspect AI / `x_om`) **does not exist** — the eval harness is net-new, owned by the trace spec; (3) `telemetry-and-otel` and `health-monitoring` are **not implemented** — metrics build on this module's own tables + `dashboards`; (4) `workflows` has **no activity registry** — `INVOKE_AGENT` is a signal-park composition first, then an additive core enum change; (5) `audit_logs` is **not auto-written** — the on-behalf-of guarantee is an enforced no-bypass invariant. The "thin agent layer on a real, capable spine" thesis itself held up: `workflows` + `business_rules` + `ai_assistant` are genuinely present and OSS.

## 1. The core idea (read this first)

A deterministic **Open Mercato `workflows` state machine is the spine.** Agents are invoked as **steps** (`INVOKE_AGENT` activities), never as the controller. An agent's output becomes a typed **Proposal**; an OM **`business_rules`** rule **disposes** of it (auto-approve, or raise a human task). That is "LLM proposes, OM disposes" — the workflow, not the LLM, controls flow.

So we are **not building a platform.** We adopt OM's engine + plumbing and build a thin **agent layer** on top. Agents run on **pluggable external runtimes** — e.g. Azure AI Foundry, AWS Bedrock AgentCore, OpenAI, Google Vertex AI Agent Engine, or in-house — reached through **runtime adapters**; OM is **runtime-agnostic** and is the records / disposition / audit plane. **A2A** is the preferred cross-runtime standard (many runtimes speak it natively); provider adapters cover the rest.

## 2. Architecture at a glance (four layers)

```
UI / CLIENTS        Agent Cockpit (extends workflow monitor + My Tasks) · Claimant portal
AGENT LAYER (build) ONE core module → agent-orchestrator   subdomains: orchestration(keystone) · identity · dispatch · trace · guardrails · context · compliance · lifecycle · cockpit
OM FOUNDATION(adopt) workflows · business_rules · auth · audit_logs · notifications · queue · storage-s3 · query_index+search · feature_toggles · api_keys · eval-runner
RUNTIMES (pluggable) OM-internal · A2A runtimes (Foundry · Bedrock · Vertex …) · provider adapters (OpenAI · custom) · pull/BYO workers
```

> **Runtime-agnostic.** OM never depends on a specific runtime. The `dispatch` subdomain carries **runtime adapters**; a binding names its runtime (`internal | a2a | foundry | bedrock | openai | vertex | custom`). A2A covers any A2A-compliant runtime with no bespoke code; provider adapters wrap the rest and normalize their traces to OM's `AgentRun` model (target: OTel GenAI conventions). Foundry is one adapter, not a dependency.

## 3. The module: `agent-orchestrator` and its subdomains

The whole feature ships as **one OM core module — `@open-mercato/agent-orchestrator`** (one manifest, one DI registration, consolidated migrations). The logical pieces below are **internal subdomains** (`src/<subdomain>/`), each mapping 1:1 to a spec — the decomposition without the overhead of nine packages. A subdomain can be extracted into its own package later if it ever needs independent reuse/versioning (most likely: `dispatch`, `trace`).

| Subdomain (`src/…`) | Role | Class | Key OM deps | Spec |
|---|---|---|---|---|
| `orchestration` | `INVOKE_AGENT` activity + Proposal/disposition (**the keystone**) | Build | workflows, business_rules | AGENTINT-01 |
| `identity` | agent-as-principal, on-behalf-of audit, agent auth | Build | auth, audit_logs, api_keys | IDENTITY-01 |
| `dispatch` | task queue + capability registry + internal/pull/A2A + runtime adapters | Build | queue, api_keys | DISPATCH-01 |
| `trace` | run trace + eval + correction flywheel | Build | storage-s3, eval-runner | TRACE-01 |
| `guardrails` | runtime input/output safety (injection, PII, grounding, schema) | Build | ai_assistant | GUARD-01 |
| `context` | TDCR context assembly + retrieval + doc ingest + lineage | Build | query_index, search, attachments | CONTEXT-01 |
| `compliance` | claimant explanation/contest, GDPR, bias, AI Act | Build | portal, audit_logs | COMPLY-01 |
| `lifecycle` | shadow/canary, budgets, regression gating | Build | feature_toggles, eval-runner | LIFECYCLE-01 |
| `cockpit` | operator/admin/engineer UI | Build (extend) | workflows monitor, dashboards, perspectives | COCKPIT-01 |

Shared `contracts/` (Zod) and `data/` (entities) live at the module root. Everything else (the engine, gates, human tasks, saga, audit, notifications, queue, secrets, connectors, OTel, optimistic locking) is **adopted from existing OM modules** — `agent-orchestrator` depends on them, doesn't reimplement them.

## 4. End-to-end flow (one claim)

1. A `workflows` instance reaches an **`INVOKE_AGENT`** step.
2. **`context`** assembles a minimal, governed `ContextBundle` (TDCR; records routed vs pruned).
3. **`dispatch`** creates an `AgentTask` and routes it — internal / pull / A2A — to a capable agent; the workflow parks (`WAIT_FOR_SIGNAL`).
4. The agent runs under its **agent principal** (`identity`), on behalf of the invoking human (or system).
5. **`guardrails`** checks input + output (injection, PII, grounding, schema); a block fails the step safely.
6. The result is captured as an `AgentRun` + typed **`Proposal`** (`trace`); a signal resumes the workflow.
7. A **`business_rules`** rule **disposes**: auto-approve under thresholds, else raise a `USER_TASK` (Decide / Answer / Do / Know).
8. A human disposes in the **cockpit**; edit/reject writes a **`Correction`**.
9. The approved action executes via a standard `workflows` effector activity (CALL_API / payment / webhook) — under OM's authority, after the gate.
10. The `Correction` becomes an **`EvalCase`** → `eval-runner` regresses future versions (`lifecycle`).
11. The claimant sees a plain-language explanation and can contest (`compliance`).

Every write in steps 4–9 flows through OM's Command/CRUD path, so it is **attributed and audited identically to a human action**, with the on-behalf-of chain intact.

## 5. Shared contracts — freeze these BEFORE parallelizing

Multiple modules depend on the same types. Agree these Zod/TS contracts first; this is what unblocks parallel work and prevents drift:

- `ExecutionContext` { actorUserId, onBehalfOfUserId, sourceKey } — identity/audit.
- `AgentTask` — dispatch ↔ orchestration.
- `AgentRun` / `Span` / `ToolCall` — trace ↔ everyone.
- `Proposal` (+ disposition) — orchestration ↔ trace ↔ cockpit.
- `ContextBundle` — context ↔ orchestration.
- `GuardrailVerdict` — guardrails ↔ orchestration.
- `EvalCase` (`x_om` format) — trace ↔ eval-runner.
- The **capability-key vocabulary** (e.g. `coverage.check`, `damage.estimate`) — shared across orchestration, dispatch, registry.

## 6. Tech stack

Next.js 15 · TypeScript · MikroORM (PostgreSQL) · Awilix DI · Zod · `packages/queue` (BullMQ) or Postgres `SKIP LOCKED` · `storage-s3` (MinIO) for large payloads · OTel telemetry (GenAI semantic conventions for trace normalization) · OAuth client-credentials / `auth.md` for external agent auth · **pluggable agent runtimes via adapters** (Azure AI Foundry, AWS Bedrock, OpenAI, Vertex, in-house) · **A2A** as the cross-runtime standard · Inspect AI (via `eval-runner`).

## 7. Build plan — what's sequential, what's parallel

### 7.1 Sequential gates (must happen in order — small team)

0. **De-risk gate.** Validate before committing: (a) load-test `workflows` event-sourcing at thousands/week × millions of events; (b) confirm `business_rules` composite conditions (`confidence ≥ x AND fraud < y AND payout ≤ z`); (c) confirm OSS vs Enterprise edition coverage. → go/no-go.
1. **Contract freeze.** Agree §5 contracts. *This single step is what makes everything after it parallelizable.*
2. **Walking skeleton.** One claim end-to-end with the bare minimum: `AGENTINT` (`INVOKE_AGENT` + `Proposal` + one disposition rule) + `dispatch` **internal adapter** + `trace` **ingest** (`AgentRun` only) + `identity` **context injection**. No guardrails / evals / UI yet — prove the spine resumes and disposes.

### 7.2 Parallel tracks (kick off after the walking skeleton)

| Track | Scope | Starts after | Parallel-safe with |
|---|---|---|---|
| **A — Engine & keystone** (spine) | harden AGENTINT (arbitration, full rule packs), effector wiring | skeleton | all |
| **B — Identity & audit** | IDENTITY full: `User.kind`, on-behalf-of column, principal provisioning, OAuth creds, no-bypass test | contract freeze | A,C,D,E |
| **C — Trace & flywheel** | TRACE evals + corrections + `EvalCase` export | contract freeze (AgentRun/Proposal frozen) | A,B,D,E |
| **D — Safety & context** | GUARD + CONTEXT (plug into INVOKE_AGENT via hooks) | contract freeze | A,B,C,E |
| **E — Dispatch connectivity** | pull adapter, then A2A client + server | skeleton (internal done) | A,B,C,D |
| **F — Cockpit UI** | caseload + proposal card + trace inspector | AGENTINT dispose API + TRACE read API | (design now, in parallel) |
| **G — Govern & ship** | COMPLY + LIFECYCLE | TRACE record + portal exist | later |

### 7.3 Phasing (rough)

- **Phase 0** (~1–2 wk): de-risk + contract freeze. *Sequential.*
- **Phase 1** (~2–3 wk): walking skeleton. *Mostly sequential, 1–2 devs.*
- **Phase 2** (parallel): B, C, D, E-pull, F-build. *Multiple devs.*
- **Phase 3** (parallel): E-A2A, C-flywheel complete, F build-out.
- **Phase 4**: G (COMPLY, LIFECYCLE) + hardening.

## 8. Splitting the work (you + one coworker)

- **You (Patryk):** Track A (keystone) + the contract freeze + integration glue + `dispatch` internal/A2A. You hold the spine.
- **Coworker:** start on **Track B (identity & audit)** — it's self-contained, high-value, and the fastest way to learn OM's auth + Command/CRUD/audit model. Then move to **Track D (guardrails + context)**, both of which plug into `INVOKE_AGENT` through clean hooks, so you two rarely touch the same files.
- **Track C (trace)** is shared once the `AgentRun`/`Proposal` contract is frozen. **F (UI)** is Oliwia + whoever picks up the front end. **G** is later.

This split keeps contention low: A and B/D meet only at well-defined contract boundaries (the `INVOKE_AGENT` hooks and the `ExecutionContext`).

## 9. Risks & invariants to enforce

- **Engine throughput** — gated by the de-risk step; don't skip it.
- **No-bypass invariant** — *all* agent writes must go through OM Commands/CRUD or they're unattributed. Enforce via `ai_assistant` tool allowlist + a test asserting no `kind='agent'` actor appears outside the audited path. (Load-bearing for the whole audit story.)
- **Contract drift** — freeze and version §5; treat them as the integration seam.
- **UI before APIs** — don't build cockpit depth before AGENTINT dispose + TRACE read APIs are stable (design/mockups are fine in parallel).
