# Step 3.6 — Verification Checks

## Scope

Phase 1 WS-B cross-cutting parity contract tests: assert that
`runAiAgentText` and `runAiAgentObject` share the same policy gate, tool
filtering, prompt composition, and `resolvePageContext` pathway. The
individual Step 3.4 / 3.5 suites exercise each helper in isolation; THIS
Step guards the invariants that MUST hold for BOTH paths.

Closes Phase 3 WS-B.

## Files touched

- `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-runtime-parity.test.ts`
  (new) — **tests only**, no production code changes.

No shared fixture module was extracted — the duplication between the 3.4
/ 3.5 suites is under 50 lines (same `makeAgent`/`makeTool`/`baseAuth`
helpers). Extracting would have forced churn on the existing test files
without reducing real maintenance burden.

## Unit tests

```
cd packages/ai-assistant && npx jest --config=jest.config.cjs --forceExit
```

Result:

```
Test Suites: 21 passed, 21 total
Tests:       265 passed, 265 total
```

Delta vs Step 3.5 baseline (20/239): **+1 suite, +26 tests**.

### Parity invariants exercised

The new suite is organized as one `describe.each` block that runs every
invariant through BOTH helpers (22 paired cases — 11 invariants × 2
helpers) plus 4 non-paired cases (inverse-pair for execution-mode +
type-level + re-export shape):

1. **Missing agent → same code.** Both helpers throw
   `AgentPolicyError('agent_unknown')`; neither calls the SDK mock.
2. **Missing agent feature → same code.** Both throw
   `AgentPolicyError('agent_features_denied')` when
   `authContext.userFeatures` lack the agent's `requiredFeatures`.
3. **Super-admin bypass is symmetric.** Both succeed when
   `authContext.isSuperAdmin` is true even without the declared
   features.
4. **`readOnly` agent with `isMutation` tool → symmetric filtering.**
   Tool is skipped with a `console.warn`; the remaining whitelisted
   tools still resolve. For the chat helper the filtered map reaches
   `streamText`; for the object helper `resolveAiAgentTools` still
   resolves the same map (object-mode does not thread tools into
   `generateObject` — documented in Step 3.5). The mutation tool is
   NEVER adapted for either path.
5. **`resolvePageContext` invocation.** Both helpers call the resolver
   when `entityType + recordId + container` are all supplied, and both
   append its return value to the composed system prompt.
6. **`resolvePageContext` skip.** Both helpers skip silently when
   `entityType` or `recordId` are missing (resolver not called, base
   prompt unchanged).
7. **`resolvePageContext` throw.** Both helpers survive a resolver
   `throw` and continue with the base prompt.
8. **`modelOverride` precedence.** Both helpers prefer `modelOverride`
   over `agent.defaultModel`.
9. **`defaultModel` fallback.** Both helpers fall back to
   `agent.defaultModel` when no override is given.
10. **Attachment ID pass-through.** Both helpers propagate
    `attachmentIds` into `resolveAiAgentTools` unchanged (Phase-1
    behavior — media-type resolution is Step 3.7).
11. **Tool whitelisting.** A tool not in `agent.allowedTools` is never
    adapted for either path. Verified both on the `resolveAiAgentTools`
    return shape AND (for the chat helper) on the `streamText` tools
    map.
12. **Execution-mode inverse pair (2 tests).** Chat-mode agent through
    `runAiAgentObject` and object-mode agent through `runAiAgentText`
    both yield `execution_mode_not_supported`.
13. **Re-export shape.** `AgentPolicyError` thrown by both helpers is
    the same class and carries the same `code` field.
14. **Type-level parity.** Compile-time check: both helpers accept the
    same `AiChatRequestContext` shape.

### Divergences found

**None.** The two helpers produce the exact same observable behavior on
every parity invariant. No production-code patch was required. The one
path-specific behavior is that `runAiAgentObject` does not thread the
resolved tools into `generateObject` (AI SDK v6 object entries do not
accept a `tools` map — documented in Step 3.5 checks). This is not a
parity violation because the tool-RESOLUTION and policy-gate behavior is
identical; only the post-resolution handoff to the SDK differs, and the
test asserts the relevant SDK-level check only for the chat helper.

## Typecheck

```
yarn turbo run typecheck --filter=@open-mercato/core --filter=@open-mercato/app
```

- `@open-mercato/core:typecheck` — cache hit, pass.
- `@open-mercato/app:typecheck` — one pre-existing diagnostic only
  (Step 3.1 carryover: `agent-registry.ts(43,7)` missing
  `@/.mercato/generated/ai-agents.generated`, guarded by runtime
  try/catch). No new diagnostics on `agent-runtime-parity.test.ts`.

## OpenAPI / i18n / Playwright

Not applicable. Tests-only Step.

## Notable design decisions

- **Single file, `describe.each` pattern.** Expressing the parity
  property with `describe.each([textHelper, objectHelper])` keeps the
  invariant side-by-side with its inverse per helper and makes the
  "both paths share this rule" guarantee visible at a glance. The
  execution-mode inverse pair lives in a sibling `describe` block
  because the scenarios are intentionally asymmetric.
- **Shared agent fixture with `output` declared.** Every fixture agent
  in the parity `describe.each` carries `output: parityOutput` so that
  the same fixture satisfies BOTH helper paths: chat-mode ignores
  `output`, object-mode consumes it. Agents do NOT declare
  `executionMode: 'object'` because that would force the chat path to
  fail `execution_mode_not_supported`. See
  `agent-policy.ts` lines 128–146 for the gate math.
- **No shared helper extraction.** The duplication between the 3.4 /
  3.5 / 3.6 suites (`makeAgent`, `makeTool`, `baseAuth`,
  `baseMessages`, SDK-mock setup) is under 50 lines total. Extracting
  would force a touch on the existing Step 3.4 / 3.5 test files
  without reducing maintenance burden. Skipped per the Step brief's
  >50-line threshold.
- **Helper-specific SDK assertion gating.** For parity tests that
  inspect the SDK call (tools map, system prompt), the chat helper
  asserts against the `streamText` mock. The object helper uses
  `generateObject` which does not accept tools — the tool-map
  assertion is gated behind `if (helper === 'text')` so the parity
  check is meaningful for both without asserting a contract AI SDK
  v6 does not support.
- **Registry-load `console.error` noise.** The registry loader emits
  a `console.error` on every test that calls `resolveAiAgentTools`
  (the `@/.mercato/generated/ai-agents.generated` module is not
  emitted in the test harness, but the try/catch keeps the run
  alive). This is identical to the noise pattern in Step 3.4 /
  3.5 tests and was not silenced here either — keeping the harness
  behavior uniform makes the suites cross-comparable.
