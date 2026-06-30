# Handoff — 2026-06-30-ts-morph-module-fact-sheets

**Last updated:** 2026-06-30T15:40:00Z
**Branch:** feat/ts-morph-module-fact-sheets
**PR:** #3715 (draft, against open-mercato:develop) — claimed/`in-progress`, supersedes design-spec PR #3685
**Current phase/step:** Phase 1 COMPLETE (1.1–1.10); next = Step 2.1 (conceptual guide)
**Last commit:** 933bfc587 — test(cli): T4 module-facts malformed-source resilience

## Takeover note
- The original autonomous run was stopped at checkpoint 1 (HEAD 3da0ba94a) per maintainer request; this session took over via `auto-continue-pr` from Step 1.7 and is now driving PR #3715.

## What just happened (checkpoint 2, steps 1.7–1.10)
- Landed Phase 1 tests T1–T4 in `packages/cli/src/lib/generators/__tests__/` (4 files, 29 tests, all green).
- T1 locks REAL customers facts (anti-drift). T2 proves auth comes from registry `apis[].metadata`. T3 is a 9-module BC resolve guard. T4 proves malformed-source resilience (warn, never throw).
- Checkpoint 2 PASS: cli typecheck exit 0; `module-facts` suite 4/4 (29 tests).

## Next concrete action
- **Step 2.1:** author the conceptual, hand-written `.ai/guides/module-system.md` (Layer 1 — the timeless "how the module system works" prose that is NOT generated). Keep it conceptual; no per-module facts (those are generated). Consult the spec's Layer-1 vs Layer-2 split before writing.
- **Step 2.2:** dedup the prose that migrated into `module-system.md` out of the core package guide (only `core.md` is deduped; the other 6 package guides stay as-is).

## Blockers / open questions
- none

## Environment caveats
- Dev runtime runnable: not needed (generator + docs; no UI surface).
- Playwright / browser checks: N/A.
- Database/migration state: clean (no schema changes).
- `yarn generate` produces `apps/mercato/src/module-facts.generated.json` (registry generated first). Re-run if core sources change.

## Known soft gaps (follow-up, non-blocking)
- `tableIds=0` for catalog/integrations/sales (host-token extractor targets specific DataTable `tableId`/`extensionTableId` literals; those modules declare tables differently). Consistent with the spec's host-tokens caveat.

## Phases remaining
- Phase 2: 2.1 conceptual guide, 2.2 core-guide dedup.
- Phase 3: 3.1 build.mjs extraction step, 3.2 shared.ts per-enabled-module copy, 3.3 AGENTS.md.template D6 block, 3.4 legacy `core.<module>.md` redirect stubs, 3.5 T5 build wiring smoke, 3.6 T6 agents-md module-guides test (all `packages/create-app`).
- Phase 4: 4.1 delete 9 per-module standalone guides, 4.2 RELEASE_NOTES deprecation note.
- Then: full validation gate + integration suites + ds-guardian + om-auto-review-pr before flipping PR #3715 to complete; close #3685.

## Worktree
- Path: .ai/tmp/auto-create-pr/ts-morph-module-fact-sheets-20260630-164927
- Created this run: yes (reused by the takeover session)
