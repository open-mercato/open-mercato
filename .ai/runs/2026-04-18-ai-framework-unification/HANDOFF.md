# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T00:00:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.7 **complete**. The
`GET /api/ai_assistant/ai/actions/[id]` route is live with tenant
scoping, `ai_assistant.view` feature gate, and a whitelist serializer
that Steps 5.8 / 5.9 will reuse. Next: Step 5.8 —
`POST /api/ai/actions/:id/confirm` with full server-side re-check
contract from spec §9.4.
**Last commit (code):** `33aeefe60` — `feat(ai-assistant): GET /api/ai/actions/:id route + pending-action client serializer (Phase 3 WS-C)`

## What just happened

- New route `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/route.ts`:
  - `GET` only. `metadata: { GET: { requireAuth: true, requireFeatures:
    ['ai_assistant.view'] } }`; also enforces the feature runtime-side
    via `hasRequiredFeatures(...)` so a stale static scan cannot bypass
    it.
  - Tenant scoping runs entirely through
    `AiPendingActionRepository.getById({ tenantId, organizationId, userId })`
    which already uses `findOneWithDecryption`. Cross-tenant / unknown
    ids collapse to a single 404 `pending_action_not_found` to prevent
    id enumeration across tenants.
  - Callers without a tenant scope also get 404 (not 400) — same
    enumeration-hardening rationale.
  - 401 envelope is `{ error, code: 'unauthenticated' }` matching the
    rest of the ai-assistant routes; TC-AI-002 only pins the status.
- New whitelist serializer
  `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-client.ts`:
  - Exposes `serializePendingActionForClient(row): SerializedPendingAction`
    and the row shape type `SerializablePendingActionRow` (defined by
    name so it stays usable in tests without MikroORM decorators).
  - Strips `normalizedInput`, `createdByUserId`, and `idempotencyKey`
    — see the module doc for the rationale (PII/credentials in
    normalizedInput, internal principal in createdByUserId, dedup
    collision risk via idempotencyKey).
  - Normalizes `Date` fields to ISO-8601 strings. `records` /
    `failedRecords` collapse empty arrays to `null`. `queueMode`
    defaults to `'inline'`.
- New package barrel exports (via `packages/ai-assistant/src/index.ts`):
  `serializePendingActionForClient`, `SerializedPendingAction`,
  `SerializablePendingActionRow`. Steps 5.8 / 5.9 / 5.10 can import
  these directly.
- Unit tests:
  - Route (9 cases): happy path returns serialized row + repo called
    with tenant/org/user scope; cross-tenant id → 404
    `pending_action_not_found`; unknown id → same 404; unauthenticated
    → 401; missing `ai_assistant.view` → 403 with repo never called;
    internal-field leak guard (`normalizedInput`, `createdByUserId`,
    `idempotencyKey` absent from body); empty id → 400; no-tenant
    caller → 404 without repo call; repo throws → 500 `internal_error`.
  - Serializer (6 cases): whitelist key set matches the documented
    shape; internal fields never leak even when present on the source
    row; batch `records[]` preserved and empty arrays collapse to
    `null`; ISO-string Date round-trip; `queueMode` default; full
    snapshot equality.
- Test deltas:
  - ai-assistant: 38 / 438 → **40 / 453** (+2 suites / +15 tests).
  - core: 338 / 3094 preserved.
  - ui: 60 / 328 preserved.
- Typecheck (`@open-mercato/core` + `@open-mercato/app`) clean;
  `yarn generate` added
  `/api/ai_assistant/ai/actions/{id}` with `operationId:
  aiAssistantGetPendingAction` to `apps/mercato/.mercato/generated/openapi.generated.json`
  (grep-verified, count = 1). `yarn i18n:check-sync` green (no new
  user-facing strings in this Step).

## BC posture (production inventory)

- Additive only. No schema / DI / existing route / existing repo
  method changed. The new route is a read-only surface; the mutation
  interception path is still governed by Step 5.6's `prepareMutation`.
- The whitelist serializer makes any future additive column on
  `AiPendingAction` default to **not leaked** — a new client-visible
  field has to be added to `SerializedPendingAction` +
  `serializePendingActionForClient` explicitly, with a matching unit
  test.

## Open follow-ups carried forward

- **Step 5.8** — `POST /api/ai/actions/:id/confirm` with the full §9.4
  re-check contract: tenant-scope re-check, idempotency replay inside
  the TTL window, `recordVersion` optimistic-lock, state-machine
  transitions via `AiPendingActionRepository.setStatus`
  (`pending → confirmed → executing → (success | failed)`), partial-
  success `failedRecords[]` population for batch (`isBulk`) actions,
  `read-only-agent` refusal, prompt-override-escalation refusal,
  pending-action expiry → 410 (or 409 — confirm via spec §9.4 text
  before implementing). Response body MUST reuse
  `serializePendingActionForClient` so the UI sees the same shape it
  got from GET.
- **Step 5.9** — `POST /api/ai/actions/:id/cancel`. Thin wrapper around
  `setStatus(..., 'cancelled', { resolvedByUserId: auth.sub })`.
  Response body reuses `serializePendingActionForClient`.
- **Step 5.10** — Four new UI parts in `@open-mercato/ui/src/ai/parts/`
  (`mutation-preview-card`, `field-diff-card`, `confirmation-card`,
  `mutation-result-card`) + chat dispatcher drain of
  `ResolvedAgentTools.uiPartQueue`. The UI parts import
  `SerializedPendingAction` from the ai-assistant barrel so the row
  shape stays in lockstep with the GET/confirm/cancel responses.
- **Step 5.11** — `ai.action.confirmed` / `ai.action.cancelled` /
  `ai.action.expired` events via `createModuleEvents`.
- **Step 5.12** — Cleanup worker sweeping `status='pending' AND
  expiresAt < now` → `expired` + event emission.
- **Step 5.13** — First mutation-capable agent flow
  (`customers.account_assistant` deal-stage updates).
- **Step 5.14** — D18 catalog mutation tools batch + single-approval
  flow.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred — carry through Step 5.8 so the override surface is wired
  once the confirm route exists. Today the repo forwards the env-level
  default (`AI_PENDING_ACTION_TTL_SECONDS`, default 900s).
- **Dispatcher UI-part flushing contract** — unchanged from 5.6; land
  in Step 5.10.
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — carried from Step 5.5.

## Next concrete action

- **Step 5.8** — Spec Phase 3 WS-C — `POST /api/ai/actions/:id/confirm`.
  Route file: `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/confirm/route.ts`.
  Full server-side re-check contract per spec §9.4:
  1. Load pending row via `AiPendingActionRepository.getById` with
     tenant scope (404 on cross-tenant same as GET).
  2. Reject unless `status === 'pending'` AND `expiresAt > now` (spec
     §9.4 says 409 `pending_action_not_pending` / 410 `pending_action_expired`
     — pick per the spec text at implementation time).
  3. Re-resolve the agent + tool from the current registry. Reject
     with 409 `read_only_agent` if the effective `mutationPolicy`
     degraded since creation. Reject with 409 `tool_unknown` or
     `tool_not_whitelisted` if the agent no longer exposes the tool.
  4. Re-check the user's features (`ai_assistant.view` + the agent's
     `requiredFeatures` + the tool's `requiredFeatures`).
  5. Optimistic lock: re-load the target record (single-row tools via
     `tool.loadBeforeRecord`, batch via `tool.loadBeforeRecords`) and
     compare `recordVersion` against the value stored on the pending
     row. Mismatch → 409 `stale_record_version`.
  6. Transition pending → confirmed via
     `AiPendingActionRepository.setStatus(..., 'confirmed', { resolvedByUserId })`,
     then confirmed → executing, then invoke the tool's real handler
     with the stored `normalizedInput`. Batch tools populate
     `failedRecords[]` on partial failure; terminal status stays
     `confirmed` on full success and walks to `failed` on total
     failure. Write the outcome via
     `setStatus(..., { executionResult, failedRecords })`.
  7. Idempotency replay: a second call within the TTL window with the
     same `(tenant, org, agent, conversationId, toolName, normalizedInput)`
     MUST return the same `executionResult` + terminal status, never
     re-execute the handler.
  8. Response body reuses `serializePendingActionForClient(row)` so
     the UI sees the same shape it got from GET.
  9. Unit tests MUST cover: happy single, happy batch, stale version,
     cross-tenant, read-only escalation refusal, tool no longer
     whitelisted, idempotent replay, expired row, partial batch
     failure, feature-check failure, tenant-less caller.
  Export `metadata` + `openApi`.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1–5.7 are the 7th–13th Steps since. Main coordinator should
  run the full validation gate + integration suites + ds-guardian
  sweep around 5.7–5.10 to cover the new routes in one pass. **Step
  5.7 completed; coordinator should strongly consider the checkpoint
  batch at 5.10 boundary.**
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C: 5.5 (foundation) + 5.6 (runtime wrapper) + 5.7
  (reconnect/polling, this Step) done; 5.8–5.14 remaining.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.8
  validation.
- Database / migration state: no migration in this Step. Step 5.5's
  `Migration20260419134235_ai_assistant` remains the active delta.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s). No
  `.env.example` update in this Step either.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
