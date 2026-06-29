# Checkpoint 1 — Steps 1.1..2.1

**Checkpoint index:** 1
**Steps covered:** 1.1 (1aa45ad89) → 2.1 (42abcb811)
**Touched packages:** `packages/core` (staff module edit page + integration test)

## Checks

| Check | Result | Notes |
|-------|--------|-------|
| handleDelete structure (AST parse) | ✅ Pass | No try/catch, no flash in success path confirmed via node script |
| `flash` import still present | ✅ Pass | Used by other callbacks in the same file |
| `t` dep in useCallback | ✅ Pass | Still needed for `errorMessage` in deleteCrud call |
| TypeCheck root | ⚠️ Skip | Pre-existing `#generated/entities.ids.generated` errors in unrelated modules (attachments, sync-akeneo); worker unable to run `yarn generate` without dev DB |
| Integration test structure | ✅ Pass | TC-STAFF-002 second test: creates team + member, asserts 409, teardown deletes member then team |
| `createStaffTeamFixture` import added | ✅ Pass | Import updated from staffFixtures |
| Teardown order | ✅ Pass | Member deleted before team (unblocks team deletion) |

## UI verification
Skipped — this is a logic-only fix in an async callback. No structural UI change. No new pages, routes, or widgets added. No Playwright session needed at this checkpoint.

## Notes
- Double-toast risk resolved: removed both `try/catch` AND the success `flash` from `handleDelete`. CrudForm shows "Item deleted successfully." on success, handles error flash on 409.
- Pre-existing typecheck errors in `sync-akeneo` and `attachments` (missing generated shims) are unrelated to this run.
