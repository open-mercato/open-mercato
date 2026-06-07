# HANDOFF — #2468 Undo/Redo verification

If this task was interrupted, read this first, then `PLAN.md`.

## What this is
Autonomous QA verification of Undo/Redo for ~214 undoable commands (spec
`.ai/qa/scenarios/TC-UNDO-001-undo-redo-all-commands.md`), driven through the real app via the
ephemeral integration harness. Deliverable: per-module undo/redo integration specs + GitHub bug
reports (root-caused) for every failure, tracked against issue #2468.

## Environment
- Worktree: `.ai/tmp/wt-2468` on branch `qa/2468-undo-redo-verification` (off `origin/develop`).
  - Undo/command-bus surfaces are byte-identical to `origin/develop` (verified empty diff), so
    results are faithful to develop.
- Ephemeral env state file: `.ai/qa/ephemeral-env.json` (baseUrl/port/databaseUrl when running).
- Seeded creds: `admin@acme.com` / `secret` (also `superadmin@acme.com`, `employee@acme.com`).

## Key mechanics (so you don't re-discover)
- Every mutating API response carries the undo token in header `x-om-operation: omop:<urlencoded JSON>`
  → `{ id (logId), undoToken, commandId, resourceKind, resourceId, ... }`.
- Undo:  `POST /api/audit_logs/audit-logs/actions/undo` `{ undoToken }` → `{ ok, logId }`.
- Redo:  `POST /api/audit_logs/audit-logs/actions/redo` `{ logId }` → `{ ok, logId, undoToken }`.
- List:  `GET /api/audit_logs/audit-logs/actions?undoableOnly=true`.
- A command is undoable iff handler has `undo()` and `isUndoable !== false`.
- Latest-only rule: only the most recent undoable action for a resource/actor can be undone;
  older → `400 Undo token not available`. Undo consumes the token (no double-undo).
- ACL: `audit_logs.undo_self` (employee default), `undo_tenant` (admin); `redo_self`/`redo_tenant`.

## Helpers
- `packages/core/src/helpers/integration/api.ts` — `getAuthToken(request, role)`, `apiRequest(...)`.
- `packages/core/src/helpers/integration/crmFixtures.ts` — create*/deleteEntityIfExists.
- NEW: `packages/core/src/helpers/integration/undoHarness.ts` — token extraction + cycle runner.

## How to resume
1. `cd .ai/tmp/wt-2468`
2. Ensure ephemeral app is up: `cat .ai/qa/ephemeral-env.json`; if not, `yarn test:integration:ephemeral:start`.
3. Open `PLAN.md`, find first `[ ]`/`[~]` row, continue.
4. Run a single spec: `BASE_URL=<baseUrl> npx playwright test --config .ai/qa/tests/playwright.config.ts <path> --retries=0`
5. On FAIL: root-cause the command's `undo()`/snapshot code, file a `bug`+`priority-high` issue linked to #2468, append to PLAN "Bugs filed", set row `[!]`.
6. Update the issue #2468 progress comment (see `progress-comment.md`) and commit run-folder changes.

## Tracking PR
A tracking PR (this branch → develop) holds the new specs + this run folder. It is linked to #2468.
Keep `PLAN.md` checkboxes current; that is the source of truth for what's verified.

## Current status (2026-06-04)
- Ephemeral app: http://127.0.0.1:46203 (still running). Branch `qa/2468-undo-redo-verification`, tracking PR #2500.
- Verified ~50 scenarios (see VERIFICATION-MATRIX.md). Bugs filed: #2498, #2504, #2507 (P-high), #2506 (medium findings).
- Green regression specs: TC-UNDO-001-people.spec.ts, TC-UNDO-001-config-entities.spec.ts (14), scheduler fixme spec.
- Repro/sweep scripts: repro.mjs(removed), sweep.mjs, batch2.mjs, batch3.mjs + contracts.json (live-validated payloads).

## To resume (remaining — see VERIFICATION-MATRIX "TODO" + Batch-3 deferred)
1. App may have stopped; if so re-run `yarn test:integration:ephemeral:start` from the worktree, read new baseUrl from `.ai/qa/ephemeral-env.json`.
2. Remaining scenarios: sales documents (orders/quotes lines/adjustments/convert), shipments, returns; planner weekly/date-specific replace; staff team-member activities/addresses/comments/job-histories + time_project_members assign/unassign; resources resourceTags CRUD (non-undoable per enumeration — verify negative); customers tags/labels unassign, todos.unlink, dictionaryKindSettings.upsert, entityRoles(+userId), interactions update; catalog productUnitConversions (valid UoM); X8 tenant isolation, X9 bulk undo, X10 cf-heavy on a working entity, X12 search/index.
3. Use contracts.json + the commands enumeration (in conversation) for payloads; extend sweep.mjs/batch2.mjs (they auto-provision parents).
4. Confirm #2507/#2498 share root cause; if the encryption-subscriber systemic fix lands, flip the relevant test.fixme to active.
