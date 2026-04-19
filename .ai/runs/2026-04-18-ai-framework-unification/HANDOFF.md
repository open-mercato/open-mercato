# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T23:30:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.11 **complete**. A new
`packages/ai-assistant/src/modules/ai_assistant/events.ts` declares the
three FROZEN pending-action lifecycle events
(`ai.action.confirmed`, `ai.action.cancelled`, `ai.action.expired`)
via `createModuleEvents({ moduleId: 'ai_assistant', events })`. Both
Step 5.8 (`executePendingActionConfirm`) and Step 5.9
(`executePendingActionCancel`) now emit through the typed
`emitAiAssistantEvent` helper; the `TODO(step 5.11)` markers on both
call sites are gone. Typed payload interfaces
(`AiActionConfirmedPayload` / `AiActionCancelledPayload` /
`AiActionExpiredPayload`) live alongside the declarations and are
consumed by the unit suites so future drift surfaces as a test
failure. `yarn generate` picks the module up automatically
(`EVENTS_ai_assistant_1223` in `apps/mercato/.mercato/generated/events.generated.ts`).
**Last commit (code):** `26e304f29` — `feat(ai-assistant): declare typed ai.action.* events + migrate confirm/cancel emissions (Phase 3 WS-C)`

## What just happened

- **New events module** `packages/ai-assistant/src/modules/ai_assistant/events.ts`:
  - `eventsConfig` built via `createModuleEvents({ moduleId: 'ai_assistant', events })`.
  - Three entries, all `category: 'system'`, `entity: 'ai_pending_action'`:
    `ai.action.confirmed`, `ai.action.cancelled`, `ai.action.expired`.
  - Typed exports: `emitAiAssistantEvent` (helper), `AiAssistantEventId`
    (union type), `AiActionConfirmedPayload`, `AiActionCancelledPayload`,
    `AiActionExpiredPayload`.
- **Emission swap** at the two Step 5.8 / 5.9 call sites:
  - `lib/pending-action-executor.ts` now imports `emitAiAssistantEvent`
    and routes `ai.action.confirmed` emissions through a
    `defaultConfirmedEmitter` that calls the typed helper with
    `{ persistent: true }`. The old `container.resolve('eventBus')`
    path is gone; the injection seam on `PendingActionExecuteInput`
    was renamed from `eventBus?` to a typed `emitEvent?: ConfirmedEmitter`
    so the unit suite can still assert emission without the global bus.
  - `lib/pending-action-cancel.ts` does the same for
    `ai.action.cancelled` + `ai.action.expired`, with a shared
    `CancelEmitter` type that covers both ids. Additive payload
    extensions (all zero-impact): cancelled now carries an optional
    `reason`, expired carries `expiresAt` + `expiredAt`.
  - Both `TODO(step 5.11)` markers are deleted; the cancel helper's
    module doc-comment is updated to drop the "Step 5.11 will migrate"
    line.
- **New unit suite** `src/modules/ai_assistant/__tests__/events.test.ts`
  (6 tests): FROZEN-id declaration assertion, category/entity
  consistency assertion, typed forwarding verified for each of the
  three events (calls `setGlobalEventBus` with a spy, awaits
  `emitAiAssistantEvent`, asserts the spy receives `(id, payload,
  options)` verbatim), and an undeclared-id safety-net test asserting
  the factory logs an error through `console.error` in non-strict mode.
- **Existing unit suites updated** so the mock assertions target the
  new typed `emitEvent` helper rather than the raw-bus `emitEvent` id:
  - `lib/__tests__/pending-action-executor.test.ts` (happy path,
    handler-throw, idempotent, partial-stale — 4 tests touched, 0
    removed).
  - `lib/__tests__/pending-action-cancel.test.ts` (5 tests touched,
    explicit payload-shape assertions added for cancelled + expired).
  - `api/ai/actions/[id]/cancel/__tests__/route.test.ts` installs a
    global event bus via `setGlobalEventBus` so its emitted-id
    assertions stay green now that the helper bypasses the DI
    container.
- **AGENTS.md** (`packages/ai-assistant/AGENTS.md`) grew a short Events
  section documenting the three typed ids, their payload shapes, and
  the FROZEN status (one short paragraph inserted immediately after
  Permissions (ACL) and before the OpenCode Client rules).
- **Generator** picks up the new module automatically — the generated
  events registry (`apps/mercato/.mercato/generated/events.generated.ts`)
  now imports `EVENTS_ai_assistant_1223 from
  "@open-mercato/ai-assistant/modules/ai_assistant/events"` alongside
  the other 28 event modules. Runtime registration wires the three ids
  into the global declaration set.

## Test + gate results

- **Tests**: ai-assistant 45/512 → **46/518** (+1 suite / +6 tests);
  core 338/3094 preserved; ui 65/348 preserved.
- **Typecheck**: `yarn turbo run typecheck --filter=@open-mercato/ai-assistant
  --filter=@open-mercato/core --filter=@open-mercato/app` clean
  (ai-assistant has no typecheck script — ts-jest gates TS).
- **Generator**: `yarn generate` green; no drift beyond the new
  `EVENTS_ai_assistant_1223` import.
- **i18n**: `yarn i18n:check-sync` green — no user-facing strings.

## BC posture (production inventory)

- **Additive only.** Event ids are FROZEN and unchanged. Payload
  additions (`cancelled.reason?`, `expired.expiresAt` + `expired.expiredAt`)
  are optional — no existing field removed or narrowed. The helper
  `emitEvent?` seam replaces the previous `eventBus?` seam; the only
  in-codebase callers are the two routes (default path) and the three
  test files (updated). No external consumer relied on the raw bus
  seam.
- **DI service names**: the `eventBus` registration is untouched. The
  cancel + confirm helpers no longer resolve it, but other modules
  still do — registration is preserved.

## Open follow-ups carried forward

- **Step 5.12** — cleanup worker sweeping `status='pending' AND
  expiresAt < now` → `expired` + emit `ai.action.expired` via the
  typed helper landed in 5.11. No events.ts edit required.
- **Step 5.13** — first mutation-capable agent flow
  (`customers.account_assistant` deal-stage updates).
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

## Next concrete action

- **Step 5.12** — cleanup worker sweeping expired pending actions.
  Implement a `workers/ai-pending-action-expire.ts` (or similar)
  declaring `metadata.queue` via the existing queue convention, iterate
  `AiPendingActionRepository` rows with `status='pending' AND
  expiresAt < now`, flip each to `expired` via `repo.setStatus`, and
  emit `ai.action.expired` via `emitAiAssistantEvent` (already
  declared in 5.11). Scheduler wiring: register the worker in the
  scheduled-jobs registry (same pattern the other lifecycle workers
  use). Idempotent: running the worker twice on the same row must be
  a no-op. The typed `emitAiAssistantEvent` payload interface
  (`AiActionExpiredPayload`) already carries `expiresAt` + `expiredAt`
  so the worker can distinguish "just expired now" from "expired
  earlier but never swept" in subscribers without a second lookup.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 5.5 (`checkpoint-5step-after-5.5.md`); Steps 5.6–5.11 are the
  6 Steps since. **Coordinator should run the checkpoint batch after
  5.11** so the full validation gate + integration suites + ds-guardian
  sweep cover the new routes, the four UI parts, and the typed events
  in one pass.
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C: 5.5 + 5.6 + 5.7 + 5.8 + 5.9 + 5.10 + 5.11 done; 5.12–5.14
  remaining.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.12
  validation. No dev-server restart required for Step 5.11 (the new
  module is picked up at generator time; the server will re-register
  the event ids on next restart but the existing routes kept working
  through the whole swap).
- Database / migration state: no migration in this Step. Step 5.5's
  `Migration20260419134235_ai_assistant` remains the active delta.
- Typecheck clean (`@open-mercato/ai-assistant` + `@open-mercato/core` +
  `@open-mercato/app`); the ai-assistant package still has no
  `typecheck` script — its Jest suite acts as the TS gate via
  `ts-jest`.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s).
  Unchanged. Step 5.12 will read it.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
