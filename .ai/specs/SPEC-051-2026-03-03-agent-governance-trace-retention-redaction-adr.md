# SPEC-051: Agent Governance Decision Trace Retention and Redaction ADR

**Date**: 2026-03-03
**Status**: Accepted
**Scope**: Open Source (`.ai/specs/`)
**Related**: `SPEC-050-2026-03-03-agentic-operations-and-governance-module.md`

## TLDR
- Decision traces are immutable and append-only; they are never hard-deleted from canonical lineage.
- Redaction is implemented as policy + superseding records, not destructive rewrite.
- Retention is tiered by risk and operational value so compliance and cost stay balanced.

## Context
`agent_governance` is a system of record for decision lineage. The platform must preserve legal/audit integrity while minimizing sensitive-data exposure in search, retrieval, and operator workflows.

## Decision

### 1) Immutability and correction model
- Canonical `DecisionEvent` rows remain append-only.
- Corrections are represented through `supersedes_event_id`.
- Any redaction action must emit an additional superseding event that references the original event and records redaction rationale.

### 2) Retention tiers
- `critical` / irreversible / approval-gated decisions: retain lineage for `7 years`.
- Standard governed writes: retain lineage for `24 months`.
- Operationally noisy low-risk traces may be compacted after `90 days` into summarized, query-safe evidence links while preserving event headers and hashes.

### 3) Redaction policy
- Avoid storing raw source artifacts in telemetry; store references (`source_refs`) and structured summaries.
- Sensitive payload fragments in `write_set` or contextual evidence must be scrubbed before persistence whenever possible.
- When post-hoc redaction is required, do not mutate original events. Emit a superseding event with sanitized fields and mark downstream retrieval/presentation layers to prefer the sanitized successor.

### 4) Access and retrieval boundaries
- Retrieval APIs and MCP tools remain tenant/org scoped and deny-by-default.
- Search field policy (`excluded`/`hashOnly`) is mandatory for sensitive fields.
- Operator and auditor views should default to least-privilege exposure of rationale data.

## Implementation Mapping
- Immutable chain: `AgentGovernanceDecisionEvent` + `supersedesEventId`.
- Correction command path: `agent_governance.decisions.supersede`.
- Integrity contract: `immutable_hash` verification in telemetry service.
- Retrieval boundary enforcement: precedent/context graph API scope filters and security tests.

## Consequences
- Strong legal defensibility and replayability of governance decisions.
- Redaction becomes operationally explicit and auditable.
- Additional storage footprint is accepted as a tradeoff for compliance and precedent reliability.

## Verification
- Unit/integration tests must validate:
  - append-only supersede behavior,
  - immutable hash integrity checks,
  - scoped retrieval on sanitized decision chains.

## Migration & Backward Compatibility
- Additive-only behavior; no existing API/event IDs are removed.
- Existing consumers continue reading decision events without contract breaks.

## Changelog
### 2026-03-03
- Created ADR for retention tiers, redaction model, and immutable correction strategy.
