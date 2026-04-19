# Step 5.9 — verification notes

**Commit (code):** `6ee59d877` —
`feat(ai-assistant): POST /api/ai/actions/:id/cancel route + idempotent cancel helper (Phase 3 WS-C)`

## Scope

Lands the cancel half of the Phase 3 WS-C mutation approval gate
(spec §9.4, Step 5.9). The route flips a pending action from
`pending → cancelled` and emits `ai.action.cancelled`. The wrapped
tool handler is NEVER invoked — cancellation is a pure state-machine
transition plus an event emission, so the route reuses only the
`status + expiry` guard from the Step 5.8 recheck helper.

## Files

- `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/cancel/route.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/cancel/__tests__/route.test.ts` (new, 14 tests)
- `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-cancel.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/pending-action-cancel.test.ts` (new, 5 tests)
- `packages/ai-assistant/src/index.ts` — barrel: + `executePendingActionCancel`,
  + `PENDING_ACTION_CANCELLED_EVENT_ID`, + `PENDING_ACTION_EXPIRED_EVENT_ID`,
  + the cancel helper's type aliases.

## Contract summary

### Route order of operations

1. `getAuthFromRequest(req)` (framework guard → 401 if missing).
2. `idParamSchema` on `{ id }` → 400 on non-string / empty / >128 chars.
3. `bodySchema` on the optional JSON body. `{ reason?: string }` with
   a 500-char max, `.strict()` rejects unknown fields. Invalid JSON
   or unknown-field rejection → 400 `validation_error`.
4. `hasRequiredFeatures(['ai_assistant.view'], ...)` → 403 `forbidden`
   if missing.
5. Missing `auth.tenantId` → 404 `pending_action_not_found` (never
   leak cross-tenant existence).
6. `AiPendingActionRepository.getById(id, { tenantId, organizationId })`
   → 404 `pending_action_not_found` on unknown / cross-tenant.
7. **Idempotency short-circuit**: `row.status === 'cancelled'` →
   200 + `serializePendingActionForClient(row)` + NO event emission.
   This runs BEFORE the recheck helper so the eventBus is touched
   zero times on replay.
8. `checkStatusAndExpiry(row)` from Step 5.8's `pending-action-recheck.ts`:
   - `confirmed` / `executing` / `failed` → 409 `invalid_status`.
   - `expiresAt <= now` → delegate to `executePendingActionCancel`
     which flips the row to `expired` and emits `ai.action.expired`
     (race-safe with the Step 5.12 worker), then return
     409 `{ code: 'expired', pendingAction: <SerializedPendingAction status=expired> }`.
9. Happy path: `executePendingActionCancel({ action, ctx, reason })`
   atomically runs `repo.setStatus(id, 'cancelled', { resolvedByUserId, executionResult: { error: { code: 'cancelled_by_user', message } } })`
   + emits `ai.action.cancelled`. Response:
   200 + `{ ok: true, pendingAction: <SerializedPendingAction status=cancelled> }`.

### Response shapes

- 200 cancel success:
  ```
  { ok: true, pendingAction: <SerializedPendingAction status=cancelled> }
  ```
- 200 idempotent replay (already cancelled):
  ```
  { ok: true, pendingAction: <SerializedPendingAction status=cancelled> }
  ```
  The eventBus is NOT touched on this path.
- 400 `{ error, code: 'validation_error', issues }` — invalid id,
  invalid JSON body, reason >500 chars, unknown body field.
- 401 `{ error, code: 'unauthenticated' }` — framework guard.
- 403 `{ error, code: 'forbidden' }` — caller lacks `ai_assistant.view`.
- 404 `{ error, code: 'pending_action_not_found' }` — unknown id /
  cross-tenant id / caller lacks tenant scope (single 404 on purpose
  to prevent id enumeration across tenants).
- 409 `{ error, code: 'invalid_status' }` — terminal row (`confirmed`
  / `executing` / `failed`).
- 409 `{ error, code: 'expired', pendingAction: <status=expired> }` —
  TTL exceeded; the row has been flipped to `expired` and
  `ai.action.expired` has been emitted.
- 500 `{ error, code: 'cancel_internal_error' }` — unexpected failure;
  the original cause is logged.

## Idempotency policy

**Decision: 200 + current row on double-cancel, not 409.** Cancellation
is a user-visible terminal state. Asking the operator to distinguish
"I clicked cancel twice" from "somebody else already cancelled" via a
409 would add friction for no value. The contract matches the confirm
route's idempotent-replay semantics (which return 200 + the prior
`executionResult` on a second confirm).

**Event-emission suppression.** Two independent guards ensure zero
re-emission on the idempotent path:

1. The route short-circuits on `row.status === 'cancelled'` BEFORE
   delegating to `executePendingActionCancel`. The cancel helper is
   never invoked → the eventBus is never touched.
2. The helper itself carries `if (action.status === 'cancelled') return { row, status: 'cancelled' }`
   as a second-line defence. A future caller that uses the helper
   directly without the route's pre-check still gets idempotent
   behavior.

The route unit test `idempotent: second cancel on cancelled row returns
200 + same row without re-emitting event` asserts BOTH the response
(`status === 'cancelled'`, `ok: true`) AND the mocked eventBus call
count (zero).

## Reason-field validation edge cases

- **Length cap**: `z.string().max(500).optional()` at the body level.
  A 500-char reason is persisted verbatim; a 501-char reason is
  rejected at the zod layer with 400 `validation_error`.
- **Whitespace handling**: the cancel helper calls `reason.trim()`
  before deciding the persisted message. A whitespace-only reason
  (`"   \t\n  "`) collapses to empty after trim and falls back to the
  default `Cancelled by user` message rather than persisting the raw
  whitespace onto `executionResult.error.message`.
- **Unknown-field rejection**: `.strict()` on the body object rejects
  `{ reason: 'ok', evil: 'payload' }` with 400 `validation_error`. A
  future field rename surfaces as a 400 instead of silent-drop.
- **Empty body**: a missing body (no `content-type`, empty string, or
  `undefined`) is accepted — the reason falls back to the default
  message. Covered by the `accepts an empty body (no reason)` test.
- **Invalid JSON**: malformed JSON (`{ badtoken`) is caught in the
  route's `readRequestBody` helper and surfaced as 400
  `validation_error` with a "Invalid JSON body" message.

## Expired-vs-cancelled policy

A row whose TTL has elapsed MUST NOT be labelled "cancelled". The
cancel helper flips such rows to `expired` via `repo.setStatus(..., 'expired')`
and emits `ai.action.expired` rather than `ai.action.cancelled`. The
route returns 409 with `code: 'expired'` and includes the serialized
(now-`expired`) row in the body so the UI can update the row's status
in place without a second GET round trip.

This is race-safe with the Step 5.12 cleanup worker: both paths use
`repo.setStatus(..., 'expired')` which the Step 5.5 repo guards with
`AI_PENDING_ACTION_ALLOWED_TRANSITIONS[pending] ⊇ ['expired']` inside
`em.transactional`. If 5.12 flips the row first, the cancel route's
`checkStatusAndExpiry` returns `invalid_status` (the row is no longer
`pending`) and the route returns 409 `invalid_status` — still a 409,
still terminal, still visible to the operator.

## Event emission

Emits `ai.action.cancelled` via `container.resolve('eventBus')` with
the payload:
```
{ pendingActionId, agentId, toolName, status, tenantId, organizationId,
  userId, resolvedByUserId, resolvedAt, executionResult }
```
The expired branch emits `ai.action.expired` with the same shape
minus `executionResult` (`resolvedByUserId` is null). Both use raw
literal event ids with `TODO(step 5.11)` markers; Step 5.11 will
replace the emission sites with `createModuleEvents`-typed calls in
one sweep alongside the confirm route's Step 5.8 marker.

## Reuse of Step 5.8 recheck helper

The route imports `checkStatusAndExpiry` directly from
`packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-recheck.ts`.
No re-implementation. The rest of the Step 5.8 guards (agent /
features / tool whitelist / attachments / record-version) are
confirm-only and remain untouched.

## Unit tests

- `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit`
  → **45 / 512 passed** (baseline 43 / 493, delta +2 suites / +19 tests).
  - `cancel/__tests__/route.test.ts` — 14 tests (happy 200 cancel with
    reason, idempotent double-cancel without re-emit, 409 expired with
    flip-to-expired + `ai.action.expired`, three 409 `invalid_status`
    branches for `confirmed` / `executing` / `failed`, 404 cross-
    tenant, 403 `forbidden`, whitespace-only reason collapses to
    default message, 400 `validation_error` on 501-char reason, 400 on
    unknown body fields, empty body accepted, 500 `cancel_internal_error`,
    401 via framework guard).
  - `lib/__tests__/pending-action-cancel.test.ts` — 5 tests (atomic
    `pending → cancelled` + `ai.action.cancelled` emit, default reason
    fallback, idempotent already-cancelled short-circuit, expired
    short-circuit with `ai.action.expired`, eventBus failure
    swallowed without failing the cancel).
- `cd packages/core && npx jest --config=jest.config.cjs --forceExit`
  → **338 / 3094 passed** (baseline preserved).
- `cd packages/ui && npx jest --config=jest.config.cjs --forceExit`
  → **60 / 328 passed** (baseline preserved).

## Typecheck

- `yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app`
  → clean (core + app cache-hits; ai-assistant has no `typecheck`
  script by design — its Jest suite is the TS gate via `ts-jest`).
- `yarn turbo run typecheck --filter=@open-mercato/app --force` → clean.

## Generator

- `yarn generate` → OpenAPI bundle rebuilt.
- Confirmed the new operation is present:
  - path: `/api/ai_assistant/ai/actions/{id}/cancel`
  - operationId: `aiAssistantCancelPendingAction`
  - `grep -c "aiAssistantCancelPendingAction" apps/mercato/.mercato/generated/openapi.generated.json` → `1`.
- `yarn i18n:check-sync` → green (no new user-facing strings on the
  server side — UI-side confirmation / cancellation messaging lands
  in Step 5.10).

## BC posture

- Additive only: new route path, new pure-function library, new
  barrel exports. No changes to the Step 5.5 entity / migration or
  the Step 5.7 GET / Step 5.8 confirm routes.
- The repository's `setStatus(..., 'cancelled' | 'expired', { executionResult, resolvedByUserId })`
  signature already supported the fields needed by this Step; no
  signature change was required.
- `serializePendingActionForClient` already covers `executionResult`
  + `resolvedAt` + `resolvedByUserId`; no serializer change required.
- The Step 5.8 `checkStatusAndExpiry` export from
  `pending-action-recheck.ts` is reused verbatim; the Step 5.8 doc
  explicitly anticipated this reuse.

## Deviations

- None.
