# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T00:45:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.12 **complete**. A new
`packages/ai-assistant/src/modules/ai_assistant/workers/ai-pending-action-cleanup.ts`
periodically sweeps `AiPendingAction` rows whose TTL elapsed without a
confirm/cancel touch, flipping them `pending → expired` via the Step
5.5 repo's state-machine guard and emitting
`ai.action.expired` through the Step 5.11 typed helper. A
`run-pending-action-cleanup` CLI subcommand lets operators invoke it
manually, and `setup.ts` registers a system-scope 5-minute interval
schedule via `schedulerService.register` (stable id
`ai_assistant:pending-action-cleanup`, upsert = idempotent across
tenants).
**Last commit (code):** `4fc11ed48` — `feat(ai-assistant): cleanup worker for expired pending actions with typed expired event (Phase 3 WS-C)`

## What just happened

- **New worker** `packages/ai-assistant/src/modules/ai_assistant/workers/ai-pending-action-cleanup.ts`:
  - `metadata = { queue: 'ai-pending-action-cleanup', id: 'ai_assistant:cleanup-expired-pending-actions', concurrency: 1 }`.
  - Discovers tenants via a narrow native `select distinct tenant_id, organization_id from ai_pending_actions where status = 'pending' and expires_at < ?`
    query (no row contents read — only scoping keys). Injection seam
    `discoverTenants` keeps the test suite container-free.
  - Per tenant, loops `AiPendingActionRepository.listExpired` at
    `pageSize = 100` until the queue drains (capped at
    `MAX_PAGES_PER_TENANT = 50` to prevent runaway sweeps — the next
    scheduled tick picks up any leftovers).
  - Each row: `repo.setStatus(row.id, 'expired', { tenantId, organizationId, userId: null }, { resolvedByUserId: null, now })`.
    Race safety: if the state-machine guard rejects the transition via
    `AiPendingActionStateError`, the worker catches, logs (info), and
    skips WITHOUT emitting — the winning path (confirm/cancel) already
    emitted the canonical signal. Generic errors log + continue, they
    never abort the batch.
  - Successful flips emit `ai.action.expired` via the Step 5.11
    `emitAiAssistantEvent` helper with `resolvedByUserId: null`,
    `expiresAt`, and `expiredAt` — the payload distinguishes
    worker-driven expirations from cancel-helper TTL short-circuits.
  - Default export handler resolves `em` from DI and calls
    `runPendingActionCleanup({ em })`; the pure helper is testable
    without a queue context.
- **New CLI subcommand** `yarn mercato ai_assistant run-pending-action-cleanup`
  bootstraps DI, resolves `em`, invokes `runPendingActionCleanup`, and
  prints the `{ tenantsScanned, rowsProcessed, rowsExpired, rowsSkipped, rowsErrored }`
  summary. Useful for operator ad-hoc sweeps + integration smoke.
- **Scheduler wiring** in `packages/ai-assistant/src/modules/ai_assistant/setup.ts`:
  `seedDefaults` calls `ensurePendingActionCleanupSchedule(container)`
  which resolves `schedulerService` via DI (optional — if the scheduler
  module is disabled the call is a no-op) and registers a
  `scopeType: 'system'` `interval` schedule targeting queue
  `ai-pending-action-cleanup`. Stable id
  `ai_assistant:pending-action-cleanup`, `scheduleValue: '5m'`,
  `sourceType: 'module'`, `sourceModule: 'ai_assistant'`. Because
  `schedulerService.register` is an upsert keyed by `id`, re-running
  `seedDefaults` for every tenant leaves a single system-scope row.
- **New unit suite** `src/modules/ai_assistant/workers/__tests__/ai-pending-action-cleanup.test.ts`
  (7 tests): happy path (3 expired → 3 setStatus + 3 emits);
  race-safe (concurrent `AiPendingActionStateError` → skip without
  emit); pagination (5 rows at `pageSize = 2` → 3 listExpired calls,
  5 emits); cross-tenant (tenant-alpha + tenant-beta both processed
  with correct scope); zero-expired (no listExpired, no setStatus, no
  emit); single-row generic error (continues batch, emits for good
  rows only); already-expired idempotency (listExpired filters them
  out, setStatus never called).
- **AGENTS.md** (`packages/ai-assistant/AGENTS.md`) grew a Workers
  section documenting the new worker, its race-safety contract, the
  CLI subcommand, and the 5-minute system-scope schedule.

## Test + gate results

- **Tests**: ai-assistant 46/518 → **47/525** (+1 suite / +7 tests);
  core 338/3094 preserved; ui 65/348 preserved.
- **Typecheck**: `yarn turbo run typecheck --filter=@open-mercato/core
  --filter=@open-mercato/app --force` clean; `yarn build` of
  `@open-mercato/ai-assistant` clean (143 entry points; the package has
  no typecheck script — ts-jest + build gate the TS).
- **Generator**: `yarn generate` green; the worker now appears in
  `apps/mercato/.mercato/generated/modules.generated.ts` as
  `{ id: "ai_assistant:cleanup-expired-pending-actions", queue: "ai-pending-action-cleanup", concurrency: 1, ... }`.
- **i18n**: `yarn i18n:check-sync` green — no user-facing strings.

## BC posture (production inventory)

- **Additive only.** New worker file, new queue name, new stable
  scheduler id, new CLI subcommand. No existing event id renamed — the
  `ai.action.expired` event was declared in Step 5.11 and its payload
  is extended only through already-optional fields (`expiresAt`,
  `expiredAt` — both declared in 5.11). No DB schema change; the
  entity and migration remain from Step 5.5. No DI registration
  renamed; the worker reuses `em` and the optional `schedulerService`.

## Open follow-ups carried forward

- **Step 5.13** — first mutation-capable agent flow (candidate
  `customers.account_assistant` for deal-stage updates) end-to-end on
  the pending-action contract.
- **Step 5.14** — D18 catalog mutation tools batch + single-approval
  flow.
- **Dispatcher UI-part flushing** — still on the Step 5.10 backlog.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred.
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — carried from Step 5.5.
- **Dev-env integration test for the cleanup worker** — gated on the
  coordinator's next checkpoint batch (needs Postgres + scheduler
  runtime). The unit suite covers the decision logic; an integration
  test that seeds a pending action via the repo, rewinds `expiresAt`
  in SQL, runs the CLI subcommand, and asserts the row flipped is the
  natural follow-up.

## Next concrete action

- **Step 5.13** — first mutation-capable agent flow. Candidate
  `customers.account_assistant` driving deal-stage updates through the
  pending-action contract. The agent needs: (1) an `isMutation: true`
  tool schema that pipes through the Step 5.6 `prepareMutation` wrapper,
  (2) a mutation policy (Step 5.4) declaring the allowed stage
  transitions as `allowList`, (3) concrete field-diff rendering in
  the Step 5.10 UI parts keyed on the `deal.stage` column, (4) an
  end-to-end integration test that walks a conversational "move DealX
  to won" → Preview → Confirm → `deals.updated` event → DataTable
  refresh. Must honour the state-machine contract: Preview → Confirm
  → Executing → {Confirmed | Failed}, and the Step 5.8 server-side
  re-check (stale-version refusal).

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 5.5 (`checkpoint-5step-after-5.5.md`); Steps 5.6–5.12 are the
  7 Steps since. **Coordinator should run the checkpoint batch after
  5.12** so the full validation gate + integration suites + ds-guardian
  sweep cover the new routes, the four UI parts, the typed events, and
  the cleanup worker + scheduler entry in one pass.
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C: 5.5 + 5.6 + 5.7 + 5.8 + 5.9 + 5.10 + 5.11 + 5.12 done;
  5.13–5.14 remaining.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.13
  validation. The new worker is picked up at generator time; a
  dev-server restart is NOT required for the unit gate, but IS needed
  before the scheduler actually enqueues the first sweep (the existing
  runtime won't notice the new system-scope schedule row until it
  re-seeds / reboots, which is fine for this async polish Step).
- Database / migration state: no migration in this Step. Step 5.5's
  `Migration20260419134235_ai_assistant` remains the active delta.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`);
  ai-assistant gated by build + ts-jest.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s) —
  unchanged. The worker reads nothing explicit from it — the repo's
  `expires_at` comparison against `now()` is the sole input.
- Scheduler runtime: `QUEUE_STRATEGY=local` in dev polls every 30s;
  the 5m interval schedule wakes the worker every ~5 min. Production
  with `QUEUE_STRATEGY=async` uses BullMQ's repeatable jobs via the
  scheduler's sync path.

## State-machine guard note for executors

The repo throws `AiPendingActionStateError` (NOT a generic error with
`code === 'invalid_status'`) when a transition is rejected. The
cleanup worker keys off `error instanceof AiPendingActionStateError`
for the race-safe skip branch. If a future Step adds new terminal
statuses, update the error-class check — do NOT replace it with string
matching on `error.code` (the class also exposes `from` / `to`
properties the log line uses).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
