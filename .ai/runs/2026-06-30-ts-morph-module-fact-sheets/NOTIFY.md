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
