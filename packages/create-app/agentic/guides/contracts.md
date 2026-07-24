# Module and Data Contracts

Use this guide for entities, APIs, commands, scoping, compatibility, migrations, events, workers, search, and cache. Use `customers` as the CRUD reference after resolving its installed source.

## Entity and Scope Contract

- Define entity classes together in `src/modules/<id>/data/entities.ts`; import decorators from `@mikro-orm/decorators/legacy` and ORM types from the installed MikroORM package.
- Give tenant-owned rows `tenant_id` and `organization_id` columns plus a composite index suitable for their common filters. Derive scope from authenticated context, never request payloads.
- Give new user-editable rows `updated_at` with create/update behavior. Return it as `updatedAt` from list/detail APIs.
- Use UUID primary keys, explicit scalar FK IDs, and module-prefixed plural table names. Do not create cross-module ORM relations.
- Store sensitive/PII fields through `encryption.ts` `defaultEncryptionMaps`; use the framework decryption find helpers with both scope IDs. Add a deterministic hash sibling only when equality lookup requires it.
- Model nullable/optional/clearable fields consistently through validator, command, entity, response, and form. Test create, edit, reload, and clearing to `null`.

## Migration Workflow

1. Change `data/entities.ts` and any validator/command/response contracts.
2. Run `yarn generate` if discovery or entity registration changed.
3. Run `yarn db:generate` as a schema-diff probe.
4. Review every emitted statement; retain only the intended module change and update that module's `.snapshot-open-mercato.json` to the post-change schema.
5. Never edit a shipped migration. Add a corrective migration.
6. Ask before `yarn db:migrate`; normal delivery includes migration plus snapshot without mutating the user's database.

## CRUD Route Contract

Create handlers under `api/<resource>/route.ts` and build them with the installed `makeCrudRoute` contract:

- `metadata`: per-method `requireAuth` and `requireFeatures`;
- `orm`: entity, id field, tenant/org fields, and explicit soft-delete field (including `null` when absent);
- `list`: Zod query schema, stable colon-form `entityId`, fields including `updated_at`, scoped filters, stable response transform, and custom-field decoration when needed;
- `actions.create`, `actions.update`, `actions.delete`: command IDs, raw schemas, scoped input mapping, responses, and statuses;
- `indexer: { entityType }`: query-index coverage;
- `enrichers: { entityId }`: only when this route intentionally exposes the enricher host.

Export the factory's handlers and a matching `openApi` document. Do not use the stale flat `create`/`update`/`del` factory shape, a top-level `requireAuth`, or an API file organized by HTTP-method directory.

Reject malformed ID lists and filters explicitly. Preserve existing response keys; normalize custom fields deliberately and test compatibility when changing prefixed keys.

## Commands and Custom Writes

- Put domain mutations in commands so audit, undo, events, cache invalidation, and indexing share one path. Routes validate and dispatch; they do not reproduce writes.
- For custom write/action routes, run registered mutation guards before mutation, merge guarded payload changes, and run post-success callbacks after commit while logging callback failures.
- Enforce command-level optimistic locking for action/sub-resource endpoints. Guard the aggregate parent when lines share a parent version.
- Wrap multi-phase scalar/relation work with `withAtomicFlush(..., { transaction: true })`. Keep CRUD side effects and cache invalidation after the transaction commits.
- Emit both forward and undo side effects with the same index/cache aliases when undo exists.
- Make retries and idempotency explicit. Do not advance external cursors, one-time keys, or recovery state until the durable unit of work commits.

## Optimistic-Lock UI Contract

- `CrudForm` derives the update/delete header from `initialValues.updatedAt`; ensure the detail payload supplies it.
- A custom client mutation wraps the call with the framework's scoped request-header helper and `buildOptimisticLockHeader(record.updatedAt)`.
- Surface 409s through the shared record-conflict UI. Do not silently retry over newer data.
- If a parent form mutates children, override the header per child with that child's version; do not reuse the parent version.

## ACL and Setup

- Declare stable `<module>.<capability>` features in `acl.ts` and their dependency relationships when applicable.
- Gate API methods and pages declaratively with `requireFeatures`; never gate by mutable role names.
- Grant new features in `setup.ts` `defaultRoleFeatures` for the intended default roles, then run `yarn mercato auth sync-role-acls` for existing tenants.
- Use the wildcard-aware matcher wherever raw feature arrays are evaluated; `module.*` and `*` must satisfy concrete grants.
- Make `onTenantCreated`, `seedDefaults`, and provider setup idempotent. Keep examples in `seedExamples`.

## Cross-Module Mechanism

| Need | Use |
|---|---|
| Side effect after another module changes | Typed event + subscriber owned by the optional consumer. |
| Display/read another module's data | Widget injection plus response enricher. |
| Durable historical reference | Scalar ID plus snapshot; resolve live data only when available. |
| Add app-owned data linked to installed entity | Separate extension entity in `data/extensions.ts`. |
| Optional service call | Guarded/soft DI resolve in the consumer and a defined degraded result. |

## Events, Notifications, Workers, Search, and Cache

- Declare typed events in `events.ts` with `createModuleEvents(... as const)` before emitting them. Keep IDs past-tense and stable.
- Use persistent idempotent subscribers for retried side effects; use ephemeral subscribers for local reactive work. Verify the host module can be absent when optional.
- Declare notification types/renderers/handlers through their registries; keep notification IDs stable and ACL-aware.
- Give every worker metadata, an idempotent handler, bounded concurrency/retry behavior, scoped payloads, and commands for domain writes. Use `ProgressJob` for user-visible bulk/long work.
- Configure `search.ts`; use deterministic convergence polling or reindex assertions rather than arbitrary sleeps.
- Resolve cache through DI, use tenant/org/entity tags, and invalidate every successful write/undo/sub-resource path after commit.
- Add module CLI commands through the discovery contract and test the compiled package path, not only TypeScript source.

## Frozen Surfaces

Treat API routes, public imports/signatures, DB schema, event/entity/ACL/DI/widget/notification/AI IDs, CLI commands/flags, and generated bootstrap exports as compatibility surfaces. Prefer additive fields and aliases. A rename/removal needs an explicit deprecation bridge and migration plan.
