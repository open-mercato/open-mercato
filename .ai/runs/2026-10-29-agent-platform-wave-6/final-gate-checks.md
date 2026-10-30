# Final gate — agent-platform-wave-6

- **When:** 2026-10-30T13:07:02Z
- **Head verified:** `3161b7e1f` (+ this record and the rolling-deploy note).
- **Runner:** local mode; integration on ephemeral apps; full integration suite via PR CI.

## Validation (`validation.commands`)

| Command | Result |
|---|---|
| `yarn build:packages` → `yarn generate` → `yarn build:packages` | pass |
| `yarn i18n:check-sync`, `yarn i18n:check-usage` | pass |
| `yarn typecheck` | pass |
| `yarn test --continue` | pass after triage — 46/49 tasks; cli + core suites hit jest worker SIGSEGV (known flake; the affected suites pass alone: cli 10, core 8) and the docs test OOM'd inside the full run (passes alone with an 8 GB heap: 24/24) |
| `yarn build:app` | pass |
| Guards: time-bombs, pagination-capped, agents budget, dep-versions, template sync; DS lint on wave-6 `.tsx` | pass |

## Integration

- Checkpoint 1: every `TC-AGENT-*` with the full OTel env — 95 passed, 13 skipped, 0 failed.
- Checkpoint 2: `TC-AGENT-*`, `TC-ATT-*`, `TC-SEARCH*`, `TC-QI*` with the full OTel env — 150 passed, 15 skipped, 0 failed.
- After 4.1-review-fix: `TC-ATT-STRUCT-001..007` (incl. the new section-search spec 006) — 7 passed on an app without Meilisearch.
- The OTel delivery specs need the app started with the OTel env documented in each spec header; CI does not set it, so they skip there.
- Full suite: PR CI `ephemeral-integration` once the stack is re-synced with `main` (the branch currently conflicts with `main`, which blocks CI).

## Review

`om-auto-review-pr --autofix` (wave-6 commits only): no blocker/major; 1 minor fixed (**5.1-review-fix**: tenant header values with control/non-Latin-1 characters failed every send instead of failing credential validation). Minors/nits left as follow-ups in the review comment: https://github.com/open-mercato/open-mercato/pull/8251#pullrequestreview-5712664739
