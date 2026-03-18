---
name: spec-writing
description: Guide for creating high-quality specifications for {{PROJECT_NAME}}. Use when starting a new SPEC or reviewing specs against architectural standards.
---

# Spec Writing & Review

Design and review specifications (SPECs) against Open Mercato architecture and quality rules.

## Workflow

1. **Load Context**: Read `AGENTS.md` for module conventions and `.ai/specs/` for existing specs.
2. **Initialize**: Create `SPEC-{number}-{date}-{title}.md` in `.ai/specs/`.
3. **Start Minimal**: Write a Skeleton Spec (TLDR + 2-3 key sections). Do NOT write the full spec in one pass.
   - Scan for **critical unknowns** — decisions that block data model, scope, or architecture.
   - If unknowns exist, add a numbered **Open Questions** block (`Q1`, `Q2`, …) after the TLDR.
   - **STOP after presenting the skeleton.** Do not proceed until the user answers all questions.
4. **Iterate**: Apply answers, remove Open Questions block. Repeat if new unknowns surface.
5. **Research**: Challenge requirements against open-source market leaders.
6. **Design**: Create architecture, data models, API contracts.
7. **Implementation Breakdown**: Break into **Phases** (stories) and **Steps** (testable tasks).
8. **Review**: Apply the [Spec Checklist](references/spec-checklist.md).
9. **Output**: Finalize the specification file.

## Output Formats

### 1. New Specification

Use the [Specification Template](references/spec-template.md). Adapt if needed, but ensure core concerns are addressed.

**Required sections**: TLDR, Problem Statement, Proposed Solution, Data Models, API Contracts, Risks, Changelog.

### 2. Architectural Review

```markdown
# Architectural Review: {SPEC-0XX: Title}

## Summary
{1-3 sentences: what the spec proposes and overall health}

## Findings

### Critical
{Cross-module ORM, tenant isolation leaks, missing auth guards}

### High
{Missing undo logic, incorrect module placement, missing phase strategy}

### Medium
{Missing failure scenarios, inconsistent terminology}

### Low
{Style suggestions, nits}
```

## Review Heuristics

1. **Command Graph vs. Independent Ops**: Graph Save (coupled calculation) or Compound Command (independent steps)?
2. **Architectural Diff**: Cut standard CRUD noise. Focus on what's unique.
3. **Singularity Law**: Singular naming for entities, commands, events, feature IDs.
4. **Undo Contract**: Is the "Undo" logic as detailed as the "Execute"?
5. **Module Isolation**: Using Event Bus for side effects or cheating with direct imports?

## Quick Rule Reference

- **Singular naming** for entities, commands, events, feature IDs.
- **FK IDs only** for cross-module links — no ORM relationships.
- **`organization_id`** is mandatory for all tenant-scoped entities.
- **Undoability** is the default for state changes.
- **Zod validation** for all API inputs.

## Reference Materials

- [Spec Template](references/spec-template.md)
- [Spec Checklist](references/spec-checklist.md)
- [AGENTS.md](../../../AGENTS.md)
