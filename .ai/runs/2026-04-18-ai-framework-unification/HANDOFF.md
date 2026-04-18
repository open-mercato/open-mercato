# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T14:10:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-B partially landed (Step 3.4).
Next: Step 3.5 (structured-output / `executionMode: 'object'` +
`runAiAgentObject`).
**Last commit:** `e20c80c1e` —
`feat(ai-assistant): add AI SDK helpers — runAiAgentText, resolveAiAgentTools, createAiAgentTransport`

## What just happened

- Executor landed **Step 3.4** as one code commit (`e20c80c1e`) plus the
  docs-flip commit for this HANDOFF rewrite + PLAN row flip +
  NOTIFY append.
- Three new public helpers live under
  `packages/ai-assistant/src/modules/ai_assistant/lib/`:
  - `agent-tools.ts` — exports `resolveAiAgentTools` + `AgentPolicyError`.
    Re-runs `checkAgentPolicy` at the agent level AND per tool,
    adapts each whitelisted tool via `mcp-tool-adapter.ts` (single
    adapter stack per D10), and skips tool-level denies with a
    `console.warn` so the remaining tools still reach the model.
  - `agent-runtime.ts` — exports `runAiAgentText` + `composeSystemPrompt`.
    Resolves a model via `llmProviderRegistry.resolveFirstConfigured()`
    (agent `defaultModel` or caller-supplied override wins over the
    provider default), composes the system prompt with opportunistic
    `resolvePageContext` hydration, converts UI messages via
    `convertToModelMessages` (awaited — the v6 API is async), and
    streams through `streamText` with `stopWhen: stepCountIs(maxSteps)`
    when the agent declared a budget. Returns the SDK's
    `toTextStreamResponse()` with the existing `text/event-stream`
    headers so the dispatcher keeps its content-type contract.
  - `agent-transport.ts` — exports `createAiAgentTransport` — a thin
    `DefaultChatTransport` subclass-free wrapper that binds the agent
    id as a query param and merges extra body fields for `useChat`.
- Dispatcher `api/ai/chat/route.ts` now delegates to `runAiAgentText`
  after the same agent-level policy check. The placeholder SSE body is
  gone; the `TODO(step-3.4)` comment and `buildPlaceholderStream` helper
  were removed. `AgentPolicyError` thrown by the helper is caught and
  mapped via the existing `statusForDenyCode` switch so HTTP status
  parity is preserved.
- Public surface: `@open-mercato/ai-assistant` now re-exports
  `resolveAiAgentTools`, `runAiAgentText`, `composeSystemPrompt`,
  `createAiAgentTransport`, `AgentPolicyError`,
  `ResolveAiAgentToolsInput`, `ResolvedAgentTools`, `RunAiAgentTextInput`,
  `AgentRequestPageContext`, `CreateAiAgentTransportInput`.
- Unit tests: 19 suites / 231 tests in `packages/ai-assistant`
  (baseline 16/213 after Step 3.3; delta +3 suites / +18 tests). New
  files:
  - `agent-tools.test.ts` (5 tests)
  - `agent-runtime.test.ts` (8 tests; mocks `streamText`,
    `convertToModelMessages`, `stepCountIs`, and the llm-provider
    registry so the pipeline shape is asserted without hitting an LLM)
  - `agent-transport.test.ts` (4 tests)
  - `api/ai/chat/__tests__/route.test.ts` — placeholder-stream test
    rewritten to assert delegation to `runAiAgentText`; new
    `AgentPolicyError` mapping test.
- Typecheck: `yarn turbo run typecheck --filter=@open-mercato/core
  --filter=@open-mercato/app` carries one pre-existing `app:typecheck`
  error on `agent-registry.ts` (missing `ai-agents.generated.ts` at
  import-time — the runtime path is wrapped in try/catch; carried over
  from Step 3.1). No new diagnostics from any of the four files
  delivered in this Step.
- `yarn generate` ran clean: 310 API paths unchanged, `aiAssistantChatAgent`
  still present (this Step did not change the route's OpenAPI surface).

## Next concrete action

- **Step 3.5** — Spec Phase 1 WS-B — Structured-output (`executionMode:
  'object'`) support + `runAiAgentObject` helper.
  - Expected file: `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts`
    gains a sibling `runAiAgentObject` export (or a new file
    `agent-runtime-object.ts` if the executor prefers a cleaner
    fan-out — keep the public symbol on the `@open-mercato/ai-assistant`
    package boundary).
  - MUST reuse `resolveAiAgentTools`, the same system-prompt composer,
    and the same `llmProviderRegistry` model resolution path. Object
    helpers and chat helpers must share the tool-filtering + prompt
    composition path so chat-mode / object-mode can never diverge.
  - MUST call AI SDK `generateObject` (or `streamObject` if the spec
    calls for streaming structured output — double-check §4.3 in the
    source spec) with the agent's `output.schema` and `schemaName`.
  - The dispatcher (POST route) MAY branch on
    `requestedExecutionMode: 'object'` in a later Step; for 3.5 the
    helper must work standalone so Step 3.6 (contract tests) can
    exercise chat-mode / object-mode parity.
  - Phase 3 WS-B closes after Step 3.6 (contract tests for chat/object
    parity).

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing — same
  caveat as earlier Steps.
- **`apps/mercato` stale generated import**: `agent-registry.ts(43,7)`
  still references `@/.mercato/generated/ai-agents.generated` which is
  not yet emitted (Step 3.1 carryover). Runtime try/catch hides it; TS
  flags it as a compile-time diagnostic. Drive-by candidate for Step
  3.5 if the executor adds a generated-file emission anywhere.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.
- **`authContext` on the public helper surface**: intentional Phase-1
  shim — the source spec's public shape omits it, but no global
  request-context resolver exists yet. Phase 4 can wrap this once the
  resolver lands. Any Step that builds on `runAiAgentText` from now on
  should accept this until then.
- **Attachment bridge**: `runAiAgentText` accepts `attachmentIds` and
  passes them to the tool resolver untouched; no media-type resolution
  yet. Step 3.7 owns that.
- **`resolvePageContext` hydration**: implemented opportunistically in
  `composeSystemPrompt`, but no production agent declares a callback
  today. Step 5.2 backfills that.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests only.
- Database/migration state: clean, untouched.
- `yarn generate` ran successfully. Step 3.5 MAY skip regeneration if
  it only touches library helpers.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
