# Schema Design

Load this reference for entity shape and relationship decisions.

- Put entities in one `data/entities.ts`; use legacy decorators and explicit DB column names.
- Prefer UUID primary keys and module-prefixed plural table/index names.
- Tenant-owned rows require tenant/org IDs and an index beginning with the fields used by common scoped queries.
- Editable rows require create/update timestamps and `updated_at`; append-only logs and pure junction rows may be exempt when justified.
- Represent money as the installed monetary contract, not floating point; represent timestamps/timezones explicitly.
- Make nullable/optional/default semantics deliberate. A clearable field accepts explicit null through validator and command.
- Same-module relations may use ORM relations with owned/inverse sides defined. Cross-module records use scalar IDs, snapshots, events/enrichers, or `data/extensions.ts`.
- Add scoped uniqueness and partial indexes for soft-deleted data where needed. Ensure retries cannot create duplicates.

Use generated entity IDs rather than class-name guesses in APIs/search/widgets.
