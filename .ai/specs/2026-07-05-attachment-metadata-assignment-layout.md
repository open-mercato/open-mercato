# Attachment Metadata Assignment Layout

**Date**: 2026-07-05
**Status**: Ready for implementation

## TLDR

**Key Points:**
- Fix the shared `AttachmentMetadataDialog` assignment editor so long assignment values never force the dialog wider than its modal content area.
- Keep the change in core `@open-mercato/ui`, because downstream apps reuse this dialog and should not need app-level CSS workarounds.

**Scope:**
- `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx`
- Assignment row grid tracks, shrink behavior, remove-button accessibility, and focused regression coverage.

**Boundaries:**
- No API, database, storage, attachment assignment semantics, or module activation changes.
- No redesign of attachment metadata, record pickers, link generation, or custom fields.

## Overview

The attachment metadata dialog is a shared backend UI surface used by the core attachments library and any app that opens `AttachmentMetadataDialog`. The `Assignments` editor currently renders a dense desktop grid inside a `DialogContent` capped at `sm:max-w-2xl`. Long values such as `production_operations:production_order`, UUIDs, or long backend links can push a row beyond the dialog width because the grid tracks and field wrappers do not explicitly allow shrinkage.

The fix is a localized layout correction: bounded CSS grid tracks, `min-w-0` on shrinkable cells, full-width inputs that can shrink, and a small Design System Boy Scout cleanup for the icon-only remove control.

**Market Reference:**
- Radix UI Dialog keeps modal content inert, traps focus in modal mode, announces title/description, and closes with `Esc`. The current Open Mercato dialog primitive already builds on this model, so this spec preserves the existing dialog host rather than inventing a new modal pattern: https://www.radix-ui.com/primitives/docs/components/dialog
- shadcn/ui documents dialog composition with `DialogContent`, `DialogHeader`, `DialogTitle`, optional description/footer, and scrollable content patterns. This supports keeping the overflow behavior inside the existing content layout instead of adding a separate horizontal-scroll container for the row: https://ui.shadcn.com/docs/components/dialog

## Related Context

- `.ai/specs/2026-06-08-organization-sidebar-logo.md` uses the existing attachments API for uploaded images and does not change attachment metadata assignment behavior.
- `.ai/specs/implemented/2026-04-12-product-variant-media-display.md` documents that media flows should use the existing attachments API rather than widening attachment contracts unnecessarily.
- `.ai/specs/SPEC-050-2026-02-28-sonarqube-critical-fixes.md` references attachment code quality cleanup, but not this dialog layout bug.

No existing spec owns the `AttachmentMetadataDialog` assignment-row layout, so this focused UI spec does not conflict with prior attachment API or storage assumptions.

## Problem Statement

`AttachmentMetadataDialog` renders `AttachmentAssignmentsEditor` inside a modal. Each assignment row currently uses this desktop grid:

```tsx
sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_1.6fr_1fr_auto]
```

The grid cells and their input wrappers do not declare `min-w-0`. In CSS grid/flex layouts, this lets long, unbreakable input values contribute an oversized min-content width. A single long assignment type, record id, or link can therefore make the row overflow the dialog content area. Users see clipped controls, content extending under or beyond the modal boundary, and a broken edit experience on `/backend/storage/attachments` and shared consumers.

There is also a small touched-line Design System issue: the assignment remove control is an icon-only `Button size="icon"` without an accessible label. Current UI guidelines require `IconButton` for icon-only actions and an `aria-label`.

## Proposed Solution

Update only the assignment row layout inside `AttachmentMetadataDialog.tsx`:

- Replace unconstrained desktop tracks with bounded tracks, for example `lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_auto]`.
- Add `min-w-0` to each shrinkable grid child and to the row container where needed.
- Pass `className="w-full min-w-0"` to `Input` instances in the assignment row so the input wrapper can shrink inside its grid cell.
- Keep the existing stacked mobile layout and two-column small-screen layout.
- Keep the existing `AssignmentDraft` shape, `assignments` form field id, `CrudForm` usage, `onSave` payload, translations, and public exports unchanged.
- Replace the icon-only remove `Button` with `IconButton` or otherwise meet the local primitive contract with an `aria-label={labels.remove}`. Preferred implementation is `IconButton` because `packages/ui` marks `Button size="icon"` as an anti-pattern for icon-only actions.

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Fix the row grid, not `DialogContent` width | The modal width is correct for backend dialogs; the row should respect it. Widening the modal would still fail on narrower screens. |
| Use `minmax(0, ...)` tracks | This is the standard grid fix for long min-content values in fractional tracks. |
| Avoid horizontal scrolling as the primary UX | Users are editing four short fields plus one action. Shrinking contained inputs is preferable to a horizontally scrolling mini-table inside a modal. |
| Keep `CrudForm` | The dialog already relies on shared form behavior, submit state, loading state, and keyboard handling. |
| Keep assignment strings editable as plain inputs | Entity pickers or automatic link resolution are separate product work and would change behavior. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Increase modal max width beyond `sm:max-w-2xl` | Masks the issue on desktop and does not fix smaller widths. |
| Add `overflow-x-auto` to the assignment row | Preserves broken intrinsic sizing and creates poor modal ergonomics for a form row. |
| Stack all fields on every viewport | Safe but unnecessarily regresses density for normal desktop editing. |
| Build a new assignment picker | Larger behavior change with API/product implications outside this bug fix. |

## User Stories / Use Cases

- **Backend admin** wants to edit metadata for an attachment linked to a long module/entity id so that the dialog remains usable.
- **Module developer** wants shared attachment metadata UI to handle long polymorphic assignment ids so that downstream modules do not ship local overrides.
- **Keyboard/screen-reader user** wants the remove-assignment action to have an accessible name so that the icon-only action is understandable.

## Architecture

### Surface

| Surface | File | Ownership | Notes |
|---------|------|-----------|-------|
| Attachment metadata dialog | `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx` | `@open-mercato/ui` | Existing client component with `CrudForm`, `Input`, `Dialog`, `apiCall`, `useT`, and `useDialogKeyHandler`. |

### Component Flow

```text
AttachmentMetadataDialog
  -> DialogContent(sm:max-w-2xl)
  -> CrudForm(entityId = E.attachments.attachment)
  -> custom field: AttachmentAssignmentsEditor
  -> AssignmentInputRow
      -> Input(type)
      -> Input(record id)
      -> Input(link)
      -> Input(label)
      -> IconButton(remove)
```

### Layout Contract

`AssignmentInputRow` must satisfy these rules:

- The row container is `max-width: 100%` and does not force an intrinsic width wider than its parent.
- Every field wrapper that sits in a grid track has `min-w-0`.
- Every `Input` wrapper in the row has `w-full min-w-0`.
- Desktop grid tracks use `minmax(0, ...)` for all text-input columns and `auto` only for the remove action.
- The remove action does not shrink text fields and remains reachable at the row end on desktop.
- Mobile and small layouts remain stacked or two-column; no field is hidden.

### Commands & Events

N/A. This is a presentational layout fix. It does not add commands, events, subscribers, workers, or side effects.

## Frontend Architecture Contract

### Server/Client Boundary Map

| Route / surface | Server root | Client islands | Data owner | Notes |
|-----------------|-------------|----------------|------------|-------|
| Backend attachment library surfaces that open metadata | Existing backend page hosts | Existing `AttachmentMetadataDialog` | Existing `/api/attachments/library/:id` load plus caller-provided `onSave` | No page-root conversion to client. |
| Shared `@open-mercato/ui` dialog | N/A shared package component | Existing `"use client"` file `AttachmentMetadataDialog.tsx` | Parent component owns save mutation; dialog owns local form state | Only row layout and icon-button accessibility change. |

### `"use client"` Ledger

| File | Reason | Imported by | Heavy deps? | Cleanup / hydration risk | Alternative rejected |
|------|--------|-------------|-------------|---------------------------|----------------------|
| `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx` | Existing interactive dialog with local state, `useEffect` metadata loading, image-tab state, clipboard action, `CrudForm`, and keyboard handler | Backend attachment library/detail consumers | No new heavy deps | Existing file is over the 300 LOC guardrail, but this change is localized and adds no route-level client blob | Splitting the dialog is out of scope for a layout bug; require a follow-up only if future features expand it further. |

### Client Blob Guardrail

- No new client files.
- No generated page root becomes `"use client"`.
- No new browser SDK, editor, chart, table, or provider dependency.
- The existing shared dialog remains large; implementation should keep the diff localized to `AssignmentInputRow` imports/classes unless tests require a small test-only export. A refactor split is not required for this fix.

### Budgets

| Budget | Target | Spec value |
|--------|--------|------------|
| Generated backend page-root `"use client"` | 0 new unallowlisted | 0 |
| Touched client page/root files over 300 LOC | 0 unless justified | 0 page/root files; one existing shared component touched with localized diff |
| Heavy browser libraries at page/provider root | 0 | 0 |
| Per-route hydration smoke test | Required for changed interactive route when route is exercised | Focused Jest render test required; manual/browser smoke for `/backend/storage/attachments` recommended during implementation if local data is available |
| Performance evidence | Static check plus focused package validation | Focused UI test plus `yarn workspace @open-mercato/ui build` |

### Provider / Bootstrap Scope

| Provider/bootstrap | Global? | Scope | Why | Exit criteria to narrow |
|--------------------|---------|-------|-----|-------------------------|
| None | N/A | N/A | No providers, registries, generated frontend, or bootstrap files change | N/A |

### Test and Evidence Plan

- Add focused Jest/jsdom coverage for `AttachmentMetadataDialog` or a testable assignment-row helper with long `type`, `id`, and `href` values.
- Assert the rendered assignment row no longer contains the previous unconstrained `lg:grid-cols-[1.2fr_1.2fr_1.6fr_1fr_auto]` class.
- Assert shrink classes exist on the row/field wrappers and inputs (`min-w-0`, `w-full`, and `minmax(0,...)` track definition).
- Assert the remove assignment control has an accessible name from `labels.remove`.
- Build `@open-mercato/ui` after the test passes.

## Data Models

No data model changes.

Existing shapes remain unchanged:

```ts
export type AssignmentDraft = {
  type: string
  id: string
  href?: string
  label?: string
}
```

No entity, tenancy column, lifecycle column, migration, index, encryption map, custom field definition, or search index changes are introduced.

## API Contracts

No API contract changes.

Existing behavior remains:

| API | Change | Notes |
|-----|--------|-------|
| `GET /api/attachments/library/:id` | None | Dialog still loads metadata through existing `apiCall`. |
| Caller-owned save path, currently used to persist metadata payloads | None | `AttachmentMetadataDialog` still calls `onSave(item.id, payload)` with `{ tags, assignments, customFields? }`. |

The implementation must not alter request/response schemas, OpenAPI metadata, ACL guards, optimistic locking behavior, or error payloads.

## Internationalization (i18n)

No new user-facing copy is required.

If the remove control is converted to `IconButton`, use the existing translated label:

```tsx
aria-label={labels.remove}
```

Do not introduce hard-coded strings for labels, tooltips, errors, or button text.

## UI/UX

### Expected Behavior

- Assignment rows stay inside the modal at desktop, tablet, and mobile widths.
- Long `type`, `id`, and `href` values remain editable in their inputs.
- The row keeps the existing field order: Type, Record ID, Link, Label, Remove.
- The mobile layout remains one column; the small layout remains two columns; the desktop layout remains dense.
- The dialog retains existing `Escape` cancel behavior through Radix/Dialog and `useDialogKeyHandler`.
- The dialog retains existing `CrudForm` submit behavior and `Cmd/Ctrl+Enter` handling.

### Design System Requirements

- Use `Input` from `@open-mercato/ui/primitives/input`.
- Use `IconButton` for the icon-only remove action, with `type="button"` and `aria-label`.
- Use lucide `Trash2` with `size-4` or equivalent DS icon sizing; do not add inline SVG.
- Do not add hard-coded status colors, arbitrary text sizes, arbitrary spacing, arbitrary z-index values, or raw buttons.
- Preserve visible labels for every input.

## Migration & Compatibility

- No migration files.
- No generated files.
- No `yarn generate` required unless implementation unexpectedly changes auto-discovered module files. This spec should not.
- Backward compatibility is preserved because public exports, props, payload shapes, field IDs, translations, and routes remain unchanged.
- Existing consumers benefit automatically after upgrading `@open-mercato/ui`.

## Implementation Plan

### Phase 1: Contain Assignment Row Layout

1. Modify `AssignmentInputRow` in `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx`.
2. Replace the desktop grid class with bounded `minmax(0, ...)` tracks.
3. Add `min-w-0` to shrinkable field wrappers and `w-full min-w-0` to assignment-row `Input` components.
4. Keep current responsive breakpoints and field order.
5. Convert the remove action to `IconButton` with `aria-label={labels.remove}` and `type="button"`; keep the same remove callback and disabled behavior.

### Phase 2: Regression Coverage

1. Add a focused test under `packages/ui/src/backend/__tests__/` or the closest existing backend UI test location.
2. Render the assignment editor path with long values for `type`, `id`, and `href`.
3. Verify the old overflow-prone grid class is absent and the bounded grid/min-width classes are present.
4. Verify the remove action is reachable by accessible name.
5. Run focused UI tests.

### Phase 3: Validation

1. Run the focused test command for the new/updated test.
2. Run `yarn workspace @open-mercato/ui build`.
3. If implementation adds or changes i18n keys unexpectedly, run `yarn i18n:check`; otherwise document that no new keys were introduced.
4. Optional but recommended: open `/backend/storage/attachments`, edit an attachment with a long assignment value, and capture desktop plus narrow viewport screenshots showing no horizontal overflow.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx` | Modify | Fix assignment-row grid shrink behavior and icon-only remove accessibility. |
| `packages/ui/src/backend/__tests__/AttachmentMetadataDialog.test.tsx` or closest existing test file | Create/modify | Add regression coverage for long assignment values and accessible remove action. |

## Testing Strategy

Required:

```bash
yarn workspace @open-mercato/ui test -- AttachmentMetadataDialog
yarn workspace @open-mercato/ui build
```

Fallback if the package test runner does not support the file filter syntax:

```bash
yarn workspace @open-mercato/ui test
```

Conditional:

```bash
yarn i18n:check
```

Run `yarn i18n:check` only if implementation adds or changes translation keys. This spec expects reuse of existing labels, so no i18n sync should be needed.

## Acceptance Criteria

- The Assignments section stays within `AttachmentMetadataDialog` at typical modal widths with long Type, Record ID, and Link values.
- The previous unconstrained `lg:grid-cols-[1.2fr_1.2fr_1.6fr_1fr_auto]` row class is gone.
- Shrinkable row cells and inputs include `min-w-0`; text-input desktop tracks use `minmax(0, ...)`.
- Existing add/remove assignment behavior and submitted PATCH/save payloads remain unchanged.
- `CrudForm`, `Input`, `Dialog`, `apiCall`, `useT`, and `useDialogKeyHandler` usage remain intact.
- The remove assignment icon-only action has an accessible name and uses the shared icon-button primitive contract.
- No API, entity, migration, generated registry, or attachment assignment semantics change.

## Risks & Impact Review

### Risk Register

#### R1: Layout fix regresses desktop editing density
- **Scenario**: Bounded tracks shrink fields too aggressively on desktop, making normal assignments harder to scan.
- **Severity**: Low
- **Affected area**: Attachment metadata dialog, assignment editor only
- **Mitigation**: Preserve the existing responsive shape and relative track weights; only add `minmax(0, ...)` and shrink classes.
- **Residual risk**: Some very long values still require cursor navigation inside the input, which is acceptable for editable text fields.

#### R2: Class-based regression test becomes brittle
- **Scenario**: A future refactor changes class strings while preserving layout behavior, causing a test failure.
- **Severity**: Low
- **Affected area**: `@open-mercato/ui` test suite
- **Mitigation**: Assert the core contract, not every class: old unconstrained track absent, bounded track present, shrink classes present, accessible remove action present.
- **Residual risk**: jsdom cannot measure actual modal overflow; optional browser smoke covers visual confirmation.

#### R3: Remove-button primitive swap changes styling subtly
- **Scenario**: Replacing `Button size="icon"` with `IconButton` changes icon button height or border treatment.
- **Severity**: Low
- **Affected area**: Assignment row remove action
- **Mitigation**: Use `IconButton` size/variant that best matches existing row rhythm and `packages/ui` primitive rules; keep callback and disabled behavior unchanged.
- **Residual risk**: Slight visual difference is acceptable because it aligns the touched line with the Design System.

#### R4: Hidden API assumptions creep into a UI-only fix
- **Scenario**: Implementation expands scope by changing assignment payload normalization, API contracts, or attachment route behavior.
- **Severity**: Medium
- **Affected area**: Attachments metadata save behavior
- **Mitigation**: Keep implementation limited to row layout/accessibility and tests; acceptance criteria explicitly forbid API/payload changes.
- **Residual risk**: None if file manifest is respected.

### Data Integrity Failures

N/A. No writes are added or changed. Existing save behavior remains caller-owned through `onSave`.

### Cascading Failures & Side Effects

N/A. No events, queues, notifications, caches, or external calls change.

### Tenant & Data Isolation Risks

N/A. No query, API, cache, or tenant scoping behavior changes.

### Migration & Deployment Risks

This is a package UI change with no migrations. Deployment can happen with a normal package/app build.

### Operational Risks

The blast radius is limited to the shared attachment metadata dialog. If the change fails, users may see a visual layout regression in assignment editing; data persistence contracts remain unchanged.

## Final Compliance Report - 2026-07-05

### AGENTS.md Files Reviewed

- `AGENTS.md` (root instructions provided in the task)
- `packages/ui/AGENTS.md`
- `packages/ui/src/backend/AGENTS.md`
- `.ai/ds-rules.md`
- `.ai/ui-components.md` sections for Button, IconButton, Input, and Dialog
- `.ai/skills/om-spec-writing/references/frontend-architecture-contract.md`
- `.ai/skills/om-spec-writing/references/spec-checklist.md`
- `.ai/skills/om-spec-writing/references/compliance-review.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Keep changes minimal, focused, and integrated through real call sites | Compliant | Single shared UI component plus focused test. |
| root AGENTS.md | Check existing specs before modifying a module | Compliant | Related attachment specs reviewed; no conflict found. |
| root AGENTS.md | Never hard-code user-facing strings | Compliant | Reuse existing `labels.remove`; no new strings expected. |
| root AGENTS.md | No API/data behavior change unless requested | Compliant | API contracts and payload shape stay unchanged. |
| packages/ui/AGENTS.md | Use existing UI primitives before creating new ones | Compliant | Keeps `Input`, `CrudForm`, `Dialog`; uses `IconButton` for icon-only action. |
| packages/ui/AGENTS.md | Use `CrudForm` for dialog forms unless custom host is required | Compliant | Existing `CrudForm` remains. |
| packages/ui/AGENTS.md | Use `apiCall` for backend data calls | Compliant | Existing load call remains `apiCall`; no new HTTP calls. |
| packages/ui/AGENTS.md | Use i18n keys and `useT()` for user-facing copy | Compliant | Existing `useT()` labels remain; remove aria-label uses translated label. |
| packages/ui/src/backend/AGENTS.md | MUST use `Button` or `IconButton`; use `IconButton` for icon-only buttons | Compliant | Spec requires converting remove action to `IconButton`. |
| packages/ui/src/backend/AGENTS.md | MUST use `LoadingMessage`/`ErrorMessage` for loading/error states | N/A | This spec does not add loading/error states; existing dialog behavior is not changed. |
| `.ai/ds-rules.md` | No hardcoded status colors, arbitrary text sizes, arbitrary spacing, or raw buttons | Compliant | Layout classes use grid containment only; no new status colors or raw buttons. |
| `.ai/ui-components.md` | `Input` wrapper supports `className`; icon-only buttons need accessible names | Compliant | Spec uses `className="w-full min-w-0"` on row inputs and `aria-label` on remove. |
| Frontend Architecture Contract | Include server/client map, `"use client"` ledger, budgets, test/evidence plan | Compliant | Contract included above. Existing large client component is justified as localized bug fix. |
| Spec checklist | Risks, tests, API/UI compatibility, DS compliance documented | Compliant | Sections included; non-applicable data/API items marked N/A by design. |
| Backward compatibility | Preserve public exports, field ids, payloads, routes | Compliant | Explicit acceptance criterion and API section. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | No data model or API change. |
| API contracts match UI/UX section | Pass | UI keeps existing load/save path and payload. |
| Risks cover all write operations | Pass | No write operation changes; risk R4 guards against scope creep. |
| Commands defined for all mutations | Pass | No new mutations; existing `CrudForm` submit path remains. |
| Cache strategy covers all read APIs | Pass | No cache behavior changes. |
| Design System requirements match implementation plan | Pass | `IconButton`, `Input`, labels, no raw buttons. |
| Frontend boundaries match implementation plan | Pass | Existing client island only; no route/provider changes. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** - approved and ready for implementation.

## Changelog

### 2026-07-05

- Expanded the skeleton into a full implementation-ready spec with UI architecture, Frontend Architecture Contract, test plan, risk register, and compliance report.
- Scoped the fix to `AttachmentMetadataDialog.tsx` assignment-row layout and icon-only remove accessibility.

### Review - 2026-07-05

- **Reviewer**: Codex Agent
- **Security**: Passed - no data access, tenant scoping, secrets, or API contract changes.
- **Performance**: Passed - no new data loading, heavy client dependency, provider, or route-level client boundary.
- **Cache**: Passed - no cache usage or invalidation changes.
- **Commands**: Passed - no new commands, events, queues, or side effects.
- **Risks**: Passed - layout density, test brittleness, primitive swap, and API scope creep documented with mitigations.
- **Verdict**: Approved.
