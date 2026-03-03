# Agent Governance V2 Architecture

## Purpose
`agent_governance` is the decision-control and decision-memory module for AI-assisted operations in Open Mercato.

It combines:
- governed execution (policies, risk bands, approvals, run controls),
- immutable decision telemetry,
- context graph retrieval for precedent-aware reasoning,
- tacit-knowledge skill lifecycle.

## System boundaries
- Canonical source of truth: Open Mercato `agent_governance` data model.
- Runtime/harness: provider adapters (`opencode`, `claude_agent_sdk`, future providers).
- Domain state ownership: existing business modules (customers, sales, catalog, etc.).

## Core components
- `run-orchestrator-service`: risk-aware run lifecycle and checkpoint logic.
- `telemetry-service`: decision envelope persistence, immutable hash, fail-closed/fail-soft durability.
- `decision-projector-service`: projection into `DecisionEntityLink`, `DecisionWhyLink`, `PrecedentIndex`.
- `retrieval-planner-service`: prompt-as-external-object context slicing and budget controls.
- `skill-lifecycle-service`: capture/validate/promote skills from traces.
- `observability-service`: governance/memory/operations/learning metrics and alert routing.
- `harness-adapter-service`: provider registry + capability/fallback behavior.

## Decision telemetry envelope
Minimum required data for governed writes:
- intent: action type + target entity/id,
- evidence refs: source links,
- policy/risk references,
- control path (`auto|checkpoint|override|rejected`),
- approvals/exceptions,
- commit outcome (`writeSet`, status/error),
- provenance (`runId`, provider, timestamps).

## Interference and control model
- run states: `queued|running|checkpoint|paused|failed|completed|terminated`.
- operator controls: pause/resume/terminate/reroute.
- stale-state guard: optional `expectedStatus` prevents nondeterministic concurrent actions.

## Scheduler and automation model
- scheduled playbooks register queue jobs (`agent-governance-dispatch`).
- dispatch worker starts governed runs with idempotency keys.
- repair/projection workers are idempotent and emit anomalies for human intervention.

## Observability and anti-fatigue
- metrics groups: governance, memory, operations, learning.
- includes skill outcome delta (`with skills` vs `without skills`) and alert routing recommendations.
- checkpoint throttling + severity routing reduce operator overload while preserving high-risk controls.
