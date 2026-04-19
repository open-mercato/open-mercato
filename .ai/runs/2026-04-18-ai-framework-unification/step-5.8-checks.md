# Step 5.8 — verification notes

**Commit (code):** `2f43b615c` —
`feat(ai-assistant): POST /api/ai/actions/:id/confirm with full server-side re-check contract (Phase 3 WS-C)`

## Scope

Lands the confirm half of the Phase 3 WS-C mutation approval gate
(spec §9.4, Step 5.8). The route re-verifies every invariant on the
server before invoking the wrapped tool handler, so an agent cannot
sneak past the preview card by mutating the pending row between
propose and confirm.

## Files

- `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/confirm/route.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/confirm/__tests__/route.test.ts` (new, 14 tests)
- `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-recheck.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/pending-action-recheck.test.ts` (new, 22 tests)
- `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-executor.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/pending-action-executor.test.ts` (new, 4 tests)
- `packages/ai-assistant/src/index.ts` — barrel: + recheck guards (exported
  individually for downstream tests), + `executePendingActionConfirm`, +
  the new re-check / executor types.

## Contract summary (spec §9.4 re-check)

The route runs every guard in this order; first failure short-circuits
with a structured JSON error envelope `{ error, code }`.

1. `checkStatusAndExpiry`
   - status !== 'pending' → 409 `invalid_status`
   - expiresAt <= now → 409 `expired`
2. `checkAgentAndFeatures`
   - agent missing → 404 `agent_unknown`
   - caller lacks agent.requiredFeatures → 403 `agent_features_denied`
3. `checkToolWhitelist`
   - tool missing OR dropped from allowedTools OR `isMutation !== true`
     → 403 `tool_not_whitelisted`
   - effective mutationPolicy resolved via the Step 5.4 helper is
     `read-only` → 403 `read_only_agent`
4. `checkAttachmentScope`
   - any attachment id outside caller's tenant/org → 403
     `attachment_cross_tenant`. The route does NOT leak which id
     specifically; the guard returns a single 403 regardless.
5. `checkRecordVersion`
   - Re-parses `normalizedInput` through the tool's CURRENT
     `inputSchema`. A shape change between propose and confirm returns
     412 `schema_drift` so the model re-proposes. The zod re-parse was
     verified in the unit suite — swapping the tool schema to require a
     field not present on the stored payload produces 412 `schema_drift`.
   - Single-record: if `loadBeforeRecord(...).recordVersion` differs
     from the stored `recordVersion`, returns 412 `stale_version`.
   - Batch: computes per-record. If ALL records are stale, returns 412
     `stale_version`. If SOME are stale, returns `{ ok: true,
     failedRecords: [...] }`. The executor persists those entries via
     `repo.setStatus(..., { failedRecords })` on the confirmed row and
     proceeds with the non-stale subset. The response shape carries the
     `failedRecords` array inside `pendingAction.failedRecords` (the
     serializer already exposes it) and `mutationResult` reflects the
     tool's return for the partial batch.

Only after every guard passes does the state machine advance:
`pending → confirmed → executing` via `repo.setStatus` (each transition
sits inside `em.transactional` in the Step 5.5 repo), then the tool
handler runs OUTSIDE that transaction (see atomicity note below) and
`executing → confirmed` or `executing → failed` persists the outcome.

## Response shapes

- 200 success:
  ```
  { ok: true, pendingAction: <SerializedPendingAction>, mutationResult: { recordId?, commandName? } }
  ```
- 200 handler-failed (confirmation itself succeeded, underlying write
  didn't):
  ```
  { ok: false, pendingAction: <SerializedPendingAction status=failed>, mutationResult: { error: { code: 'handler_error', message } } }
  ```
- 401 `{ error, code: 'unauthenticated' }` — framework guard.
- 403 `{ error, code: 'forbidden' }` — caller lacks `ai_assistant.view`.
- 403 `{ error, code }` — policy/whitelist/attachment failure (codes:
  `agent_features_denied`, `tool_not_whitelisted`, `read_only_agent`,
  `attachment_cross_tenant`).
- 404 `{ error, code: 'agent_unknown' }` — agent missing from registry.
- 404 `{ error, code: 'pending_action_not_found' }` — unknown id /
  cross-tenant id / caller lacks tenant scope (single 404 on purpose
  to prevent id enumeration across tenants).
- 409 `{ error, code: 'invalid_status' | 'expired' }`.
- 412 `{ error, code: 'stale_version', extra: { recordId? | staleRecords?[] } }`
  for record-version drift (single or all-batch-stale).
- 412 `{ error, code: 'schema_drift', extra: { issues } }` for zod
  re-parse failure.
- 500 `{ error, code: 'confirm_internal_error' }` for unexpected
  failures; the original cause is logged.

## Idempotency

Calling the route twice on an already-`confirmed` (or `failed`) row
short-circuits BEFORE the re-check runs and returns the prior
`executionResult` verbatim. The tool handler is never invoked twice;
the unit suite explicitly asserts `handlerSpy` was never called and
`repo.setStatus` was never called on the idempotent path.

## Atomicity decision

Each state-machine transition (`pending → confirmed`,
`confirmed → executing`, `executing → confirmed|failed`) goes through
the Step 5.5 repository's `em.transactional` boundary. That is the
load-bearing atomic unit — a crash mid-transition leaves the row in a
recoverable intermediate state (`executing`) that the operator can
reason about.

The tool handler itself runs OUTSIDE the repo transaction. Holding an
`ai_pending_actions` row lock across a potentially long-running write
(a command that touches many tables) would serialize unrelated
pending-action reads. The handler's own transaction boundary
(typically a Command Pattern invocation) is the unit of atomicity for
the underlying data change. If the handler throws, the row flips to
`failed` with an `executionResult.error`; if the handler succeeds, the
row flips to `confirmed` with `executionResult.recordId` /
`commandName` captured.

A crash between `executing` and the final `confirmed`/`failed` flip
leaves the row in `executing` — the Step 5.12 cleanup worker will
treat this as an operator-recoverable state, not mutate it silently.

## Schema-drift test outcome

The zod re-parse DOES catch a shape change between propose and confirm.
The `checkRecordVersion` guard calls `tool.inputSchema.safeParse(
action.normalizedInput)` before resolving the record-version probe;
swapping the tool's schema in the test fixture from
`{ productId, patch: { title? } }` to `{ productId, newTitle }`
surfaces the stored payload as invalid and the guard returns 412
`schema_drift`. This protects against a tool-schema refactor landing
between propose (when the pending row was written with the old shape)
and confirm (when the runtime has reloaded the new schema).

## Batch partial-stale materialization

The `checkRecordVersion` batch branch produces
`{ ok: true, failedRecords: [{ recordId, error: { code: 'stale_version', message } }] }`
when only some records are stale. The route passes that array into
`executePendingActionConfirm` which writes it onto the first
`setStatus('confirmed', ...)` call via `extra.failedRecords`. The
response body carries it inside `pendingAction.failedRecords` (already
whitelisted by `serializePendingActionForClient`). Only the all-stale
case flips to a 412 response — partial stale is a 200 with the
`failedRecords` sidecar so the UI can render a mixed result card
without a second round trip.

## Event emission

Emits `ai.action.confirmed` via `container.resolve('eventBus')` with
the payload:
```
{ pendingActionId, agentId, toolName, status, tenantId, organizationId,
  userId, resolvedByUserId, resolvedAt, executionResult }
```
Both success and handler-failed paths emit (spec: confirmation itself
succeeded even when the underlying write threw). Step 5.11 will replace
the raw emission site with a `createModuleEvents` typed declaration;
the source carries `TODO(step 5.11): switch to typed emit` as the grep
trail.

## Unit tests

- `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit`
  → **43 / 493 passed** (baseline 40 / 453, delta +3 suites / +40 tests).
  - `pending-action-recheck.test.ts` — 22 tests (one per guard, happy +
    single failure mode, cross-tenant attachment, batch partial-stale,
    batch all-stale, orchestrator happy + first-failure bubble-up).
  - `pending-action-executor.test.ts` — 4 tests (pending → confirmed on
    handler success, pending → failed on handler throw, idempotency on
    already-confirmed row, failedRecords[] carried onto the row).
  - `confirm/__tests__/route.test.ts` — 14 tests (happy 200,
    `invalid_status`, `expired`, `stale_version`, `read_only_agent`,
    `tool_not_whitelisted`, `agent_features_denied`,
    `attachment_cross_tenant`, `agent_unknown`, `forbidden`,
    `pending_action_not_found`, 401 via framework guard, idempotent
    double-confirm, 500 internal error).
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
  - path: `/api/ai_assistant/ai/actions/{id}/confirm`
  - operationId: `aiAssistantConfirmPendingAction`
  - `grep -c "aiAssistantConfirmPendingAction"
    apps/mercato/.mercato/generated/openapi.generated.json` → `1`.
- `yarn i18n:check-sync` → green (no new user-facing strings on the
  server side — UI-side confirmation-card error messaging lands in
  Step 5.10).

## BC posture

- Additive only: new route path, new pure-function library modules,
  new barrel exports. No changes to the Step 5.5 entity / migration or
  the Step 5.7 GET route.
- The repository's `setStatus(..., { executionResult, failedRecords })`
  signature already supported the fields needed by this Step; no
  signature change was required.
- `serializePendingActionForClient` already covers
  `executionResult` + `failedRecords`; no serializer change required.

## Deviations

- None.
