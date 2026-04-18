# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T09:44:35Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 2 / Step 2.3 landed. Module-tool loading
is now wired back into the MCP runtime through the existing
`mcp-tool-adapter.ts` path.
**Last commit:** `dc5d865fa` —
`feat(ai-assistant): load module ai-tools.generated.ts in runtime tool-loader`

## What just happened

- Executor subagent landed **Step 2.3** as a single code commit
  (`dc5d865fa`) plus the scheduled docs-flip commit.
- Runtime change: `packages/ai-assistant/src/modules/ai_assistant/lib/
  tool-loader.ts` now calls a new `loadGeneratedModuleAiTools()` after
  Code Mode bootstrap. That helper dynamic-imports
  `@/.mercato/generated/ai-tools.generated`, reads the
  `aiToolConfigEntries` array emitted by the Step 2.2 generator, and
  hands every valid tool to `registerMcpTool()`. `mcp-tool-adapter.ts`
  continues to be the single AI SDK adapter stack.
- Shape/contract additions:
  - exported `AiToolConfigEntry` type (mirrors the generator).
  - exported `registerGeneratedAiToolEntries(entries)` — idempotent,
    fail-soft on malformed entries, returns the number registered.
  - new `.d.ts` shim
    `packages/ai-assistant/src/modules/ai_assistant/lib/ai-tools-generated.d.ts`
    declares the `@/.mercato/generated/ai-tools.generated` module so the
    dynamic import type-checks inside the package even when the app's
    generated file is absent.
- Unit tests: new `tool-loader.test.ts` asserts (a) populated modules
  register, (b) empty/undefined `tools` stay silent, (c) the adapter
  path resolves the registered tools unchanged, (d) re-running the
  loader is idempotent, (e) malformed entries are skipped with a
  warning. Full suite: 11/11 green, 155/155 tests.
- Typecheck: `@open-mercato/core:typecheck` green; `@open-mercato/app`
  still fails on a pre-existing stale entry in
  `backend-routes.generated.ts` pointing at
  `example/backend/customer-tasks/page` (not in the diff). Focused
  `tsc --noEmit` over the Step 2.3 files produced no diagnostics.

## Next concrete action

- **Step 2.4** — Spec Phase 0 — Add attachment-bridge contract types
  (`AiResolvedAttachmentPart` with `source: 'bytes' | 'signed-url' |
  'text' | 'metadata-only'`, `AiUiPart`, `AiChatRequestContext`) plus
  prompt-composition primitive types (`PromptSection`, `PromptTemplate`
  with named sections per spec §8) in `@open-mercato/ai-assistant`.
  Export them from the package root (`packages/ai-assistant/src/index.ts`)
  so downstream Steps in Phase 3 can import them without deep reaching.
  - Target folder for the new type module:
    `packages/ai-assistant/src/modules/ai_assistant/lib/` — co-locate
    alongside `ai-agent-definition.ts` and `ai-tool-definition.ts` for
    symmetry.
  - Unit tests MUST assert the discriminated union for
    `AiResolvedAttachmentPart.source` is exhaustive, that `PromptSection`
    preserves `kind` + `content` invariants, and that the public exports
    from `@open-mercato/ai-assistant` include the new names (BC
    additive-only check).
  - One code commit + one docs-flip commit.
- Steps 2.5 follows. Strict ordering: 2.5 adds regression coverage
  (existing `ai-tools.ts` modules still register through 2.3's loader,
  `defineAiTool()` is compatible with plain-object shape,
  `ai-agents.generated.ts` discovery is additive).

## Blockers / open questions

- **`packages/ai-assistant` typecheck script**: still missing. The
  package has no `tsc --noEmit` npm script, so we lean on focused
  standalone typecheck projects for Step-level checks. Candidate for a
  Phase 5 cleanup Step.
- **`apps/mercato` stale generated route**: pre-existing `example/
  backend/customer-tasks/page` entry in
  `backend-routes.generated.ts` blocks `@open-mercato/app:typecheck`.
  Unrelated to AI work; consider a drive-by `yarn generate` Step if it
  persists into Phase 3.
- **User's unstaged spec edit** (~280 lines on
  `.ai/specs/2026-04-11-unified-ai-tooling-and-subagents.md`) remains
  out-of-scope. Step 2.3 read the committed HEAD view of the spec
  only.

## Environment caveats

- Dev runtime runnable: unknown. Step 2.4 is types-only (no UI, no
  HTTP), so Playwright is N/A through the rest of Phase 2.
- Database/migration state: clean, untouched. First migration lands
  in Phase 5 (Step 5.5, `AiPendingAction` table).
- `yarn generate` will regenerate
  `apps/mercato/.mercato/generated/ai-tools.generated.ts` on next run;
  no new generator was added in this Step.

## Worktree

- Path: `/Users/piotrkarwatka/Projects/mercato-development` (user's
  primary worktree). Documented dogfood exception (see earlier NOTIFY
  entries). Any follow-up PR spun out of Phase 2+ MUST use an isolated
  worktree per the skill default.
