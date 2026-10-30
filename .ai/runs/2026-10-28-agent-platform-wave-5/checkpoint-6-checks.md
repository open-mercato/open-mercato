# Checkpoint 6 — Steps 7.1..7.10

- **When:** 2026-10-30T05:14:45Z
- **Steps:** 7.1–7.10 (Eval P3–P5 up to the rubric library, `9e1e4b169`..`058781a33`) + 7.10-review-fix (`345b6e955`) + 1.11-review-fix-2 (`239d0230f`).

| Check | Result |
|---|---|
| `yarn build:packages` → `yarn generate` → `yarn build:packages` | pass |
| `yarn i18n:check-sync`, `yarn i18n:check-usage` | pass |
| `yarn typecheck` | pass |
| time-bomb, pagination, AGENTS.md budget guards; `yarn check:dep-versions` (new `yaml` 2.9.0) | pass |
| DS lint on every `.tsx` changed since checkpoint 5 | pass |
| enterprise `jest` (all) | pass — 334 suites, 3572 tests |
| ai-assistant `jest` | pass — 177 suites, 2516 tests |
| core `jest src/__tests__ src/modules/auth` | 1 fail (`explicit-sort-comparators`: comparator-less `.sort()` in `evalSetYaml.ts` and `rubrics/index.ts`) → fixed in **7.10-review-fix** → pass |
| `yarn build:app` | pass |
| Integration, fresh ephemeral app (AO enabled): `TC-AGENT-*` (all AO specs incl. EVAL-REPORT/EVAL-SET, UXC), `TC-AI-RUN*`, `TC-AI-CITATIONS*` | 113 passed, 18 skipped, 1 failed (`TC-AGENT-UXC-006` PL smoke expected the raw `pii` kind; Step 1.11 localized it to „Dane osobowe (PII)") → fixed in **1.11-review-fix-2** → UXC specs 8/8 pass |

Skips are environment-only (LLM provider or tenant storage).

Notes:
- This checkpoint widened the integration filter to every `TC-AGENT-*` spec; earlier checkpoints ran only ACC/INT/TRACE, which is why the 1.11 test drift surfaced only now.
- Ephemeral app started with `test:integration:ephemeral:start` (shared Playwright browser-cache lock held by another project) and specs run with `BASE_URL`/`DATABASE_URL`.
- `yarn npm audit --recursive --severity high` (run at 7.2) reports 15 high findings repo-wide; none in `yaml`. Not addressed here.

Artifacts: none kept.
