# Issue #8426 local handoff

Dependency: this fix commit is based on open Release 5 PR #8268 head `28538d8e58d1b25c3cb0556834795b0ade979e34`. Do not merge that release into a main-based parent as part of this fix. Apply only this fix commit to a Release 5-based target. Original fork point `7588d72a33` lacks the cancellation implementation and CodeUsage.revertedAt.

Root cause: countActiveCustomerUsage counted reverted CodeUsage rows. Cancellation correctly sets revertedAt and restores global capacity, but the customer allowance remained exhausted. Filter the count by revertedAt:null; organization/tenant filters and active other-cart reservations are preserved. No schema, API, DI, event or other public-contract changes.

Regression: static and generated single-use codes with usagePerCustomer=1 run reserve -> use -> cancel -> duplicate cancel -> reserve from a new cart -> use. Audit retains both usage rows with only the first reverted. Existing live-use and other-cart-reservation limit tests remain passing.

Runner: local; no running compose app found. Dependencies reused through an untracked node_modules symlink to the parent installation.

Validation commands and results:
- `timeout 90 node node_modules/jest/bin/jest.js --config packages/core/jest.config.cjs --runInBand --runTestsByPath packages/core/src/modules/promotions/lib/__tests__/code-service.test.ts`: before production fix, exit 1, 2 new regressions failed with code_invalid; 55 passed.
- `timeout 120 node node_modules/jest/bin/jest.js --config packages/core/jest.config.cjs --runInBand promotions`: exit 0; 36 suites passed, 1 skipped; 431 tests passed, 11 skipped.
- `timeout 90 node node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json`: exit 2; missing generated registries and multiple unrelated errors including duplicate id in parent ui ComboboxInput.tsx. Full log provided as cockpit artifact. No out-of-scope fixes attempted.
- `git diff --check`: exit 0.

Review: production diff is one scoped predicate in the shared helper consumed by reserve/validate/use. Existing audit and locking behavior preserved. No correctness findings in local diff inspection. Formal review verdict: request changes for incomplete validation; this is a parent-review handoff, not merge approval.

Limits: full configured gate NOT RUN (build:packages, generate, build:packages, i18n:check-sync, i18n:check-usage, typecheck, test, build:app); only scoped tests/typecheck above executed. Real Postgres/concurrency integration and cart API cancellation/reuse QA NOT RUN (no live app/database). No push or PR; parent owns publication and final validation. No children dispatched.
