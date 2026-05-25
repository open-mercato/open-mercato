# Handoff — 2026-05-25-fix-staff-team-delete-success-toast

**Last updated:** 2026-05-25T00:00:00Z
**Branch:** fix/fix-staff-team-delete-success-toast
**PR:** not yet opened
**Current phase/step:** Phase 1 Step 1.1
**Last commit:** — (run folder not yet committed)

## What just happened
- Run folder created with PLAN.md, HANDOFF.md, NOTIFY.md
- Root cause confirmed: `handleDelete` in edit page swallows 409 error, CrudForm sees resolved promise, fires success toast
- Double-toast risk resolved in plan: remove flash from success path too, keep router.push

## Next concrete action
- Step 1.1: Edit `packages/core/src/modules/staff/backend/staff/teams/[id]/edit/page.tsx` — replace `handleDelete` (lines 283–297)

## Blockers / open questions
- None

## Environment caveats
- Dev runtime runnable: unknown
- Playwright / browser checks: skipped (no UI path changed structurally — logic-only fix)
- Database/migration state: clean (no schema changes)

## Worktree
- Path: TBD (worktree being created)
- Created this run: yes
