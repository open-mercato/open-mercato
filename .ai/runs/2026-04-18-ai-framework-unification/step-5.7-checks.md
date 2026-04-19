# Step 5.7 — verification notes

**Commit (code):** `33aeefe60` —
`feat(ai-assistant): GET /api/ai/actions/:id route + pending-action client serializer (Phase 3 WS-C)`

## Scope

Lands the read-side of the Phase 3 WS-C mutation approval gate (spec
§9.4, Step 5.7) — the `GET /api/ai_assistant/ai/actions/[id]` route —
plus the whitelist serializer `serializePendingActionForClient` that
Steps 5.8 (confirm) and 5.9 (cancel) will reuse for their response
bodies. Additive only.

## Files

- `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/route.ts`
  (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/__tests__/route.test.ts`
  (new — 9 tests)
- `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-client.ts`
  (new)
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/pending-action-client.test.ts`
  (new — 6 tests)
- `packages/ai-assistant/src/index.ts` — barrel: +
  `serializePendingActionForClient`, + types `SerializedPendingAction`
  / `SerializablePendingActionRow`.

## Unit tests

- `cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit`
  → **40 / 453 passed** (baseline 38 / 438, delta +2 suites / +15 tests).
- `cd packages/core && npx jest --config=jest.config.cjs --forceExit`
  → **338 / 3094 passed** (baseline preserved).
- `cd packages/ui && npx jest --config=jest.config.cjs --forceExit`
  → **60 / 328 passed** (baseline preserved).

## Typecheck

- `yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app`
  → clean (core + app cache-hits; ai-assistant has no `typecheck`
  script by design — its Jest suite is the TS gate via `ts-jest`).
- `yarn turbo run typecheck --filter=@open-mercato/app --force` → clean
  (forced re-run to prove the new route typechecks end-to-end through
  `apps/mercato` — same contract used in earlier Steps).

## Generator

- `yarn generate` → OpenAPI bundle rebuilt.
- Confirmed the new operation is present in the generated OpenAPI:
  - path: `/api/ai_assistant/ai/actions/{id}`
  - operationId: `aiAssistantGetPendingAction`
  - `grep -c "aiAssistantGetPendingAction"
    apps/mercato/.mercato/generated/openapi.generated.json` → `1`.
- `yarn i18n:check-sync` → green (no new user-facing strings in this
  Step — reconnect UX is handled by Step 5.10's UI parts).

## Contract summary

### Response body (200)

Whitelist-serialized `AiPendingAction` row:

```
id, agentId, toolName, status, fieldDiff, records, failedRecords,
sideEffectsSummary, attachmentIds, targetEntityType, targetRecordId,
recordVersion, queueMode, executionResult, createdAt, expiresAt,
resolvedAt, resolvedByUserId
```

`Date` fields are ISO-8601 strings. `records` and `failedRecords`
collapse empty arrays to `null`. `queueMode` defaults to `"inline"`.

### Not in the response body (server-internal)

- `normalizedInput` — raw tool input may contain PII or credentials.
- `createdByUserId` — internal principal; UI only needs
  `resolvedByUserId`.
- `idempotencyKey` — hash used to dedupe writes; leaking it lets an
  attacker craft collisions inside the TTL window.

### Error envelope

- `401 { error, code: 'unauthenticated' }` — same shape as the Phase 3
  chat dispatcher and other ai-assistant routes. TC-AI-002 only pins
  the status, not the body shape.
- `403 { error, code: 'forbidden' }` when caller lacks
  `ai_assistant.view`.
- `404 { error, code: 'pending_action_not_found' }` for unknown ids,
  cross-tenant ids, and callers with no tenant scope. A single 404 is
  used on purpose so the route cannot be used to enumerate rows owned
  by other tenants.
- `400 { error, code: 'validation_error', issues }` for empty / too-long
  `id` param.
- `500 { error, code: 'internal_error' }` when the repo throws.

## BC posture

- Additive-only: new route path, new package exports, no changes to
  existing routes / tools / DI / schema. The existing
  `AiPendingActionRepository.getById` is the single read port used by
  this route; no new repo method added.
- The whitelist serializer protects future entity columns from leaking
  through a `{...row}` copy — any new client-visible field must be
  added to `SerializedPendingAction` + `serializePendingActionForClient`
  explicitly, with a unit test.

## Deviations

- None.
