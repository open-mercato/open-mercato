# Handoff — 2026-06-30-ts-morph-module-fact-sheets

**Last updated:** 2026-06-30T15:30:00Z
**Branch:** feat/ts-morph-module-fact-sheets
**PR:** not yet opened (opens at step 7/9 after the full gate; this run carries spec + code, supersedes #3685)
**Current phase/step:** Phase 1 complete through 1.6; next = Step 1.7 (T1 test)
**Last commit:** 6257b8923 — feat(cli): emit module-facts.generated.json in yarn generate

## What just happened (checkpoint 1, steps 1.1–1.6)
- Built the full ts-morph extractor `packages/cli/src/lib/generators/module-facts.ts` (entities, events, ACL, API auth from registry `apis[].metadata`, DI service-only tokens, search, host tokens, notifications, CLI, + warnings).
- Added markdown + JSON renderers + `extractAllModuleFacts` orchestrator.
- Wired `generateModuleFacts` into `yarn generate` (runs after module-registry); emits versioned `apps/mercato/src/module-facts.generated.json` for all 9 D5 modules.
- Checkpoint 1 PASS: cli typecheck exit 0; artifact has real registry-resolved auth; customers counts locked.

## Next concrete action
- Step 1.7: write T1 `module-facts.customers.fixture.test.ts` in `packages/cli/src/lib/generators/__tests__/`. Lock the REAL source-derived customers facts (events=49, acl=21, search=6, notifications=2, diTokens=[], **cli=4**, **tableIds=3**, colon-form entity ids). Do NOT lock the spec §6 stale `cli:[]`/single-tableId example (see NOTIFY 15:20 decision).

## Blockers / open questions
- none

## Environment caveats
- Dev runtime runnable: not needed (generator + docs; no UI surface).
- Playwright / browser checks: N/A.
- Database/migration state: clean (no schema changes).
- `yarn generate` works in-worktree and produces the artifact (registry generated first).

## Known soft gaps (follow-up, non-blocking)
- `tableIds=0` for catalog/integrations/sales (host-token extractor targets specific DataTable tableId literals).

## Worktree
- Path: .ai/tmp/auto-create-pr/ts-morph-module-fact-sheets-20260630-164927
- Created this run: yes
