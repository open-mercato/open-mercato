# Enterprise RLS production regressions

These harnesses exercise the production runtime in `src/lib/rls/runtime` against real PostgreSQL using randomly named schemas, restricted login roles and synthetic records. They do not run application migrations. Keep existing tenant, organization, authorization and encryption checks enabled.

Run from the repository root with dependencies installed and packages built:

```sh
timeout 300 yarn workspace @open-mercato/enterprise typecheck
timeout 300 yarn workspace @open-mercato/enterprise test --runInBand
timeout 120 yarn tsc --project packages/enterprise/tests/rls/tsconfig.json --noEmit
```

Set `OM_RLS_TEST_DATABASE_URL` privately to an **explicitly disposable** PostgreSQL database with administrative privileges to create roles and schemas and change database privileges. Never use production, user data, a shared developer database, or the application database. The catalog harness revokes the database's PUBLIC temporary-table privilege; this database-wide change is intentionally not restored. Discard the database after testing.

```sh
timeout 240 node --test packages/enterprise/tests/rls/integration.test.mjs
```

The integration runner launches two sequential subprocesses with 90-second deadlines and requires exactly **16 runtime checks** and **24 catalog checks**. Without the disposable URL, both tests skip; skips provide no live isolation evidence. The former prototype environment variable and runtime-selection flag are no longer used.

For private diagnostics, run either harness directly:

```sh
timeout 120 yarn tsx packages/enterprise/tests/rls/run.ts
timeout 120 yarn tsx packages/enterprise/tests/rls/catalog.run.ts
```

The runtime regression covers ORM reads/flush, raw SQL, Kysely, commit/rollback, A→B→absent reuse on one connection, denied writes, setup-failure recovery, 60 overlapping reads and 60 mixed transactions over three simultaneous backend connections, stale leases, borrowed pinned transactions, completed invocation cleanup, nested tenant switching and fixture removal. Its negative control confirms that transaction-local state outside a transaction cannot protect later autocommit queries.

The catalog regression covers unsafe roles and effective privileges, unknown tenant tables, schema drift, inheritance, canonical and widening policies, dependent views, concurrent reconciliation, exact-version rollback and production adapter readiness. The catalog harness also verifies a distinct, explicitly scoped maintenance login and rejects tenant access to its bypass pool. Both harnesses remove their random schema and roles in `finally`; success is printed only after cleanup. Forced termination may prevent cleanup, so discard the disposable database after any timeout or failure.

The integration runner suppresses subprocess diagnostics that could contain credentials. Do not paste direct harness diagnostics or database URLs into reports. These explicit operator commands do not alter CI configuration. HTTP/worker/RSC propagation and application-canary acceptance remain separate live gates; these regressions alone do not establish production readiness.
