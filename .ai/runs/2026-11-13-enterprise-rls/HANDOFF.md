# Handoff — full enterprise RLS

Branch: cez/82462d87
PR: https://github.com/open-mercato/open-mercato/pull/9424 (draft)
Current step: 2.2-rsc and remaining public continuations; PLAN.md remains authoritative for all remaining work.

## Completed

Neutral execution/pool hooks, enterprise ownership and policy/catalog/role checks, early bootstrap, canonical API identity and request/RSC resolver foundation. Runtime declarations now belong to owning modules through neutral discovery; enterprise request runtime knows no particular business modules. Customer-specific test probe now belongs to customers and uses only neutral context APIs.

Accepted child 3b4195bffa removed the prototype source/unit tests and dual-mode harness. Parent reviewed the diff and reran 74 runtime units, harness typecheck and live PG17: 16 runtime plus 23 catalog checks, zero skips, fixture cleanup verified. Production regressions are under packages/enterprise/tests/rls.

## Next action and verification limits

Native attempt6 retry app is ready; test owner71754/session64558 remains active with log /tmp/rls-82462-live-rsc-6.log. First run failed before fixture creation on database timeout. No live RSC assertion pass claimed. Serialize package builds/generators with the native runner and its retries.

Latest e094c81303 storefront/buyer continuation:119 tests/9 suites and core typecheck pass. Login/tokens 009655ef56/2637311d63:27 tests/3 suites and core typecheck pass. Signup/invitation a485df41a5:9 tests pass. Module-owned catalog declarations d324542332 produce347 inventory entries. All pushed. Checkpoint4 posted as comment6856414615; full gates remain required.

## Remaining

Full public-token/storefront/provisioning continuations, workers/events/scheduler, CLI maintenance, independent pools and migration lifecycle. Real CRUD/job/People UI tests and restricted-role screenshots. Real authenticated 20/30/50/100-user concurrency isolation tests, analysis document and PR comments. Full ordered repository/integration/create-app gates and independent security review. User requires a separate subagent to resolve upstream conflicts and make the PR merge ready after implementation. No scope reduction, no completion claim until all gates pass.

## Environment

Local runner. Set MISE_NODE_VERSION=24.22.3 TMPDIR=/tmp TURBO_ENV_MODE=loose and prepend Node24 binary directory, including commits. Native CLI owns disposable app/database; no user database migrations. Run inventory with yarn tsx --tsconfig apps/mercato/tsconfig.json packages/enterprise/scripts/generate-rls-table-inventory.mjs. Test helpers contain private disposable URLs: never print them. Own PG17 container om-rls-82462-pg17:55279 retained for regressions. No child currently in flight. Use the cockpit binary for handoff/dispatch; never push or merge into base.
