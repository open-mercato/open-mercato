# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-19T17:15:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 5 Step 5.6 **complete**. The
`prepareMutation` runtime wrapper now intercepts `isMutation: true` tool
calls for agents whose effective `mutationPolicy` is not `read-only`,
creates an `AiPendingAction` via the Step 5.5 repo, and enqueues a
`mutation-preview-card` UI part in the new `ResolvedAgentTools.uiPartQueue`.
Next: Step 5.7 — `GET /api/ai/actions/:id` route with `metadata` + `openApi`
for reconnect/polling.
**Last commit (code):** `292ff18a1` — `feat(ai-assistant): prepareMutation
runtime wrapper + mutation-preview-card emission (Phase 3 WS-C)`

## What just happened

- New helper `packages/ai-assistant/src/modules/ai_assistant/lib/prepare-mutation.ts`:
  - `prepareMutation(input, ctx): Promise<{ uiPart, pendingAction }>` is
    the sole entry point a non-read-only agent runtime uses to convert a
    mutation tool call into a pending-action + `mutation-preview-card`
    UI part. It NEVER invokes the tool's handler — the write happens
    only in Step 5.8's confirm route.
  - Fail-closed guards: `not_a_mutation_tool` (tool lacks
    `isMutation: true`) and `read_only_agent` (agent's effective
    `mutationPolicy` is `read-only`). The runtime never reaches here
    in practice, but the helper re-checks defensively.
  - `computeMutationIdempotencyKey({ tenantId, organizationId, agentId,
    conversationId, toolName, normalizedInput })` produces a SHA-256
    hex digest. Canonicalization sorts object keys alphabetically via a
    `safeStringify` helper so `{a,b}` and `{b,a}` hash identically.
    Attachments are NOT included in the hash — they're captured on the
    pending row via `attachmentIds` pass-through.
  - Single-record path: calls `tool.loadBeforeRecord(args, ctx)`, diffs
    `before` vs the `args.patch` sub-object (or the envelope-minus-
    well-known-keys fallback when the tool schema is flat).
  - Batch path (`tool.isBulk === true`): calls `loadBeforeRecords`, then
    per-record matches the `args.records[]` entry by `recordId` / `id`
    and diffs each row independently. The batch diff is stored on
    `AiPendingAction.records[]`; top-level `fieldDiff` stays `[]`.
  - Missing resolver (either single or bulk): logs a `console.warn`,
    returns `fieldDiff: []` + `sideEffectsSummary: 'Tool did not declare
    a field-diff resolver; action will proceed without a preview.'`.
    Pending row is still created so Step 5.8 can execute the write.
- `AiToolDefinition` (lib/types.ts) grows three optional additive fields:
  - `isBulk?: boolean` (default `false`).
  - `loadBeforeRecord?: (input, ctx) => Promise<{ recordId, entityType,
    recordVersion, before } | null>`.
  - `loadBeforeRecords?: (input, ctx) => Promise<Array<{ recordId,
    entityType, label, recordVersion, before }>>`.
  - Every existing tool in `packages/*/**/ai-tools.ts` is unaffected —
    BC preserved, contract additive-only.
- `resolveAiAgentTools` (lib/agent-tools.ts) is the runtime wire-in:
  - New optional `container?: AwilixContainer` + `conversationId?: string
    | null` inputs. Dispatchers (`runAiAgentText`, `runAiAgentObject`)
    already pass `input.container` into the call.
  - When an agent's effective `mutationPolicy` is non-read-only AND a
    container is supplied, the adapter that wraps each mutation tool
    swaps the execute body for a call to `prepareMutation`. The
    returned UI part is pushed into the new per-request
    `AiUiPartQueue` that lives on `ResolvedAgentTools.uiPartQueue`.
  - The wrapper returns the serialized `status: 'pending-confirmation'`
    payload (incl. `pendingActionId` + `expiresAt`) as the tool-call
    result so the model explains "awaiting user confirmation" to the
    user without revealing internals.
  - Read-only agents + missing-container callers + non-mutation tools
    fall through to the pre-5.6 adapter unchanged.
- `AiUiPartQueue` is a tiny FIFO exposing `enqueue / drain / size`.
  The chat dispatcher will flush it in Step 5.10 once the
  `mutation-preview-card` component registers; today the queue simply
  carries the UI part across the SDK boundary without leaking
  internals. Spec §9 explicitly allows this queue pattern until a
  first-class streaming channel lands.
- New package exports (via `packages/ai-assistant/src/index.ts`):
  `prepareMutation`, `computeMutationIdempotencyKey`,
  `AiMutationPreparationError`, `MUTATION_PREVIEW_CARD_COMPONENT`,
  `AiUiPartQueue`, plus the three new helper input/result types.
- 11 new Jest cases in `lib/__tests__/prepare-mutation.test.ts`:
  idempotency-hash key-order stability, single-record happy path,
  batch happy path (records[] vs fieldDiff invariant), missing
  `loadBeforeRecord` → fieldDiff=[] + sideEffectsSummary warning,
  `read_only_agent` fail-closed, `not_a_mutation_tool` fail-closed,
  repeat call with same `(agent, tool, args, conversationId)` returns
  the same row (no duplicate), tenant scoping, attachmentIds pass-
  through, `resolveAiAgentTools` mutation interception with
  handler-never-invoked assertion, non-mutation tool pass-through.
- Test deltas:
  - ai-assistant: 37 / 427 → **38 / 438** (+1 suite / +11 tests).
  - core: 338 / 3094 preserved.
  - ui: 60 / 328 preserved.
- Typecheck (`@open-mercato/core` + `@open-mercato/app`) clean;
  `yarn generate` zero drift; `yarn i18n:check-sync` green (no new
  keys — `mutation-preview-card` copy ships with Step 5.10).

## BC posture (production inventory)

- Only one `isMutation: true` tool exists in production today:
  `ai-assistant/src/modules/ai_assistant/ai-tools/attachments-pack.ts
  :transfer_record_attachments`. Grep-verified that NO registered
  agent whitelists it in `allowedTools` — every current agent is
  read-only and the policy gate already rejects it at
  `checkAgentPolicy` before the wrapper would fire. Step 5.6 is
  therefore a runtime no-op for existing agents; the interception
  path goes live the moment Step 5.13 lands the first mutation-
  capable agent.

## Open follow-ups carried forward

- **Step 5.7** — `GET /api/ai/actions/:id` route for reconnect/polling.
  Consumes `AiPendingActionRepository.getById` + the pending-action
  types exported in Step 5.5. Must declare `metadata` (feature gate)
  and `openApi`.
- **Step 5.8** — `POST /api/ai/actions/:id/confirm`. Executes the
  wrapped handler server-side with the full §9.4 re-check contract:
  tenant-scope, `recordVersion` optimistic-lock, idempotency replay,
  partial-success `failedRecords[]`, and state-machine transitions
  via `AiPendingActionRepository.setStatus`.
- **Step 5.9** — `POST /api/ai/actions/:id/cancel`.
- **Step 5.10** — Register the four new UI parts + wire the chat
  dispatcher to drain `ResolvedAgentTools.uiPartQueue` between
  streamText chunks. This is when `mutation-preview-card` starts
  rendering end-to-end; until then the queue holds parts silently.
- **Per-agent TTL override** (spec §8 `mutationApprovalTtlMs`) still
  deferred — carry through Steps 5.7–5.10 so the override surface is
  wired once the routes exist. Today `prepareMutation` forwards the
  repo's env-level default.
- **Dispatcher UI-part flushing contract.** This Step intentionally
  leaves drain timing to Step 5.10. When that Step lands, confirm the
  queue is drained AFTER `streamText`'s first finish-step boundary so
  clients see the mutation-preview-card as part of the same logical
  assistant turn (spec §9 ordering).
- **`agent-runtime.ts` `resolveAgentModel` migration** still deferred
  from Step 5.1. A later Step should migrate it to
  `createModelFactory(container)` so chat-mode and object-mode runs
  honor `<MODULE>_AI_MODEL` via the shared port.
- **Runtime signature extension** for `AiAgentPageContextInput` —
  unchanged from Step 5.5.
- **`inbox_ops/ai-tools.ts` + `translationProvider.ts`** still call
  `resolveExtractionProviderId` + `createStructuredModel` directly.
  Revisit in or after the next WS-C Step.
- **Portal customer login UI helper** still missing.
- **Dedicated portal `ai_assistant.view` feature** — still gated on
  `portal.account.manage`; tighten in a later Phase 5 Step.
- **Dedicated `ai_assistant.settings.manage_mutation_policy` feature**
  — carried from Step 5.5.

## Next concrete action

- **Step 5.7** — Spec Phase 3 WS-C — `GET /api/ai/actions/:id`.
  Reads a pending action by id with tenant scoping (reject cross-
  tenant with 404). Exposes the fields the `mutation-preview-card`
  needs to rehydrate after a reconnect: `status`, `fieldDiff` or
  `records`, `expiresAt`, `toolName`, `sideEffectsSummary`, and
  `executionResult` when terminal. Declare `metadata` (feature gate
  — `ai_assistant.view`) and `openApi`. Unit-test the handler
  against the mock repo from Step 5.5. No DB-level changes.

## Cadence reminder

- **5-Step checkpoint overdue.** Last full-gate checkpoint landed
  after 4.4 (`checkpoint-5step-after-4.4.md`); Phase 2 closed at 4.11;
  Steps 5.1–5.6 are the 7th–12th Steps since. Main coordinator should
  run the full validation gate + integration suites + ds-guardian
  sweep around 5.7–5.10 to cover the new routes in one pass.
- Phase 3 WS-A (5.1 + 5.2) done; Phase 3 WS-B (5.3 + 5.4) done;
  Phase 3 WS-C: 5.5 (foundation) + 5.6 (this Step) done; 5.7–5.14
  remaining.

## Environment caveats

- Dev runtime: `bgyb7opzt` on port 3000 — reuse for Phase 5 Step 5.7
  validation.
- Database / migration state: no migration in this Step. Step 5.5's
  `Migration20260419134235_ai_assistant` remains the active delta.
- Typecheck clean (`@open-mercato/core` + `@open-mercato/app`); the
  ai-assistant package still has no `typecheck` script — its Jest
  suite acts as the TS gate via `ts-jest`.
- TTL env var: `AI_PENDING_ACTION_TTL_SECONDS` (default 900). No
  `.env.example` update in this Step.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
