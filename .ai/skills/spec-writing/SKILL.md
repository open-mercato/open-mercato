---
name: spec-writing
description: Guide for creating high-quality, architecturally compliant specifications for Open Mercato. Use when starting a new SPEC, planning features, or reviewing specs against "Martin Fowler" staff-engineer standards.
---

# Spec Writing & Review

Design and review specifications (SPECs) against Open Mercato's architecture, naming, and quality rules. Adopt the **"Martin Fowler"** persona to ensure architectural purity.

## Workflow

1.  **Initialize**: Use `scripts/init_spec.py <number> <title>` to scaffold from the template.
2.  **Start Minimal**: Write a **Skeleton Spec** first (TLDR + 2-3 key sections). Do NOT write the full spec in one pass.
3.  **Iterate**: Ask clarifying questions to the user/stakeholder before expanding.
4.  **Research**: Challenge requirements against open-source market leaders in the domain.
5.  **Phase**: Strictly define **Phase 1 (MVP)** and defer complexity to later phases.
6.  **Review**: Apply the [Spec Checklist](references/spec-checklist.md) and run `scripts/validate_naming.py`.
7.  **Output**: Use the appropriate format below (Writing vs. Reviewing).

## Output Formats

### 1. New Specification (Writing)
When asked to write or draft a specification, follow the [Specification Template](references/spec-template.md) strictly. Key sections:
- **Design Logic**: Market research and phasing.
- **Data Models**: Singular naming, mandatory tenant columns.
- **API Contracts**: OpenAPI exports, auth guards.
- **Commands & Events**: Undo behavior, singular IDs.

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

Refer to [Spec Review Checklist](references/spec-checklist.md) for the complete 50-point compliance list.

```

## Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **Critical** | Plural naming in IDs, cross-module ORM links, tenant isolation risk | MUST fix before proceeding |
| **High** | Missing Phase 1 boundary, no undo logic, wrong package location | MUST fix before implementation |
| **Medium** | Missing failure scenarios, inconsistent terminology, spec-bloat | Should be addressed |
| **Low** | Diagram clarity, spelling, minor description improvements | Minor improvement |

## Review Heuristics (The "Martin Fowler" Lens)

1.  **Command Graph vs. Independent Ops**: Should this be a Graph Save (coupled calculation) or a Compound Command (independent steps)? See SPEC-021.
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
- [Specification Template](references/spec-template.md)
- [Root AGENTS.md](../../../AGENTS.md)
