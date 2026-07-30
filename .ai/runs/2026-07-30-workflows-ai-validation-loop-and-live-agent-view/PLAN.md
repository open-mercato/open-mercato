# Execution Plan — Workflows AI: Draft Validation Loop & Live Agent-Action View

- **Slug:** workflows-ai-validation-loop-and-live-agent-view
- **Branch:** feat/workflows-ai-validation-loop-and-live-agent-view
- **Base branch:** feat/agent-orchestrator-mvp (per maintainer decision — `develop` lacks the AI-draft feature and the agent_orchestrator peer; both live only on this WIP stack, base tip `8e549eb13`)
- **Source doc:** .ai/specs/2026-07-30-workflows-ai-validation-loop-and-live-agent-view.md
- **Engine:** om-auto-create-pr-loop (spec-implementation run; cross-package)
- **Status:** in-progress

## Tasks

| Phase | Step | Title | Exec | Status | Commit |
|-------|------|-------|------|--------|--------|
| 1 | 1.1 | Add `workflows.validate_workflow_definition` AI tool (`ai-tools.ts`) + unit tests | inline | todo | |
| 1 | 1.2 | Extend `WorkflowDraftCatalog`/`buildWorkflowDraftCatalog` with `agents` + fail-closed prompt rule + unit tests | inline | todo | |
| 1 | 1.3 | Wire agents list into generate route from optional `agentWorkflowBridge.listAgentOutcomeContracts?.()` | inline | todo | |
| 1 | 1.4 | Enable tool loop: `ai-agents.ts` (allowedTools/loop/header) + `ai-draft-runner.ts` `enableTools:true` + `yarn generate` | inline | todo | |
| 1 | 1.5 | Docs: module `AGENTS.md` AI table + draft doc-comments | inline | todo | |
| 2a | 2.1 | ai-assistant: optional `onAgentAction` observer on `runAiAgentObject` (stream path) + unit test | inline | todo | |
| 2b | 2.2 | enterprise: DI-resolved relay transport + publish `onAgentAction` in `nativeAgentRunner` + backpressure + tests | dispatch | todo | |
| 2c | 2.3 | core: SSE endpoint `GET /api/workflows/instances/[id]/agent-stream` + tests | dispatch | todo | |
| 2c | 2.4 | core: `useLiveAgentActions` hook + run-view "Agent activity" panel + i18n + tests | dispatch | todo | |

> Convention: `todo` → `wip` → `done`. Append the commit SHA to the row when a Step lands. 1 Step = 1 commit.

## Goal

Implement the spec end-to-end in one PR (per explicit user direction): (1) turn the single-shot workflow-draft AI agent into a tool-loop that self-corrects via a read-only `validate_workflow_definition` tool, with a fail-closed `INVOKE_AGENT` catalog; (2) stream each agent action (incl. token-level thinking text) of an `INVOKE_AGENT` activity into the run view live and ephemerally, via a worker→browser relay + a dedicated per-run SSE channel.

## Scope

- Phase 1: core only (`packages/core/src/modules/workflows/`).
- Phase 2: `packages/ai-assistant` (additive observer) → `packages/enterprise` agent_orchestrator (relay producer) → `packages/core` workflows (SSE endpoint + run-view UI).

## Non-goals

- Persisting/replaying agent traces (spec = ephemeral, live-only).
- Streaming for non-`INVOKE_AGENT` activity types.
- Changing the `agentWorkflowBridge` interface (relay emitter is internal to the runner).

## Risks

- **Base is unmerged WIP** (feat/agent-orchestrator-mvp, 525 ahead of develop): the PR stacks on a moving branch; must be merged in order after the base lands.
- **Phase 2 is realistically 3 coordinated sub-PRs** compressed into one; token-streaming-through-a-worker-relay is the central complexity. Likely ends this invocation `in-progress` with Phase 2 as `todo`, to be resumed via `om-auto-continue-pr-loop`.
- Full monorepo validation gate (8 commands incl. builds) is long; targeted validation per checkpoint, full gate at completion.

## Progress notes

See HANDOFF.md (resume pointer) and NOTIFY.md (append-only log).
