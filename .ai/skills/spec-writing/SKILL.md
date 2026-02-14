---
name: spec-writing
description: Guide for creating high-quality, architecturally compliant specifications for Open Mercato. Use when starting a new SPEC or reviewing specs against "Martin Fowler" staff-engineer standards.
---

# Spec Writing & Review

Design and review specifications (SPECs) against Open Mercato's architecture, naming, and quality rules. Adopt the **"Martin Fowler"** persona to ensure architectural purity, but remain flexible to innovation.

## Workflow

1.  **Load Context**: Load initial context, take user provided context prompt, and load related files using the Task-Routing table from root `AGENTS.md`.
2.  **Initialize**: Create an empty file with the naming convention `SPEC-{number}-{date}-{title}.md`.
3.  **Start Minimal**: Write a **Skeleton Spec** first (TLDR + 2-3 key sections). Do NOT write the full spec in one pass.
4.  **Iterate**: Iterate with the user to refine the scope and requirements.
5.  **Research**: Challenge requirements against open-source market leaders in the domain.
6.  **Design**: Create the spec design and architecture.
7.  **Implementation Breakdown**: Create implementation details broken down into **Phases** (stories) and **Steps** (testable tasks). Each step should result in a working application.
8.  **Review**: Apply the [Spec Checklist](references/spec-checklist.md).
9.  **Compliance Gate**: Apply the [Final Compliance Review](references/compliance-review.md).
10. **Output**: Finalize the specification file.

## Output Formats

### 1. New Specification (Writing)
When asked to write or draft a specification, use the [Specification Template](references/spec-template.md) as a guide. You may adapt it if the feature requires a different structure, but ensure core architectural concerns are addressed.

**Key Sections to Include:**
- **TLDR & Overview**: Summary and context.
- **Problem Statement**: What are we solving?
- **Proposed Solution**: High-level approach.
- **Phasing**: Breakdown of delivery.
- **Implementation Plan**: Detailed steps.

### 2. Architectural Review (Reviewing)
When asked to review or audit a specification, produce the report using this structure:

```markdown
# Architectural Review: {SPEC-0XX: Title}

## Summary
{1-3 sentences: what the spec proposes and overall architectural health}

## Findings

### Critical
{Violations of core laws: plural naming, cross-module ORM, tenant isolation leaks}

### High
{Missing Phase strategy, lack of undo logic, incorrect package placement}

### Medium
{Missing failure scenarios, inconsistent terminology, spec-bloat}

### Low
{Stylistic suggestions, diagram improvements, nits}

## Checklist

Refer to [Spec Review Checklist](references/spec-checklist.md).

```

## Review Heuristics (The "Martin Fowler" Lens)

1.  **Command Graph vs. Independent Ops**: Should this be a Graph Save (coupled calculation) or a Compound Command (independent steps)?
2.  **The Architectural Diff**: Is the spec wasting space documenting standard CRUD? Cut the noise, focus on the unique.
3.  **Singularity Law**: Does the spec use `pos.carts` (FAIL) or `pos.cart` (PASS)?
4.  **Undo Contract**: How is the state reversed? Is the "Undo" logic as detailed as the "Execute"?
5.  **Module Isolation**: Are we using Event Bus for side effects or cheating with direct imports?

## Quick Rule Reference

- **Singular naming** for everything (entities, commands, events, feature IDs).
- **FK IDs only** for cross-module links.
- **Organization ID** is mandatory for all scoped entities.
- **Undoability** is the default for state changes.
- **Zod validation** for all API inputs.

## Reference Materials

- [Spec Review Checklist](references/spec-checklist.md)
- [Final Compliance Review](references/compliance-review.md)
- [Specification Template](references/spec-template.md)
- [Root AGENTS.md](../../../AGENTS.md)
