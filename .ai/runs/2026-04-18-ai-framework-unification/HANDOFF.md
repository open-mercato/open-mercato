# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T12:10:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-A complete (Steps 3.1, 3.2, 3.3).
Phase 3 WS-B opens with Step 3.4 (AI SDK helpers).
**Last commit:** `aae4fc6f5` —
`feat(ai-assistant): add POST /api/ai/chat?agent=<id> dispatcher route`

## What just happened

- Executor landed **Step 3.3** as a single code commit (`aae4fc6f5`)
  plus this docs-flip commit.
- New file
  `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts`:
  - Exports `metadata` with `requireAuth: true` +
    `requireFeatures: ['ai_assistant.view']` (POST).
  - Exports `openApi` with `operationId: aiAssistantChatAgent`,
    required query param `agent` (pattern `^[a-z0-9_]+\.[a-z0-9_]+$`),
    zod-validated `AiChatRequest` body (`messages` 1..100, optional
    `attachmentIds`, `debug`, `pageContext`), and typed 200/400/401/403/404/409/500
    responses.
  - Resolves auth via `getAuthFromRequest`, loads ACL via
    `rbacService.loadAcl()` (from the DI container), then consumes
    Step 3.2's `checkAgentPolicy` with `requestedExecutionMode: 'chat'`.
  - Maps deny codes to HTTP status per HANDOFF carryover:
    `agent_unknown` → 404, `agent_features_denied` / `tool_features_denied` → 403,
    `tool_not_whitelisted` / `tool_unknown` / `mutation_blocked_by_*` /
    `execution_mode_not_supported` → 409,
    `attachment_type_not_accepted` → 400.
  - On allow: returns `text/event-stream` with a single
    `data: {"type":"text","content":"..."}` placeholder chunk followed
    by `data: [DONE]`. The placeholder is marked with a
    `TODO(step-3.4): wire streamText via createAiAgentTransport` comment —
    a permissible WHY-comment because Step 3.4 is the concrete successor.
- Attachment media-type resolution is deferred to Step 3.7 — the call site
  explicitly passes `attachmentMediaTypes: undefined` with a
  `TODO(step-3.7)` comment; the policy gate still runs but skips the
  attachment branch. Acceptable for Phase 3.3: `attachmentIds` are still
  validated as `string[]` by zod and will be bound to media types only
  once the attachment-to-model bridge lands.
- Effective route URL after `yarn generate` is
  `/api/ai_assistant/ai/chat` (module-id-prefixed discipline — all
  ai-assistant routes follow this convention). The spec's `/api/ai/chat`
  label remains as shorthand; the file layout is exactly what the plan
  called for (`api/ai/chat/route.ts`).
- Unit tests: 16 suites / 213 tests in `packages/ai-assistant`
  (baseline 15/204 after Step 3.2; delta +1 suite, +9 tests). New file
  `api/ai/chat/__tests__/route.test.ts` covers 401, 400-missing-agent,
  400-malformed-agent, 400-invalid-body, 400-message-overflow, 404-unknown,
  403-missing-feature, 409-object-mode-over-chat, and 200-placeholder-stream.
- `yarn generate` regenerated the OpenAPI spec: 310 API paths (previously
  309). `operationId: aiAssistantChatAgent` is present and the
  `x-require-auth` / `x-require-features` extensions are emitted
  correctly.

## Next concrete action

- **Step 3.4** — Spec Phase 1 WS-B — AI SDK helpers:
  `createAiAgentTransport`, `resolveAiAgentTools`, `runAiAgentText`.
  - Expected file: `packages/ai-assistant/src/modules/ai_assistant/lib/ai-sdk-helpers.ts`
    (or split across `lib/agent-transport.ts` + `lib/agent-tools.ts` if the
    executor prefers a cleaner fan-out — but keep the public symbols on
    `@open-mercato/ai-assistant` package boundary).
  - `createAiAgentTransport(agent, { model, ... })` MUST return an
    AI SDK-compatible chat transport so future API-route consumers can
    plug it into `streamText` / `streamUI` without glue code.
  - `resolveAiAgentTools(agent, context)` MUST convert the agent's
    `allowedTools` whitelist into an AI-SDK `tools` map by reusing
    `mcp-tool-adapter.ts` (do NOT introduce a second adapter stack —
    see BC surface 4 and the Phase 0 D1 decision).
  - `runAiAgentText({ agentId, messages, ... })` MUST share the same
    policy gate (`checkAgentPolicy`) as the HTTP route so chat-mode and
    helper-call paths cannot diverge.
  - The new route from Step 3.3 MAY be updated in Step 3.4 to replace
    its placeholder stream body with `createAiAgentTransport()` output.
    That replacement is in-scope for 3.4 (finalizing the dispatch body
    is the whole point of WS-B); keep the `metadata` + `openApi`
    exports untouched.
  - Phase 3 WS-B closes after Step 3.6 (contract tests for chat/object
    parity). Step 3.5 is the `runAiAgentObject` structured-output path.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing. Same
  caveat as Step 3.2 — lean on focused standalone typecheck projects
  (no regressions via monorepo typecheck grep).
- **`apps/mercato` stale generated route** (`example/backend/customer-tasks/page`):
  still blocks `@open-mercato/app:typecheck`. Unrelated; `yarn generate`
  at Phase 3 boundary cleaned our own route but did not purge the legacy
  entry. Drive-by candidate if it surfaces during Step 3.4.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.
- **Route URL vs spec shorthand**: spec says `/api/ai/chat`; routing
  convention emits `/api/ai_assistant/ai/chat`. The file layout from
  the plan is correct (`api/ai/chat/route.ts`); the spec shorthand
  stays as-is and downstream consumers (Step 3.4 helpers + Phase 4 UI)
  should use the generated route registry rather than a hard-coded
  URL literal.
- **Tool-registry additive-field loss** (from Step 2.5): Step 3.3 does
  not exercise `isMutation` — the dispatcher passes `toolName`
  undefined at the top level, so the tool-features + mutation branch of
  `checkAgentPolicy` is NOT triggered. Each individual tool call inside
  the Step 3.4 transport WILL need a second `checkAgentPolicy({ toolName })`
  invocation; that's where the `isMutation` cast carries its weight.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests only.
- Database/migration state: clean, untouched.
- `yarn generate` ran successfully in this Step. Step 3.4 MAY skip
  regeneration if it only touches library helpers (no auto-discovery
  surface); if the Step 3.4 executor updates the route body to drop the
  placeholder, regeneration MAY or MAY NOT be necessary (no new API
  surface — the OpenAPI doc for this route already exists).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
