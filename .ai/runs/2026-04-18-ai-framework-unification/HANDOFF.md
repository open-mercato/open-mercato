# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T16:10:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 3 WS-B **closed** (Steps 3.4 / 3.5 / 3.6
all landed). Phase 3 WS-C **opens** next with Step 3.7.
**Last commit:** `34e50e455` —
`test(ai-assistant): add chat/object runtime parity contract tests`

## What just happened

- Executor landed **Step 3.6** as one code commit (`34e50e455`) plus
  this docs-flip commit (PLAN row + HANDOFF rewrite + NOTIFY append).
  Closes Phase 3 WS-B.
- New test file:
  `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/agent-runtime-parity.test.ts`.
  Tests-only Step — no production code touched.
- Parity invariants guarded (all paired via `describe.each` unless
  noted):
  1. `agent_unknown` deny on both helpers.
  2. `agent_features_denied` on both helpers.
  3. Super-admin bypass symmetric on both helpers.
  4. `readOnly` agent with `isMutation` tool in `allowedTools` is
     filtered out with `console.warn` + continue — identical on both
     helpers. Mutation tool never adapted for the model on either
     path.
  5. `resolvePageContext` invocation, skip, and throw-survival all
     identical on both helpers.
  6. `modelOverride` precedence + `agent.defaultModel` fallback
     identical on both helpers.
  7. `attachmentIds` pass-through to `resolveAiAgentTools` identical
     (Phase-1 behavior — Step 3.7 owns media-type resolution).
  8. Non-whitelisted tools never reach either path.
  9. Inverse-pair: object-mode agent → `runAiAgentText` AND chat-mode
     agent → `runAiAgentObject` both yield
     `execution_mode_not_supported`.
  10. `AgentPolicyError` structural parity (same class, same `code`
      field shape).
- **No production divergence found.** Every invariant observes the
  same behavior across both helpers with the existing Step 3.4 + 3.5
  code as-is. Zero source-file patches in this Step.
- No shared-fixture module extracted — duplication between 3.4 / 3.5
  / 3.6 suites is under the 50-line threshold, so the Step brief
  opts-out is triggered.
- Unit tests: 21 suites / 265 tests in `packages/ai-assistant`
  (baseline 20/239 after Step 3.5; delta **+1 suite, +26 tests**).
- Typecheck: `yarn turbo run typecheck --filter=@open-mercato/core
  --filter=@open-mercato/app` carries the same pre-existing
  `app:typecheck` error on `agent-registry.ts` (Step 3.1 carryover).
  Grep of the typecheck output for `agent-runtime-parity` returned
  **no new diagnostics**.
- `yarn generate` NOT run — Step 3.6 only adds a test file, no
  route / OpenAPI / module-discovery surface changed.

## Next concrete action

- **Step 3.7** — Spec Phase 1 WS-C — Attachment-to-model conversion
  bridge (images / PDFs / text-like / metadata-only).
  - Expected file: new
    `packages/ai-assistant/src/modules/ai_assistant/lib/attachment-parts.ts`
    (spec line 77) plus wiring into `runAiAgentText` +
    `runAiAgentObject` so the resolved `AiResolvedAttachmentPart[]`
    from Step 2.4 actually reaches the model-message layer.
  - The existing `attachmentIds` pass-through (Step 3.4 / 3.5 / 3.6
    invariant #10) becomes the load-bearing bridge: Step 3.7 wires
    the resolver into both helpers with the same API surface.
  - Scope:
    1. New module `attachment-parts.ts` that loads attachments by id,
       classifies media type per `AiAgentAcceptedMediaType`
       (`image` / `pdf` / `file`), and emits the contract-typed parts
       from Step 2.4 (`bytes` / `signed-url` / `text` /
       `metadata-only`).
    2. Thread the resolver into `runAiAgentText` (chat message parts)
       AND `runAiAgentObject` (system prompt / message parts per SDK
       v6 object-mode capabilities) with the same code path —
       preserves the parity guarantee Step 3.6 just locked in.
    3. Unit tests for all four source kinds; integration-test is
       Step 3.13.
  - First Phase 3 WS-C Step — opens the "Files + tool packs"
    workstream.
  - After 3.7 comes 3.8 (general-purpose tool packs) and the
    customers / catalog tool packs in 3.9–3.12.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing — same
  caveat as earlier Steps.
- **`apps/mercato` stale generated import**: `agent-registry.ts(43,7)`
  still references `@/.mercato/generated/ai-agents.generated` which
  is not emitted yet (Step 3.1 carryover). Runtime try/catch hides
  it; TS flags it as a compile-time diagnostic. Still a drive-by
  candidate.
- **Attachment bridge**: Step 3.7 is the load-bearing bridge (new
  file `attachment-parts.ts`). All three WS-B helpers currently pass
  `attachmentIds` through to the tool resolver untouched.
- **Object-mode HTTP dispatcher**: intentionally deferred to Phase 4
  (playground). Phase 3 only needs the helpers to work standalone;
  contract tests in this Step exercise the helpers directly.
- **Tools in object mode**: the AI SDK v6 object entries
  (`generateObject` / `streamObject`) don't accept a `tools` map, so
  the object-mode pipeline currently resolves tools (for the policy
  gate) but does NOT pass them to the SDK. Migration to
  `generateText` + `Output.object` would close this gap but remains
  out of scope for Phase 3. Flag for Phase 4 if a concrete agent
  needs tool-backed object mode.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) still
  out-of-scope.
- **`authContext` on the public helper surface**: intentional Phase-1
  shim on both helpers. Phase 4 may wrap them behind a thinner API
  once a global request-context resolver lands.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 remains runtime + tests
  only.
- Database/migration state: clean, untouched.
- `yarn generate` NOT re-run this Step (tests-only change).
  Regenerating would be a no-op for the API path count.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree — documented dogfood exception).
