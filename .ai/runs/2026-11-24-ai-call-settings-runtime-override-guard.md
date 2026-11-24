# Execution plan — reject per-call `callSettings` when `allowRuntimeOverride: false`

## Goal

An agent that declares `allowRuntimeOverride: false` must not have its model call settings (temperature, topP, maxOutputTokens, stopSequences, seed, penalties) overridden per call. Today `runAiAgentText` / `runAiAgentObject` merge caller `callSettings` over the agent's `modelSettings` without consulting the flag.

## Scope

- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-policy.ts` — new deny code `runtime_override_disabled`.
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts` — guard in both run functions, right after the agent is resolved and before any model work: caller `callSettings` with at least one key + `resolveAllowRuntimeOverride(agent) === false` → `AgentPolicyError('runtime_override_disabled')`.
- `packages/ai-assistant/src/modules/ai_assistant/api/ai/run-object/route.ts` — map the code to HTTP 400 (same code and status the chat route already returns for provider/model overrides); document it in OpenAPI.
- `ai-agent-definition.ts` JSDoc — state that per-call `callSettings` are rejected.
- Unit tests for the runtime guard and the route mapping.

Decision (user): reject with 400, not silently ignore.

## Non-goals

- Forwarding `allowRuntimeOverride` from agent_orchestrator `defineAgent` (contract extension; separate change).
- The agent's own `modelSettings` — still applied unchanged.
- Chat route (does not accept `callSettings`).

## Risks

- Behavior change for callers that send `callSettings` to an agent with `allowRuntimeOverride: false` — they now get 400 instead of a silent override. No in-repo agent sets the flag to `false`. Note in UPGRADE_NOTES if a notes section for the next release exists.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Guard and tests

- [x] 1.1 Add `runtime_override_disabled` deny code and runtime guard in `runAiAgentText` / `runAiAgentObject` — 7ee9585323
- [x] 1.2 Map the code to 400 in the run-object route and document it — 7ee9585323
- [x] 1.3 Unit tests for the guard and route mapping — 7ee9585323

### Phase 2: Validation

- [x] 2.1 Run the validation gate — 90ef1939e0
