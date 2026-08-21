# Hardened Agent Orchestrator Profile

> **Status:** Implemented
> **Scope:** Enterprise, `agent_orchestrator`

## TLDR

When the shared AI runtime profile is `hardened`, Agent Orchestrator accepts only native agents, routes every proposal to human review, makes native trace persistence synchronous, and fails the run when required trace or encrypted artifact storage cannot be written.

## Overview

The Enterprise orchestrator is structurally propose-only and uses exact tool allowlists. This profile closes the remaining deployment choices that could weaken human oversight or evidence completeness.

## Problem Statement

OpenCode agents and threshold-based auto-approval were valid standard-mode choices. Native trace capture was intentionally best-effort and could be disabled. Those defaults are unsuitable when every decision needs human review and trace evidence must exist before disposition.

## Proposed Solution

- Reject `runtime: opencode` before dispatch in hardened mode.
- Force the production disposition service to apply `alwaysAsk` regardless of a lower workflow threshold.
- Ignore `OM_AGENT_TRACE_CAPTURE=off` in hardened mode.
- Await trace persistence before a successful run can reach disposition.
- Propagate trace persistence and required artifact encryption/storage errors.

## Architecture

The orchestrator imports the MIT profile resolver. Enforcement lives at the runtime dispatch, disposition, native trace capture, and artifact offload boundaries. Standard mode preserves asynchronous best-effort trace behavior.

## Data Models

No schema change is required. Existing encrypted `AgentRun`, `AgentProposal`, and `AgentToolCall` maps remain authoritative.

## API Contracts

No route, method, response schema, event ID, ACL feature, or DI token changes. A hardened run configured for OpenCode fails with `agent_runtime_profile_restricted` before a session is created.

## Integration Coverage

- Unit tests verify OpenCode rejection, forced human review, trace-disable override, required trace failure propagation, and required artifact encryption.
- Existing native runner, trace ingestion, guardrail, and disposition suites remain the regression base.

## Risks & Impact Review

| Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Required trace storage is unavailable | High | run availability | Fail before disposition | Operator must restore storage/encryption |
| Workflow expected auto-approval | Medium | throughput | Hardened profile deliberately forces review | Review capacity must be planned |
| File-defined agent selected | Medium | agent availability | Reject before external runtime dispatch | Port the agent to native runtime |

## Migration & Backward Compatibility

All checks are gated by the additive shared profile. Standard mode is unchanged. No stable contract is narrowed or removed.

## Final Compliance Report

- Every hardened proposal reaches an authorized human review task.
- Hardened runs cannot use the external OpenCode runtime.
- Native trace persistence completes before disposition and cannot be disabled.
- Large trace artifacts require both storage and tenant encryption.

## Changelog

- **2026-08-21:** Implemented native-only dispatch, mandatory human disposition, synchronous trace persistence, and fail-closed encrypted artifact offload for the hardened profile.
