# Notify — 2026-06-30-ts-morph-module-fact-sheets

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-06-30T14:52:00Z — run started
- Brief: Implement the ts-morph module fact-sheets spec (generated standalone guides) — generator in packages/cli + create-app wiring + tests; spec carried in-branch (PR #3685 not merged separately).
- External skill URLs: none
- Mode: Spec-implementation run (4 phases, 20 steps).

## 2026-06-30T15:20:00Z — decision: spec §6 example data is stale/abbreviated (anti-drift)
- Step 1.4 extractor found customers `cli` = 4 commands (seed-dictionaries, seed-examples, seed-stresstest, interactions:backfill), NOT the spec §6 `cli: []`; and `tableIds` = 3 (companies/deals/people .list), NOT 1.
- Decision: T1 (Step 1.7) MUST lock the REAL source-derived values, not the spec's abbreviated/stale §6 example. The locked-correct counts remain: 49 events, 21 acl, 6 search, 2 notifications, diTokens=[]. This is the anti-drift behavior the spec exists to enforce.
