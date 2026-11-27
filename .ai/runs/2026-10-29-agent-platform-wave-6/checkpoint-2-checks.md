# Checkpoint 2 — Steps 3.3..4.6

- **When:** 2026-10-30T12:03:05Z
- **Steps:** 3.3–3.6 (export destination, destination picker, OTEL-003/004 integration tests, docs + env) and 4.1–4.6 (`shouldIndex` gate, section search entity, section-search jobs, index on extraction, purge cleanup, partition toggle + CLI) — `9f3526961`..`08e0c9cf0` + 3.4-review-fix (`0a725e423`). Step 3.6 landed as two commits (`3f511daaf` docs + `4a4b47049` plan row) because the executor's macOS sed missed the row.

| Check | Result |
|---|---|
| `yarn build:packages` → `yarn generate` → `yarn build:packages` | pass |
| `yarn i18n:check-sync`, `yarn i18n:check-usage` | pass |
| `yarn typecheck` | pass |
| time-bombs, pagination-capped, agents budget, dep-versions, template sync | pass |
| DS lint on changed `.tsx` | pass |
| enterprise `jest src/modules/agent_orchestrator` | 2 fail (`backend-route-links`: link to core's `/backend/integrations/[id]`; `i18n-coverage`: one English-identical German value over the ceiling) → fixed in **3.4-review-fix** → pass |
| core `jest` (all) | pass — 25,644 tests |
| search `jest` · shared `jest src/modules` | pass — 418 · 222 tests |
| cli `jest src/lib/generators` | pass (one suite hit a jest worker SIGSEGV; passes alone) |
| `yarn build:app` | pass |
| Integration, fresh ephemeral app with the full OTel env: `TC-AGENT-*`, `TC-ATT-*`, `TC-SEARCH*`, `TC-QI*` | 150 passed, 15 skipped, 0 failed |

Notes:
- Known gap (follow-up): if an attachment is purged between a partition toggle-off fan-out and its per-extraction delete job, a few section search records can remain until a reindex.
- The exported-content branch of OTEL-003 needs trace content storage; the ephemeral app has none, so the not-exported branch ran.
- Skips are environment-only (LLM provider or storage).

Artifacts: none kept.
