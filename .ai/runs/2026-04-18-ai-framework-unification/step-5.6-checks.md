# Step 5.6 — prepareMutation runtime wrapper verification notes

**Commit (code):** `292ff18a1`
**Branch:** `feat/ai-framework-unification`
**Date:** 2026-04-19 UTC

## Summary

Wired the runtime interception path for `isMutation: true` tools. When an
agent's effective `mutationPolicy` is non-read-only AND a DI container is
passed through, `resolveAiAgentTools` now adapts mutation tools with a
wrapper that routes into a new `prepareMutation` helper. The helper
creates an `AiPendingAction` row (via the Step 5.5 repo) and emits a
`mutation-preview-card` UI part through a per-request `AiUiPartQueue`.
The original tool handler is NEVER invoked — the write happens only in
Step 5.8's confirm route.

`AiToolDefinition` grew three optional additive fields (`isBulk`,
`loadBeforeRecord`, `loadBeforeRecords`). Every existing tool file keeps
working unchanged. The only production tool with `isMutation: true`
today (`attachments.transfer_record_attachments`) is not in any agent's
`allowedTools`, so this Step is a runtime no-op for current agents —
the interception fires the moment Step 5.13 lands the first
mutation-capable agent.

## Unit tests

One new suite; every pre-existing suite remains green.

| Suite | Tests | Notes |
|-------|-------|-------|
| `lib/__tests__/prepare-mutation.test.ts` | 11 | (1) `computeMutationIdempotencyKey` is stable under object key reordering; (2) single-record happy path emits `mutation-preview-card` with `pendingActionId` + computed `fieldDiff`; (3) batch happy path populates per-record diffs on `AiPendingAction.records[]` while top-level `fieldDiff` stays `[]`; (4) missing `loadBeforeRecord` ships `fieldDiff: []` + `sideEffectsSummary` warning + still creates the pending row; (5) `read_only_agent` fail-closed when effective `mutationPolicy === 'read-only'`; (6) `not_a_mutation_tool` fail-closed when the tool lacks `isMutation: true`; (7) idempotency: two calls with same `(agent, tool, args, conversationId)` return the same `pendingActionId` (no duplicate row); (8) tenant scoping: persisted row carries `ctx.tenantId` + `ctx.organizationId`; (9) `attachmentIds` pass-through from `toolCallArgs`; (10) `resolveAiAgentTools` replaces the mutation-tool handler with the wrapper — original handler NEVER invoked, pending row IS created, UI part IS enqueued; (11) non-mutation tools bypass the wrapper and run their original handler. |

### Counts

- `@open-mercato/ai-assistant`: **38 / 438** (baseline 37 / 427 → +1 suite / +11 tests).
- `@open-mercato/core`: **338 / 3094** (baseline preserved).
- `@open-mercato/ui`: **60 / 328** (baseline preserved).

## Typecheck

`yarn turbo run typecheck --filter=@open-mercato/ai-assistant --filter=@open-mercato/core --filter=@open-mercato/app --force` → 2 cached/2 successful for `@open-mercato/core` + `@open-mercato/app`. The `@open-mercato/ai-assistant` package does not declare a `typecheck` script; its Jest suite runs via `ts-jest` and acts as the TS gate — all 438 tests compile + pass.

## Generate / i18n / DB

- `yarn generate` — zero drift (no untracked generated files, no unexpected modifications; only pre-existing generated outputs are rewritten unchanged).
- `yarn i18n:check-sync` — green across `en / pl / es / de` (no new keys in this Step; `mutation-preview-card` copy ships with Step 5.10).
- No migration generated in this Step. Step 5.5's `Migration20260419134235_ai_assistant` remains the active delta.

## BC posture

- Additive-only on every surface:
  - `AiToolDefinition`: three new optional fields (`isBulk`, `loadBeforeRecord`, `loadBeforeRecords`).
  - `ResolveAiAgentToolsInput`: two new optional fields (`container`, `conversationId`).
  - `ResolvedAgentTools`: new `uiPartQueue` field. Existing callers that destructure only `{ agent, tools }` are unaffected.
  - New package exports: `prepareMutation`, `computeMutationIdempotencyKey`, `AiMutationPreparationError`, `MUTATION_PREVIEW_CARD_COMPONENT`, `AiUiPartQueue`, plus helper input/result types.
- **Production inventory grep-verified.** The one existing `isMutation: true` tool (`attachments.transfer_record_attachments`) is NOT in any registered agent's `allowedTools`. All current agents are read-only and the pre-existing policy gate rejects them at `checkAgentPolicy` before the wrapper fires. Runtime behavior for every existing agent is therefore unchanged — byte-for-byte the same SDK tool-call adapter path as pre-5.6.

## Key decisions

1. **UI part delivery: queue, not streaming channel.** No first-class UI-part streaming channel exists today; spec §9 explicitly allows a dispatcher-drained queue instead. Shipped `AiUiPartQueue` (tiny FIFO on `ResolvedAgentTools`). Step 5.10 will drain it from the chat dispatcher when the `mutation-preview-card` component registers. Until then the queue silently holds emitted parts — no client-visible effect.
2. **Idempotency-hash canonicalization.** SHA-256 over a key-sorted JSON of `(tenantId, organizationId, agentId, conversationId, toolName, normalizedInput)`. `attachmentIds` are NOT included in the hash — they are captured separately on the pending row so re-uploading the same file set with a different tool-call object never accidentally collides with a prior row. Canonicalization uses a `safeStringify` helper that sorts object keys recursively so `{a,b}` and `{b,a}` collapse to the same hex digest.
3. **No existing tool had to be touched.** Zero `ai-tools.ts` files changed; the new resolver contract is purely opt-in. Step 5.13 / 5.14 will be the first producers of `loadBeforeRecord` / `loadBeforeRecords`.

## Next

- Step 5.7 — `GET /api/ai/actions/:id` route (reconnect/polling, `metadata` + `openApi`).
- Step 5.10 eventually drains `ResolvedAgentTools.uiPartQueue` from the chat dispatcher once the `mutation-preview-card` component registers.
