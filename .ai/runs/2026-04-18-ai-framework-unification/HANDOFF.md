# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T00:00:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.8 **complete**. The
`POST /api/ai_assistant/ai/actions/[id]/confirm` route is live with the
full server-side re-check contract from spec §9.4 — status/expiry,
agent registration + features, tool whitelist + mutation policy,
tenant-scoped attachments, record-version optimistic lock, zod
schema-drift guard, and idempotent double-confirm. State-machine
transitions go through `AiPendingActionRepository.setStatus` inside
`em.transactional`; the tool handler runs outside the repo transaction
so it does not hold an `ai_pending_actions` row lock. Emits
`ai.action.confirmed` via the raw eventBus with a `TODO(step 5.11)`
grep trail pointing at the typed-event migration. Next: Step 5.9 —
`POST /api/ai/actions/:id/cancel`.
**Last commit (code):** `2f43b615c` — `feat(ai-assistant): POST /api/ai/actions/:id/confirm with full server-side re-check contract (Phase 3 WS-C)`

## What just happened

- New route `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/confirm/route.ts`:
  - `POST` only. `metadata: { POST: { requireAuth: true,
    requireFeatures: ['ai_assistant.view'] } }`; the feature is also
    re-checked runtime-side via `hasRequiredFeatures(...)`.
  - Tenant scoping runs entirely through
    `AiPendingActionRepository.getById` (same as the Step 5.7 GET
    route). Cross-tenant / unknown ids collapse to a single 404
    `pending_action_not_found`. Callers without a tenant scope also
    get 404.
  - Idempotency short-circuit BEFORE re-check: an already-`confirmed`
    or already-`failed` row returns the prior `executionResult`
    without re-invoking the handler.
  - Re-check contract runs every guard in spec §9.4 order via the new
    `runPendingActionRechecks` helper; first failure short-circuits
    with a structured `{ error, code }` envelope.
  - State machine: `pending → confirmed → executing → (confirmed |
    failed)` via `repo.setStatus` (each call sits inside the Step 5.5
    repo's `em.transactional`); tool handler runs OUTSIDE that
    transaction to avoid holding a row lock across a long write.
  - Response body reuses `serializePendingActionForClient(row)` so the
    UI sees the same shape it got from GET.
- New pure-function library `pending-action-recheck.ts`:
  - Exports `runPendingActionRechecks` orchestrator + the individual
    guards `checkStatusAndExpiry`, `checkAgentAndFeatures`,
    `checkToolWhitelist`, `checkAttachmentScope`, `checkRecordVersion`
    so Step 5.9 (cancel) and the unit suite can use them directly.
  - `checkRecordVersion` re-parses `action.normalizedInput` through
    the tool's CURRENT `inputSchema`. A shape change between propose
    and confirm surfaces as 412 `schema_drift`. The test suite
    explicitly asserts this by swapping the tool schema to require a
    field not present on the stored payload.
  - Batch record-version: per-record computation; ALL stale → 412
    `stale_version`, SOME stale → `{ ok: true, failedRecords: [...] }`
    which the route persists onto the confirmed row. Only all-stale
    is a 412 — partial stale is a 200 with the `failedRecords`
    sidecar.
- New pure-function library `pending-action-executor.ts`:
  - `executePendingActionConfirm` orchestrates the state-machine
    transitions and the tool-handler invocation. Idempotent on
    already-`confirmed` / already-`failed` rows. Emits
    `ai.action.confirmed` on BOTH success and handler-throw paths
    (per spec §9.4 — confirmation itself succeeded even when the
    underlying write threw). Carries `TODO(step 5.11)` for the typed
    emit migration.
- Barrel exports (`packages/ai-assistant/src/index.ts`): the recheck
  guards + orchestrator + type aliases + executor entry point + event
  id constant, so downstream tests and the Step 5.9 cancel route can
  reuse the same code paths.
- Unit tests:
  - `pending-action-recheck.test.ts` — 22 tests (one per guard happy
    + single failure mode, cross-tenant attachment id, batch partial-
    stale, batch all-stale, orchestrator happy + first-failure
    bubble-up).
  - `pending-action-executor.test.ts` — 4 tests (pending→confirmed on
    handler success, pending→failed on handler throw, idempotency,
    `failedRecords[]` carried onto the row).
  - `confirm/__tests__/route.test.ts` — 14 tests (happy 200,
    `invalid_status`, `expired`, `stale_version`, `read_only_agent`,
    `tool_not_whitelisted`, `agent_features_denied`,
    `attachment_cross_tenant`, `agent_unknown`, `forbidden`,
    `pending_action_not_found`, 401 via framework guard, idempotent
    double-confirm, 500 internal error).
- Test deltas:
  - ai-assistant: 40 / 453 → **43 / 493** (+3 suites / +40 tests).
  - core: 338 / 3094 preserved.
  - ui: 60 / 328 preserved.
- Typecheck (`@open-mercato/app --force`) clean. `yarn generate` added
  `/api/ai_assistant/ai/actions/{id}/confirm` with `operationId:
  aiAssistantConfirmPendingAction` to
  `apps/mercato/.mercato/generated/openapi.generated.json`
  (grep-verified, count = 1). `yarn i18n:check-sync` green (no new
  user-facing strings in this Step — confirmation-card i18n lands in
  Step 5.10).

## BC posture (production inventory)

- Additive only. No schema / DI / existing route / existing repo
  method changed. The new route is a new surface; the Step 5.5 repo's
  `setStatus(..., { executionResult, failedRecords })` signature was
  already shaped to support the partial-stale write path.
- `serializePendingActionForClient` already covers `executionResult`
  + `failedRecords` so no serializer change was required — the new
  response body reuses the exact shape the GET route emits.

## Open follow-ups carried forward

- **Step 5.9** — `POST /api/ai/actions/:id/cancel`. Thin wrapper
  around `setStatus(..., 'cancelled', { resolvedByUserId })` that
  reuses `checkStatusAndExpiry` from the new recheck helper; cannot
  be cancelled if already terminal (409); read-only caller is fine
  because cancel does not execute anything. Response body reuses
  `serializePendingActionForClient`.
- **Step 5.10** — Four new UI parts in `@open-mercato/ui/src/ai/parts/`
  (`mutation-preview-card`, `field-diff-card`, `confirmation-card`,
  `mutation-result-card`) + chat dispatcher drain of
  `ResolvedAgentTools.uiPartQueue`. Confirm-card i18n + keyboard
  shortcuts (`Cmd/Ctrl+Enter` / `Escape`) land here. The UI parts
  import `SerializedPendingAction` from the ai-assistant barrel so
  the row shape stays in lockstep with the GET/confirm/cancel
  responses.
- **Step 5.11** — `ai.action.confirmed` / `ai.action.cancelled` /
  `ai.action.expired` events via `createModuleEvents`. The confirm
  route already emits `ai.action.confirmed` via the raw eventBus with
  a `TODO(step 5.11)` marker — 5.11 swaps the emission site to the
  typed helper.
- **Step 5.12** — Cleanup worker sweeping `status='pending' AND
  expiresAt < now` → `expired` + event emission.
- **Step 5.13** — First mutation-capable agent flow
  (`customers.account_assistant` deal-stage updates).
- **Step 5.14** — D18 catalog mutation tools batch + single-approval
  flow.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred. Today the repo forwards the env-level default
  (`AI_PENDING_ACTION_TTL_SECONDS`, default 900s). The confirm route
  honors whatever `expiresAt` the row was born with.
- **Dispatcher UI-part flushing contract** — unchanged from 5.6;
  lands in Step 5.10.
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — carried from Step 5.5.

## Next concrete action

- **Step 5.9** — Spec Phase 3 WS-C — `POST /api/ai/actions/:id/cancel`.
  Route file: `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/cancel/route.ts`.
  1. Load pending row via `AiPendingActionRepository.getById` with
     tenant scope (404 on cross-tenant same as GET/confirm).
  2. Reuse `checkStatusAndExpiry` from Step 5.8's
     `pending-action-recheck` helper — cancel MUST only succeed on a
     still-pending, not-expired row. Already-terminal rows return
     409 `invalid_status`; expired rows return 409 `expired`.
  3. Idempotent: a second cancel on an already-`cancelled` row
     returns 200 with the prior row (no new resolvedAt / resolvedByUserId
     overwrite).
  4. Transition `pending → cancelled` via
     `AiPendingActionRepository.setStatus(..., 'cancelled', { resolvedByUserId })`.
  5. Emit `ai.action.cancelled` via the raw eventBus with the same
     `TODO(step 5.11)` grep marker used by 5.8.
  6. Response body reuses `serializePendingActionForClient(row)`.
  7. Unit tests MUST cover: happy cancel, idempotent double-cancel,
     already-confirmed → 409 invalid_status, expired → 409 expired,
     cross-tenant → 404, 401 via framework guard, 500 on repo throw.
  Export `metadata` + `openApi`.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1–5.8 are the 7th–14th Steps since. Main coordinator should
  run the full validation gate + integration suites + ds-guardian
  sweep around 5.8–5.10 to cover the new routes in one pass. **Step
  5.8 completed; coordinator should strongly consider the checkpoint
  batch at 5.10 boundary.**
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C: 5.5 (foundation) + 5.6 (runtime wrapper) + 5.7
  (reconnect/polling) + 5.8 (confirm, this Step) done; 5.9–5.14
  remaining.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.9
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
