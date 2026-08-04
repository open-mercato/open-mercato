# Schema Design

Load this reference for entity shape and relationship decisions.

- Put entities in one `data/entities.ts`; use legacy decorators and explicit DB column names.
- Prefer UUID primary keys and module-prefixed plural table/index names.
- Tenant-owned rows require tenant/org IDs and an index beginning with the fields used by common scoped queries.
- Editable rows require create/update timestamps and `updated_at`; append-only logs and pure junction rows may be exempt when justified.
- Represent money as the installed monetary contract, not floating point; represent timestamps/timezones explicitly.
- Make nullable/optional/default semantics deliberate. A clearable field accepts explicit null through validator and command.
- Same-module relations may use ORM relations with owned/inverse sides defined. Cross-module records use scalar IDs, snapshots, events/enrichers, or `data/extensions.ts`.
- Add scoped uniqueness and partial indexes for soft-deleted data where needed. With legacy decorators, import `Unique` from `@mikro-orm/decorators/legacy` and declare a composite constraint as `@Unique({ name, properties: [...] })`; `@Index({ unique: true })` is not a supported unique-constraint shape. Ensure retries cannot create duplicates.

Canonical example source: [`data/entities.ts`](../../../../src/modules/example/data/entities.ts) (UUID PKs, snake_case columns, `tenant_id`/`organization_id`, `created_at`/`updated_at`/`deleted_at`, no cross-module relations), [`data/validators.ts`](../../../../src/modules/example/data/validators.ts) (Zod create/update/list schemas with `z.infer` types), and [`ce.ts`](../../../../src/modules/example/ce.ts) (custom entities and field kinds). The example does not implement `data/extensions.ts`; route that to `om-system-extension`.

Use generated entity IDs rather than class-name guesses in APIs/search/widgets. App-owned modules import them from `@/.mercato/generated/entities.ids.generated`; `#generated/entities.ids.generated` is a package-internal alias and must not be copied into a standalone app. Typecheck cannot detect a valid-looking but wrong entity ID string, so also start the generated route and smoke-test the affected API against its runtime registry.
