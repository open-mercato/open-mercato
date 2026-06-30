# Notify — 2026-06-30-ts-morph-module-fact-sheets

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-06-30T14:52:00Z — run started
- Brief: Implement the ts-morph module fact-sheets spec (generated standalone guides) — generator in packages/cli + create-app wiring + tests; spec carried in-branch (PR #3685 not merged separately).
- External skill URLs: none
- Mode: Spec-implementation run (4 phases, 20 steps).

## 2026-06-30T15:20:00Z — decision: spec §6 example data is stale/abbreviated (anti-drift)
- Step 1.4 extractor found customers `cli` = 4 commands (seed-dictionaries, seed-examples, seed-stresstest, interactions:backfill), NOT the spec §6 `cli: []`; and `tableIds` = 3 (companies/deals/people .list), NOT 1.
- Decision: T1 (Step 1.7) MUST lock the REAL source-derived values, not the spec's abbreviated/stale §6 example. The locked-correct counts remain: 49 events, 21 acl, 6 search, 2 notifications, diTokens=[]. This is the anti-drift behavior the spec exists to enforce.

## 2026-06-30T15:30:00Z — checkpoint 1 (steps 1.1–1.6)
- Extractor + emitter + yarn-generate wiring feature-complete. cli typecheck exit 0.
- Generated apps/mercato/src/module-facts.generated.json for all 9 D5 modules; real registry-resolved API auth confirmed.
- PASS. Known soft gap: tableIds=0 for catalog/integrations/sales (follow-up, non-blocking).
- Next: T1–T4 tests (steps 1.7–1.10).

## 2026-06-30T15:33:00Z — auto-continue-pr takeover (maintainer-requested)
- The original autonomous run was found STILL ALIVE (headless `bypassPermissions` session) committing on this branch every few minutes; it had reached checkpoint 1 (HEAD 3da0ba94a, Phase 1 through 1.6).
- Per maintainer decision (via `om-help` → `auto-continue-pr`), the live run's process tree was stopped, draft PR #3715 was opened against open-mercato:develop and claimed (`in-progress`), and this session took over from Step 1.7. PR #3685 (design-spec only) is superseded and to be closed once #3715 lands.
- Resume point: Step 1.7 (T1). PR head SHA at takeover: 3da0ba94a.

## 2026-06-30T15:40:00Z — checkpoint 2 (steps 1.7–1.10)
- Phase 1 COMPLETE. Landed T1–T4 in packages/cli (4 files, 29 tests). cli typecheck exit 0; module-facts suite 4/4 green.
- T1 anti-drift (real customers facts), T2 registry-as-auth-source, T3 9-module BC resolve guard, T4 malformed-source resilience.
- PASS. Next: Phase 2 — Step 2.1 conceptual .ai/guides/module-system.md, then 2.2 core-guide dedup.

## 2026-06-30T15:52:00Z — Phase 2 complete (steps 2.1–2.2)
- 2.1 authored Layer-1 `packages/create-app/agentic/guides/module-system.md` (focused/general scope per user decision — custom per-module facts stay generated via ts-morph). Ships to app `.ai/guides/` via existing wholesale agentic copy; no Layer-1 build wiring needed.
- 2.2 deduped the two migrated sections (Auto-Discovery Paths, Module Files Reference) out of `packages/core/agentic/standalone-guide.md` into a pointer; all other core.md sections retained.
- Also aligned the T2/T3/T4 test filenames to spec §10 (auth-source/bc-guard/malformed).
- Next: Phase 3 (build-system surgery) — Step 3.1 build.mjs extraction step. NOTE: extractor not yet exported from @open-mercato/cli `exports`; resolve that first. Phase 3 verification needs full build runs (yarn build:packages + create-app build + yarn test:create-app for T5/T6).

## 2026-06-30T15:58:00Z — decision: @open-mercato/cli as create-app build-time devDep (3.1)
- The cli `exports` wildcard already maps `@open-mercato/cli/lib/generators/module-facts` → dist; build.mjs imports it. Declared cli as a create-app devDependency (build-time only, never shipped). Resolves via hoisting; lockfile synced (1 edge).

## 2026-06-30T16:02:00Z — decision: ts-morph as create-app RUNTIME dep (3.2, user-approved)
- shared.ts runs at `npx create-mercato-app` time, where devDeps/@open-mercato/cli are NOT installed. Per user choice, ts-morph added to create-app `dependencies` so the spec's literal "AST-parse enabledModules with ts-morph" works in the scaffolded context. Allowlist is materialized as the bundled fact-sheet set (enabled ∩ available), so no cli import is needed at runtime. Lockfile synced (1 edge).

## 2026-06-30T16:08:00Z — checkpoint 3 (steps 2.1–3.4)
- Phase 2 + Phase 3 build-side complete. Full create-app build emits 9 fact-sheets + module-facts.json (122 KB, customers 54 registry-resolved apiRoutes); 61/61 existing create-app unit tests pass; cli module-facts 29 tests still green.
- Marker-block inject + ts-morph enabledModules parser + redirect-stub path all scratch-verified.
- PASS. Next: 3.5 T5 + 3.6 T6 (create-app node:test), then Phase 4 (delete 9 guides + RELEASE_NOTES), then final gate + ds-guardian + auto-review-pr.

## 2026-06-30T16:25:00Z — run COMPLETE (all 21 steps) + final gate PASS
- Phase 3 finished (3.5 T5 build smoke + 3.6 T6 module-guides; 68 create-app tests). Phase 4 done (deleted 9 standalone-guide.md → clean rebuild writes 9 redirect stubs; RELEASE_NOTES deprecation note added).
- Final gate (feasible scope): build:packages 21/21 ✅; yarn generate ✅ with ZERO drift in the versioned module-facts.generated.json (D4 validated); i18n:check-sync ✅; cli + create-app typecheck ✅; cli module-facts 29 + create-app 68 tests ✅. Self code-review + BC self-review: clean (generated-file contract bridged via stubs + RELEASE_NOTES; all surfaces additive).
- Deferred to PR CI: build:app + integration suites (N/A per spec §10 — no HTTP/UI) + a formal om-auto-review-pr. ds-guardian N/A (no .tsx diff).
- PR #3715 marked ready for review; #3685 to be closed once #3715 lands.
