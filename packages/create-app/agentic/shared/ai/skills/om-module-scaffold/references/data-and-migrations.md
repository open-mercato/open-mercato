# Module Data and Migrations

Load this reference when the module persists data.

1. Invoke `om-data-model-design`; place all entity classes in `data/entities.ts` and validators in `data/validators.ts`.
2. Add UUID IDs, explicit tenant/org columns and indexes, timestamps, optional soft delete, and `updated_at` for every new editable record.
3. Keep same-module relations explicit. For another module, store a scalar ID/snapshot or use an extension entity; never declare an ORM relation.
4. Add encryption maps for PII/credentials and decryption reads for every code path that returns those values.
5. Design commands and responses so optional fields can be intentionally cleared.
6. Run `yarn db:generate`, review only the scoped SQL, and update the module snapshot. Ask before applying.

Required regression coverage: two-scope isolation, create/read/update/clear/delete, current/stale version, and injected multi-phase failure rollback.

Canonical example source: [`data/entities.ts`](../../../../src/modules/example/data/entities.ts), [`data/validators.ts`](../../../../src/modules/example/data/validators.ts), [`ce.ts`](../../../../src/modules/example/ce.ts), and the generated pair [`migrations/Migration20260226161000_example.ts`](../../../../src/modules/example/migrations/Migration20260226161000_example.ts) plus [`migrations/.snapshot-open-mercato.json`](../../../../src/modules/example/migrations/.snapshot-open-mercato.json). No canonical encryption map exists yet — follow step 4 and `om-data-model-design`.
