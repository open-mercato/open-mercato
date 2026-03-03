# ANALYSIS-050: Agent Governance V2 Planning Gate

**Date**: 2026-03-03
**Input Spec**: `SPEC-050-2026-03-03-agentic-operations-and-governance-module.md`
**Purpose**: Apply pre-planning consultant -> ruthless plan reviewer -> architect sequence before implementation task generation.

---

## 1) Pre-Planning Consultant Output

### Intent Classification

**Intent Classification**: Architecture - The request defines a strategic, multi-module foundation requiring long-term tradeoff decisions, contract surfaces, and phased delivery.

### Pre-Analysis Findings

1. The critical product boundary is now explicit and correct: Open Mercato owns policy/execution/memory; runtime providers are adapters.
2. The hardest failure mode is not model quality but missing decision lineage at commit time; V2 correctly elevates this to a contract.
3. Retrieval architecture must be external-object based to avoid context/tool bloat and maintain deterministic governance controls.

### Hidden Requirements Surfaced

- Data retention policy for decision traces and redaction mechanics (for legal/privacy constraints).
- Canonical signature strategy for precedent indexing to prevent noisy duplicate precedents.
- Clear handling for provider outages in high-risk paths (graceful fail vs fail closed by risk class).

### Ambiguities Resolved

- Whether decision telemetry is optional: resolved to mandatory envelope for governed writes.
- Whether trace immutability is negotiable: resolved to append-only with superseding records.
- Whether external graph systems become source of truth: resolved to adapter-only, not canonical.

### Dependencies

- `@open-mercato/ai-assistant` MCP tool registration pattern.
- `@open-mercato/scheduler` + `@open-mercato/queue` for scheduled execution.
- `@open-mercato/search` constraints for retrieval indexing hygiene.
- Backward compatibility contract for APIs/events/tool names.

### Identified Risks

- Approval fatigue in medium-risk workflows.
- Precedent poisoning from low-quality traces.
- Tenant leakage in graph traversal.
- Runtime lock-in if adapter boundary erodes.

### Recommendation

**Proceed** with implementation planning for Phase 0-2 (governance + trace + retrieval core). Defer Phase 3+ capabilities until baseline memory quality metrics are stable.

---

## 2) Ruthless Plan Review Output

[APPROVE]

**Justification**: The plan is now implementable from the spec alone with explicit contract surfaces, measurable phase gates, and direct references to existing framework patterns.

### Summary

- **Clarity**: Pass — each major area maps to concrete APIs/entities/commands and backlog stories.
- **Verifiability**: Pass — phase gates and acceptance criteria are measurable.
- **Completeness**: Pass with minor follow-up — trace retention/redaction policy should be finalized before production rollout.
- **Big Picture**: Pass — strategic objective, architecture boundaries, and phased workflow are coherent.

### Top Critical Improvements Applied / Required

1. Applied: mandatory telemetry envelope and high-risk blocking semantics.
2. Applied: anti-Frankenstein scope boundaries and ownership model.
3. Applied: execution-ready backlog for Phase 0-2 with dependencies.
4. Follow-up required: explicit retention/redaction ADR before GA.
5. Follow-up required: benchmark protocol for native retrieval vs adapter retrieval.

---

## 3) Architect Advisory Output

### Bottom Line

Build the smallest coherent system that can both act and remember why it acted: Phase 0-2 should ship policy-governed execution with immutable decision telemetry and precedent retrieval. Use Claude Agent SDK as a preferred harness adapter, but keep the adapter seam strict to avoid lock-in and preserve architectural control.

### Action Plan

1. Lock and test the decision telemetry envelope contract.
2. Implement run orchestration and checkpoint controls with risk-based blocking semantics.
3. Persist append-only decision events and project graph links from those events.
4. Expose retrieval/explanation APIs and MCP tools against tenant-scoped graph memory.
5. Verify operational quality via completeness, intervention, and precedent usefulness metrics.

### Effort Estimate

**Medium** for Phase 0-2 planning-to-ready engineering handoff (implementation remains multi-sprint).

### Risks

- **Edge-case overload**: Mitigate with risk-band defaults and strict out-of-scope controls.
- **Operational drift**: Mitigate with phase gates and DoD enforcement.
- **Provider coupling**: Mitigate via adapter conformance tests.

