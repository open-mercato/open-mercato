# Promotion-code customer allowance after cancellation (#8426)

The per-customer usage count included reverted audit rows. Cancellation correctly restored global capacity and marked the use reverted, but the same customer remained over their limit. The fix excludes `revertedAt != null` rows from the shared eligibility count, preserving tenant/organization scope and active reservations held by other carts. No API, schema, event, locking, or public type changes.

This patch is based on Release 5 PR open-mercato/open-mercato#8268 head `28538d8e58d1b25c3cb0556834795b0ade979e34`. Its implementation is absent on main. The patch targets `adeptofvoltron/open-mercato:feat/ecommerce-release-5-conversion` so the feature is not imported into main by this bug fix.

Regression evidence:

- Static and generated codes with `usagePerCustomer: 1`: reserve, use, cancel, duplicate cancellation, reserve from a new cart, use again; both audit rows retained, only the original reverted. A different cart remains blocked while a reservation is live.
- Real PostgreSQL integration through the cancellation subscriber: an active use blocks the same customer; cancellation and duplicate delivery restore eligibility; an active reservation blocks another cart; the next active use blocks further reuse. The new case fails on the original code with `code_invalid` on the post-cancellation reserve.
- Final Node 24 run with `OM_PG_INTEGRATION=1`: all 37 promotions suites and 443 tests pass, including all 12 PostgreSQL lifecycle tests. Disposable PostgreSQL containers are stopped by test teardown.
- Targeted ESLint and `git diff --check` pass.

Runner: local with an immutable worktree-local dependency install. Targeted PostgreSQL tests and the final full unit suite ran on Node 24.22.3. Build/generation/translation/typecheck/app checks also passed through the host Yarn launcher. Earlier shared-dependency symlink diagnostics were superseded by the local install. `TMPDIR=/tmp` avoids the macOS Unix-socket path limit during tsx checks; `TURBO_ENV_MODE=loose` passes that environment setting through Turbo without changing test selection or assertions.

All configured validation commands passed on this source: `yarn build:packages`, `yarn generate`, `yarn build:packages`, `yarn i18n:check-sync`, `yarn i18n:check-usage`, `yarn typecheck`, `yarn test`, `yarn build:app`. The final full test run completed all 51 tasks in 4m41.82s, including 2,856 passing core suites (42 skipped by their existing gates). Earlier broad runs failed on the long temporary socket path; a subsequent run hit its 300s limit with 49 tasks complete. The final 900s-bounded run passed with the environment settings above. No assertions, test selection, production code or timeout configuration were weakened.

Published PR: https://github.com/adeptofvoltron/open-mercato/pull/20. Parent review found no correctness or compatibility findings. GitHub denied label changes for this account's READ permission in the fork; a maintainer must apply `bug`, `review`, `needs-qa`, `priority-medium`, `risk-medium`. Automated claimed-PR review could not run with that permission; the review handoff is posted on the PR. No hosted checks were reported in the fork at handoff. Real browser checkout/cancellation QA is separate from this database/subscriber integration proof; retain `needs-qa` and do not infer QA approval. Nothing was merged.
