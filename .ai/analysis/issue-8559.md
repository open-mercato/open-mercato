# Issue 8559 — coverage pruning

Plan: (1) trace lock ordering and NULL uniqueness, (2) coordinate NULL-tenant snapshot and delta writes before row locks and reuse snapshot rows, (3) prove PostgreSQL deadlock pattern and corrected concurrency, validate, publish and review.

Summary: Concurrent global coverage writers can create duplicate rows and prune while holding conflicting tuple locks.

Root cause: `upsertCoverageRow` inserts for NULL tenants because the ordinary unique constraint treats NULL as distinct; it neither participates in `lockCoverageInitialization` nor opens a transaction. Counter initialization only takes that lock after trying its UPDATE. Existing duplicate rows can consequently be mutated/pruned without a common coordination boundary. The CI log shows 40P01 in pruning during global feature-toggle reindexing, but does not retain the peer statement or execution plan; the precise historical tuple acquisition sequence cannot be established from that log alone.

Files to change:
- packages/core/src/modules/query_index/lib/coverage.ts — coordinate nullable-tenant writers before mutation; snapshot update existing rows while holding the transaction lock.
- packages/core/src/modules/query_index/__tests__/coverage-adjustment-atomicity.test.ts — assert lock-before-write ordering.
- packages/core/src/modules/query_index/__integration__/TC-QIDX-8559-coverage-deadlock.spec.ts — real PostgreSQL controlled lock-cycle reproduction and fixed-path concurrency/count/isolation/cleanup coverage.

Approach: Reuse the existing per-scope transaction advisory key for both writers, acquired before row locks. Keep the non-null tenant fast path unchanged. Reuse ambient transactions, never nest. Reuse a NULL-tenant snapshot row so repeated snapshots remain idempotent.

Risks: NULL-tenant adjustments incur one advisory-lock statement; these are global catalogue scopes. Arbitrary caller-owned transactions acquiring multiple independent scopes must still respect the existing stable scope ordering. No schema, public API, or telemetry changes.

## Reproduction and verification

The deterministic PostgreSQL regression drives the real `applyCoverageAdjustments` and `writeCoverageCounts` functions. Two committed duplicate NULL-tenant rows are created, then a HOT update moves the first row's visible heap tuple after the second while preserving its index traversal position. Per-connection planner settings and assertions establish delta UPDATE traversal A,B and snapshot DELETE traversal B,A. Test-only triggers gate each writer after its first tuple lock. The old delta holds A and waits on B; snapshot pruning holds B and waits on A. Replacing only coverage.ts with HEAD's unfixed version fails with `deadlock detected` in 1.3 seconds. Restoring the fix makes snapshot wait on the delta's scope advisory lock before any tuple mutation; both finish and leave one exact-count row. The CI peer statement was not retained, so this proves a production-path causal cycle consistent with the log rather than asserting the exact historical query plan.

A second PostgreSQL regression starts from two canonical duplicates and a legacy NULL-organization row; it checks repeated concurrent refreshes, exact global/scoped/withDeleted/vector totals, snapshot/delta coordination, unrelated tenant progress, and schema/fixture cleanup. The schema is owned per test and dropped with an asserted namespace absence. No migrations are applied.

Runner: local (no running Docker app container). Dependencies reuse the checkout's existing node_modules via an ignored symlink.

## Validation results

| Configured command (ordered) | Result |
| --- | --- |
| `yarn build:packages` | PASS, 42 tasks |
| `yarn generate` | PASS |
| `yarn build:packages` | PASS, 42 tasks |
| `yarn i18n:check-sync` | Initial tsx IPC path EINVAL; PASS on retry with `TMPDIR=/tmp` |
| `yarn i18n:check-usage` | Initial tsx IPC path EINVAL; retry with short TMPDIR stopped at 60 seconds while scanning (no result) |
| `yarn typecheck` | FAIL in untouched engine.ts: shared-package declaration skew (`CiphertextSearchWarning`, `ciphertextSearchWarnings`, `onDiagnostic`); no changed-file diagnostic |
| `yarn test` | FAIL before execution in web-research-serp: TypeScript 7 does not expose the JS compiler API required by ts-jest |
| `yarn build:app` | FAIL: Turbopack cannot resolve the reused node_modules symlink outside its filesystem root |

Targeted tests:
- PostgreSQL 17.11: `playwright test --config /tmp/8559-playwright.config.cjs --repeat-each 5`: **10 passed** in 9.3 seconds. Temporary config sets the worktree testDir and exact new module spec, timeout 20000, retries 0, workers 1; it bypasses application bootstrap because these tests only need PostgreSQL. The repository config uses the same 20000ms test timeout.
- Query-index Jest: `jest --config /tmp/8559-jest.json --runInBand packages/core/src/modules/query_index/__tests__`: **41 suites / 469 tests passed**, 3 suites / 21 tests skipped by existing suite guards. Temporary config derives from root Jest config, explicitly sets transform tsconfig.rootDir to the worktree, and adds `kysely` to transformIgnorePatterns' ESM allowlist. Bare root Jest cannot start with the installed TypeScript6 default rootDir plus Kysely ESM layout.
- Mutation check: run only the actual-writer PostgreSQL regression with original HEAD coverage.ts, restoring fixed bytes in a finally block: **fails with deadlock detected** in 1.3 seconds.
- Independent reviewer ran PostgreSQL suite (2 passed), reviewed final cleanup and diff: **APPROVE**, no correctness/scope/count findings.
- `git diff --check`: PASS.

Full application initialization was not rerun: production writer concurrency is covered directly with controlled locks and self-contained PostgreSQL fixtures. Full-gate failures remain explicit environment/toolchain blockers; this is not a claim of merge readiness.

## CI follow-up — source-registry bootstrap

Hosted attempts 1 and 2 pass both deadlock regressions and the unit gate, but TC-EXAMPLE-015 fails its home-Todo vector-search assertion (60 integration passes, one failure, two skips). This matches existing issue #8348: the direct vector-service caller did not bootstrap the application source registry, so the production source-authority guard correctly fails closed.

The CI repair calls the existing `bootstrapFromAppRoot(resolveAppRoot())` before constructing test data. It retains all home/foreign organization, checksum and query-scope assertions. A negative control persists a vector for a unique unregistered entity, proves it exists through the list API, and requires the real similarity query to exclude it. The test closes its owned pool in `finally`; its disposable tables still drop during cleanup. No production search code, authorization, timeout or assertion is weakened.

The repaired TC-EXAMPLE-015 passes all three scenarios against a managed disposable PostgreSQL/app environment, including the persisted unregistered-source negative control and the workflow integration. Workspace typechecking passes (42/42 tasks). A repeated integration run and new-head hosted CI are pending; the earlier coverage source change is unchanged.
