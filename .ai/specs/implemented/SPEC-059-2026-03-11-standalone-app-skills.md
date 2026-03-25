# SPEC-059 — AI Skills for Standalone Apps

**Date**: 2026-03-11
**Status**: Implemented
**Depends on**: [SPEC-058](SPEC-058-2026-03-10-agentic-tool-setup-standalone-app.md) (agentic tool setup infrastructure)

---

## TLDR

- Adapt three monorepo AI skills — **spec-writing**, **backend-ui-design**, and **code-review** — for standalone Open Mercato app developers.
- Ship them as part of the existing `packages/create-app/agentic/shared/` directory so they're generated into every standalone app that runs the agentic wizard.
- Each skill is a **purpose-built adaptation** — not a copy of the monorepo skill. Monorepo-specific concerns (multi-package builds, backward compatibility contracts, template sync, i18n across 4 locales, enterprise specs) are stripped. App-level concerns are kept and simplified.

---

## Problem Statement

### Standalone app developers lack structured AI workflows

SPEC-058 shipped AGENTS.md, entity-migration hooks, and tool configs to standalone apps. But the monorepo has **10 specialized skills** that guide AI agents through complex workflows (spec writing, code review, UI design). Standalone app developers get none of this — their AI tools operate without structured review processes, spec templates, or UI pattern enforcement.

### The monorepo skills don't fit standalone apps

The existing skills contain monorepo assumptions throughout:

| Monorepo concept | Standalone equivalent |
|---|---|
| 14+ packages with `yarn build:packages` | Single app with `yarn build` |
| `BACKWARD_COMPATIBILITY.md` with 13 contract surfaces | No published packages, no contract surfaces |
| `yarn template:sync` between `apps/mercato/` and `packages/create-app/template/` | N/A |
| `yarn i18n:check-sync` across 4 locales (en, de, es, pl) | App-defined locales (unknown count) |
| `packages/core/AGENTS.md`, `packages/ui/AGENTS.md`, etc. | Single `AGENTS.md` at app root |
| `.ai/specs/enterprise/` dual directory | Single `.ai/specs/` |
| 100+ item review checklist with package-scoped rules | Simplified checklist scoped to app-level patterns |
| Task Router referencing 30+ package/module guides | Flat task-context map in AGENTS.md |

Copying the monorepo skills would produce confusion (wrong paths, irrelevant checks, failed references) and context window waste.

### Three skills deliver the highest value for standalone developers

Based on analysis of all 10 monorepo skills:

1. **spec-writing** — Universal value. Designing inventory modules, order flows, or integrations benefits from phased specs with risk assessment.
2. **backend-ui-design** — Zero-adaptation component library. Standalone apps use the exact same `@open-mercato/ui` package via npm.
3. **code-review** — Catches the same bug classes (missing migrations, broken tenant isolation, raw fetch, custom forms) with a simplified CI/CD gate.

The remaining 7 skills are either monorepo-internal (create-agents-md, dev-container-maintenance, fix-specs, pre-implement-spec), require heavy adaptation with marginal value for standalone context (implement-spec, integration-tests), or already domain-agnostic (skill-creator — useful but not framework-specific).

---

## Proposed Solution

### Add skills to the shared agentic content

Add a `.ai/skills/` directory to the shared generator output. Three skills, each with a `SKILL.md` and optional `references/` subdirectory:

```
packages/create-app/agentic/shared/ai/skills/
├── spec-writing/
│   ├── SKILL.md
│   └── references/
│       ├── spec-template.md
│       └── spec-checklist.md
├── backend-ui-design/
│   ├── SKILL.md
│   └── references/
│       └── ui-components.md
└── code-review/
    ├── SKILL.md
    └── references/
        └── review-checklist.md
```

The `generateShared()` function in `packages/create-app/src/setup/tools/shared.ts` copies these alongside the existing `.ai/specs/` and `.ai/lessons.md`.

### Design decisions

| Decision | Rationale |
|----------|-----------|
| Ship in `shared/` (not per-tool) | Skills are tool-agnostic — they guide agent behavior regardless of Claude Code, Codex, or Cursor |
| Strip compliance review gate | Standalone apps have a single AGENTS.md — the monorepo's multi-file compliance matrix is overhead |
| Strip backward compatibility | Standalone app developers consume packages, they don't publish them. No contract surfaces to protect |
| Keep spec template sections | Data Models, API Contracts, Risks are universally valuable even for app-level features |
| Keep full UI component reference | `@open-mercato/ui` is identical in standalone — same imports, same API |
| Simplify CI/CD gate to 4 steps | `yarn generate` → `yarn typecheck` → `yarn test` → `yarn build` covers standalone apps |
| Use `{{PROJECT_NAME}}` placeholder | Consistent with existing AGENTS.md template |

---

## Source Content — Detailed Design

### Skill 1: spec-writing

**Adapted from**: `.ai/skills/spec-writing/`

**What's kept**:
- Skeleton-first workflow with Open Questions gate
- Spec template with TLDR, Problem, Solution, Data Models, API Contracts, Risks, Changelog
- Review checklist (simplified)
- Martin Fowler review heuristics (command graph, architectural diff, undo contract, module isolation)
- Quick rule reference (singular naming, FK IDs, organization_id, zod validation)

**What's removed**:
- Final Compliance Review gate (references multiple AGENTS.md files — standalone has only one)
- Enterprise spec directory references (`SPEC-ENT-*`, `.ai/specs/enterprise/`)
- Task Router cross-references (standalone has flat context map)
- Compliance Matrix output format
- `BACKWARD_COMPATIBILITY.md` references

**What's simplified**:
- Spec checklist reduced from 7 sections / 40+ items to 6 sections / ~25 items
- Architecture section simplified: no multi-package placement rules
- Cache section simplified: no multi-strategy decision tree

#### `SKILL.md`

```markdown
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
```

#### `references/spec-template.md`

```markdown
# SPEC-{number} — {Title}

**Date**: {YYYY-MM-DD}
**Status**: Draft

## TLDR

**Key Points:**
- [What is being built — 1-2 sentences]
- [Primary goal / value proposition]

**Scope:**
- [Feature 1]
- [Feature 2]

## Open Questions *(remove before finalizing)*

- **Q1**: [Critical unknown — e.g. "Should this store data per-tenant or globally?"]
- **Q2**: [Critical unknown — e.g. "Does this replace X or coexist with it?"]

---

## Overview

[What this feature does and why. Target audience and key benefits.]

> **Market Reference**: [Name the open-source leader you studied. What did you adopt vs. reject?]

## Problem Statement

[Specific pain points or gaps this solves.]

## Proposed Solution

[High-level technical approach.]

### Design Decisions (Optional)

| Decision | Rationale |
|----------|-----------|
| [Choice] | [Why this over alternatives] |

## User Stories

- **[User]** wants to **[Action]** so that **[Benefit]**

## Data Models

### [Entity Name] (Singular)

- `id`: string (UUID)
- `organization_id`: string (FK)
- `created_at`: Date
- `updated_at`: Date
- ...

## API Contracts

### [Endpoint Name]

- `METHOD /api/path`
- Request: `{...}`
- Response: `{...}`

## Implementation Plan

### Phase 1: [Name]

1. [Step — testable]
2. [Step — testable]

### Phase 2: [Name]

1. [Step]

## Risks

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| [What goes wrong] | High/Med/Low | [How addressed] | [What remains] |

## Changelog

| Date | Change |
|------|--------|
| {date} | Initial spec |
```

#### `references/spec-checklist.md`

```markdown
# Spec Review Checklist

Every item must be answered in the spec or marked N/A with justification.

## 1. Design Logic & Phasing

- [ ] TLDR defines scope, value, and clear boundaries
- [ ] MVP is explicit; future work is deferred and labeled
- [ ] User stories map to API/data/UI sections
- [ ] Phase plan is testable and incrementally deliverable

## 2. Architecture & Module Isolation

- [ ] Cross-module links use FK IDs only (no direct ORM relations)
- [ ] Tenant isolation and `organization_id` scoping are explicit
- [ ] Module placement is in `src/modules/<id>/`
- [ ] DI usage is specified (Awilix)
- [ ] Event/subscriber boundaries are clear and non-circular

## 3. Data Integrity & Security

- [ ] Entities include `id`, `organization_id`, `created_at`, `updated_at`
- [ ] Write operations define transaction boundaries
- [ ] Input validation uses zod schemas
- [ ] All user input validated before business logic/persistence
- [ ] Auth guards are declared (`requireAuth`, `requireRoles`, `requireFeatures`)
- [ ] Tenant isolation: every scoped query filters by `organization_id`

## 4. Commands, Events & Naming

- [ ] Naming is singular and consistent
- [ ] All mutations are commands with undo logic
- [ ] Events declared in `events.ts` before emitting
- [ ] Side-effect reversibility is documented

## 5. API & UI

- [ ] API contracts are complete (request/response/errors)
- [ ] Routes include `openApi` expectations
- [ ] UI uses `CrudForm`, `DataTable`, and shared primitives
- [ ] i18n keys are planned for user-facing strings
- [ ] Pagination limits defined (`pageSize <= 100`)

## 6. Risks & Anti-Patterns

- [ ] Risks include concrete scenarios with severity and mitigation
- [ ] Blast radius and detection described
- [ ] Does not introduce cross-module ORM links
- [ ] Does not skip undoability for state changes
- [ ] Does not mix MVP with speculative future phases
```

---

### Skill 2: backend-ui-design

**Adapted from**: `.ai/skills/backend-ui-design/`

**What's kept**: Everything — the `@open-mercato/ui` package is identical in standalone apps. Same imports, same components, same patterns.

**What's removed**:
- References to SPEC-001 and SPEC-016 (monorepo-internal specs)
- "When to Create New Components" section suggesting additions to `@open-mercato/ui` (standalone devs can't modify the package)

**What's added**:
- Note about ejecting modules for deeper customization

#### `SKILL.md`

```markdown
---
name: backend-ui-design
description: Design and implement consistent backend/backoffice interfaces using @open-mercato/ui. Use when building admin pages, CRUD interfaces, data tables, forms, detail pages, or any backoffice UI.
---

# Backend UI Design

Guide for creating consistent, production-grade backend interfaces using the `@open-mercato/ui` component library. All implementations must use existing components for visual and behavioral consistency.

For complete component API reference, see `references/ui-components.md`.

## Design Principles

1. **Consistency First**: Every page should feel like part of the same application.
2. **Component Reuse**: Never create custom implementations when a shared component exists.
3. **Data Density**: Admin users need information-rich interfaces. Optimize for scanning.
4. **Keyboard Navigation**: `Cmd/Ctrl+Enter` for primary actions, `Escape` to cancel.
5. **Clear Hierarchy**: Page → Section → Content. Use `PageHeader`, `PageBody`, consistent spacing.

## Required Component Library

ALWAYS import from `@open-mercato/ui`.

### Core Layout

```tsx
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'

<Page>
  <PageHeader>{/* Title, actions, breadcrumbs */}</PageHeader>
  <PageBody>{/* Main content */}</PageBody>
</Page>
```

### Data Display (Lists)

Use `DataTable` for ALL tabular data. Never implement custom tables.

```tsx
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef } from '@open-mercato/ui/backend/FilterBar'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { TruncatedCell } from '@open-mercato/ui/backend/TruncatedCell'
import { BooleanIcon, EnumBadge } from '@open-mercato/ui/backend/ValueIcons'
```

Column patterns:
- Text: `TruncatedCell` with `meta.maxWidth`
- Boolean: `BooleanIcon`
- Status/enum: `EnumBadge` with severity presets
- Actions: `RowActions` for context menus

### Forms

Use `CrudForm` for ALL forms. Never build from scratch.

```tsx
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
```

Field types: `text`, `textarea`, `number`, `email`, `password`, `select`, `multiselect`, `combobox`, `checkbox`, `switch`, `date`, `datetime`, `custom`.

### Form Headers & Footers

```tsx
import { FormHeader, FormFooter, FormActionButtons, ActionsDropdown } from '@open-mercato/ui/backend/forms'
```

- **`FormHeader mode="edit"`** — compact header for CrudForm pages
- **`FormHeader mode="detail"`** — large header for view/detail pages with entity type label, title, status badge, and Actions dropdown
- **`FormFooter`** — footer wrapping `FormActionButtons`
- **`ActionsDropdown`** — groups additional context actions (Convert, Send, Print). Delete is never inside the dropdown.

### Dialogs

```tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'

// Dialog forms MUST use embedded={true}
<CrudForm fields={fields} onSubmit={handleSubmit} embedded={true} submitLabel="Save" />
```

### Detail Pages

```tsx
import { DetailFieldsSection, LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { NotesSection } from '@open-mercato/ui/backend/detail/NotesSection'
import { TagsSection } from '@open-mercato/ui/backend/detail/TagsSection'
import { CustomDataSection } from '@open-mercato/ui/backend/detail/CustomDataSection'
```

### Notifications

```tsx
import { flash } from '@open-mercato/ui/backend/FlashMessages'

flash('Record saved successfully', 'success')
flash('Failed to save record', 'error')
flash('This action cannot be undone', 'warning')
```

NEVER use `alert()`, `console.log()`, or custom toast implementations.

### Loading & Error States

```tsx
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { ErrorNotice } from '@open-mercato/ui/primitives/ErrorNotice'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
```

### Primitives

```tsx
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
```

## API Integration

```tsx
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'

const handleCreate = async (values: FormValues) => {
  const result = await createCrud<ResponseType>('module/resource', values)
  if (result.ok) {
    flash('Created successfully', 'success')
    router.push(`/backend/module/${result.result.id}`)
  }
  return result
}
```

## Custom Fields Integration

```tsx
import { useCustomFieldDefinitions } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { buildCustomFieldFormFields } from '@open-mercato/ui/backend/utils/customFieldForms'
import { buildCustomFieldColumns } from '@open-mercato/ui/backend/utils/customFieldColumns'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
```

## Implementation Checklist

- [ ] Forms use `CrudForm` (not custom)
- [ ] Tables use `DataTable` (not custom)
- [ ] Notifications use `flash()` (not alert/toast)
- [ ] Dialog forms have `embedded={true}`
- [ ] Keyboard: `Cmd/Ctrl+Enter` (submit), `Escape` (cancel)
- [ ] Loading states use `LoadingMessage` or `DataLoader`
- [ ] Error states use `ErrorMessage`, `ErrorNotice`, or `Notice variant="error"`
- [ ] Empty states use `EmptyState`
- [ ] Column truncation uses `meta.truncate` and `meta.maxWidth`
- [ ] Boolean values use `BooleanIcon`
- [ ] Status/enum values use `EnumBadge`
- [ ] Row actions use `RowActions` with stable `id` values
- [ ] API calls use `apiCall`/`apiCallOrThrow` (not raw `fetch`)

## Anti-Patterns

1. Custom form implementations — use `CrudForm`
2. Manual table markup — use `DataTable`
3. Custom toast/notification — use `flash()`
4. Inline styles — use Tailwind classes
5. Hardcoded colors — use theme variables
6. Missing loading states — every async operation needs feedback
7. Missing error handling — every failure needs messaging
8. Missing keyboard shortcuts — all dialogs need `Cmd+Enter` and `Escape`
9. Custom truncation — use `TruncatedCell` with `meta.maxWidth`
10. Direct `fetch()` — use `apiCall`/`apiCallOrThrow`

## Visual Guidelines

### Spacing
- `p-4` for cards, `p-6` for page sections
- `gap-4` or `gap-6` for flex/grid layouts
- `space-y-4` or `space-y-6` for vertical rhythm

### Colors
- Use semantic colors from theme (no hardcoded hex)
- Destructive: `variant="destructive"` on buttons
- Status badges: `useSeverityPreset()`

### Layout Patterns
- **List pages**: FilterBar + DataTable + Pagination
- **Detail pages**: Header + Tabs/Sections + Related data
- **Create/Edit**: Full-page CrudForm or Dialog with embedded CrudForm
- **Settings**: Grouped sections with inline editing
```

#### `references/ui-components.md`

This file is copied directly from the monorepo's `.ai/skills/backend-ui-design/references/ui-components.md` with no modifications — the component API is identical in standalone apps.

---

### Skill 3: code-review

**Adapted from**: `.ai/skills/code-review/`

**What's kept**:
- Review workflow structure (scope → context → CI/CD gate → checklist → output)
- Severity classification (Critical/High/Medium/Low)
- Architecture rules (FK IDs, tenant isolation, DI, event boundaries)
- Security rules (zod validation, auth guards, encryption helpers)
- Data integrity rules (entity → migration lifecycle, atomic flush, idempotent workers)
- UI & HTTP rules (CrudForm, DataTable, apiCall, flash, keyboard shortcuts)
- Code quality rules (no `any`, no empty catch, functional style)
- Naming conventions (singular entities, camelCase JS, snake_case DB)
- Anti-patterns checklist

**What's removed**:
- Backward compatibility gate (13 contract surfaces — standalone devs don't publish packages)
- Template parity gate (`yarn template:sync` — monorepo-only)
- Multi-package CI/CD steps (`yarn build:packages` twice, `yarn i18n:check-sync` for 4 locales)
- Package-scoped required exports references (`packages/core/AGENTS.md`, `packages/cache/AGENTS.md`)
- Review heuristics #0 (backward compatibility), #13 (spec numbering), #14 (template sync)
- Lessons Learned section (references monorepo-specific bugs)
- Review checklist sections: Cache (§8), Queue & Workers (§9), Module Setup (§10), Custom Fields (§11), Search Config (§7), AI Tools/MCP (§18), Generated Files (§19), Backward Compatibility (§21) — these are either not applicable or too monorepo-specific

**What's simplified**:
- CI/CD gate: 4 steps (generate → typecheck → test → build)
- Review checklist: ~40 items across 8 focused sections (vs 100+ across 22)
- Required exports table: simplified to app-level patterns

#### `SKILL.md`

```markdown
---
name: code-review
description: Review code changes for architecture, security, conventions, and quality compliance. Use when reviewing pull requests, code changes, or auditing code quality.
---

# Code Review

Review code changes against Open Mercato architecture rules, security requirements, and quality standards.

## Review Workflow

1. **Scope**: Identify changed files. Classify by layer (entity, API route, validator, backend page, subscriber, worker, command, widget).
2. **Gather context**: Read `AGENTS.md` for module conventions. Check `.ai/specs/` for active specs. Read `.ai/lessons.md` for known pitfalls.
3. **CI/CD verification gate (MANDATORY)**: Run the checks below. Every gate MUST pass. See **CI/CD Gate** section.
4. **Run checklist**: Apply rules from `references/review-checklist.md`. Flag violations with severity, file, and fix suggestion.
5. **Test coverage**: Verify changed behavior is covered by tests. Flag missing coverage.
6. **Cross-module impact**: If the change touches events, extensions, or widgets, verify consumers handle the contract correctly.
7. **Output**: Produce the review report.

## CI/CD Verification Gate (MANDATORY)

**NEVER claim code is "ready to merge" without running these checks.** If any step fails, it MUST be fixed before the review can pass.

| # | Command | What it checks | If it fails |
|---|---------|----------------|-------------|
| 1 | `yarn generate` | Module registries are up to date | Run it — it generates missing files |
| 2 | `yarn typecheck` | TypeScript types are correct | Fix type errors |
| 3 | `yarn test` | All unit tests pass | Fix failing tests |
| 4 | `yarn build` | The app builds successfully | Fix build errors |

**Rules**:
- Steps 2 and 3 can run in parallel.
- Every failure is a **Critical** finding — even if it appears unrelated to the current changes.
- The review output MUST include actual pass/fail results. Do not assume — run and report.

## Output Format

```markdown
# Code Review: {change description}

## Summary
{1-3 sentences: what the change does, overall assessment}

## CI/CD Verification

| Gate | Status | Notes |
|------|--------|-------|
| `yarn generate` | PASS/FAIL | |
| `yarn typecheck` | PASS/FAIL | |
| `yarn test` | PASS/FAIL | |
| `yarn build` | PASS/FAIL | |

## Findings

### Critical
{Security, data integrity, tenant isolation violations}

### High
{Architecture violations, missing required exports}

### Medium
{Convention violations, suboptimal patterns}

### Low
{Suggestions, minor improvements}

## Checklist
{From references/review-checklist.md — mark [x] passing, [ ] failing with explanation}
```

Omit empty severity sections.

## Severity Classification

| Severity | Criteria | Action |
|----------|----------|--------|
| **Critical** | Security vulnerability, cross-tenant leak, data corruption, missing auth | MUST fix before merge |
| **High** | Architecture violation, missing required export, broken module contract | MUST fix before merge |
| **Medium** | Convention violation, suboptimal pattern, missing best practice | Should fix |
| **Low** | Style suggestion, minor improvement | Nice to have |

## Quick Rule Reference

### Architecture

- **NO direct ORM relationships between modules** — use FK IDs, fetch separately
- **Always filter by `organization_id`** for tenant-scoped entities
- **Use DI (Awilix)** to inject services — never `new` directly
- **NO direct module-to-module calls** for side effects — use events
- **Cross-module data**: use extension entities + `data/extensions.ts`

### Security

- **Validate all inputs with zod** in `data/validators.ts`
- **Use `findWithDecryption`** instead of raw `em.find`/`em.findOne`
- **Hash passwords with bcryptjs (cost >= 10)** — never log credentials
- **Every endpoint MUST declare auth guards** (`requireAuth`, `requireRoles`, `requireFeatures`)

### Data Integrity

- **Never hand-write migrations** — update entities, run `yarn db:generate`
- **Validate migration scope** — autogenerated doesn't mean correct
- **Workers/subscribers MUST be idempotent**
- **Commands MUST be undoable** — include before/after snapshots

### Naming

- Modules: **plural, snake_case** (folders and `id`)
- JS/TS identifiers: **camelCase**
- Database: **snake_case**, table names plural
- Standard columns: `id`, `created_at`, `updated_at`, `deleted_at`, `is_active`, `organization_id`

### UI & HTTP

- Forms: `CrudForm` — never custom
- Tables: `DataTable` — never manual markup
- Notifications: `flash()` — never `alert()` or custom toast
- API calls: `apiCall`/`apiCallOrThrow` — never raw `fetch`
- Dialogs: `Cmd/Ctrl+Enter` (submit), `Escape` (cancel)
- `pageSize` MUST be <= 100

### Code Quality

- No `any` types — use zod + `z.infer`
- No empty `catch` blocks
- No one-letter variable names
- Boolean parsing: use `parseBooleanToken`/`parseBooleanWithDefault`
- Don't add docstrings/comments to code you didn't change

## Review Heuristics

1. **New files**: Check if `yarn generate` is needed. Verify auto-discovery paths.
2. **Entity changes**: Check if `yarn db:generate` is needed. Look for missing tenant columns.
3. **Migration sanity**: Inspect SQL content. Reject unrelated schema churn.
4. **New API routes**: Verify `openApi` export, auth guards, zod validation, tenant filtering.
5. **Event emitters**: Verify event is declared in `events.ts` with `as const`.
6. **Commands**: Verify undoable, before/after snapshots.
7. **UI changes**: Verify `CrudForm`/`DataTable`, `flash()`, keyboard shortcuts, loading/error states.
8. **Test coverage**: Verify unit/integration tests cover new behavior.

## Reference Materials

- [Review Checklist](references/review-checklist.md)
- [AGENTS.md](../../../AGENTS.md)
```

#### `references/review-checklist.md`

```markdown
# Code Review Checklist

## 1. Architecture & Module Independence

- [ ] No ORM relationships between modules — FK IDs only
- [ ] No direct module-to-module function calls for side effects
- [ ] DI (Awilix) used for service wiring
- [ ] No cross-tenant data exposure
- [ ] Code in correct location (`src/modules/<id>/`)

## 2. Security

- [ ] All inputs validated with zod in `data/validators.ts`
- [ ] No `any` types
- [ ] Auth guards on all endpoints (`requireAuth`, `requireRoles`, `requireFeatures`)
- [ ] Passwords hashed with bcryptjs (cost >= 10)
- [ ] No credentials logged or in error messages
- [ ] `findWithDecryption` used instead of raw `em.find`/`em.findOne`
- [ ] Tenant isolation: queries filter by `organization_id`

## 3. Data Integrity & ORM

- [ ] No hand-written migrations — entities updated, `yarn db:generate` run
- [ ] Migration scope matches PR intent (no unrelated schema churn)
- [ ] UUID primary keys with standard columns (`id`, `created_at`, `updated_at`)
- [ ] Soft delete via `deleted_at` where applicable
- [ ] Atomic transactions for multi-step writes

## 4. API Routes

- [ ] `openApi` exported for documentation
- [ ] `metadata` exported with auth guards
- [ ] Zod validation on request body
- [ ] Tenant scoping in queries
- [ ] `apiCall` used instead of raw `fetch`
- [ ] `pageSize <= 100`

## 5. Events & Commands

- [ ] Events declared in `events.ts` with `createModuleEvents` and `as const`
- [ ] Subscribers export `metadata` with `{ event, persistent?, id? }`
- [ ] Workers export `metadata` with `{ queue, id?, concurrency? }`
- [ ] All mutations implemented as commands with undo logic
- [ ] Side effects outside `withAtomicFlush`

## 6. UI & Backend Pages

- [ ] Forms use `CrudForm` (not custom)
- [ ] Tables use `DataTable` (not custom)
- [ ] Notifications use `flash()` (not alert/toast)
- [ ] Dialog forms have `embedded={true}`
- [ ] Keyboard: `Cmd/Ctrl+Enter` submit, `Escape` cancel
- [ ] Loading states: `LoadingMessage` or `DataLoader`
- [ ] Error states: `ErrorMessage` or `ErrorNotice`
- [ ] Empty states: `EmptyState`
- [ ] `RowActions` items have stable `id` values
- [ ] i18n: `useT()` client-side — no hardcoded strings

## 7. Naming Conventions

- [ ] Modules: plural, snake_case
- [ ] JS/TS identifiers: camelCase
- [ ] DB tables/columns: snake_case, plural table names
- [ ] Feature naming: `<module>.<action>` (e.g. `inventory.view`)
- [ ] Event naming: `module.entity.action` (singular entity, past tense)

## 8. Anti-Patterns

- [ ] No cross-module ORM links
- [ ] No plural entity/command/event naming
- [ ] No direct `fetch()` calls
- [ ] No custom toast/notification implementations
- [ ] No inline styles (use Tailwind)
- [ ] No hardcoded colors (use theme)
- [ ] No empty `catch` blocks
- [ ] No `any` types
- [ ] No missing loading/error states
```

---

## Generator Changes

### `packages/create-app/src/setup/tools/shared.ts`

Add skill file copy operations to `generateShared()`:

```typescript
// .ai/skills/
writeTemplate('ai/skills/spec-writing/SKILL.md', join(targetDir, '.ai', 'skills', 'spec-writing', 'SKILL.md'), config)
copyFile('ai/skills/spec-writing/references/spec-template.md', join(targetDir, '.ai', 'skills', 'spec-writing', 'references', 'spec-template.md'))
copyFile('ai/skills/spec-writing/references/spec-checklist.md', join(targetDir, '.ai', 'skills', 'spec-writing', 'references', 'spec-checklist.md'))

writeTemplate('ai/skills/backend-ui-design/SKILL.md', join(targetDir, '.ai', 'skills', 'backend-ui-design', 'SKILL.md'), config)
copyFile('ai/skills/backend-ui-design/references/ui-components.md', join(targetDir, '.ai', 'skills', 'backend-ui-design', 'references', 'ui-components.md'))

writeTemplate('ai/skills/code-review/SKILL.md', join(targetDir, '.ai', 'skills', 'code-review', 'SKILL.md'), config)
copyFile('ai/skills/code-review/references/review-checklist.md', join(targetDir, '.ai', 'skills', 'code-review', 'references', 'review-checklist.md'))
```

Only `SKILL.md` files use `writeTemplate` (for `{{PROJECT_NAME}}`). Reference files use `copyFile` (no placeholders).

### `packages/create-app/agentic/shared/AGENTS.md.template`

Add skills reference to the task-context map:

```markdown
| Write a spec | `.ai/skills/spec-writing/SKILL.md`, `.ai/specs/SPEC-000-template.md` |
| Review code changes | `.ai/skills/code-review/SKILL.md` |
| Build backend UI | `.ai/skills/backend-ui-design/SKILL.md` |
```

### `packages/cli/src/lib/agentic-setup.ts`

Add skill content strings and copy operations to the CLI's self-contained generator (mirrors the create-app generator changes).

---

## Impact on Generated File Counts

| Selection | Before (SPEC-058) | After | Delta |
|---|---|---|---|
| Claude Code only | 8 | 14 | +6 skill files |
| Codex only | 5 | 11 | +6 skill files |
| Cursor only | 10 | 16 | +6 skill files |
| All three | 15 | 21 | +6 skill files |
| Skip | 0 | 0 | — |

The 6 new files (all in shared):
1. `.ai/skills/spec-writing/SKILL.md`
2. `.ai/skills/spec-writing/references/spec-template.md`
3. `.ai/skills/spec-writing/references/spec-checklist.md`
4. `.ai/skills/backend-ui-design/SKILL.md`
5. `.ai/skills/backend-ui-design/references/ui-components.md`
6. `.ai/skills/code-review/SKILL.md`
7. `.ai/skills/code-review/references/review-checklist.md`

Correction: **7 new files** (+7 delta, not +6).

---

## Risks

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| Skills drift from monorepo originals as framework evolves | Medium | Sync reminder in `.ai/lessons.md` (already added by SPEC-058). Skills are simplified versions, not 1:1 copies — drift is expected and acceptable for standalone-relevant rules. | Medium — periodic manual review needed |
| `ui-components.md` reference becomes stale as new components are added | Medium | This file is a reference, not enforcement. Developers will discover new components via IDE autocomplete and package exports. Add update reminder to `packages/create-app/AGENTS.md`. | Low |
| Standalone developers try to follow monorepo-specific rules from online docs | Low | Skills explicitly state "standalone app" context. AGENTS.md template already frames the "build ON TOP of" mental model. | Low |
| Package size increase | Low | ~30KB of markdown files. Negligible vs existing agentic content. | None |

---

## Implementation Plan

### Phase 1 — Source Content

1. Create `packages/create-app/agentic/shared/ai/skills/spec-writing/SKILL.md`
2. Create `packages/create-app/agentic/shared/ai/skills/spec-writing/references/spec-template.md`
3. Create `packages/create-app/agentic/shared/ai/skills/spec-writing/references/spec-checklist.md`
4. Create `packages/create-app/agentic/shared/ai/skills/backend-ui-design/SKILL.md`
5. Create `packages/create-app/agentic/shared/ai/skills/backend-ui-design/references/ui-components.md` (copy from monorepo, no changes needed)
6. Create `packages/create-app/agentic/shared/ai/skills/code-review/SKILL.md`
7. Create `packages/create-app/agentic/shared/ai/skills/code-review/references/review-checklist.md`

### Phase 2 — Generator Wiring

8. Update `packages/create-app/src/setup/tools/shared.ts` to copy skill files
9. Update `packages/create-app/agentic/shared/AGENTS.md.template` to reference skills in task-context map
10. Update `packages/cli/src/lib/agentic-setup.ts` with skill content and copy operations
11. Build and verify `dist/agentic/` includes skill files

### Phase 3 — Polish

12. Update `packages/create-app/AGENTS.md` with skill sync notes
13. Test: scaffold app with wizard → verify `.ai/skills/` structure generated
14. Test: `yarn mercato agentic:init --tool=claude-code` → verify skills included
15. Test: verify `{{PROJECT_NAME}}` replaced in SKILL.md files

---

## Testing

### Quick verification

```bash
# Build
cd packages/create-app && node build.mjs

# Scaffold to temp dir
mkdir -p /tmp/test-skills/src/modules
echo 'export const modules = []' > /tmp/test-skills/src/modules.ts

# Run generator
node -e "
import { runAgenticSetup } from './dist/setup/wizard.js'
await runAgenticSetup('/tmp/test-skills', async () => '1')
"

# Verify
ls /tmp/test-skills/.ai/skills/spec-writing/
ls /tmp/test-skills/.ai/skills/backend-ui-design/
ls /tmp/test-skills/.ai/skills/code-review/
cat /tmp/test-skills/.ai/skills/spec-writing/SKILL.md | head -5  # Check {{PROJECT_NAME}} resolved
cat /tmp/test-skills/AGENTS.md | grep "skills/"  # Check task-context references
```

### Verification checklist

- [ ] `.ai/skills/spec-writing/SKILL.md` exists with resolved `{{PROJECT_NAME}}`
- [ ] `.ai/skills/spec-writing/references/spec-template.md` exists
- [ ] `.ai/skills/spec-writing/references/spec-checklist.md` exists (6 sections, ~25 items)
- [ ] `.ai/skills/backend-ui-design/SKILL.md` exists
- [ ] `.ai/skills/backend-ui-design/references/ui-components.md` exists (40+ components)
- [ ] `.ai/skills/code-review/SKILL.md` exists with 4-step CI/CD gate
- [ ] `.ai/skills/code-review/references/review-checklist.md` exists (8 sections, ~40 items)
- [ ] `AGENTS.md` task-context map references all three skills
- [ ] Zero references to `packages/`, `BACKWARD_COMPATIBILITY.md`, `yarn build:packages`, `yarn template:sync`, `SPEC-ENT-*`, or `.ai/specs/enterprise/` in any skill file
- [ ] `yarn mercato agentic:init` generates skills alongside existing shared files
- [ ] Skills are generated for ALL tool selections (not tool-specific)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-03-11 | Initial spec. Three adapted skills (spec-writing, backend-ui-design, code-review) for standalone app developers. |
| 2026-03-11 | **Implementation complete.** 7 source files in `agentic/shared/ai/skills/`, generator wiring in `shared.ts`, CLI embedded content in `agentic-setup.ts`, AGENTS.md template updated with skill references. Build + typecheck clean, functional tests passed (14 files Claude Code, 21 files all-three, placeholder substitution, zero monorepo leakage). |
