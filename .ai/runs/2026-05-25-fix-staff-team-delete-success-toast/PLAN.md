# fix-staff-team-delete-success-toast

Source spec: .ai/specs/2026-05-25-fix-staff-team-delete-success-toast.md

## Tasks

> Authoritative status table. `Status` is one of `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first row whose `Status` is not `done` is the resume point for `auto-continue-pr`. Step ids are immutable once a Step has a commit.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 1 | 1.1 | Fix handleDelete — remove try/catch and redundant flash | done | 1aa45ad89 |
| 2 | 2.1 | Add 409 integration test for delete-with-members | done | 3a1d285cd |

## Goal

Fix the staff team delete UX bug (issue #2049): when a team with assigned members is deleted via the edit page, the backend returns 409 but the UI shows a success toast. Root cause: the edit page's `handleDelete` swallows the thrown error and returns normally, causing `CrudForm` to call its own success flash.

## Scope

- `packages/core/src/modules/staff/backend/staff/teams/[id]/edit/page.tsx` — fix `handleDelete`
- `packages/core/src/modules/staff/__integration__/TC-STAFF-002.spec.ts` — add 409 test case

## Non-Goals

- Hiding the delete button on the edit page when members exist (follow-up UX improvement)
- Changing CrudForm error handling
- Any other staff module changes

## Risks

- **Double toast on happy path**: after removing try/catch, `handleDelete`'s `flash('Team deleted.', 'success')` would show alongside CrudForm's own `flash('Item deleted successfully.', 'success')`. Fix: remove the module-specific `flash` from `handleDelete`'s success path too; CrudForm's generic flash is sufficient. The `router.push` stays.
- **Integration test fixture**: uses `/api/staff/team-members` POST with `{ teamId, displayName }` — confirmed from `staffTeamMemberCreateSchema`.

## Implementation Plan

### Phase 1: Fix handleDelete

#### Step 1.1 — Fix handleDelete — remove try/catch and redundant flash

File: `packages/core/src/modules/staff/backend/staff/teams/[id]/edit/page.tsx`

Replace the `handleDelete` callback (lines 283–297):

**Before:**
```tsx
const handleDelete = React.useCallback(async () => {
  if (!teamId) return
  try {
    await deleteCrud('staff/teams', teamId, {
      errorMessage: t('staff.teams.errors.delete', 'Failed to delete team.'),
    })
    flash(t('staff.teams.messages.deleted', 'Team deleted.'), 'success')
    router.push('/backend/staff/teams')
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : t('staff.teams.errors.delete', 'Failed to delete team.')
    flash(message, 'error')
  }
}, [teamId, router, t])
```

**After:**
```tsx
const handleDelete = React.useCallback(async () => {
  if (!teamId) return
  await deleteCrud('staff/teams', teamId, {
    errorMessage: t('staff.teams.errors.delete', 'Failed to delete team.'),
  })
  router.push('/backend/staff/teams')
}, [teamId, router, t])
```

Rationale:
- Removing try/catch lets `deleteCrud` throw on 409. `CrudForm`'s outer `catch (err)` (CrudForm.tsx:1206) handles the error flash.
- Removing the success `flash` avoids a double toast (edit page + CrudForm both flash). `CrudForm` shows `t('ui.forms.flash.deleteSuccess')` = "Item deleted successfully." after `await onDelete()` resolves.
- Removing `t` from the dependency array since it's no longer used (if `t` is still used by other callbacks it stays — verify during implementation).

### Phase 2: Integration test

#### Step 2.1 — Add 409 integration test for delete-with-members

File: `packages/core/src/modules/staff/__integration__/TC-STAFF-002.spec.ts`

Add a second test to the existing `test.describe` block. The test:
1. Creates a team
2. POSTs a team member to `/api/staff/team-members` with `{ teamId, displayName }`
3. Attempts DELETE `/api/staff/teams?id=<teamId>`
4. Expects 409 with error message matching `/assigned member/i`
5. Teardown: deletes member first (unblocks team), then team

Member creation endpoint: `POST /api/staff/team-members` with body `{ teamId: <uuid>, displayName: 'QA Member ...' }`
Member deletion endpoint: `DELETE /api/staff/team-members?id=<memberId>` (mirrors team pattern)
