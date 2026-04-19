# Step 5.12 — Cleanup worker sweeping expired pending actions — Checks

**Code commit:** `4fc11ed48`
**Docs-flip commit:** _(this commit)_
**Branch:** `feat/ai-framework-unification`
**Worktree:** `/Users/piotrkarwatka/Projects/mercato-development` (documented dogfood exception)

## Files touched

### Created

- `packages/ai-assistant/src/modules/ai_assistant/workers/ai-pending-action-cleanup.ts`
  - `metadata = { queue: 'ai-pending-action-cleanup', id: 'ai_assistant:cleanup-expired-pending-actions', concurrency: 1 }`.
  - Exports `runPendingActionCleanup(options)` for CLI + test use; default
    handler resolves `em` from the DI container and calls the helper.
  - Tenant discovery: narrow native SELECT on `ai_pending_actions`
    (distinct `tenant_id` / `organization_id` where `status = 'pending' AND expires_at < ?`).
    Injectable via `discoverTenants` for unit tests.
  - Per-tenant loop: `repo.listExpired(...)` at `pageSize = 100`,
    bounded by `MAX_PAGES_PER_TENANT = 50`, until the page returns
    fewer rows than the page size.
  - Per-row: `repo.setStatus(row.id, 'expired', { tenantId, organizationId, userId: null }, { resolvedByUserId: null, now })`.
    Emit `ai.action.expired` via `emitAiAssistantEvent` on success.
    Race-safety branch: `error instanceof AiPendingActionStateError` →
    log info + skip + do NOT emit (the winning concurrent path already
    emitted the canonical signal). Generic errors log + continue.
- `packages/ai-assistant/src/modules/ai_assistant/workers/__tests__/ai-pending-action-cleanup.test.ts`
  - 7 tests: happy path, race-safe, pagination, cross-tenant,
    zero-expired, single-row generic error, already-expired idempotency.

### Modified

- `packages/ai-assistant/src/modules/ai_assistant/cli.ts`
  - New `run-pending-action-cleanup` subcommand.
- `packages/ai-assistant/src/modules/ai_assistant/setup.ts`
  - New `seedDefaults` hook that resolves `schedulerService` via DI
    and upserts the system-scope 5-minute interval schedule entry
    with stable id `ai_assistant:pending-action-cleanup`. Fails soft
    when the scheduler module is disabled.
- `packages/ai-assistant/AGENTS.md`
  - New Workers section documenting the worker, race-safety contract,
    CLI subcommand, and the 5-minute system-scope schedule.

## Gate results

| Gate | Command | Result |
|------|---------|--------|
| ai-assistant unit tests | `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit` | **47 suites / 525 tests** (baseline 46/518; +1/+7 for the new worker suite) |
| core unit tests | `cd packages/core && npx jest --config=jest.config.cjs --forceExit` | **338/3094 preserved** |
| ui unit tests | `cd packages/ui && npx jest --config=jest.config.cjs --forceExit` | **65/348 preserved** |
| Typecheck (forced) | `yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app --force` | **clean** |
| ai-assistant build (acts as typecheck — no `typecheck` script) | `cd packages/ai-assistant && yarn build` | **143 entry points built** |
| Generator | `yarn generate` | **clean**; worker now in `apps/mercato/.mercato/generated/modules.generated.ts` as `ai_assistant:cleanup-expired-pending-actions` |
| i18n sync | `yarn i18n:check-sync` | **all 4 locales in sync** |

## Unit suite coverage matrix

| Case | Assertion |
|------|-----------|
| Happy path (3 expired rows) | 3 `setStatus('expired')` calls + 3 `ai.action.expired` emits; summary `{ rowsExpired: 3, rowsSkipped: 0, rowsErrored: 0 }` |
| Race-safe | Row that throws `AiPendingActionStateError` from `setStatus` is caught + logged + skipped; emit count = 2 (for the other two rows only) |
| Pagination | 5 rows at `pageSize = 2` → 3 `listExpired` calls (pages of 2, 2, 1); 5 emits |
| Cross-tenant | Rows under `tenant-alpha` AND `tenant-beta` both get processed with correct tenant scope propagated into `setStatus` extras |
| Zero-expired | Empty tenant list → `listExpired` NOT called; `setStatus` NOT called; 0 emits |
| Single-row generic error | 1 row throws `Error('boom-…')`; batch continues; the other 2 rows emit; summary `{ rowsExpired: 2, rowsErrored: 1 }` |
| Idempotency | Rows already `status = 'expired'` are filtered out by `listExpired`; `setStatus` NOT called; 0 emits |

## Decisions / blockers

- **Scheduler hookup convention followed**: `schedulerService.register`
  with `scopeType: 'system'`, `scheduleType: 'interval'`,
  `scheduleValue: '5m'`, `sourceType: 'module'`, stable id
  `ai_assistant:pending-action-cleanup`. Registration happens from
  `setup.ts` `seedDefaults` (NOT `onTenantCreated` — the latter's
  context doesn't carry the DI container). Same API shape that
  `core/src/modules/data_sync/lib/sync-schedule-service.ts` uses.
  `register()` is upsert-by-id so seeding per tenant stays idempotent.
- **CLI subcommand landed**: `yarn mercato ai_assistant run-pending-action-cleanup`
  prints the `{ tenantsScanned, rowsProcessed, rowsExpired, rowsSkipped, rowsErrored }`
  summary. Useful for operator ad-hoc sweeps and integration smoke.
- **State-machine guard key**: the brief hinted at
  `AiPendingActionStateError.code === 'invalid_status'`. The actual
  class code is `'ai_pending_action_invalid_transition'` — the worker
  keys off `error instanceof AiPendingActionStateError` instead, which
  is the correct class-based check and also preserves access to the
  `from` / `to` properties for the log line. No other sentinel values
  on the class match the brief's text.
- **Integration test deferred**: the optional integration spec
  (seed a pending action, rewind `expires_at` in SQL, run the CLI,
  assert the row flipped) requires live Postgres + the scheduler
  runtime. Gated on the next coordinator checkpoint batch. The unit
  suite exhaustively covers the decision logic.

## BC posture

- **Additive only.** New worker file, new queue name, new stable
  scheduler id, new CLI subcommand. No existing event id renamed; no
  DB schema change; no migration; no DI registration renamed; no
  existing entity modified. The `ai.action.expired` event was declared
  in Step 5.11 and its payload is untouched — the worker emits exactly
  the shape the cancel-helper TTL short-circuit already emits.

## Hard-rule deviations

None.
