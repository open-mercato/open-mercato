# Handoff — 2026-04-18-ai-framework-unification

**Last updated:** 2026-04-18T09:52:53Z
**Branch:** `feat/ai-framework-unification`
**PR:** https://github.com/open-mercato/open-mercato/pull/1593 (held by
coordinator `in-progress` lock — main session is the dispatcher; the
executor MUST NOT release the lock)
**Current phase/step:** Phase 2 / Step 2.4 landed. Attachment-bridge
contract types and prompt-composition primitive types are now
implementation-ready and exported from `@open-mercato/ai-assistant`.
**Last commit:** `b3ea44b0c` —
`feat(ai-assistant): add attachment-bridge and prompt-composition contract types`

## What just happened

- Executor subagent landed **Step 2.4** as a single code commit
  (`b3ea44b0c`) plus the scheduled docs-flip commit.
- Two new type modules under
  `packages/ai-assistant/src/modules/ai_assistant/lib/`:
  - `attachment-bridge-types.ts` declares `AttachmentSource`,
    `AiResolvedAttachmentPart` (every field from spec lines 985–993,
    `textContent`/`url`/`data` optional), `AiUiPart` (componentId +
    props), and `AiChatRequestContext` (tenant/org/user/features/
    isSuperAdmin).
  - `prompt-composition-types.ts` declares `PromptSectionName`
    (camelCase union covering the seven spec §8 required sections plus
    `overrides` per spec line 228), `PromptSection` (name + content +
    optional order), `PromptTemplate` (id + ordered sections), and the
    `definePromptTemplate()` identity builder.
- `packages/ai-assistant/src/index.ts` re-exports the six new type
  symbols and `definePromptTemplate` alongside the existing
  `defineAiAgent`/`defineAiTool` block. Purely additive — no existing
  exports touched.
- Unit tests: new
  `__tests__/attachment-bridge-and-prompt-types.test.ts` (12 tests)
  asserts (a) each of the four `source` values is accepted, (b)
  optional fields are truly optional (minimal metadata-only instance
  type-checks), (c) `AiUiPart` and `AiChatRequestContext` structural
  shape, (d) the eight-name `PromptSectionName` union is exhaustive and
  constructible, (e) `definePromptTemplate` is an identity builder, (f)
  a spec §8 baseline blueprint template (role → responseStyle) can be
  assembled and sorted by `order`. Full suite: 12/12 green, 167/167
  tests (baseline was 11/155 after Step 2.3; delta +1 suite, +12
  tests).
- Typecheck: `@open-mercato/core:typecheck` green (cache hit);
  `@open-mercato/app:typecheck` still fails on the pre-existing stale
  `example/customer-tasks/page` entry in `backend-routes.generated.ts`
  (documented in Step 2.3 HANDOFF). Grep of the typecheck output for
  `attachment-bridge-types`, `prompt-composition-types`, and
  `attachment-bridge-and-prompt-types` matched zero lines — the new
  files produce no diagnostics.

## Next concrete action

- **Step 2.5** — Spec Phase 0 — Unit-test coverage asserting the
  restoration/additivity of the Phase 0 contract:
  - existing modules' `ai-tools.ts` files still register through the
    Step 2.3 loader (regression guard on `loadGeneratedModuleAiTools()`
    + `registerGeneratedAiToolEntries()`);
  - `defineAiTool()` return value is structurally compatible with the
    old plain-object `AiToolDefinition` shape (pure type-level proof
    plus runtime assertion) — the existing `ai-agent-definition.test.ts`
    covers part of this but Step 2.5 should widen the matrix;
  - `ai-agents.generated.ts` discovery is additive — loading modules
    without an `ai-agents.ts` file MUST NOT throw, and the generator
    output is stable across repeated runs.
  - One code commit + one docs-flip commit.
- Step 2.5 is the final Step in Phase 2. Phase 3 (WS-A runtime) starts
  at Step 3.1 with the `agent-registry.ts` loader.

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
  out-of-scope. Step 2.4 read the committed HEAD view of the spec
  only.

## Environment caveats

- Dev runtime runnable: unknown. Step 2.5 is types/tests-only (no UI,
  no HTTP), so Playwright is N/A through the rest of Phase 2.
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
