# Handoff — 2026-06-30-ts-morph-module-fact-sheets

**Last updated:** 2026-06-30T16:08:00Z
**Branch:** feat/ts-morph-module-fact-sheets
**PR:** #3715 (draft, against open-mercato:develop) — claimed/`in-progress`, supersedes design-spec PR #3685
**Current phase/step:** Phases 1, 2 complete; Phase 3 build-side complete (3.1–3.4); next = Step 3.5 (T5 build smoke)
**Last commit:** 2ec0f0978 — feat(create-app): emit legacy core.<module>.md redirect stubs (BC bridge)

## Takeover note
- Original autonomous run stopped at checkpoint 1 (HEAD 3da0ba94a); this session took over via auto-continue-pr from Step 1.7. User decisions: focused/general conceptual guide; ts-morph added as a create-app RUNTIME dep for the shared.ts AST read.

## Progress this resume (1.7 → 3.4)
- **Phase 1:** T1–T4 (29 cli tests, checkpoint 2). Filenames aligned to spec §10.
- **Phase 2:** 2.1 Layer-1 `packages/create-app/agentic/guides/module-system.md` (focused); 2.2 core.md dedup → pointer.
- **Phase 3 build-side:** 3.1 build.mjs emits fact-sheets + module-facts.json; 3.2 shared.ts filtered enabled-∩-allowlist copy (ts-morph); 3.3 marker-delimited Module-Specific Guides block + module-system.md routing; 3.4 legacy core.<module>.md redirect stubs (active after 4.1). Checkpoint 3 PASS (full create-app build + 61/61 unit tests).

## Next concrete action — Step 3.5 (T5 build smoke)
- New `packages/create-app/src/**/*.test.ts` using `node:test` (the create-app test runner is `node --import tsx --test src/**/*.test.ts`, NOT jest).
- T5 asserts: after `yarn workspace create-mercato-app build`, `dist/agentic/guides/modules/customers.md` and `dist/agentic/guides/module-facts.json` exist, all 9 D5 fact-sheets exist, and the 9 legacy `core.<module>.md` names are present (full guides pre-4.1; stubs post-4.1 — assert PRESENCE, robust across the boundary). Either invoke the build in-test or assert against the already-built `dist`.

## Step 3.6 (T6 — Module-Specific Guides block)
- New `packages/create-app/src/**/agents-md.module-guides.test.ts` (`node:test`). Exercise `generateShared` (or its exported helpers) against a temp targetDir whose `src/modules.ts` enables `{customers, sales}`:
  - block lists exactly those 2 rows pointing at `.ai/guides/modules/{customers,sales}.md`; "(if available)" hedge dropped.
  - present-but-not-enabled module → no row; enabled-but-not-allowlisted module → no row.
  - second generation pass over an already-generated AGENTS.md is idempotent (replace strictly between `<!-- om:module-guides:start/end -->`).
- NOTE: `generateShared`/`injectModuleGuides`/`selectModuleFactSheets`/`readEnabledModuleIds` are currently NOT exported from `shared.ts`. T6 either needs them exported (additive) or must drive the public `generateShared` end-to-end with a bundled GUIDES_DIR fixture. Exporting the helpers is the cleaner path.

## Phase 4
- 4.1 delete the 9 `packages/core/src/modules/<mod>/agentic/standalone-guide.md` (the D5 set). After deletion, rebuild and confirm build.mjs now writes the 9 `core.<module>.md` redirect stubs. The 7 package guides + non-D5 module guides are untouched.
- 4.2 RELEASE_NOTES.md deprecation note for the legacy core.<module>.md → modules/<module>.md move.

## Final gate (after 4.2)
- Full: yarn build:packages, yarn generate, yarn build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app.
- Integration: yarn test:integration + yarn test:create-app:integration (the latter is directly relevant — it exercises the scaffold).
- ds-guardian over the diff (mostly docs/build; low DS surface). Then om-auto-review-pr. Then flip PR #3715 body to complete; close #3685.

## Open follow-ups / notes
- yarn.lock gained 2 workspace-dep edges (@open-mercato/cli devDep, ts-morph dep). Run a real `yarn install` at the final gate to be safe.
- Soft gap (from checkpoint 1): tableIds=0 for catalog/integrations/sales (host-token extractor pattern) — non-blocking, follow-up.
- Spec §10 T1 row still says "empty cli" (the stale example this feature exists to catch); the real T1 locks cli=4. Optional doc nit to fix in the spec.

## Worktree
- Path: .ai/tmp/auto-create-pr/ts-morph-module-fact-sheets-20260630-164927
- Created this run: yes (reused by takeover session)
