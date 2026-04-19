# Step 5.11 — Validation Checks

**Step id:** 5.11
**Step title:** Spec Phase 3 WS-C — Typed `ai.action.confirmed` / `ai.action.cancelled` / `ai.action.expired` events via `createModuleEvents`
**Code commit:** `26e304f29`

## Files created / touched

- **Created**
  - `packages/ai-assistant/src/modules/ai_assistant/events.ts` — typed `eventsConfig` via `createModuleEvents({ moduleId: 'ai_assistant', events })`, exports `emitAiAssistantEvent`, `AiAssistantEventId`, and `AiActionConfirmedPayload` / `AiActionCancelledPayload` / `AiActionExpiredPayload` interfaces.
  - `packages/ai-assistant/src/modules/ai_assistant/__tests__/events.test.ts` — 6 new tests (FROZEN-id declaration, category/entity consistency, typed forwarding for each of the three events, undeclared-id safety-net).
- **Modified**
  - `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-executor.ts` — replaced `container.resolve('eventBus').emitEvent('ai.action.confirmed', …)` with the typed `emitAiAssistantEvent` helper; kept a typed `emitEvent?: ConfirmedEmitter` injection seam; deleted the `TODO(step 5.11)` marker.
  - `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-cancel.ts` — same swap for `ai.action.cancelled` + `ai.action.expired`; cancelled payload now carries an optional `reason`; expired payload now carries `expiresAt` + `expiredAt` (both additive); deleted the `TODO(step 5.11)` marker and the "will migrate" doc-line.
  - `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/pending-action-executor.test.ts` — tests now assert on the typed `emitEvent` helper call tuple + payload shape.
  - `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/pending-action-cancel.test.ts` — same migration; added explicit payload-shape assertions for confirmed / cancelled / expired.
  - `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/cancel/__tests__/route.test.ts` — installs a global event bus via `setGlobalEventBus` so its emitted-id assertions continue to work now that the helper bypasses the DI container.
  - `packages/ai-assistant/AGENTS.md` — new Events section documenting the three typed ids + payload shapes + FROZEN status (one short paragraph).

## Test results

| Package | Before | After | Delta |
|---------|--------|-------|-------|
| ai-assistant | 45 suites / 512 tests | **46 suites / 518 tests** | +1 suite / +6 tests |
| core | 338 suites / 3094 tests | 338 suites / 3094 tests | 0 |
| ui | 65 suites / 348 tests | 65 suites / 348 tests | 0 |

Run commands:

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
  → Test Suites: 46 passed, 46 total
  → Tests:       518 passed, 518 total

cd packages/core && npx jest --config=jest.config.cjs --forceExit
  → Test Suites: 338 passed, 338 total
  → Tests:       3094 passed, 3094 total

cd packages/ui && npx jest --config=jest.config.cjs --forceExit
  → Test Suites: 65 passed, 65 total
  → Tests:       348 passed, 348 total
```

### Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app
  → Tasks: 2 successful, 2 total (cached)
  → Note: @open-mercato/ai-assistant has no typecheck script; ts-jest acts as the TS gate (all 46 suites green).
```

### Generator

```
yarn generate
  → All generators completed.
  → Structural cache purged for all tenants.
  → Generated events.generated.ts now imports
    `EVENTS_ai_assistant_1223 from "@open-mercato/ai-assistant/modules/ai_assistant/events"`
    alongside the other 28 event modules. Runtime registry confirms
    `ai.action.confirmed`, `ai.action.cancelled`, `ai.action.expired`
    appear under moduleId `ai_assistant`.
```

### i18n

```
yarn i18n:check-sync
  → All translation files are in sync.
```

## Key decisions

- Typed emission routes through `emitAiAssistantEvent` + the global event bus (the `createModuleEvents` contract), NOT via `container.resolve('eventBus')`. This tightens the BC envelope to a single canonical emit path per event id and matches every other module using `createModuleEvents` (`sales`, `catalog`, `webhooks`, …).
- Kept a strictly-typed `emitEvent?: CancelEmitter` / `emitEvent?: ConfirmedEmitter` injection seam on the helper inputs so unit suites can assert on emission without reaching into the global-bus module. Default path delegates to `emitAiAssistantEvent` — production behavior is unchanged.
- `ai.action.expired` declared in this Step even though Step 5.12 hasn't shipped yet, because the cancel helper's TTL short-circuit already emits it. Landing the declaration here unblocks 5.12 without forcing a second `events.ts` edit.

## BC posture

- **Additive only.** Contract surfaces touched:
  - Event IDs (§5): unchanged. `ai.action.confirmed` / `ai.action.cancelled` / `ai.action.expired` FROZEN.
  - Event payloads (§5): additive only. `cancelled` gains an optional `reason`; `expired` gains `expiresAt` + `expiredAt`. No existing field removed or narrowed.
  - Function signatures (§3): `PendingActionExecuteInput.eventBus` replaced with `PendingActionExecuteInput.emitEvent` (typed). The only in-codebase callers are the two routes (which use the default path) and three test files (updated in this Step). No external consumer relies on the `eventBus` seam.
  - DI service names (§9): unchanged (`eventBus` registration untouched; the helper no longer consults it, but the registration itself is preserved for other modules).

## Blockers / deviations

- None. Hard-rule compliance: one code commit (`26e304f29`), one docs-flip commit to follow. `in-progress` lock untouched. No PR summary comment posted.
