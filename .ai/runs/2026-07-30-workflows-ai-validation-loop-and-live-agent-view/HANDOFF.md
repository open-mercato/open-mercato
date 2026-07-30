# HANDOFF — workflows-ai-validation-loop-and-live-agent-view

**Resume pointer:** Step 2.1 (todo) — ai-assistant: optional `onAgentAction` observer on `runAiAgentObject`.
**PR:** #4719 (draft, in-progress) · base `feat/agent-orchestrator-mvp`.
**Resume with:** `om-auto-continue-pr-loop 4719`.

## Done (Phase 1 — verified)
- 1.1–1.4 (`b4bdcd5a9`): `workflows.validate_workflow_definition` read-only tool; agent allows it + `loop.budget`; runner `enableTools: true`; fail-closed `INVOKE_AGENT` catalog/prompt fed from the optional `agentWorkflowBridge`.
- 1.5 (`466d4df03`): module AGENTS.md note.
- Verification: `@open-mercato/core` typecheck clean (0 errors); `ai-authoring.test.ts` 5/5.

## Todo (Phase 2 — cross-package, not started)
- 2.1 ai-assistant: optional `onAgentAction` observer → `streamObject` path in `runAiAgentObject` (`packages/ai-assistant/.../lib/agent-runtime.ts`). Additive; default path unchanged.
- 2.2 enterprise: DI-resolved relay (events NOTIFY dedicated channel, or DI Redis) + publish deltas in `nativeAgentRunner.ts`; backpressure; best-effort.
- 2.3 core: SSE `GET /api/workflows/instances/[id]/agent-stream` (auth, tenant/org scope, 404 foreign, auto-close).
- 2.4 core: `useLiveAgentActions` hook + run-view "Agent activity" panel + i18n (`en/pl/de/es`).

## Environment notes (important for resume)
- Worktree needs bootstrap before typecheck: `yarn build:packages` → `yarn generate` → typecheck. (CLI must be built for `yarn generate`.)
- `yarn generate` emits UNRELATED side-effects in a fresh worktree (deletes `docker/opencode/*`, touches `packages/enterprise/.../generated/file-agents.generated.ts`). Restore them (`git checkout -- docker/ packages/enterprise/.../file-agents.generated.ts`) before staging so commits stay clean.
- Run jest from `packages/core` (its `jest.config.cjs`), not repo root (root invocation hits TS5011).
- Full 8-command validation gate + integration suite still owed at Phase 2 completion.
