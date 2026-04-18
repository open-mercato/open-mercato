# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T09:40:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
`auto-continue-pr` `in-progress` lock — release queued at end of run)
**Current phase/step:** Phase 2 / Step 2.1 landed. First actionable code
Step of the spec (Phase 0 Alignment Prerequisite) is committed.
**Last commit:** `a6191c741` —
`feat(ai-assistant): add AiAgentDefinition type and defineAiTool() helper`

## What just happened

- Session reopened on PR #1593 via `/auto-continue-pr`. No previous
  owner — claimed `in-progress` label + assignee + comment.
- Read `HANDOFF.md` (previous session ended at Step 1.2 rephasing),
  skimmed `NOTIFY.md` tail, parsed the Tasks table — first `todo` row
  was Step 2.1.
- Read the source spec §1 (Additive Tool Builder), §2 (Module-Owned
  Sub-Agents type definition), §3 (Standard Agent Runtime rules), and
  §Data Models (`AiToolDefinition`, `AiAgentDefinition`).
- **Step 2.1** committed as `a6191c741`:
  - New `ai-agent-definition.ts` with `AiAgentDefinition`, supporting
    type aliases, and `defineAiAgent()`.
  - New `ai-tool-definition.ts` with `defineAiTool()`.
  - Extended `AiToolDefinition` with five optional focused-agent fields
    (`displayName`, `tags`, `isMutation`, `maxCallsPerTurn`,
    `supportsAttachments`). `McpToolDefinition` unchanged.
  - Public re-exports from `@open-mercato/ai-assistant`.
  - New test file `ai-agent-definition.test.ts` (7 cases). All 150
    package tests pass.
  - Pre-existing cross-package typecheck failures (`@open-mercato/events`
    missing `sanitize-html`, `@open-mercato/core` missing `pdfjs-dist` /
    `mammoth` / `@dnd-kit/*`, `DataTable.tsx` implicit-anys) reproduced
    by stashing my diff — not introduced by this Step.

## Next concrete action

- **Step 2.2** — Generator extension for `ai-agents.ts`. Scan module
  roots, emit additive `ai-agents.generated.ts` in
  `apps/mercato/.mercato/generated/`. No route emission in v1
  (dispatcher-based HTTP layer).
  - Generator lives in `packages/cli`. Grep for the existing
    `ai-tools.generated.ts` generator extension as the template.
  - Module discovery should mirror how `ai-tools.ts` is discovered:
    walk `packages/*/src/modules/*` + `apps/*/src/modules/*`, import
    their `ai-agents.ts` when present, and emit an `aiAgents` aggregate
    that resolves all `AiAgentDefinition` exports.
  - Emit a typed array: `export const aiAgents: AiAgentDefinition[] = […]`.
  - Unit tests: generator output is stable across runs; missing module
    files are a no-op; duplicate agent `id`s fail the generator.
  - One commit with generator + tests, then a Tasks-table-flip commit.
- Steps 2.3–2.5 still pending after 2.2. The ordering is strict: 2.3
  restores loading from `ai-tools.generated.ts` (pre-req for the next
  phase), 2.4 defines attachment-bridge + prompt-section types, 2.5
  adds regression coverage.

## Blockers / open questions

- User's unstaged ~280-line edit to
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md` remains
  out-of-scope (see NOTIFY entry 2026-04-18T08:52:00Z). Step 2.1 read
  the committed HEAD view only.
- `packages/ai-assistant` has no `typecheck` script, so cross-package
  typecheck runs through consumers (`@open-mercato/core`,
  `@open-mercato/app`). Pre-existing failures unrelated to this PR
  (documented in `step-2.1-checks.md`). Consider adding a `typecheck`
  script to the ai-assistant package in a Phase 5 Step or in a drive-by
  follow-up PR.

## Environment caveats

- Dev runtime runnable: unknown. Steps 2.1–2.5 are types + generators +
  loaders — no UI, so Playwright is N/A through Step 2.5.
- Database/migration state: clean, untouched. First migration lands in
  Phase 5 (Step 5.5, `AiPendingAction` table).
- `yarn generate` must re-run once Step 2.2 lands so the new
  `ai-agents.generated.ts` aggregate appears under
  `apps/mercato/.mercato/generated/`.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree).
- Created this run: no. Documented one-time dogfooding deviation in
  `NOTIFY.md` entry 2026-04-18T08:15:00Z. Any follow-up PR spun out of
  Phase 2+ MUST use an isolated worktree per the skill default.
