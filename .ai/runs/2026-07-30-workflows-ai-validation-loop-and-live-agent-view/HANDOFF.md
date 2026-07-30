# HANDOFF — workflows-ai-validation-loop-and-live-agent-view

**Status:** complete (implementation). PR #4719 — flipped to ready. Base `feat/agent-orchestrator-mvp`.
**Owed before merge (enforced by CI + `needs-qa`):** full `yarn lint`/`yarn test`/`yarn build:app`, integration suite, and an `om-auto-review-pr 4719` pass.

## What shipped
- **Phase 1** (`b4bdcd5a9`, `466d4df03`, `b53a62178`): draft agent self-corrects via the read-only `workflows.validate_workflow_definition` tool + `enableTools` loop; fail-closed `INVOKE_AGENT` catalog/prompt from the optional peer.
- **Phase 2** (`68a67b661`): live agent-action view (steps + tool calls) — new `workflows.agent.action` `clientBroadcast` event; enterprise `nativeAgentRunner` emits per step via the existing `onStepFinish`; `useLiveAgentActions` + `AgentActivityPanel` + i18n mounted in the run detail. Token-level streaming deliberately dropped (maintainer decision) — the tool loop uses `generateText`, which can't stream tokens.

## Verified (local)
core+enterprise typecheck 0 errors; workflows Jest 3540/3540; new tests 9/9 (5 ai-authoring + 4 hook).

## If resumed
Everything is done. Remaining work is CI/QA verification + code review, not implementation. To re-open Phase-2 token streaming later, it requires a `generateText`→`streamText` conversion of the shared tool loop (see NOTIFY finding).
