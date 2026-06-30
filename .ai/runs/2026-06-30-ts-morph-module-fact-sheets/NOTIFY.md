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
