# Fix Todo Assignee Checkbox Auto-Submit

## Goal
Prevent clicking example Todo Assignees checkbox/listbox options inside `CrudForm` from submitting the whole form.

## Scope
- Shared backend form controls in `packages/ui`.
- Example Todo custom-field regression coverage only where needed to prove the behavior.

## Non-goals
- No visual redesign of custom fields or Todo pages.
- No API contract changes.
- No database or generated-file changes.

## Implementation Plan

### Phase 1: Root Cause
- Confirm which interactive control triggers native form submit.
- Add a focused regression test around multi-select/listbox custom-field selection inside `CrudForm`.

### Phase 2: Fix
- Patch the shared control so checkbox/listbox clicks are non-submit interactions inside forms.
- Keep existing value-change behavior intact.

### Phase 3: Validation and PR
- Run focused UI tests and typecheck if needed.
- Push a branch and open a PR against `develop` with bug/needs-qa labels.

## Risks
- `Checkbox` is a shared primitive. The fix must preserve normal checked/indeterminate behavior while preventing accidental native form submission.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Root Cause

- [x] 1.1 Confirm submit trigger and add regression test — 07d053f2a

### Phase 2: Fix

- [x] 2.1 Patch checkbox/listbox non-submit behavior — 07d053f2a

### Phase 3: Validation and PR

- [x] 3.1 Run focused validation and open PR — 07d053f2a
