# HANDOFF — workflows-ai-validation-loop-and-live-agent-view

**Resume pointer:** Step 1.1 (todo) — add the `workflows.validate_workflow_definition` AI tool.

## State
- Worktree: `/Users/pat-lewczuk/projects/open-mercato/2/wt-workflows-ai-loop`
- Branch: `feat/workflows-ai-validation-loop-and-live-agent-view` off `origin/feat/agent-orchestrator-mvp` (`8e549eb13`).
- Base branch is unmerged WIP (maintainer-approved; `develop` lacks the target code).
- Run folder committed; draft PR: (pending open).

## Next actions (in order)
1. Phase 1 Steps 1.1–1.5 (core only) — the immediate fix for the reported `INVOKE_AGENT` `agentId`/`onResult` draft failure.
2. Phase 2 Steps 2.1–2.4 (ai-assistant → enterprise → core) — live agent-action streaming. Larger; may be resumed in a later invocation.

## Key references (from research, base tip 8e549eb13 — verify line numbers still hold)
- Tool-loop path already exists: `runAiAgentObject({ enableTools: true })` → `Output.object` (`packages/ai-assistant/src/modules/ai_assistant/lib/agent-runtime.ts`).
- Tool context type `McpToolContext` (`.../lib/types.ts`) gives `container` for server-side validation.
- Phase 1 files: `packages/core/src/modules/workflows/{ai-agents.ts,ai-tools.ts(new),lib/ai-authoring.ts,lib/ai-draft-runner.ts,api/definitions/generate/route.ts}`.
- Validators: `packages/core/src/modules/workflows/data/{validators.ts,activity-config-schemas.ts}`.
