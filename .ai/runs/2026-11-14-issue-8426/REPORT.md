# Promotion-code customer allowance after cancellation (#8426)

The per-customer usage count included reverted audit rows. Cancellation correctly restored global capacity and marked the use reverted, but the same customer remained over their limit. The fix excludes `revertedAt != null` rows from the shared eligibility count, preserving tenant/organization scope and active reservations held by other carts. No API, schema, event, locking, or public type changes.

This patch is based on Release 5 PR open-mercato/open-mercato#8268 head `28538d8e58d1b25c3cb0556834795b0ade979e34`. Its implementation is absent on main. The patch targets `adeptofvoltron/open-mercato:feat/ecommerce-release-5-conversion` so the feature is not imported into main by this bug fix.

Regression evidence:

- Static and generated codes with `usagePerCustomer: 1`: reserve, use, cancel, duplicate cancellation, reserve from a new cart, use again; both audit rows retained, only the original reverted. A different cart remains blocked while a reservation is live.
- Real PostgreSQL integration through the cancellation subscriber: an active use blocks the same customer; cancellation and duplicate delivery restore eligibility; an active reservation blocks another cart; the next active use blocks further reuse. The new case fails on the original code with `code_invalid` on the post-cancellation reserve.
- Final Node 24 run with `OM_PG_INTEGRATION=1`: all 37 promotions suites and 443 tests pass, including all 12 PostgreSQL lifecycle tests. Disposable PostgreSQL containers are stopped by test teardown.
- Targeted ESLint and `git diff --check` pass.

Runner: local, Node 24.22.3, immutable worktree-local dependency install. Earlier diagnostics using a shared dependency symlink and Node 26 were superseded by a clean local install and the supported runtime. `TMPDIR=/tmp` avoids the macOS Unix-socket path limit during tsx checks.

The configured validation gate is being completed and its final result will be recorded on the PR. Real browser checkout/cancellation QA is separate from this database/subscriber integration proof; retain `needs-qa` and do not infer QA approval.
