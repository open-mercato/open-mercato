# Final Gate Checks - attachment-metadata-assignment-layout

**Timestamp:** 2026-07-05T17:13:35Z
**Runner:** local host
**Branch:** fix/attachment-metadata-assignment-layout

Final gate subsumes checkpoint 1 for Phase 1 Steps 1.1 and 1.2.

## Focused Checks

| Command | Status | Notes |
|---------|--------|-------|
| `yarn workspace @open-mercato/ui test -- AttachmentMetadataDialog` | PASS | Regression test covers bounded assignment row classes and accessible remove action. |
| `yarn workspace @open-mercato/ui build` | PASS | UI package builds with the `IconButton` import and layout changes. |

## CI / Final Gate

| Command | Status | Notes |
|---------|--------|-------|
| `yarn build:packages` | PASS | Initial package build passed. |
| `yarn generate` | PASS | Completed with non-blocking structural-cache purge skip for missing `packages/core/dist/generated/entities.ids.generated.js`; git status stayed clean. |
| `yarn build:packages` | PASS | Rebuild after generate passed. |
| `yarn i18n:check-sync` | PASS | Required sandbox escalation because `tsx` IPC pipe listen failed with EPERM in the sandbox. |
| `yarn i18n:check-usage` | PASS/WARN | Required sandbox escalation; exited 0 with existing unused-key advisory output. |
| `yarn typecheck` | PASS | Full typecheck passed. |
| `yarn test` | FAIL | Fails in `packages/create-app/src/lib/template-api-dispatcher-require-roles.test.ts` because the template API dispatcher is not byte-identical to the monorepo dispatcher. This branch does not touch `packages/create-app`, `apps/mercato`, `packages/core`, or `packages/shared`. |
| `yarn build:app` | PASS | Required sandbox escalation because Turbopack could not create processes/bind ports in the sandbox. Build completed successfully. |
| `yarn template:sync` | FAIL | Reports 25 template file drifts and 5 package dependency drifts. Syncing them is outside this spec's scope. |
| `yarn test:integration` | FAIL/BLOCKED | Local Playwright Chromium cache is missing (`chromium_headless_shell-1228`); the suite also reported unrelated example/API failures. Interrupted after 67 failures, 3 passes, 1 skip, and 1658 tests not run. |
| `yarn test:create-app:integration` | SKIP | Not relevant to this UI-only change and final gate is already blocked by create-app/template parity failures. |

## DS Review

| Check | Status | Notes |
|-------|--------|-------|
| `.ai/scripts/ds-health-check.sh` | PASS | Generated report was inspected and removed from the worktree. |
| Diff scan for raw DS violations | PASS | No introduced hardcoded status colors, raw controls, `size="icon"`, or raw focus/disabled classes in changed UI/test files. |
| Component usage | PASS | Replaced icon-only remove `Button size="icon"` with DS `IconButton` and kept existing primitives. |

## Code Review

No changed-file code findings beyond the verification blockers above.

- Changed production code is limited to `packages/ui/src/backend/detail/AttachmentMetadataDialog.tsx`.
- The save payload, form field ids, assignment draft shape, callbacks, disabled behavior, API calls, and translations are preserved.
- No raw `fetch`, `alert`, manual table markup, ORM calls, migrations, API routes, ACL, events, widgets, queue, cache, or generated files were introduced.
- Grep for `em.find(` / `em.findOne(` in the changed production file returned no hits.

## Backward Compatibility

PASS for the changed files.

- No public import path, component prop, function signature, event id, widget spot id, API URL, response schema, database schema, DI key, ACL id, generated convention, or required type field was removed or renamed.
- The added spec file uses the required `.ai/specs/YYYY-MM-DD-slug.md` naming convention.

## Result

Implementation is complete, but the PR cannot be marked ready because the final gate is blocked by unrelated template parity/test drift and local Playwright environment setup.
