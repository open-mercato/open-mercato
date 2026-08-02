# Module Verification

Load this reference before claiming a scaffold is complete.

1. Run `yarn generate`; inspect warnings and the affected module/API/page/entity/event/search/agent registrations.
2. Standalone unit and command tests use the scaffold's Jest setup, never Vitest. When the standalone `tsconfig` does not declare Jest types, explicitly import `describe`, `it`/`test`, `expect`, and `jest` from `@jest/globals`; passing typecheck requires this, and a focused runner must discover and execute the file. Keep hooks void (`beforeEach(() => { jest.clearAllMocks() })`, not an expression callback that returns `Jest`), give framework mocks their complete callable signatures instead of relying on zero-argument `jest.fn()` inference, and pass the handler's full `{ input, logEntry, ctx }` object to `undo`. Put command behavior/undo tests under `commands/__tests__/`, run focused command/API/component tests, then `yarn typecheck`, `yarn lint`, and the smallest applicable build/test gate. Do not stop with a known TypeScript diagnostic in either implementation or test code.
3. Create fixtures through APIs for two tenants/organizations and clean them in `finally`.
4. Exercise list/detail/create/update/clear/delete, invalid input, denied/wildcard ACL, stale versions, and empty/error UI states.
5. Exercise every optional surface actually added: search reindex, subscriber retry, worker restart/progress, cache invalidation, notification, CLI compiled path, portal/public auth.
6. Disable optional peers in a test and verify defined degraded behavior.
7. If package paths changed, pack/install into a disposable standalone consumer and rerun generation/build.

Do not count generated files or screenshots alone as behavioral proof.
