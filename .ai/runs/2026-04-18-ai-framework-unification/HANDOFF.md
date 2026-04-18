# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T14:55:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-B progressing (Step 3.5 landed).
Next: Step 3.6 (contract tests for chat-mode + object-mode parity —
shared policy checks).
**Last commit:** `56d06f921` —
`feat(ai-assistant): add runAiAgentObject structured-output helper`

## What just happened

- Executor landed **Step 3.5** as one code commit (`56d06f921`) plus
  this docs-flip commit (PLAN row + HANDOFF rewrite + NOTIFY append).
- `packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts`
  gained a `runAiAgentObject` sibling to `runAiAgentText`. Kept in the
  same file on purpose — reuses `resolveAgentModel` (module-private)
  and `composeSystemPrompt` (exported) directly, no duplication.
  Public surface is identical shape to the source spec §1149–1160:
  `{ agentId, input, attachmentIds?, pageContext?, authContext,
  modelOverride?, output?, debug?, container? }`.
- `resolveAiAgentTools` input gained an optional
  `requestedExecutionMode?: 'chat' | 'object'`, defaulting to `'chat'`
  (preserves the chat dispatcher contract). `runAiAgentObject` passes
  `'object'`, so chat-only agents get rejected at the same agent-level
  policy check the chat pipeline uses — chat-mode and object-mode can
  never diverge on execution-mode validation.
- Object mode calls the AI SDK `generateObject` / `streamObject`
  directly (they accept `schema` + `schemaName` as named args, a 1:1
  match to the spec). Both entries are marked `@deprecated` in `ai@6`
  but remain fully supported; a future Step can migrate to
  `generateText`/`streamText` + `Output.object` without changing the
  public helper shape. Tools are still resolved (the policy gate is
  the whole point) but not threaded into the object-mode SDK calls —
  AI SDK v6's object entries don't accept a `tools` map. See
  `step-3.5-checks.md` for the full rationale.
- Input accepts `string | UIMessage[]` per spec. Strings are wrapped
  into a single user-message `UIMessage`. Arrays flow through
  `convertToModelMessages` untouched (same as chat).
- `mode: 'generate'` (default) returns `{ mode, object, finishReason,
  usage }`. `mode: 'stream'` returns `{ mode, object:
  Promise<TSchema>, partialObjectStream, textStream, finishReason,
  usage }` — the full SDK handle so callers can consume progressive
  hydration, raw text deltas, or just the final parsed object.
- Public surface: `@open-mercato/ai-assistant` now re-exports
  `runAiAgentObject`, `RunAiAgentObjectInput`, `RunAiAgentObjectResult`
  (+ its two concrete variants) and `RunAiAgentObjectOutputOverride`.
- Unit tests: 20 suites / 239 tests in `packages/ai-assistant`
  (baseline 19/231 after Step 3.4; delta **+1 suite, +8 tests**). New
  file: `agent-runtime-object.test.ts`:
  - Happy path — agent-declared `output` + `executionMode: 'object'` +
    `mutationPolicy: 'read-only'` → `generateObject` mock →
    helper returns `{ object, finishReason, usage }`; composed system
    prompt matches the base prompt.
  - Runtime `output` override wins over agent-level `output`.
  - No `output` anywhere → `AgentPolicyError('execution_mode_not_supported')`.
  - Chat-mode agent called via `runAiAgentObject` →
    `execution_mode_not_supported`.
  - Missing `agent.requiredFeatures` → `agent_features_denied`.
  - `modelOverride` wins.
  - `resolvePageContext` hydration appends to the composed system
    prompt.
  - `mode: 'stream'` calls `streamObject` and returns a stream handle;
    iterators yield partial objects + text chunks.
- Typecheck: `yarn turbo run typecheck --filter=@open-mercato/core
  --filter=@open-mercato/app` carries the same pre-existing
  `app:typecheck` error on `agent-registry.ts` (Step 3.1 carryover).
  Grep of the typecheck output for `agent-runtime`, `agent-tools`, and
  `agent-runtime-object` returned **no new diagnostics**.
- `yarn generate` NOT run — Step 3.5 only touches library helpers, no
  route / OpenAPI / module-discovery surface changed. (Step brief
  permits skipping regeneration in this case.)

## Next concrete action

- **Step 3.6** — Spec Phase 1 WS-B — Contract tests for chat-mode +
  object-mode parity (shared policy checks).
  - Expected file: `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-parity.test.ts`
    (or similar) — a dedicated suite that exercises BOTH `runAiAgentText`
    and `runAiAgentObject` and asserts they share the same deny
    behavior on:
    - `agent_unknown`
    - `agent_features_denied`
    - `tool_not_whitelisted` (via the tool-resolution path)
    - `tool_features_denied`
    - `mutation_blocked_by_readonly` / `mutation_blocked_by_policy`
      (only triggers when a write tool is whitelisted — fixture with
      `isMutation: true` tool)
    - `execution_mode_not_supported` (chat agent → object helper AND
      object agent → chat helper)
    - `attachment_type_not_accepted` — deferred? Step 3.7 owns the
      attachment bridge; either parity-test that both paths currently
      skip the attachment check OR add a TODO for Step 3.13.
  - MUST NOT duplicate existing policy-gate tests from
    `agent-policy.test.ts` — this Step's purpose is to prove the two
    helpers share a single enforcement path. A parameterized describe
    block (`describe.each([runAiAgentText, runAiAgentObject])`) is a
    clean way to express this.
  - After 3.6, Phase 3 WS-B closes and Phase 3 WS-C (attachment bridge
    + tool packs) opens.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing — same
  caveat as earlier Steps.
- **`apps/mercato` stale generated import**: `agent-registry.ts(43,7)`
  still references `@/.mercato/generated/ai-agents.generated` which is
  not emitted yet (Step 3.1 carryover). Runtime try/catch hides it;
  TS flags it as a compile-time diagnostic. Still a drive-by
  candidate.
- **Object-mode HTTP dispatcher**: intentionally deferred to Phase 4
  (playground) per the Step brief. Phase 3 only needs the helper to
  work standalone; contract tests in Step 3.6 exercise the helper
  directly.
- **Tools in object mode**: the AI SDK v6 object entries
  (`generateObject` / `streamObject`) don't accept a `tools` map, so
  the object-mode pipeline currently resolves tools (for the policy
  gate) but does NOT pass them to the SDK. Migration to
  `generateText` + `Output.object` would close this gap but was out of
  scope for Step 3.5. Flag for Phase 4 if a concrete agent needs
  tool-backed object mode.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.
- **`authContext` on the public helper surface**: intentional Phase-1
  shim — same caveat as `runAiAgentText`. Phase 4 may wrap both
  helpers behind a thinner API once a global request-context resolver
  lands.
- **Attachment bridge**: `runAiAgentObject` accepts `attachmentIds`
  and passes them to the tool resolver untouched; Step 3.7 owns media
  type resolution + model-part conversion (same carry-forward as
  Step 3.4).

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests only.
- Database/migration state: clean, untouched.
- `yarn generate` NOT re-run this Step (library-only change).
  Regenerating would be a no-op for the API path count.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
