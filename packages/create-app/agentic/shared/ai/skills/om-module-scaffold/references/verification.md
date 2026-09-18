# Module Verification

Load this reference before claiming a scaffold is complete.

## What counts as a gate that passed

A gate has passed ONLY when its command ran to completion and you report its exit status.
This is not pedantry — every item below is a way a real scaffold was reported green while it
could not compile:

- **A gate that crashes has not passed.** `FATAL ERROR: … heap out of memory` from `tsc` is a
  failure to report, never a step to skip. Re-run it with a larger heap
  (`NODE_OPTIONS=--max-old-space-size=8192`) and report the real result.
- **`No tests found` is not a pass.** An empty suite exits 0 and is indistinguishable from a
  green one. Report it as `test: no tests found (not a pass)`.
- **`lint` passing says nothing about whether imports resolve.** ESLint does not check module
  resolution unless `import/no-unresolved` is enabled, and it is not enabled by default. Only
  `typecheck` proves an import path exists — an invented one surfaces as `TS2307`.
- **A pipe hides the exit status.** `yarn test | tail -30` reports the exit code of `tail`.
  Capture the status of the command itself.
- **Writing a document is not running a gate.** Never produce a completion claim — `gate
  green`, `PRODUCTION READY`, a status table, a summary file — asserting a result you did not
  observe. If you cannot run a gate, say so plainly and say why.

1. Run `yarn generate`; inspect warnings and the affected module/API/page/entity/event/search/agent registrations.
2. Standalone unit and command tests use the scaffold's Jest setup, never Vitest. When the standalone `tsconfig` does not declare Jest types, explicitly import `describe`, `it`/`test`, `expect`, and `jest` from `@jest/globals`; passing typecheck requires this, and a focused runner must discover and execute the file. Keep hooks void (`beforeEach(() => { jest.clearAllMocks() })`, not an expression callback that returns `Jest`), give framework mocks their complete callable signatures instead of relying on zero-argument `jest.fn()` inference, and pass the handler's full `{ input, logEntry, ctx }` object to `undo`. Put command behavior/undo tests under `commands/__tests__/`, run focused command/API/component tests, then `yarn typecheck`, `yarn lint`, and the smallest applicable build/test gate. Do not stop with a known TypeScript diagnostic in either implementation or test code.
3. Create fixtures through APIs for two tenants/organizations and clean them in `finally`.
4. Exercise list/detail/create/update/clear/delete, invalid input, denied/wildcard ACL, stale versions, and empty/error UI states.
5. Exercise every optional surface actually added: search reindex, subscriber retry, worker restart/progress, cache invalidation, notification, CLI compiled path, portal/public auth.
6. Disable optional peers in a test and verify defined degraded behavior.
7. If package paths changed, pack/install into a disposable standalone consumer and rerun generation/build.

Do not count generated files or screenshots alone as behavioral proof.
