# Enterprise RLS connection proof

Commercial Enterprise prototype for [#244](https://github.com/open-mercato/open-mercato/issues/244). It is deliberately unregistered: importing the enterprise package does not install it or enable policies on application tables.

The adapter initializes tenant session state on the **same checked-out pg client**, before returning it to MikroORM/Kysely. It clears absent scope on every reservation and destroys the client if setup fails. Promise and callback acquisition are supported, including `pool.query` and the existing application pool instrumentation.

Run from the repository root after installing dependencies and building packages:

```sh
yarn workspace @open-mercato/enterprise test --runInBand --testPathPatterns=poolScope.test.ts
yarn tsc --project packages/enterprise/poc/rls/tsconfig.json --noEmit
```

Set `OM_RLS_POC_DATABASE_URL` privately to a **disposable** PostgreSQL database whose administrative role may create roles and schemas, then run:

```sh
yarn tsx packages/enterprise/poc/rls/run.ts
```

The proof creates a random restricted login role and schema, verifies the runtime role is neither superuser, `BYPASSRLS` nor table owner, and tears down its own fixtures in `finally`. It does not run app migrations. Never point it at a production database.

The live checks cover ORM reads/flush, raw SQL, Kysely, transaction commit/rollback, one-client A→B→absent reuse, rejected writes, setup-failure recovery with max=1, 60 concurrent reads plus 60 mixed transactions over max=3, and the old `SET LOCAL` autocommit failure. Ordinary CI runs the unit suite; this live proof is an explicit operator command and is **not automatically run by existing GitHub CI**.

## Automated integration execution

With `OM_RLS_POC_DATABASE_URL` set privately to an explicitly disposable database, run:

```sh
node --test packages/enterprise/poc/rls/integration.test.mjs
```

The Node test runner executes two real ORM/Kysely/PostgreSQL proofs, each in a subprocess with a 90-second deadline. The original prototype requires 13 checks. The production guard library requires 16 checks, including stale lease rejection on the same backend, borrowing a pinned ORM transaction from another invocation, and cleanup/recovery after invocation completion. Both verify that the random schema and login role were removed. Both concurrent batches drain before teardown; pools close before checkout wrappers are removed. Success is reported only after cleanup. Without the disposable database URL, the integration tests report skips, not database-isolation evidence. Run them explicitly alongside the ordinary unit suite; this does not change the repository's CI pipeline.

The guard-library proof can also be run directly with `yarn tsx packages/enterprise/poc/rls/run.ts --runtime`. It tests the real driver and lease guard against disposable fixtures; production module registration, role/policy startup validation, HTTP/worker/RSC propagation and the application canary are separate acceptance gates in the full implementation run.

On failure the runner reports the exit status without forwarding database diagnostics that could contain credentials. Use the direct operator command privately for diagnosis. If the subprocess is forcibly terminated or times out, its `finally` cleanup cannot be guaranteed; discard the disposable database rather than reusing it for application work.

This prototype requires direct PostgreSQL or session-compatible pooling. It does not support transaction-pooling proxies, escaped transaction/client reuse between tenant scopes, global maintenance, or application-wide entry-point coverage. Keep all existing tenant, organization, authorization and encryption checks. Do not install it in a production app; the [enterprise specification](../../../../.ai/specs/enterprise/2026-11-12-row-level-security.md) defines the remaining activation gates.

## Observed proof, 2026-11-12

Against a dedicated PostgreSQL 16 container, all **12 live checks passed**, including 60 overlapping tenant reads, 60 mixed transactions through a pool of 3, and recovery from setup failure over a pool of 1. The negative control confirmed that transaction-local state set outside an explicit transaction does not protect a later autocommit query. The expanded proof passed on Node 24.

The mixed-operation check uses a bounded first-wave barrier to require **three distinct PostgreSQL backend PIDs holding transactions simultaneously**, with both tenants represented. Each operation creates through ORM/flush, updates through Kysely, attempts raw update/delete against the other tenant, reads without an application tenant predicate, and rechecks the pinned PID and tenant setting. Of the 60 transactions, 40 commit and 20 deliberately roll back; committed deletes leave exactly 30 new rows. A privileged final read must exactly match those rows and both unchanged seed rows. `Promise.allSettled` drains all work before reporting errors, and only the deliberate rollback sentinel is accepted as an expected failure.

The 12 ordinary unit tests and dedicated harness no-emit typecheck also passed. Independent review found no blocking source issue. Full repository and GitHub CI results are tracked on [PR #9353](https://github.com/open-mercato/open-mercato/pull/9353); these proof results alone do not imply full-CI success or production readiness.
