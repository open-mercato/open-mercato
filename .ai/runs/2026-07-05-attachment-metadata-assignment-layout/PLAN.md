# Auto Create PR Loop Plan - attachment-metadata-assignment-layout

**Date:** 2026-07-05
**Mode:** Spec-implementation run
**Branch:** fix/attachment-metadata-assignment-layout
**Source spec:** .ai/specs/2026-07-05-attachment-metadata-assignment-layout.md

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `om-auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Add assignment layout regression coverage | done | 8cf9f9b1e |
| 1 | 1.2 | Contain assignment row layout and accessible remove action | done | e90bd6af3 |

## Goal

Fix the shared `AttachmentMetadataDialog` assignment editor so long assignment values cannot force the dialog row wider than its modal content, while preserving assignment payload behavior.

## Overview

### Scope

- Copy the source spec into `.ai/specs/` on the implementation branch because the current `develop` base does not contain it.
- Update `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx`.
- Add focused UI regression coverage under `packages/ui/src/backend/__tests__/`.
- Keep all API contracts, save payloads, form field ids, translations, and public exports unchanged.

### External References

- None.

## Non-goals

- No attachment API, storage, database, migration, route, or generated-file changes.
- No redesign of metadata editing, assignment semantics, record pickers, or link generation.
- No new user-facing strings or i18n keys.
- No change to `CrudForm`, `Dialog`, `Input`, or `apiCall` contracts.

## Risks

- Class-based layout assertions can become brittle if a future refactor preserves behavior with different classes. The tests will assert only the required contract: old track absent, bounded tracks present, shrink classes present, and accessible remove action present.
- `IconButton` may alter the remove action's exact dimensions. Use the DS-recommended size that preserves the existing row rhythm.
- jsdom cannot measure real pixel overflow. The test protects the class contract; checkpoint/final documentation will call out browser smoke status separately.

## Final Gate Blockers

- `yarn template:sync` fails on pre-existing template drift: 25 synced-template files and 5 package dependency entries differ between app source and `packages/create-app/template`. This run does not touch those files, and syncing them would be a broad unrelated change.
- `yarn test` fails in `packages/create-app/src/lib/template-api-dispatcher-require-roles.test.ts` because the template API dispatcher is no longer byte-identical to the monorepo dispatcher. This branch has no changes under `packages/create-app`, `apps/mercato`, `packages/core`, or `packages/shared`.
- `yarn test:integration` is blocked by the local Playwright browser cache missing Chromium (`chromium_headless_shell-1228`) and by unrelated example/API integration failures. The run was interrupted after the global failures were clear.
- `yarn test:create-app:integration` was not run because this UI-only change does not touch app template/package surfaces and the final gate is already blocked by the create-app/template parity failures above.

## Implementation Plan

### Phase 1: Attachment assignment row containment

#### Step 1.1 - Add assignment layout regression coverage

- Add a focused Jest/jsdom test for `AttachmentMetadataDialog`.
- Mock the form host enough to render the custom assignments field with long `type`, `id`, and `href` values.
- Assert the old unconstrained desktop grid class is absent.
- Assert bounded `minmax(0, ...)`, `min-w-0`, and `w-full min-w-0` layout hooks are present.
- Assert the remove action can be found by its accessible remove label.
- Run the focused test as a scratch check; it is expected to fail before Step 1.2 if the old component is still present.

#### Step 1.2 - Contain assignment row layout and accessible remove action

- Replace the assignment row desktop grid with bounded `minmax(0, ...)` text tracks and an `auto` remove column.
- Add `min-w-0` to shrinkable row/container wrappers.
- Pass `className="w-full min-w-0"` to assignment-row `Input` primitives.
- Replace the icon-only remove `Button size="icon"` with `IconButton` using `type="button"` and `aria-label={labels.remove}`.
- Keep responsive breakpoints, field order, disabled behavior, callbacks, assignment payload shape, and existing translated labels unchanged.
- Run the focused test and UI package build as scratch checks before committing.

## Checkpoints

- Final gate subsumes the only checkpoint because this run has two Steps.
- UI browser smoke is conditional: if no runnable local fixture/dev environment is available for `/backend/storage/attachments`, record the skip reason in the final gate/checkpoint notes instead of blocking.

## Validation Plan

- Focused:
  - `yarn workspace @open-mercato/ui test -- AttachmentMetadataDialog`
  - `yarn workspace @open-mercato/ui build`
- Full final gate per `om-auto-create-pr-loop`:
  - `yarn build:packages`
  - `yarn generate`
  - `yarn build:packages`
  - `yarn i18n:check-sync`
  - `yarn i18n:check-usage`
  - `yarn typecheck`
  - `yarn test`
  - `yarn build:app`
  - `yarn test:integration`
  - `yarn test:create-app:integration` if relevant, otherwise documented skip
- DS/code/BC review:
  - `om-ds-guardian` review against `origin/develop..HEAD`
  - `.ai/skills/om-code-review/SKILL.md`
  - `BACKWARD_COMPATIBILITY.md`

## File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `.ai/specs/2026-07-05-attachment-metadata-assignment-layout.md` | Add | Source implementation spec copied from the docs worktree. |
| `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx` | Modify | Fix row containment and remove-button accessibility. |
| `packages/ui/src/backend/__tests__/AttachmentMetadataDialog.test.tsx` | Add | Regression coverage for long assignment values and accessible remove action. |

## Backward Compatibility

No stable contract surface changes. The implementation preserves public exports, component props, form field ids, assignment draft shape, save payloads, API URLs, events, DI names, ACL ids, and generated file conventions.
