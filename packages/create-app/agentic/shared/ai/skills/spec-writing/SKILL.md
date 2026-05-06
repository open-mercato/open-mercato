---
name: spec-writing
description: Guide for creating high-quality specifications for {{PROJECT_NAME}}. Use when starting a new SPEC or reviewing specs against architectural standards.
---

# Spec Writing & Review

Design and review specifications (SPECs) against Open Mercato architecture and quality rules.

## Workflow

1. **Load Context**: Read `AGENTS.md` for module conventions and `.ai/specs/` for existing specs.
2. **Initialize**: Create `{date}-{title}.md` in `.ai/specs/`.
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
6. **Canonical Mechanisms**: Does the spec reach for the framework primitives (`makeCrudRoute`, `<CrudForm>`, `<DataTable>`, `apiCall` / `useGuardedMutation`, DI-resolved cache, `createModuleEvents`) or invent its own substitute? See `AGENTS.md` → **Mandatory Module Mechanisms** for the full canon and links. No raw `fetch`, no raw `<form>`, no `new Redis(...)`, no manual cross-module ORM joins.
7. **Sensitive Data**: For every PII / GDPR / address / contact / free-text-about-people / integration-credential column the spec proposes, does it declare an `encryption.ts` `defaultEncryptionMaps` entry and route reads through `findWithDecryption`? See `AGENTS.md` → "Data Encryption (sensitive / GDPR-relevant fields)" and `.ai/skills/data-model-design/SKILL.md` § Sensitive Data and Encryption Maps. No hand-rolled AES, no `crypto.subtle`, no "TODO encrypt later".
8. **Design System**: Does every UI mock / className snippet in the spec match the DS canon — semantic status tokens (no `text-red-*` / `bg-green-*`), Tailwind text scale (no `text-[11px]` / `text-[13px]`), shared primitives (`StatusBadge`, `Alert`, `FormField`, `SectionHeader`, `CollapsibleSection`, `LoadingMessage` / `Spinner` / `DataLoader`, `EmptyState`), lucide-react icons in page body (never inline `<svg>`), dialog `Cmd/Ctrl+Enter` submit + `Escape` cancel, `aria-label` on every icon-only button? See `AGENTS.md` → "Design System (Strict — applies to every UI change)" and `.ai/skills/backend-ui-design/SKILL.md`. Specs that touch existing pages MUST honour the Boy Scout rule.

## Quick Rule Reference

- **Singular naming** for entities, commands, events, feature IDs.
- **FK IDs only** for cross-module links — no ORM relationships.
- **`organization_id`** is mandatory for all tenant-scoped entities.
- **Undoability** is the default for state changes.
- **Zod validation** for all API inputs.
- **Encryption maps** for every sensitive / GDPR-relevant column (declare in `<module>/encryption.ts`, read via `findWithDecryption`) — see `AGENTS.md` → Data Encryption.
- **Canonical primitives** for CRUD APIs (`makeCrudRoute`), backend forms (`CrudForm`), tables (`DataTable`), HTTP (`apiCall` — never raw `fetch`), non-`CrudForm` writes (`useGuardedMutation`), cache (DI-resolved `@open-mercato/cache`), events (`createModuleEvents`) — see `AGENTS.md` → Mandatory Module Mechanisms.
- **Design System** tokens and shared UI primitives — no hardcoded status colors, no arbitrary text sizes, no inline `<svg>` in page-body UI. See `AGENTS.md` → Design System.

## Reference Materials

- [Spec Template](references/spec-template.md)
- [Spec Checklist](references/spec-checklist.md) — § 3 covers encryption maps; § 5 covers canonical mechanisms + DS
- [AGENTS.md](../../../AGENTS.md) — Mandatory Module Mechanisms, Data Encryption, Design System sections
- [`.ai/skills/data-model-design/SKILL.md`](../data-model-design/SKILL.md) → Sensitive Data and Encryption Maps
- [`.ai/skills/module-scaffold/SKILL.md`](../module-scaffold/SKILL.md) → Encryption maps
- [`.ai/skills/backend-ui-design/SKILL.md`](../backend-ui-design/SKILL.md) — DS-compliant pages
