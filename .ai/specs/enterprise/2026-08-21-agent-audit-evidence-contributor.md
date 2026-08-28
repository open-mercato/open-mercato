# Agent Audit Evidence Contributor

> **Status:** Implemented
> **Scope:** Enterprise, `agent_orchestrator`

## TLDR

Agent Orchestrator will register an optional contributor for the MIT Core signed audit evidence export. It adds scoped agent runs, proposals, spans, tool calls and guardrail checks, all correlated by agent run ID.

## Overview

Enterprise already stores detailed AI execution and decision traces. This change exposes those records through the generic Core evidence contributor contract while keeping package direction one-way: Enterprise imports the Core type and Core only resolves an optional DI token.

## Problem Statement

Action and access logs alone do not show which model run, proposal, tool call or guardrail verdict produced an AI-assisted action. The trace inspector can show those records interactively, but there is no unified offline evidence package.

## Proposed Solution

- Implement `AgentAuditEvidenceContributor`.
- Collect `AgentRun`, `AgentProposal`, `AgentSpan`, `AgentToolCall` and `AgentGuardrailCheck` records.
- Apply the exact tenant, organization, time and per-source limit supplied by Core.
- Read encrypted run, proposal and tool payloads with the standard decryption helper.
- Use the run ID as `correlationId` for every contributed record.
- Register the contributor under the optional `agentAuditEvidenceContributor` DI token.

## Architecture

```text
MIT Core evidence service
  -> optional DI resolution
  -> AgentAuditEvidenceContributor
  -> scoped Agent Orchestrator entities
  -> normalized records
  -> Core sorting, HMAC chain and signature
```

## Data Models

No schema change is required. The contributor reads existing trace entities and does not write or mutate evidence.

## API Contracts

The module implements the Core `AuditEvidenceContributor` interface. It adds the `agent-orchestrator` source to exported bundles when the module is enabled. No HTTP route, event ID, ACL feature or database contract changes.

## Integration Coverage

- Unit tests verify strict scope filters, included trace types and run-ID correlation.
- Core integrity tests verify that Enterprise records receive the same ordering and signature protection as Core records.
- Existing trace, proposal, tool and guardrail suites remain the source-record regression base.

## Risks & Impact Review

| Failure scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| Trace query crosses organization scope | Critical | Tenant isolation | Add tenant and organization to every entity query | Privileged operator selects the requested scope |
| Large trace history exhausts memory | Medium | CLI availability | Bound every entity query with a validated per-source limit | Very large limits still require operator planning |
| Decryption fails | High | Evidence completeness | Propagate the error and do not write a partial successful bundle | Operator must restore encryption service access |
| Trace data contains sensitive business content | High | Export confidentiality | Core writes mode 0600 and documents secure storage | Destination handling remains operator responsibility |

## Migration & Backward Compatibility

The DI registration and contributor class are additive. The export is absent when Enterprise is disabled. Existing trace reads, writes and UI behavior are unchanged.

## Final Compliance Report

- Enterprise remains optional.
- Core contains no Enterprise entity or import.
- Every AI evidence record has one run-based correlation identifier.
- Existing encryption and tenant-scoping helpers are reused.

## Changelog

- **2026-08-21:** Defined the optional Agent Orchestrator contributor for signed audit evidence bundles.
- **2026-08-21:** Implemented the scoped contributor, run-ID correlation, DI registration and tests for all five trace record types.
