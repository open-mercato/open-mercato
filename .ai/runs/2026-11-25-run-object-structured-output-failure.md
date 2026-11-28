# Execution plan — run-object structured-output failure returns 500

## Goal

`POST /api/ai_assistant/ai/run-object` answers `502` with a stable `structured_output_invalid` code, not a generic `500 internal_error`, when the model's answer does not match the agent's output schema or the tool loop ends without a final answer.

## Context

Found while reviewing #10504. It was already there before that PR.

- `runAiAgentObject` (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts`) calls the AI SDK's `generateObject` (toolless path) or `generateText({ output: Output.object })` (tool-loop path). When the answer does not fit the schema, the SDK throws `AI_NoObjectGeneratedError`. When the tool loop ends without a final answer, it throws `AI_NoOutputGeneratedError`.
- The route's catch-all (`api/ai/run-object/route.ts`) turns both into `500 internal_error` and logs them at error level. Clients cannot tell "the model gave an unusable answer, retrying may help" from a real server fault.
- Agent-orchestrator agents dispatched through the same route already classify these errors (`packages/enterprise/src/modules/agent_orchestrator/lib/runtime/structuredOutputFailure.ts`). Only the locally run path is affected.

## Scope

- `run-object/route.ts`: recognise both SDK errors (directly or as `cause`) and return `502 { error, code: 'structured_output_invalid' }` with a fixed message that never echoes the model's text. Log a warning and report through `reportAiAssistantError`. Document the status in the route's `openApi.errors`.
- Unit tests in `run-object/__tests__/route.test.ts`.
- One sentence in `apps/docs/docs/framework/ai-assistant/agents.mdx`.

## Non-goals

- Callers that use `runAiAgentObject` directly (workflows draft runner, Discord auto-reply, MCP agent tools). They have their own error handling.
- Repairing or retrying the model's answer.
- The pre-existing catch-all 500 path, apart from leaving it unchanged.

## Implementation Plan

### Phase 1: Map structured-output failures

- 1.1 Route maps `AI_NoObjectGeneratedError` / `AI_NoOutputGeneratedError` to 502 `structured_output_invalid`, plus OpenAPI error entry
- 1.2 Route unit tests: both errors, the wrapped-`cause` case, no model text in the body, and an unrelated error staying a 500

### Phase 2: Docs

- 2.1 Document the 502 `structured_output_invalid` response in `agents.mdx`
- 2.2 Run the validation gate

## Risks

- Moving from 500 to 502 is visible to any client that checks the status. The new code is additive, and the old 500 was documented only as "internal runtime failure". Call it out in the PR.
- The AI SDK's `isInstance` uses a global symbol marker, so detection survives duplicate copies of the `ai` package.

## Progress

PR: #10637

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Map structured-output failures

- [x] 1.1 Route maps AI_NoObjectGeneratedError / AI_NoOutputGeneratedError to 502 structured_output_invalid, plus OpenAPI error entry — c2163e4f1b
- [x] 1.2 Route unit tests: both errors, the wrapped-cause case, no model text in the body, and an unrelated error staying a 500 — 35dd042425

### Phase 2: Docs

- [x] 2.1 Document the 502 structured_output_invalid response in agents.mdx — 0b3b5421f9
- [x] 2.2 Run the validation gate — gate green (local mode)
