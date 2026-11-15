# Checkpoint 1 — enterprise RLS foundation

Steps: 1.1, 1.1-review-fix, 1.2, 1.3, 1.4. Start: 349e99034a. End: Step 1.4 commit immediately preceding this record.

Runner: local, Node 24.22.3 via mise; TMPDIR=/tmp and TURBO_ENV_MODE=loose. No compose app container is running.

## Passed

- Shared focused database suites: 3 suites, 33 tests. Initialization waits for validation, rejects unsafe startup, closes before disposal, retries, and exposes actual immutable ORM metadata before readiness.
- Enterprise RLS suites: 4 suites, 73 tests. Scope lifetime, checkout ownership, stale leases, callbacks, configuration, role privileges, manifest drift and exact effective policy tuple.
- Shared and enterprise package typechecks; dedicated proof harness no-emit typecheck.
- Enterprise package build: 719 entries.
- Offline inventory generation: 342 explicit tables; only customer_entities is enforced. Actual ORM and catalog comparison reject unknown tenant-bearing tables and unused-schema canary claims.
- PostgreSQL 16, 17 and 18: 3 integration tests per version, 0 failures, 0 skips. Each version passed prototype 13, runtime guard 16 and catalog 21 checks. Dedicated disposable containers only; fixture schemas and roles removed by each proof.
- Catalog checks include effective database CREATE/TEMP, schema CREATE, role membership, superuser/BYPASSRLS, ownership, TRUNCATE, relation/column grant options, SECURITY DEFINER, inheritance, unknown tables, widening policies, transitive views, concurrent reconciliation and exact-version rollback.
- git diff --check.

Local logs: /tmp/rls-82462-{metadata-unit,catalog-unit,metadata-typecheck,catalog-typecheck,catalog-build,catalog-harness-tsc,pg16-live,pg17-live,pg18-live}.log.

## Limits and remaining gates

No UI file changed in this checkpoint, so no new browser screenshot is applicable. Earlier report screenshots are historical proof evidence and do not satisfy the future actual application browser gate.

Production module bootstrap, trusted HTTP/page/portal/job/CLI contexts, independent pool integration, migration hooks, canary application tests, browser screenshots, performance and the full repository gate remain pending. These tests approve this foundation only; they do not establish production readiness.
