# Final verification — PR #9424

Runner: local Node24.22.3, TMPDIR=/tmp, TURBO_ENV_MODE=loose. No compose app container was used. This is a progress record; full acceptance remains incomplete.

## Ordered repository gate

All eight configured commands passed at integrated acceptance head6e63321ca5. The subsequent eced06 change only attaches failed HTTP test diagnostics. Any later production fix requires relevant revalidation.

| Command | Result |
| --- | --- |
| build:packages | PASS |
| generate | PASS |
| build:packages | PASS |
| i18n:check-sync | PASS |
| i18n:check-usage | PASS |
| typecheck | PASS |
| test | PASS |
| build:app | PASS |

Raw result JSON and logs are in cockpit Assets/final-verification. Package tests:51/51 tasks successful; core2,796 suites and28,209 tests passed, with existing configured skips.

## Live acceptance

- Actual production dbMigrate:8 internal checks,1 test passed,0 failed,0 skipped; disposable PostgreSQL17 fixtures removed. Parent repeated the child harness. Reindex delivery is an observable mocked sink, not a live queue assertion.
- Focused migration orchestration/unit regressions:3 suites,17 tests passed in parent rerun.
- Encrypted People normal CRUD:actual native TC-RLS-005 passed before the configured pessimistic-lock extension.
- Configured pessimistic mutation guard:NOT PASSED. Actual acquire route returns500 before denied PUT/DELETE assertions. Diagnostic rerun captures restricted server logs. Full unfiltered integration and standalone suite remain pending behind this failure.
- Earlier actual RSC, People browser, public capabilities, PostgreSQL catalog/runtime, pgvector and Redis/scheduled job evidence is linked in checkpoint comments and the spec; it does not replace remaining final gates.

## Performance

The genuine pre-PR/current DB_POOL_MAX=40 comparison passes isolation and2,000 operations per version. The measured100-user elapsed slowdown104.5% and p95 slowdown159.3% are documented in packages/enterprise/tests/rls/pool40-analysis.md. No no-regression or rollout acceptance claim is made.

## Remaining gates

Fix configured guard500 and accepted query-index lifecycle; validate actual HTTP behavior. Repeat relevant repository checks after production fixes. Run full unfiltered native integration, standalone create-app integration, then style-compliance pass and final independent review. Keep PR draft until these pass. Human QA approval remains a merge gate.

Quota diagnostic: actual acquire timeout caused by second checkout inside an active transaction at pool1. Fixed5d8a2651db; parent26 service tests/typecheck pass, original fails regression. Live guard rerun remains pending. Query-index04aa child parent45 suites/508 tests and actual enterprise composition1 test pass; independent reviewac91 pending before merge.


## Combined-head revalidation

Independent reviewac91 approves both quota transaction5d8 and index lifetime04aa; parent repeated45 suites/508 tests and real scope composition1 case. Merged asf841dce56c. Ordered gatev3 is running before configured005, full unfiltered native integration (concurrency pool40), and standalone, serially. No final live pass yet.

Design-system review used om-ds-guardian and current DS rules. Health scan completed, token parity/contrast PASS, token drift0; whole-repository legacy violations are informational rather than new PR findings. Reviewed all changed TSX against origin/main: two owner-local render-probe re-exports, gated diagnostic pre output, its test, and ComboboxInput optional-id ordering. No new color/typography/form/state violation found in changed lines. No UI fixes required. Full scan log/tmp/rls-ds-health.log; baseline report restored to avoid unrelated repository health churn.
