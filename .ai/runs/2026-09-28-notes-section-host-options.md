# Execution plan — NotesSection options for non-CRM hosts

Issue: #6693

## Goal

Let hosts outside the customers module reuse `NotesSection` with author-only or read-only access and a generic per-note context, without changing today's default behaviour.

## Scope

- `packages/ui/src/backend/detail/NotesSection.tsx`
  - `canEditNote?: (note) => boolean` / `canDeleteNote?: (note) => boolean` — hide per-note edit, appearance and delete controls, and disable click-to-edit on the body.
  - `readOnly?: boolean` — hide the composer, inline add button, `onActionChange` action, empty-state action and all per-note mutation controls. Notes and "load more" still render.
  - `CommentSummary.contextLabel?` / `contextHref?` — rendered in the deal slot (link when `contextHref` set, plain text otherwise).
- `packages/ui/src/backend/__tests__/NotesSection.test.tsx` — jsdom coverage.

## Non-goals

- No change to `mapCommentSummary` output, the deal path, APIs, DB, events or i18n keys.
- No changes to customers-module call sites.

## Implementation Plan

### Phase 1: Component options
1.1 Add per-note edit/delete permission callbacks and read-only mode.
1.2 Add generic per-note context label/link.

### Phase 2: Tests
2.1 Add jsdom tests for each option and default behaviour.

## Risks

- Hidden controls are presentational only; servers stay the authority (documented in prop JSDoc).

## Progress

PR: #6694

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Component options

- [x] 1.1 Add per-note edit/delete permission callbacks and read-only mode — 72a9a5a11
- [x] 1.2 Add generic per-note context label/link — 72a9a5a11

### Phase 2: Tests

- [x] 2.1 Add jsdom tests for each option and default behaviour — 88ecaeb80
