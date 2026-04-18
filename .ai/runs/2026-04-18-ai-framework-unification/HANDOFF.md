# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T09:50:00Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher from
Step 2.3 onward; coordinator does NOT release the lock)
**Current phase/step:** Phase 2 / Step 2.2 landed. Spec Phase 0
deliverable 2 (`ai-agents.generated.ts` generator) is committed and
pushed.
**Last commit:** `89cbbe56a` —
`feat(cli): add ai-agents.generated.ts generator extension`

## What just happened

- Coordinator (auto-continue-pr surrogate) re-claimed #1593 at
  `2026-04-18T09:24:07Z` with the three-signal lock (assignee
  `pkarw`, `in-progress` label, claim comment `4273325910`). Claim
  commit: `21423c9e5`.
- User course-corrected: no subagent-dispatch tool is available inside
  this coordinator context. The coordinator landed **Step 2.2 only**
  under direct-execution discipline (one code commit + one docs-flip
  commit, per the normal executor contract). From Step 2.3 onward the
  main session will dispatch one executor subagent per Step from
  outside this coordinator context.
- **Step 2.2** committed as `89cbbe56a`:
  - New `packages/cli/src/lib/generators/extensions/ai-agents.ts`
    mirroring `createAiToolsExtension()`. Emits
    `ai-agents.generated.ts` with `aiAgentConfigEntries` (filtered)
    and `allAiAgents` (flattened).
  - Registered in `extensions/index.ts` immediately after the existing
    `createAiToolsExtension()` entry so `module-registry.ts` picks it
    up through the standard `loadGeneratorExtensions()` loop.
  - Fixture + assertions in four test files:
    `structural-contracts.test.ts` (new `ai-agents.generated.ts`
    describe, 98/98 green), `module-subset.test.ts` (empty-agents
    case), `output-snapshots.test.ts` (stability list), and
    `scanner.test.ts` (convention-file override coverage).
  - Touched-suite runs: 98/98 + 78/78 passing.

## Next concrete action

- **Step 2.3** — Restore loading of generated `ai-tools.generated.ts`
  contributions in the runtime tool-loader. The current loader is
  Code-Mode-centric (see spec §Current-State, line 38) and does not
  read `aiToolConfigEntries`; module tools declared via `ai-tools.ts`
  therefore never reach the runtime. Fix that without changing the
  generated file shape.
  - Tool loader lives under
    `packages/ai-assistant/src/modules/ai_assistant/lib/`. Grep for
    `aiToolConfigEntries` first; it is almost certainly imported
    nowhere, so the Step is to wire it in behind the existing
    `mcp-tool-adapter.ts` contract (no second adapter stack — see
    spec §D10 and PLAN Risks).
  - Unit tests must assert: (a) an existing module with a populated
    `ai-tools.ts` is visible to the loader; (b) modules without an
    `ai-tools.ts` stay silent; (c) `mcp-tool-adapter.ts` still
    resolves the same tool objects it did before.
  - One code commit + one docs-flip commit, per contract.
- Steps 2.4–2.5 still pending after 2.3. Strict ordering: 2.4 adds
  attachment-bridge + prompt-section types in
  `@open-mercato/ai-assistant`; 2.5 adds regression coverage ensuring
  the new discovery paths are additive (existing `ai-tools.ts` modules
  still register, `defineAiTool()` is compatible with plain-object
  shape, `ai-agents.generated.ts` discovery is additive).

## Blockers / open questions

- **Subagent dispatch:** not available inside this coordinator
  context. Main session owns dispatch from Step 2.3 onward. The
  coordinator pattern documented in
  `.claude/skills/auto-continue-pr/SKILL.md` is therefore being
  executed one level up from where it was designed to run; this is a
  documented deviation for this PR only.
- **`packages/ai-assistant` typecheck script:** still missing (noted
  in Step 2.1 handoff). Consider a follow-up PR or a later Phase 5
  cleanup Step.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`, first
  flagged `2026-04-18T08:52:00Z`) remains out-of-scope. Step 2.2 read
  the committed HEAD view of the spec only.

## Environment caveats

- Dev runtime runnable: unknown. Step 2.3 is loader-level (no UI,
  no HTTP), so Playwright is N/A through the rest of Phase 2.
- Database/migration state: clean, untouched. First migration lands
  in Phase 5 (Step 5.5, `AiPendingAction` table).
- `yarn generate` will produce a new
  `apps/mercato/.mercato/generated/ai-agents.generated.ts` on next
  run; this is intentional and expected. Step 2.2 did not commit
  that output (regenerates on every `yarn generate`).

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree).
- Created this run: no. Documented one-time dogfooding deviation in
  `NOTIFY.md` entry `2026-04-18T08:15:00Z`. Any follow-up PR spun out
  of Phase 2+ MUST use an isolated worktree per the skill default.
