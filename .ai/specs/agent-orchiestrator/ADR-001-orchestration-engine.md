# ADR-001: Adopt OM `workflows` + `business_rules` as the Agent Orchestration Engine

> **Status:** Proposed
> **Owner:** Patryk Lewczuk (Comerito)
> **Date:** 2026-06-16
> **Supersedes:** the proposed (never built) `SPEC-ENGINE-01`

> **Note (2026-06-19):** the nine sub-specs referenced by their short codes below were rewritten to OM conventions and corrected against a codebase audit; see the **Spec file map** in [`SPEC-00-agent-orchestration-program.md`](SPEC-00-agent-orchestration-program.md) for current filenames, and [`2026-06-19-agent-orchestrator-conventions.md`](2026-06-19-agent-orchestrator-conventions.md) (normative). Key correction to this ADR: `workflows` has **no pluggable activity registry** — the `INVOKE_AGENT` integration ships first as a `WAIT_FOR_SIGNAL`+`EXECUTE_FUNCTION` composition (zero core change), then as an **additive change to the core `workflows` activity-type enum** (a contract surface under `BACKWARD_COMPATIBILITY.md`). "Adopt as-is" for `workflows`/`business_rules` still holds; the agent-step bridge is Extend-core, not pure Adopt.

---

## Context

The agent orchestration layer needs a "hub": a process state machine that sequences steps, gates decisions ("OM disposes"), executes side effects, handles long-running waits and human tasks, and produces an audit trail. An investigation of the Open Mercato codebase (core `workflows` and `business_rules` modules, plus `ai_assistant`, `notifications`, `audit_logs`, `feature_toggles`, `query_index`, `attachments`) shows the hub — and most surrounding mechanisms — already exist.

`workflows` is a BPM-grade state machine: versioned immutable definitions, instances with JSON context + correlation key, an executor, **event sourcing**, **compensation/saga**, async queue activities, `USER_TASK` with role/dynamic assignment + form schema + SLA + escalation, `WAIT_FOR_SIGNAL`, `SUB_WORKFLOW`, parallel fork-join, custom activity/step-handler extension points, a visual editor and a monitoring dashboard.

`business_rules` is a rule engine with five rule types (GUARD, VALIDATION, CALCULATION, ACTION, ASSIGNMENT), priorities, an execution log, and **GUARD rules that hook workflow `pre_transition` events** — i.e. transition gating is already wired (`order-approval-guard-rules.json`).

## Decision

1. **Adopt `workflows` as the orchestration engine.** Model business processes (e.g. claims) as workflow definitions. Do not build a new engine.
2. **Adopt `business_rules` as the disposition/gate engine** for "LLM proposes, OM disposes": VALIDATION rules trigger approval `USER_TASK`s; GUARD rules on `pre_transition` enforce policy before side effects fire.
3. **Invoke agents as a custom activity.** Agents are *steps*, not the orchestrator — which is exactly "LLM proposes, OM disposes" (the deterministic workflow controls flow). A new `INVOKE_AGENT` activity bridges to the agent layer (see `SPEC-AGENTINT-01`).
4. **The agent layer is a focused set of extensions** on top of the engine: dispatch (`SPEC-DISPATCH-01`), trace/eval (`SPEC-TRACE-01`), guardrails, context, compliance, lifecycle, and a cockpit UI extending the workflow monitor + "My Tasks". All of it ships as **one OM core module — `@open-mercato/agent-orchestrator`** — with the specs as internal subdomains (`orchestration`, `identity`, `dispatch`, `trace`, `guardrails`, `context`, `compliance`, `lifecycle`, `cockpit`), not nine packages. See `SPEC-00` for the full program.

## Capability mapping (our design → OM)

| Need | OM mechanism | Disposition |
|---|---|---|
| Process state machine | `workflows` executor, definitions, instances | **Adopt** |
| Disposition/gate ("disposes") | `business_rules` GUARD/VALIDATION on transitions | **Adopt** |
| Human-in-the-loop / caseload | `workflows` `USER_TASK` + "My Tasks" + assignment/SLA/escalation | **Adopt** (UI extend) |
| Effector / action execution | `workflows` activities + `payment_gateways`/`integrations`/`webhooks` + atomic tx | **Adopt** |
| Compensation / rollback | `workflows` saga | **Adopt** |
| Process-record concurrency | OSS optimistic locking | **Adopt** |
| Agent invocation | — | **Build** (`INVOKE_AGENT`) |
| Proposal + disposition convention | partial (`ai_assistant` mutation-policy) | **Build/Extend** |
| External/heterogeneous dispatch + A2A | — | **Build** (`SPEC-DISPATCH-01`) |
| Agent trace + eval + correction flywheel | — | **Build** (`SPEC-TRACE-01`) |

## The `INVOKE_AGENT` integration (summary)

A custom async activity (per `workflows/extending`): the workflow reaches an `INVOKE_AGENT` step → the activity creates an `AgentTask` (`SPEC-DISPATCH-01`) and returns `QUEUED` → the workflow parks (like `WAIT_FOR_SIGNAL`) → the agent runs (internal/pull/A2A), result captured as an `AgentRun`/`Proposal` (`SPEC-TRACE-01`) → a signal resumes the workflow with the proposal in context → a `business_rules` GUARD/VALIDATION rule disposes it (auto-approve, or raise a `USER_TASK`). Trace/eval/correction wrap the run; nothing about flow control lives in the LLM.

## Consequences

- **Positive:** roughly halves the build; inherits audit/saga/versioning/assignment/escalation for free; the engine *enforces* "OM disposes"; standard, reviewed, multi-tenant code.
- **To validate:** (a) workflow event-sourcing throughput at thousands of processes/week × millions of events — load-test before pilot; (b) `business_rules` condition trees can express composite gates (`confidence ≥ x AND fraud < y AND payout ≤ z`); (c) OSS vs Enterprise edition coverage for the workflow features used.
- **Constraint:** agent steps must be modelled as activities; processes that need agent-driven dynamic control flow are out of pattern (and intentionally so).
