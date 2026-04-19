# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T00:00:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.9 **complete**. The
`POST /api/ai_assistant/ai/actions/[id]/cancel` route is live. It flips
`pending → cancelled`, emits `ai.action.cancelled`, and is idempotent on
double-cancel (second call returns 200 with the current row and does
NOT re-emit the event). Expired rows short-circuit: if `expiresAt < now`
the route flips to `expired`, emits `ai.action.expired`, and returns 409
`{ code: 'expired' }` — race-safe with the Step 5.12 cleanup worker. The
cancel path reuses only the `status + expiry` guard from the Step 5.8
recheck helper; agent / tool / attachment / record-version guards are
confirm-only. Response body reuses `serializePendingActionForClient`.
The standalone `executePendingActionCancel` helper lives in
`lib/pending-action-cancel.ts` so operator tools can cancel a pending
action programmatically in a later Step without depending on the HTTP
route. Next: Step 5.10 — four new UI parts under
`@open-mercato/ui/src/ai/parts/`.
**Last commit (code):** `6ee59d877` — `feat(ai-assistant): POST /api/ai/actions/:id/cancel route + idempotent cancel helper (Phase 3 WS-C)`

## What just happened

- New route `packages/ai-assistant/src/modules/ai_assistant/api/ai/actions/[id]/cancel/route.ts`:
  - `POST` only. `metadata: { POST: { requireAuth: true,
    requireFeatures: ['ai_assistant.view'] } }` with a runtime
    re-check via `hasRequiredFeatures(...)`.
  - Tenant scoping via `AiPendingActionRepository.getById` (same shape
    as the Step 5.7 GET route and Step 5.8 confirm route). Cross-tenant
    / unknown ids collapse to a single 404 `pending_action_not_found`.
    Callers without a tenant scope also get 404.
  - Body schema (strict): optional `{ reason?: string }` trimmed to at
    most 500 chars; whitespace-only reasons collapse to the default
    `Cancelled by user` message. Unknown fields produce 400
    `validation_error`.
  - Idempotency short-circuit BEFORE the recheck: an already-`cancelled`
    row returns 200 with the current row and does NOT re-emit
    `ai.action.cancelled` (asserted in the route unit test via the
    mocked eventBus).
  - `checkStatusAndExpiry` from the Step 5.8 recheck helper runs next.
    Terminal statuses (`confirmed` / `executing` / `failed`) short-
    circuit with 409 `invalid_status`.
  - Expired branch: if `expiresAt <= now`, the route delegates to
    `executePendingActionCancel` which flips the row to `expired` via
    `repo.setStatus` and emits `ai.action.expired`. The route then
    returns 409 `{ code: 'expired', pendingAction: <SerializedPendingAction status=expired> }`
    so the UI can surface the TTL loss without a second round trip.
  - Happy path: transition to `cancelled` via
    `repo.setStatus('cancelled', { resolvedByUserId, executionResult: { error: { code: 'cancelled_by_user', message } } })`
    + emit `ai.action.cancelled` with the raw eventBus (`TODO(step 5.11)`
    marker for the typed-event migration).
  - Response body reuses `serializePendingActionForClient(row)` so the
    UI sees the same shape as GET + confirm.
- New pure-function library
  `packages/ai-assistant/src/modules/ai_assistant/lib/pending-action-cancel.ts`:
  - Exports `executePendingActionCancel({ action, ctx, reason?, repo?, eventBus?, now? })`
    that returns `{ row, status: 'cancelled' | 'expired' }`.
  - Handles the TTL race + the already-cancelled idempotency + the
    event emission in one place. Operator tools can call it directly
    without the HTTP layer.
- Barrel exports (`packages/ai-assistant/src/index.ts`):
  `executePendingActionCancel`, `PENDING_ACTION_CANCELLED_EVENT_ID`,
  `PENDING_ACTION_EXPIRED_EVENT_ID`, and the helper's type aliases.
- Unit tests:
  - `cancel/__tests__/route.test.ts` — 14 tests (happy 200 cancel with
    reason, idempotent double-cancel without re-emit, 409 expired with
    flip-to-expired + `ai.action.expired` emission, three 409
    `invalid_status` branches, 404 cross-tenant, 403 forbidden,
    whitespace-only reason falls back to default message, 400
    `validation_error` on 501-char reason, 400 on unknown body fields,
    empty body accepted, 500 `cancel_internal_error` on repo throw, 401
    via framework guard).
  - `lib/__tests__/pending-action-cancel.test.ts` — 5 tests (atomic
    `pending → cancelled` + `ai.action.cancelled` emit, default reason
    fallback, idempotent already-cancelled short-circuit, expired
    short-circuit with `ai.action.expired`, event-bus failure swallowed
    without failing the cancel).
- Test deltas:
  - ai-assistant: 43 / 493 → **45 / 512** (+2 suites / +19 tests).
  - core: 338 / 3094 preserved.
  - ui: 60 / 328 preserved.
- Typecheck (`@open-mercato/app --force`) clean. `yarn generate` added
  `/api/ai_assistant/ai/actions/{id}/cancel` with `operationId:
  aiAssistantCancelPendingAction` to
  `apps/mercato/.mercato/generated/openapi.generated.json`
  (grep-verified, count = 1). `yarn i18n:check-sync` green — the cancel
  route emits no user-facing translatable strings; confirmation-card
  + cancellation-card i18n lands with Step 5.10's UI parts.

## BC posture (production inventory)

- Additive only. No schema / DI / existing route / existing repo method
  changed. The new route is a new surface; the Step 5.5 repo's
  `setStatus(..., 'cancelled' | 'expired', { executionResult, resolvedByUserId })`
  signature already covered everything the cancel helper needs.
- The Step 5.8 `checkStatusAndExpiry` export from
  `pending-action-recheck.ts` is reused verbatim here; no signature
  change. The rest of the Step 5.8 guards are confirm-only and remain
  untouched.
- `serializePendingActionForClient` already covers `executionResult`
  + `resolvedAt` + `resolvedByUserId`, so no serializer change was
  required.

## Open follow-ups carried forward

- **Step 5.10** — Four new UI parts in `@open-mercato/ui/src/ai/parts/`
  (`mutation-preview-card`, `field-diff-card`, `confirmation-card`,
  `mutation-result-card`) + chat dispatcher drain of
  `ResolvedAgentTools.uiPartQueue`. Confirm-card / cancel-card i18n +
  keyboard shortcuts (`Cmd/Ctrl+Enter` / `Escape`) land here. The UI
  parts import `SerializedPendingAction` from the ai-assistant barrel
  so the row shape stays in lockstep with the GET / confirm / cancel
  responses.
- **Step 5.11** — `ai.action.confirmed` / `ai.action.cancelled` /
  `ai.action.expired` events via `createModuleEvents`. Both the Step
  5.8 confirm route and the Step 5.9 cancel route emit the raw event
  ids via the eventBus with `TODO(step 5.11)` markers — 5.11 swaps the
  emission sites to the typed helper in one pass.
- **Step 5.12** — Cleanup worker sweeping `status='pending' AND
  expiresAt < now` → `expired` + event emission. Step 5.9 already
  does the flip-to-expired for the on-demand cancel path; 5.12 is the
  background sweep that handles rows nobody cancels.
- **Step 5.13** — First mutation-capable agent flow
  (`customers.account_assistant` deal-stage updates).
- **Step 5.14** — D18 catalog mutation tools batch + single-approval
  flow.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred. Today the repo forwards the env-level default
  (`AI_PENDING_ACTION_TTL_SECONDS`, default 900s). The cancel route
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

- **Step 5.10** — Spec Phase 3 WS-C — four new UI parts under
  `@open-mercato/ui/src/ai/parts/`:
  1. `mutation-preview-card.tsx` — renders
     `SerializedPendingAction` with a `fieldDiff` / `records[]` table
     + `[Confirm]` + `[Cancel]` buttons. `Cmd/Ctrl+Enter` submits the
     Confirm action; `Escape` submits the Cancel action. Wire to the
     Step 5.8 + 5.9 routes via `apiCall` from the UI package.
  2. `field-diff-card.tsx` — standalone card for a single
     `AiPendingActionFieldDiff` (before / after), reused by the preview
     card and by any future non-gated diff surface.
  3. `confirmation-card.tsx` — the post-confirm card that surfaces
     `executionResult` (success recordId / commandName OR the failure
     envelope) + any `failedRecords[]` sidecar from a partial-stale
     batch. Renders `mutation-result-card` inside for the success path.
  4. `mutation-result-card.tsx` — compact success surface (record id +
     command name + "View record" link when applicable).
  Plus the chat dispatcher drain of `ResolvedAgentTools.uiPartQueue`:
  the Step 5.6 `prepareMutation` helper already fills the queue; the
  dispatcher must route `mutation-preview-card` entries to the new
  preview component and `mutation-result-card` entries (emitted by the
  confirm route's success path, starting in 5.10) to the result card.
  Add the i18n keys for confirm / cancel / expired / success / partial-
  success messaging. No server-side changes in this Step — the routes
  are already wired.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1–5.9 are the 7th–15th Steps since. **Coordinator should
  strongly consider running the checkpoint batch at the 5.10 boundary**
  so the full validation gate + integration suites + ds-guardian sweep
  cover the new routes and the new UI parts in one pass.
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C: 5.5 (foundation) + 5.6 (runtime wrapper) + 5.7
  (reconnect/polling) + 5.8 (confirm) + 5.9 (cancel, this Step) done;
  5.10–5.14 remaining.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.10
  validation.
- Database / migration state: no migration in this Step. Step 5.5's
  `Migration20260419134235_ai_assistant` remains the active delta.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900s). No
  `.env.example` update in this Step.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
