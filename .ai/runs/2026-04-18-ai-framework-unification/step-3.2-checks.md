# Step 3.2 — Verification checks

**Branch:** `feat/ai-framework-unification`
**Step:** 3.2 — Spec Phase 1 WS-A — Runtime policy checks
(`requiredFeatures`, `allowedTools`, `readOnly`, attachment access,
`executionMode`).

## Deliverables

- New file:
  `packages/ai-assistant/src/modules/ai_assistant/lib/agent-policy.ts`
  - `checkAgentPolicy(input): AgentPolicyDecision` — pure policy-gate
    helper that consumes the agent registry + tool registry + auth
    context and returns a typed allow/deny decision.
  - Deny codes: `agent_unknown`, `agent_features_denied`,
    `tool_not_whitelisted`, `tool_unknown`, `tool_features_denied`,
    `mutation_blocked_by_readonly`, `mutation_blocked_by_policy`,
    `execution_mode_not_supported`, `attachment_type_not_accepted`.
  - No HTTP, no AI SDK wiring, no attachment fetching, no pending-action
    creation.
- Updated: `packages/ai-assistant/src/index.ts` — re-exports
  `checkAgentPolicy` and the 4 types.
- New tests: `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-policy.test.ts`
  — 17 tests covering every deny code + success paths + super-admin
  bypass + default-read-only behavior.

## Unit tests

Command:
```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
```

Result: **15 suites / 204 tests — all passing**.
Delta vs Step 3.1 baseline (14 suites / 187 tests): **+1 suite, +17
tests**.

## Typecheck

Command:
```
yarn turbo run typecheck --filter=@open-mercato/ai-assistant \
  --filter=@open-mercato/core --filter=@open-mercato/app
```

Result:
- `@open-mercato/core:typecheck` — cache hit, green.
- `@open-mercato/ai-assistant` has no standalone `typecheck` script
  (pre-existing gap tracked in HANDOFF.md / Phase 5 cleanup).
- `@open-mercato/app:typecheck` fails on the pre-existing
  `backend-routes.generated.ts` stale `example/customer-tasks/page`
  entry (unrelated to this Step, documented in HANDOFF.md).

Grep over the full typecheck output for `agent-policy` / `agent_policy`:
zero matches. No new diagnostics introduced by this Step.

## i18n / Playwright / generate

N/A — library-only change, no UI, no routes, no generated files, no
user-facing strings.

## BC check

- Contract surfaces 2 (types) and 3 (function signatures): additive
  only. `checkAgentPolicy` is a new export; no existing export signature
  changed.
- Surface 10 (ACL feature IDs): no feature IDs introduced or renamed;
  policy helper reads features through `hasRequiredFeatures`.
- Surface 4 (import paths): new re-export added to
  `@open-mercato/ai-assistant`, nothing moved or removed.

## Known gotchas carried forward (documented in NOTIFY)

- `toolRegistry.getTool()` returns `McpToolDefinition` at its declared
  surface; Step 2.5 flagged that the additive `AiToolDefinition` fields
  (`displayName`, `tags`, `isMutation`, `maxCallsPerTurn`,
  `supportsAttachments`) are not projected through this path for tools
  registered via `registerMcpTool`.
- `checkAgentPolicy` casts the registry result to `AiToolDefinition` and
  reads `isMutation` off the same object. Tools that were registered
  with `isMutation: true` via a plain-object literal DO retain the field
  (it sits on the same object reference), so the cast is BC-safe for
  current call sites.
- Tools that end up without `isMutation` (e.g. because they flowed
  through a projection that dropped it) are treated as non-mutation by
  default. This mirrors the spec's "mutation defaults to false" rule and
  stays safe: the mutation gates only fire when `isMutation === true`.
- A future widening of `McpToolDefinition` (tracked by Step 2.5) will
  automatically lift this limitation without requiring any change to
  `agent-policy.ts`.
