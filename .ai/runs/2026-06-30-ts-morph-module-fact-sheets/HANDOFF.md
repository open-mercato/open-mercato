# Handoff — 2026-06-30-ts-morph-module-fact-sheets

**Last updated:** 2026-06-30T16:25:00Z
**Branch:** feat/ts-morph-module-fact-sheets
**PR:** #3715 (against open-mercato:develop) — supersedes design-spec PR #3685
**Status:** COMPLETE — all 21 PLAN steps done; final gate PASS (feasible scope). PR marked ready for review.
**Last commit:** 7a119fb03 — docs: RELEASE_NOTES deprecation note

## Summary
Replaced the 9 hand-written per-module standalone AI guides with (1) a generated per-module fact-sheet layer (`.ai/guides/modules/<module>.md` + `module-facts.json`, extracted from source via the `packages/cli` ts-morph generator) and (2) one hand-written conceptual `module-system.md`. Wired into create-app build + the monorepo `yarn generate`, with a marker-driven Module-Specific Guides block filtered to the app's enabled modules, and BC redirect stubs for the legacy names.

## Final state (all phases)
- **Phase 1:** extractor + emitter + generate wiring (orig run, 1.1–1.6) + T1–T4 (this resume, 29 cli tests).
- **Phase 2:** conceptual `module-system.md` (focused/general) + core.md dedup.
- **Phase 3:** build.mjs fact-sheet emission + redirect stubs; shared.ts enabled-∩-allowlist filtered copy (ts-morph runtime dep) + marker-block injection; AGENTS.md.template marker block + module-system.md routing; T5 + T6 (create-app, 68 tests).
- **Phase 4:** deleted the 9 standalone-guide.md; RELEASE_NOTES deprecation note.

## Decisions (user-approved)
- Focused/general conceptual guide (custom facts stay generated).
- ts-morph as a create-app RUNTIME dependency (shared.ts AST read at scaffold time).
- @open-mercato/cli as a create-app build-time devDependency (extractor import in build.mjs).

## Remaining (owner / CI)
- PR CI runs build:app + integration suites (N/A per spec but CI-covered). A formal `om-auto-review-pr` may run on the PR.
- Close #3685 once #3715 lands (redundant — spec carried here).
- Non-blocking follow-ups in `final-gate-checks.md` (build.mjs guides-dir clean; tableIds=0 for catalog/integrations/sales; spec §10 T1 "empty cli" doc nit).

## Worktree
- Path: .ai/tmp/auto-create-pr/ts-morph-module-fact-sheets-20260630-164927 (created this run).
