# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T10:00:12Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 2 fully landed (all of spec Phase 0);
Phase 3 / Step 3.1 is next. Attachment-bridge contract types,
prompt-composition primitive types, restored loader, and Phase 0
additive-contract regression suite are all in place.
**Last commit:** `1e8e9d134` —
`test(ai-assistant): add phase 0 additive-contract regression suite`

## What just happened

- Executor subagent landed **Step 2.5** as a single code commit
  (`1e8e9d134`) plus this docs-flip commit.
- New test file
  `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/phase-0-additive-contract.test.ts`
  (12 tests across 4 top-level describes):
  1. restored module-tool loading is additive — plain-object
     `aiTools[]` exports register through `registerGeneratedAiToolEntries`,
     resolve through `mcp-tool-adapter`, are idempotent on re-run, and
     modules without an `ai-tools.ts` stay silent.
  2. `defineAiTool()` output and plain-object `AiToolDefinition` are
     structurally equivalent on required fields; both are assignable to
     `AiToolDefinition` and `McpToolDefinition`; both register through
     the same loader path. Documents the current behavior that the
     loader stores the `McpToolDefinition` subset (additive fields like
     `displayName` / `tags` / `isMutation` / `maxCallsPerTurn` /
     `supportsAttachments` are dropped at registration — Phase 3 WS-A /
     Step 3.1 is the right place to preserve them when the agent
     runtime lands).
  3. `ai-agents.generated.ts` discovery is additive — fixtures with both
     `aiToolConfigEntries` and `aiAgentConfigEntries` load tools
     correctly and do NOT register agent IDs as tools; legacy-only and
     agents-only fixtures both load cleanly.
  4. generator output is stable across runs — `createAiAgentsExtension()`
     produces byte-identical output across two factory instances and
     across two `generateOutput()` calls on the same instance. Imported
     via a relative path into `packages/cli` to keep the whole
     regression suite in ONE file.
- Unit tests: 13/13 suites, 179/179 tests in `packages/ai-assistant`
  (baseline 12/167; delta +1 suite, +12 tests). `packages/cli`
  33/33 suites, 787/787 tests (unchanged from baseline).
- Typecheck: `@open-mercato/core:typecheck` green (cache hit);
  `@open-mercato/app:typecheck` still fails on the pre-existing stale
  `example/customer-tasks/page` entry in `backend-routes.generated.ts`
  (documented since Step 2.3). Grep of typecheck output for
  `phase-0-additive` matched zero lines — new file produces no
  diagnostics.

## Next concrete action

- **Step 3.1** — Spec Phase 1 WS-A — `agent-registry.ts` loads
  `ai-agents.generated.ts` and exposes a typed lookup API.
  - New file pointer:
    `packages/ai-assistant/src/modules/ai_assistant/lib/agent-registry.ts`.
  - Contract: typed `getAgent(id)`, `listAgents()`,
    `listAgentsByModule(moduleId)` surfaced; lazy-loaded from
    `@/.mercato/generated/ai-agents.generated` with graceful fallback
    when the file is missing (tests, pre-generate builds) — mirror the
    shape of `loadGeneratedModuleAiTools()` from Step 2.3.
  - Export surface: add to `packages/ai-assistant/src/index.ts`
    additively.
  - Unit tests: fixture agents via `defineAiAgent`, lookup by id +
    module, unknown-agent returns `undefined`, missing-generated-file
    returns empty registry without throw.
  - Phase 3 is UI-less through Step 3.10 — no Playwright / screenshots.
    Step 3.3 (dispatcher HTTP route) and Step 3.6 (contract tests)
    remain integration-test anchors, not UI.
- Phase 3 Workstream A runs Steps 3.1 → 3.3 back-to-back (registry →
  policy gate → HTTP dispatcher). Keep each Step to one commit.

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing. The
  package has no `tsc --noEmit` npm script, so we lean on focused
  standalone typecheck projects for Step-level checks. Candidate for a
  Phase 5 cleanup Step.
- **`apps/mercato` stale generated route**: pre-existing
  `example/backend/customer-tasks/page` entry in
  `backend-routes.generated.ts` blocks `@open-mercato/app:typecheck`.
  Unrelated to AI work; consider a drive-by `yarn generate` Step if it
  persists into Phase 3.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) remains
  out-of-scope. Step 2.5 read the committed HEAD view of the spec
  only.
- **Loader drops additive tool fields**: documented finding — Step 3.1
  should either widen `McpToolDefinition` to include the additive fields
  or keep the registry `AiToolDefinition`-aware. Decision to be
  recorded in Step 3.1 checks.

## Environment caveats

- Dev runtime runnable: unknown. Phase 3 through Step 3.10 is
  runtime + tests-only (no UI), so Playwright stays N/A. Phase 3
  integration tests (Step 3.6, 3.13) may exercise `apiCallOrThrow`
  against in-process mocks if the dev env is unrunnable.
- Database/migration state: clean, untouched. First migration lands
  in Phase 5 (Step 5.5, `AiPendingAction` table).
- `yarn generate` will regenerate
  `apps/mercato/.mercato/generated/ai-tools.generated.ts` and
  `ai-agents.generated.ts` on next run; Step 2.2 already wired the
  generator, Step 2.3 the loader, Step 2.5 the regression coverage.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree). Documented dogfood exception (see earlier NOTIFY
  entries). Any follow-up PR spun out of Phase 2+ MUST use an isolated
  worktree per the skill default.
