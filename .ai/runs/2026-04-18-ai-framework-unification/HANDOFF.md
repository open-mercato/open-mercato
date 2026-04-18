# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T09:20:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
`auto-continue-pr` `in-progress` lock — release queued at end of run)
**Current phase/step:** Phase 1 fully landed + Step 1.2 landed (rephasing).
Phase 2 (= spec Phase 0 Alignment Prerequisite) is the next actionable
block; resume point = Step 2.1.
**Last commit:** `80b335707` —
`docs(runs): rephase PLAN.md to cover full ai-tooling spec`

## What just happened

- Session reopened on PR #1593 via `/auto-continue-pr`. Lock already owned
  by `@pkarw` from the previous session — no re-claim needed.
- Read `HANDOFF.md`, the prior `PLAN.md`, and `NOTIFY.md` tail. Read the
  full source spec
  (`.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`, 1816 lines)
  including D16 (pending-action contract), D17 (future queue), D18 (bulk
  edit demo), §7 (tool packs), §9 (approval gate), §10 (merchandising
  demo), and the Phase 0–3 Implementation Plan.
- **Step 1.2 (rephasing)** committed: `PLAN.md` rewritten from 3 Task rows
  to 46; Implementation Plan section rewritten to mirror the new table;
  Scope / Risks / Non-goals updated; `step-1.2-checks.md` rewritten to
  describe the rephasing. Docs-only; no code touched.
- **PR title renamed** from
  `feat(ai-framework): AI framework unification — Phase 1 skill harness foundation`
  to `feat(ai-framework): AI framework unification`.

## Next concrete action

- **Step 2.1** — Add `AiAgentDefinition` type + `defineAiTool()` helper,
  and export both from `@open-mercato/ai-assistant`.
  - File to create:
    `packages/ai-assistant/src/modules/ai_assistant/lib/ai-tool-definition.ts`
    (new `defineAiTool` builder returning an `AiToolDefinition`).
  - File to create:
    `packages/ai-assistant/src/modules/ai_assistant/lib/ai-agent-definition.ts`
    (new `AiAgentDefinition` type with all optional fields from spec §2:
    `executionMode`, `mutationPolicy`, `resolvePageContext`, `maxSteps`,
    `keywords`, `domain`, `dataCapabilities`, `output`).
  - Public re-exports from `packages/ai-assistant/src/index.ts` (or the
    existing module barrel; grep first).
  - Unit tests under
    `packages/ai-assistant/src/modules/ai_assistant/lib/__tests__/`.
  - One commit landing type + helper + tests together, followed by a
    Tasks-table-flip commit.
- Full Phase 2 plan is in `PLAN.md` Implementation Plan §Phase 2. Steps
  2.1 → 2.5 are strictly ordered because 2.2 imports from 2.1, 2.3
  consumes from 2.2, and 2.5 tests 2.1 + 2.2 + 2.3 together.

## Blockers / open questions

- User's unstaged ~280-line edit to
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md` remains
  deliberately out-of-scope (see NOTIFY entry 2026-04-18T08:52:00Z). The
  Step 1.2 rephasing reads the committed HEAD view of that file only.
  When the user stages and commits their edit, the Tasks table may need
  a reconciliation Step if the new content reshapes the spec's own
  Phase/Workstream boundaries.
- `packages/ai-assistant` currently has no `ai-agent-definition.ts` or
  `ai-tool-definition.ts` files. The closest existing artifact is
  `lib/types.ts`; Step 2.1 should re-use that file if it already exports
  the `AiToolDefinition` shape, or place the new definitions alongside
  it to avoid import-path churn.

## Environment caveats

- Dev runtime runnable: unknown. Phase 2 Steps are server-side types +
  generators + loaders — no UI, so Playwright is N/A through at least
  Step 2.5.
- Database/migration state: clean, untouched. First migration lands in
  Phase 5 (Step 5.5, `AiPendingAction` table).
- `yarn generate` will need to re-run once Step 2.2 lands (new generator
  extension emits `ai-agents.generated.ts`).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree).
- Created this run: no. Documented one-time dogfooding deviation in
  `NOTIFY.md` entry 2026-04-18T08:15:00Z. Any follow-up PR spun out of
  Phase 2+ MUST use an isolated worktree per the skill default.
