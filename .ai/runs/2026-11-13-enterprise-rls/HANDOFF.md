# Handoff — full enterprise RLS

Branch: cez/82462d87
PR: https://github.com/open-mercato/open-mercato/pull/9424 (draft)
Current step: 2.2-rsc; PLAN.md remains authoritative for all remaining work.

## Completed

Neutral execution/pool hooks, enterprise ownership and policy/catalog/role checks, early bootstrap, canonical API identity and request/RSC resolver foundation. Runtime declarations now belong to owning modules through neutral discovery; enterprise request runtime knows no particular business modules. Customer-specific test probe now belongs to customers and uses only neutral context APIs.

Accepted child 3b4195bffa removed the prototype source/unit tests and dual-mode harness. Parent reviewed the diff and reran 74 runtime units, harness typecheck and live PG17: 16 runtime plus 23 catalog checks, zero skips, fixture cleanup verified. Production regressions are under packages/enterprise/tests/rls.

## Next action and verification limits

Run the native tenant_boundaries suite again after module generation. Attempt 3 built packages/application and reached Playwright, but stopped before assertions: legacy catalog_product_option_values was missing from the ORM-only inventory. Catalog now explicitly declares four retained legacy option tables; generic generation adds declared non-ORM storage and produces 346 entries. Unknown tables still fail closed and diagnostics report all missing names. Typechecks, builds, generation and 74 runtime units pass; live RSC has not passed yet.

## Remaining

Full public-token/storefront/provisioning continuations, workers/events/scheduler, CLI maintenance, independent pools and migration lifecycle. Real CRUD/job/People UI tests and restricted-role screenshots. Real authenticated 20/30/50/100-user concurrency isolation tests, analysis document and PR comments. Full ordered repository/integration/create-app gates and independent security review. User requires a separate subagent to resolve upstream conflicts and make the PR merge ready after implementation. No scope reduction, no completion claim until all gates pass.

## Environment

Local runner. Set MISE_NODE_VERSION=24.22.3 TMPDIR=/tmp TURBO_ENV_MODE=loose and prepend Node24 binary directory, including commits. Native CLI owns disposable app/database; no user database migrations. Run inventory with yarn tsx --tsconfig apps/mercato/tsconfig.json packages/enterprise/scripts/generate-rls-table-inventory.mjs. Test helpers contain private disposable URLs: never print them. Own PG17 container om-rls-82462-pg17:55279 retained for regressions. No child currently in flight. Use the cockpit binary for handoff/dispatch; never push or merge into base.
