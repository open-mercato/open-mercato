# Step 3.4 — Verification Checks

## Scope

Phase 1 WS-B AI SDK helpers: `createAiAgentTransport`, `resolveAiAgentTools`,
`runAiAgentText`. Dispatcher route now delegates to `runAiAgentText`; the
placeholder SSE body from Step 3.3 is gone.

## Files touched

- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-tools.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-transport.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts`
  (placeholder stream replaced with `runAiAgentText`; `AgentPolicyError`
  mapped to the canonical HTTP status)
- `packages/ai-assistant/src/index.ts` (additive re-exports)
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-tools.test.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-runtime.test.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-transport.test.ts` (new)
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/__tests__/route.test.ts`
  (mocks `runAiAgentText`; rewrites the placeholder-stream test into a
  delegation assertion; adds an `AgentPolicyError`-mapping test)

## Unit tests

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
```

Result:

```
Test Suites: 19 passed, 19 total
Tests:       231 passed, 231 total
```

Delta vs Step 3.3 baseline (16/213): **+3 suites, +18 tests**.

New suites / additions:

- `agent-tools.test.ts` — 5 tests (policy-deny throw, feature-deny throw,
  happy-path adapter shape, per-tool skip + warn, unknown-tool skip).
- `agent-runtime.test.ts` — 8 tests (system prompt composition,
  `maxSteps → stopWhen`, `modelOverride` wins, `defaultModel` fallback,
  `resolvePageContext` append, skip when entityType/recordId missing,
  swallow throw, `composeSystemPrompt` unit).
- `agent-transport.test.ts` — 4 tests (default endpoint, endpoint override,
  body + debug merge, pre-existing query param preserved).
- `api/ai/chat/__tests__/route.test.ts` — placeholder test rewritten to
  `delegates to runAiAgentText`; new `AgentPolicyError` mapping test.

## Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

Result:

- `@open-mercato/core:typecheck` — cache hit, pass.
- `@open-mercato/app:typecheck` — one pre-existing diagnostic only:
  `agent-registry.ts(43,7): Cannot find module '@/.mercato/generated/ai-agents.generated'`
  (Step 3.1 carryover — runtime path has a try/catch fallback; unrelated to
  this Step).

Grep-checked `agent-tools`, `agent-runtime`, `agent-transport`, and
`api/ai/chat/route` — no new diagnostics from the four files delivered in
this Step.

## OpenAPI

```
yarn generate
```

- 310 API paths (unchanged from Step 3.3 — this Step touches helper
  libraries + the dispatcher body, not the route surface).
- `aiAssistantChatAgent` operationId still present in
  `apps/mercato/.mercato/generated/openapi.generated.json`.

## i18n / Playwright

No new UI, no new user-facing strings, no new pages. Playwright skipped
per the Step's library-only scope.

## Notable design decisions

- `authContext` is exposed publicly on `RunAiAgentTextInput` as a Phase-1
  shim — the source spec's public shape does not include it, but no
  global request-context resolver exists yet. Phase 4 may wrap this
  behind a thinner API once that lands.
- Attachment ids flow through unchanged — the tool resolver and
  `runAiAgentText` accept `attachmentIds`, but Step 3.7 owns the
  media-type resolution + model-part conversion. The dispatcher keeps its
  `TODO(step-3.7)` comment.
- `resolvePageContext` runs opportunistically when the agent declares one
  AND the request carries both `entityType` and `recordId` AND a DI
  container is passed in. Production agents still have no callback
  declared (that's Step 5.2).
- `agent.maxSteps` maps to `streamText({ stopWhen: stepCountIs(n) })` —
  AI SDK v6 replaced the `maxSteps` field with the `stopWhen` condition.
- Model resolution reuses the existing `llmProviderRegistry` singleton
  (first configured wins). No new model factory — Step 5.1 owns that.
- `createAiAgentTransport` is a thin subclass-free wrapper around
  `DefaultChatTransport` from the AI SDK. UI callers should prefer it
  over hardcoding the `/api/ai_assistant/ai/chat` path because the
  generated route URL may evolve independently of the spec shorthand.
