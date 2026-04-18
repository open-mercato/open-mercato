# Step 3.5 — Verification Checks

## Scope

Phase 1 WS-B structured-output support: adds `runAiAgentObject` helper
alongside `runAiAgentText`. Shares the same policy gate, tool resolution,
system-prompt composition, and model resolution pathway as chat-mode.

## Files touched

- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` —
  extended with `runAiAgentObject`, `RunAiAgentObjectInput`,
  `RunAiAgentObjectResult` (generate + stream variants),
  `RunAiAgentObjectOutputOverride`. Shared `resolveAgentModel` and
  `composeSystemPrompt` helpers are reused directly.
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-tools.ts` —
  `ResolveAiAgentToolsInput` gained optional `requestedExecutionMode`
  (defaults to `'chat'`) so the object-mode caller can have the agent-level
  policy gate reject chat-only agents early.
- `packages/ai-assistant/src/index.ts` — additive re-exports for the new
  helper and its types.
- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-runtime-object.test.ts`
  (new) — 8 tests.

## Unit tests

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
```

Result:

```
Test Suites: 20 passed, 20 total
Tests:       239 passed, 239 total
```

Delta vs Step 3.4 baseline (19/231): **+1 suite, +8 tests**.

Tests in `agent-runtime-object.test.ts`:

1. Happy path — agent declares `output` + `executionMode: 'object'` +
   `mutationPolicy: 'read-only'` → `generateObject` mock resolves →
   helper returns the parsed object, `finishReason`, `usage`, and the
   composed system prompt matches the base prompt.
2. Runtime `output` override wins over agent-level `output` (schemaName
   and schema instance replaced).
3. Neither agent nor caller declare a schema → `AgentPolicyError` with
   code `execution_mode_not_supported`; `generateObject` not called.
4. Chat-mode agent (`executionMode: 'chat'`, no `output`) called via
   `runAiAgentObject` → rejected at the policy gate with the same
   `execution_mode_not_supported` code; `generateObject` not called.
5. `agent.requiredFeatures` unmet (non-superadmin caller missing the
   feature) → `AgentPolicyError('agent_features_denied')`.
6. `modelOverride` wins over `agent.defaultModel`.
7. `resolvePageContext` with `entityType + recordId + container` is
   invoked and its return value is appended to the composed system
   prompt.
8. `mode: 'stream'` path calls `streamObject` and returns `{ object,
   partialObjectStream, textStream, finishReason, usage }` (stream
   consumption verified by iterating each async iterable).

## Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

- `@open-mercato/core:typecheck` — cache hit, pass.
- `@open-mercato/app:typecheck` — one pre-existing diagnostic only
  (Step 3.1 carryover: `agent-registry.ts(43,7)` missing
  `@/.mercato/generated/ai-agents.generated`, guarded by runtime
  try/catch). Grep of the typecheck output for `agent-runtime`,
  `agent-tools`, and `agent-runtime-object` returned no new
  diagnostics.

## OpenAPI / i18n / Playwright

Not applicable. This Step only adds a library helper — no route surface,
no user-facing strings, no UI.

## Notable design decisions

- **Single-file placement.** `runAiAgentObject` lives in
  `agent-runtime.ts` next to `runAiAgentText`, reusing the
  module-private `resolveAgentModel` + `composeSystemPrompt` directly.
  Splitting into `agent-runtime-object.ts` would have forced either a
  duplication of `resolveAgentModel` or a new shared module — extra
  churn for no isolation gain since both helpers are part of the same
  public surface.
- **AI SDK entry choice.** Uses `generateObject` / `streamObject`
  directly rather than `generateText({ output: Output.object(...) })`.
  Both paths are supported by the installed `ai@^6.0.33`; the former
  maps 1:1 to the spec's `{ schemaName, schema, mode }` fields
  (`schemaName` flows straight through as a named argument), making
  the adapter trivial and removing an indirection layer. The
  `generateObject`/`streamObject` functions carry a `@deprecated` JSDoc
  noting the `generateText`-with-output path as the future direction,
  but they remain fully supported in v6 and match the spec's public
  contract exactly. A future Step can migrate the internal call to
  `generateText` + `Output.object` without changing the helper's public
  shape if and when AI SDK v7 removes the deprecated entry point.
- **Dispatcher exposure deferred to Phase 4.** Per the Step brief,
  object-mode over HTTP is out of scope. The existing chat dispatcher
  at `POST /api/ai/chat` stays chat-only; callers that need
  structured output call `runAiAgentObject` from their own route
  handlers. Phase 4 can add `?mode=object` branching or a separate
  route when the playground lands.
- **`requestedExecutionMode` plumbing.** `resolveAiAgentTools` gained
  an optional `requestedExecutionMode` parameter, defaulting to
  `'chat'` to preserve the existing chat dispatcher contract.
  `runAiAgentObject` passes `'object'` so the policy gate can reject
  chat-only agents at the agent-level check (single point of truth
  shared with the chat path — chat-mode and object-mode can never
  diverge on this rule).
- **Input normalization.** `input` accepts `string | UIMessage[]` per
  spec §1149–1160. Strings are wrapped into a single-user-message
  UIMessage; arrays flow through `convertToModelMessages` untouched.
- **Schema type parameter.** The helper is generic over `TSchema` (not
  `ZodTypeAny` — the spec allows `ZodTypeAny | StandardSchemaV1`). The
  internal narrowing to the AI SDK uses a single `as never` cast to
  bridge the two-type schema surface the SDK's `FlexibleSchema<T>`
  generic exposes.
- **Stream-mode return shape.** Returns the full SDK handle
  (`object`/`partialObjectStream`/`textStream`/`finishReason`/`usage`)
  rather than a subset so callers can consume partial hydration,
  raw text deltas, or just the final object without re-calling.
- **Tools in object mode.** Tools are resolved via
  `resolveAiAgentTools` (same path as chat) but not passed to
  `generateObject`/`streamObject` — the AI SDK v6 object entries do
  not accept a `tools` map. The resolution still runs so the policy
  gate rejects invalid agents and so a future Step can thread tools
  through once `generateText` + `Output.object` is adopted. Variable
  is referenced via `void tools` to silence the linter without
  dropping the side effect.
- **`maxSteps`/`stopWhen` in object mode.** Forwarded as an untyped
  field (`generateArgs as Record<string, unknown>) stopWhen`) because
  the SDK's object-mode signature does not declare `stopWhen`; most
  providers ignore it, but any that respect the hint get it.
