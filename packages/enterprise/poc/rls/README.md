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

The live checks cover ORM reads/flush, raw SQL, Kysely, transaction commit/rollback, one-client A→B→absent reuse, rejected writes, setup-failure recovery with max=1, 60 concurrent operations over max=3, and the old `SET LOCAL` autocommit failure. Ordinary CI runs the unit suite; this live proof is an explicit operator command and is **not automatically run by existing GitHub CI**.

This prototype requires direct PostgreSQL or session-compatible pooling. It does not support transaction-pooling proxies, escaped transaction/client reuse between tenant scopes, global maintenance, or application-wide entry-point coverage. Keep all existing tenant, organization, authorization and encryption checks. Do not install it in a production app; the [enterprise specification](../../../../.ai/specs/enterprise/2026-11-12-row-level-security.md) defines the remaining activation gates.
