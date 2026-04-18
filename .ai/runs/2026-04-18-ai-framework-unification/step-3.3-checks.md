# Step 3.3 — Verification Checks

**Title:** Spec Phase 1 WS-A — `POST /api/ai/chat?agent=<module>.<agent>` route with `metadata` + `openApi`.

## Scope

- New file `packages/ai-assistant/src/modules/ai_assistant/api/ai/chat/route.ts`
  exposing the dispatcher HTTP endpoint for focused AI agents.
- Effective URL under the module-id-prefixed routing discipline is
  `/api/ai_assistant/ai/chat` (the spec text uses `/api/ai/chat` as shorthand;
  the source file layout matches the planned `api/ai/chat/route.ts` path).
- Placeholder streaming body marked with a `TODO(step-3.4)` comment — the
  AI SDK transport wiring (`createAiAgentTransport`, `runAiAgentText`) lands
  in Step 3.4.
- Attachment media-type resolution is intentionally deferred — `attachmentMediaTypes`
  is always passed as `undefined` to `checkAgentPolicy` in Phase 3.3 because
  the attachment-bridge conversion surface lands in Step 3.7.

## Unit Tests

Command: `npx jest --config=jest.config.cjs --forceExit` (run from `packages/ai-assistant`).

Scoped run (new test file only):

```
PASS src/modules/ai_assistant/api/ai/chat/__tests__/route.test.ts
  POST /api/ai/chat
    ✓ returns 401 when unauthenticated
    ✓ returns 400 when the agent query param is missing
    ✓ returns 400 when the agent query param is malformed
    ✓ returns 400 when body fails zod validation (missing messages)
    ✓ returns 400 when messages exceed the cap
    ✓ returns 404 for an unknown agent
    ✓ returns 403 when the agent requires features the user lacks
    ✓ returns 409 when an object-mode agent is invoked via chat transport
    ✓ streams a placeholder SSE response on successful policy check
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

Full package run (post-change baseline):

```
Test Suites: 16 passed, 16 total
Tests:       213 passed, 213 total
```

Delta vs Step 3.2 baseline: +1 suite, +9 tests (Step 3.2 baseline was 15/204).

## Typecheck

No package-level `tsc --noEmit` script exists in `packages/ai-assistant` (pre-existing
gap noted in Step 3.2 HANDOFF). Grepped the monorepo for diagnostics that reference
the new route path — zero new matches:

```
Grep "api/ai/chat/route" or "aiAssistantChatAgent" in tsc output → no new diagnostics
```

## OpenAPI Generation

`yarn generate` completed successfully and picked up the new route:

```
[OpenAPI] Found 310 API route files
[OpenAPI] Bundle approach: 310 paths, 242 with requestBody schemas
Generated apps/mercato/.mercato/generated/openapi.generated.json
```

The generated JSON contains:

- path `/api/ai_assistant/ai/chat`
- operationId `aiAssistantChatAgent`
- tag `AI Assistant`
- parameter `agent` (query, required, pattern `^[a-z0-9_]+\.[a-z0-9_]+$`)
- requestBody JSON schema with required `messages` (min 1, max 100), optional
  `attachmentIds`, `debug`, `pageContext`
- responses: 200 (text/event-stream), 400, 401, 403, 404, 409, 500
- `x-require-auth: true` and `x-require-features: ['ai_assistant.view']`

## Backward Compatibility

- Surface 7 (API route URLs): additive only — new path. Legacy `/api/ai_assistant/chat`
  OpenCode route remains untouched.
- Surface 2 (Types): `AiChatRequest` is a new local `z.infer` type at the route
  file; no public package-level type rename.
- No other contract surfaces affected.

## Playwright / Integration

N/A — no UI in this Step. Integration coverage for the dispatcher runtime
is scheduled for Step 3.13.

## Notes

- Placeholder SSE body uses `data: {"type":"text","content":"..."}\n\n`
  followed by `data: [DONE]\n\n`, and advertises `Content-Type: text/event-stream`
  so contract tests in later Steps can exercise the stream shape before the
  real transport lands.
- `checkAgentPolicy` is invoked with `requestedExecutionMode: 'chat'` so that
  agents declared as `executionMode: 'object'` reject chat-transport dispatch
  with `409 execution_mode_not_supported`.
