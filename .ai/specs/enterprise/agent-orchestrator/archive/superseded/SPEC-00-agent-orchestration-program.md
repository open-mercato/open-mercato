> 🗂️ **Reorg 2026-06-22 · Status: SUPERSEDED (historical).** Decided or replaced by the implementation and the 2026-06-22 OpenCode specs. Kept for provenance only — do not use as a plan. Current: `.ai/specs/enterprise/agent-orchestrator/00-IMPLEMENTED-BASELINE.md`.

# SPEC-00: Agent Orchestration Layer — Program Index

> **Status:** Draft
> **Owner:** Patryk Lewczuk (Comerito)
> **Last updated:** 2026-06-16
> **Decision record:** `ADR-001` (adopt OM `workflows` + `business_rules` as the engine)

This is the index and build plan for the agentic orchestration layer on Open Mercato. It maps every gap from the architecture audit to an OM mechanism, classifies it **Adopt** (use OM as-is) / **Extend** (OM foundation + agent additions) / **Build** (net-new), and lists the specs required.

> **2026-06-19 rewrite.** The nine sub-specs were rewritten to real Open Mercato conventions and corrected against a codebase audit. The short codes below (`AGENTINT-01`, `DISPATCH-01`, …) remain the logical ids used throughout this index; the actual files were renamed to the repo's `{date}-{title}.md` convention. **Read [`2026-06-19-agent-orchestrator-conventions.md`](2026-06-19-agent-orchestrator-conventions.md) first** — it is normative for module structure, entity style, naming, and tenancy, and wins over any sketch here.
>
> **Spec file map:**
> - `AGENTINT-01` → [`2026-06-19-agent-orchestration-step-and-proposal.md`](2026-06-19-agent-orchestration-step-and-proposal.md)
> - `IDENTITY-01` → [`2026-06-19-agent-identity-and-on-behalf-of.md`](2026-06-19-agent-identity-and-on-behalf-of.md)
> - `DISPATCH-01` → [`2026-06-19-agent-dispatch.md`](2026-06-19-agent-dispatch.md)
> - `TRACE-01` → [`2026-06-19-agent-trace-eval-capture.md`](2026-06-19-agent-trace-eval-capture.md)
> - `GUARD-01` → [`2026-06-19-agent-runtime-guardrails.md`](2026-06-19-agent-runtime-guardrails.md)
> - `CONTEXT-01` → [`2026-06-19-agent-context-knowledge-plane.md`](2026-06-19-agent-context-knowledge-plane.md)
> - `COMPLY-01` → [`2026-06-19-agent-decision-transparency-and-ai-act.md`](2026-06-19-agent-decision-transparency-and-ai-act.md)
> - `LIFECYCLE-01` → [`2026-06-19-agent-deployment-and-regression-gating.md`](2026-06-19-agent-deployment-and-regression-gating.md)
> - `COCKPIT-01` → [`2026-06-19-agent-operations-ui.md`](2026-06-19-agent-operations-ui.md)
>
> **Audit corrections folded into the rewrites** (things SPEC-00's gap table got wrong as "Adopt/Extend"): `eval-runner` / Inspect AI / `x_om` **does not exist** — the eval harness is net-new and owned by `TRACE-01` (gap #9/#29); `telemetry-and-otel` and `health-monitoring` are **spec-only, not implemented** (gaps #19/#36) — metrics build on this module's own tables + `dashboards`; `audit_logs` writes are **not automatic** (gap #10) — the on-behalf-of guarantee is an enforced no-bypass invariant, not inherited; the `ai-input-moderation` (gap #11) and `ai-agent-attachment-processing` (gaps #14/#31) specs are **drafts/partial**, so `GUARD-01`/`CONTEXT-01` build them; and `workflows` has **no pluggable activity registry** — `INVOKE_AGENT` is a `WAIT_FOR_SIGNAL`+`EXECUTE_FUNCTION` composition first, then an additive core activity-enum change (governed by `BACKWARD_COMPATIBILITY.md`), not a clean registration. The whole feature is a **core module `agent_orchestrator`** in `packages/core/src/modules/`, not a standalone `@open-mercato/agent-orchestrator` package.

---

## 1. Design spine

Deterministic **`workflows`** state machine is the spine. Agents are invoked as `INVOKE_AGENT` activities (steps), never as the controller. **`business_rules`** GUARD/VALIDATION rules on transitions are the disposition gate. Agent runs are dispatched (`SPEC-DISPATCH-01`), traced + evaluated (`SPEC-TRACE-01`), guarded (`SPEC-GUARD-01`), and fed context (`SPEC-CONTEXT-01`). Humans act through `USER_TASK` / "My Tasks", surfaced by the cockpit (`SPEC-COCKPIT-01`). Compliance (`SPEC-COMPLY-01`) and lifecycle/rollout (`SPEC-LIFECYCLE-01`) wrap the whole.

```
                         ┌───────────────── business_rules (GUARD/VALIDATION = "disposes") ──────────────┐
workflows (engine) ──▶ INVOKE_AGENT activity ──▶ DISPATCH ──▶ agent (internal|pull|A2A) ──▶ result
   │  USER_TASK / My Tasks            │                                   │
   │  saga · events · versioning      │  GUARD (prompt-inj/PII/schema)     │  AgentRun/Proposal
   ▼                                  ▼                                   ▼
 COCKPIT UI                       CONTEXT plane                        TRACE + eval + correction → eval set
```

---

## 2. Full gap → OM mapping

| # | Gap (from audit) | OM mechanism | Class | Spec |
|---|---|---|---|---|
| 1 | Orchestration engine | `workflows` | Adopt | ADR-001 |
| 2 | Policy/gate ("disposes") | `business_rules` GUARD/VALIDATION on transitions | Adopt | ADR-001 |
| 3 | Effector / action execution | `workflows` activities + `payment_gateways`/`integrations`/`webhooks` + atomic tx | Adopt | ADR-001 |
| 4 | Compensation / saga | `workflows` (built-in) | Adopt | ADR-001 |
| 5 | Process-record concurrency | OSS optimistic locking | Adopt | — |
| 6 | Agent invocation | — | **Build** | AGENTINT-01 |
| 7 | Proposal + disposition convention | partial (`ai_assistant` mutation-policy) | **Build** | AGENTINT-01 |
| 8 | External/heterogeneous dispatch + A2A | — | **Build** | DISPATCH-01 |
| 9 | Agent trace + eval + correction flywheel | — | **Build** | TRACE-01 |
| 10 | Agent identity, per-action authz & on-behalf-of audit | `auth` (User, nullable password, RBAC) + `audit_logs` (actor/sourceKey/auto-audit) + `api_keys`/JWT; auth.md/OAuth for external | Extend→**Build** | IDENTITY-01 |
| 11 | Runtime AI guardrails (input) | `ai-input-moderation-and-safety-identifiers` spec | Extend | GUARD-01 |
| 12 | Runtime AI guardrails (output / prompt-injection / grounding / schema) | — | **Build** | GUARD-01 |
| 13 | Secrets management | `integrations` credential encryption (fail-closed) + field encryption | Adopt | — |
| 14 | Context / retrieval plane | `query_index` + `search` (vector) + `attachments` + `ai-agent-attachment-processing` | Extend | CONTEXT-01 |
| 15 | Shared process memory | `workflows` context (JSON) | Adopt | — |
| 16 | Data lineage | `attachments` + TRACE spans | Extend | CONTEXT-01 §lineage |
| 17 | Claimant-facing explainability / contest | `portal` / `customer_accounts` (self-service surface) | Extend→**Build** | COMPLY-01 |
| 18 | Bias / fairness monitoring | — | **Build** | COMPLY-01 |
| 19 | AI Act conformity programme | `audit_logs` + `telemetry-and-otel` | Extend→**Build** | COMPLY-01 |
| 20 | GDPR DSAR / erasure / consent | field encryption + `audit_logs` | Extend | COMPLY-01 |
| 21 | Budget / quota enforcement (token/$) | `ai_assistant` loop-override/controls | Extend→**Build** | LIFECYCLE-01 §budget |
| 22 | Model routing / selection | `ai_assistant` per-agent models | Extend | LIFECYCLE-01 |
| 23 | Failure / retry / circuit breakers | `workflows` retries + `queue` + saga | Adopt | — |
| 24 | Escalation engine | `workflows` `USER_TASK` escalation | Adopt | — |
| 25 | Agent deployment (shadow/canary/gradual autonomy) | `feature_toggles` + `ai_assistant` overrides | Extend→**Build** | LIFECYCLE-01 |
| 26 | Process-definition versioning | `workflows` (versioned, immutable) | Adopt | — |
| 27 | Human work assignment / routing | `workflows` `USER_TASK` dynamic assignment + `inbox_ops` | Adopt | COCKPIT-01 (UI) |
| 28 | Notification subsystem | `notifications` (`NotificationDispatcher`) + `communication_channels` | Adopt | — |
| 29 | Pre-prod simulation + CI eval gating | `eval-runner` (SPEC-00..18, coding agents) | Extend→**Build** | LIFECYCLE-01 §gating |
| 30 | Connectors / effectors to external SoR | `integrations`, `webhooks`, `payment_gateways`/`gateway-stripe`, `data_sync`, channels | Adopt | — |
| 31 | Document ingestion / OCR / extraction | `attachments` + `ai-agent-attachment-processing` | Extend | CONTEXT-01 §ingest |
| 32 | Tool / MCP governance | `ai_assistant` (tool allowlists, MCP code-mode, mutation-policy) | Adopt | — |
| 33 | Developer extension model | `create-app`/`cli` scaffold-module + UMES + SPEC-CAPTURE-01 | Adopt | — |
| 34 | Multi-agent coordination (external) | A2A via DISPATCH-01; `workflows` SUB_WORKFLOW/fork-join (internal) | Adopt | DISPATCH-01 |
| 35 | Conflict resolution (agents disagree) | — | **Build** (thin) | AGENTINT-01 §arbitration |
| 36 | Observability / OTel / health | `telemetry-and-otel`, `health-monitoring`, `workflows` monitoring | Adopt | — |
| 37 | Agent-specific metrics / alerting | TRACE metrics | Extend | TRACE-01 §metrics |
| 38 | Agent operations UI (operator/admin/engineer) | extend `workflows` monitor + "My Tasks" + `dashboards` + `perspectives` | Extend→**Build** | COCKPIT-01 |

**Tally:** ~17 Adopt, ~10 Extend, ~8 Build. The hub and most plumbing are done; the net-new work is the agent + compliance layer.

---

## 3. Specs required

> **Packaging:** the whole feature ships as **one OM core module — `@open-mercato/agent-orchestrator`** (one manifest, one DI registration, consolidated migrations). Each Build spec below is an **internal subdomain** (`src/<name>/`) mapping 1:1 to the spec: `orchestration` (AGENTINT), `identity`, `dispatch`, `trace`, `guardrails`, `context`, `compliance`, `lifecycle`, `cockpit`. Shared `contracts/` + `data/` live at the module root. Subdomains can be extracted to their own package later if they need independent reuse (likely `dispatch`, `trace`).

**Written & house-format aligned:** `SPEC-DISPATCH-01` (dispatch + A2A), `SPEC-TRACE-01` (trace + eval + correction) — both in the standard format (TLDR · Problem · What OM provides · UMES extension points · Data models · API contracts · Phases · Acceptance), consistent with the net-new specs below and ready for `.ai/specs/`.

**Net-new (this batch):**
- `SPEC-AGENTINT-01` — Agent step (`INVOKE_AGENT`) + Proposal/disposition convention + agent authz + arbitration. **The keystone.**
- `SPEC-IDENTITY-01` — Agentic-user principal, on-behalf-of audit chain, and standard agent auth (OAuth now / `auth.md` later). Foundational for attribution + authz.
- `SPEC-GUARD-01` — Runtime AI guardrails (output, prompt-injection, PII, grounding, schema).
- `SPEC-CONTEXT-01` — Context & knowledge plane (TDCR assembly + retrieval/grounding + document ingest + lineage).
- `SPEC-COMPLY-01` — Decision transparency (claimant explanation + contest), GDPR rights, bias/fairness, AI Act conformity.
- `SPEC-LIFECYCLE-01` — Agent deployment (shadow/canary/gradual autonomy), budgets/routing, regression gating from the eval set.
- `SPEC-COCKPIT-01` — Operator/Admin/Engineer UI extending the workflow monitor + My Tasks.

**Adopt (no new spec; adoption decisions recorded here):** optimistic locking, secrets/credential encryption, retries/circuit-breakers, escalation, process-def versioning, notifications, connectors/effectors, tool/MCP governance, dev extension model, OTel/health, internal multi-agent (SUB_WORKFLOW/fork-join).

---

## 4. Dependency graph & phases

```
ADR-001 (engine adopted)
   │
   ├─ AGENTINT-01 ──depends──▶ DISPATCH-01, TRACE-01, CONTEXT-01, GUARD-01
   │       │
   │       └─▶ COCKPIT-01 (UI over engine + AGENTINT + TRACE)
   ├─ GUARD-01     (independent; safety floor)
   ├─ CONTEXT-01   (independent; on query_index/search)
   ├─ COMPLY-01    (depends on TRACE-01 for the record; portal for surface)
   └─ LIFECYCLE-01 (depends on TRACE-01 eval set + feature_toggles)
```

| Phase | Specs | Outcome |
|---|---|---|
| **0 — validate** | ADR-001 load test + rule expressiveness check | Engine confirmed for scale |
| **1 — keystone** | AGENTINT-01 (+ DISPATCH-01 internal, TRACE-01 1a/1b) | One claim runs end-to-end: workflow → agent step → proposal → rule disposes → human task |
| **2 — safety & context** | GUARD-01, CONTEXT-01, TRACE-01 evals/corrections | Agents are guarded, grounded, and their corrections become eval cases |
| **3 — external & ops** | DISPATCH-01 A2A, COCKPIT-01 | External/A2A agents + the operator/admin/engineer cockpit |
| **4 — govern & ship** | COMPLY-01, LIFECYCLE-01 | Claimant transparency, AI Act conformity, shadow/canary + regression-gated rollout |

**Critical path to a working insurance pilot:** Phase 0 → AGENTINT-01 → GUARD-01 → COMPLY-01 (the claimant/AI-Act surface can't be retrofitted late in a high-risk domain).
