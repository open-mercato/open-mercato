# @open-mercato/search 🔎

Hybrid search for Open Mercato: fulltext, vector, and token-based search in one module.

`@open-mercato/search` delivers indexing pipelines, strategy orchestration, global search UI integration, and reindex tooling.

## Why this package ✨

- 🧠 Semantic + keyword search strategies
- ⚡ Strategy fusion with configurable fallbacks
- 🧩 Module-level search config (`search.ts`) support
- 🛠 Reindex commands, diagnostics, and operational APIs

## Install

```bash
yarn add @open-mercato/search
```

## PostgreSQL storage and restricted runtime roles

Both the DI singleton and standalone `createPgVectorDriver` register their PostgreSQL pool with the shared database runtime. `ensureReady()` awaits pool validation before any storage operation. In validate mode, readiness checks the extension, schema resolution, columns, dimension, indexes and migration ledger using reads only. Run global database migrations with the maintenance connection to provision storage; runtime dimension recreation is refused in this mode. Disabled mode retains runtime provisioning.

The search module's `database.ts` owns provisioning for the default `vector_search` and `vector_search_migrations` tables. The same configuration is used by the driver and the provider: `SEARCH_PGVECTOR_SCHEMA` (default `public`), `SEARCH_PGVECTOR_TABLE`, `SEARCH_PGVECTOR_MIGRATIONS_TABLE`, `SEARCH_PGVECTOR_DIMENSION` (default `1536`) and `SEARCH_PGVECTOR_DISTANCE_METRIC` (`cosine`, `euclidean`, `inner`). `SEARCH_PGVECTOR_APPLICATION_SCHEMA` (or the `applicationSchema` driver option) can select a different schema for correlated application reads; it defaults to the vector schema. The connection search path must resolve correlated `entity_indexes` and `custom_entities_storage` reads in the declared schema. Dimensions above 2000 use sequential scans; lower dimensions require an ivfflat index with 100 lists and the matching operator class. Mismatched existing storage fails validation and requires an explicit maintenance migration.

For a separate custom vector table, export `createPgVectorDatabaseDeclarations(options)` from the owning module's `database.ts`, importing it from `@open-mercato/search/vector/drivers/pgvector/storage`. Pass the same options to `createPgVectorDriver`. Do not declare the same physical storage twice. Both internally created and supplied pools are closed by the driver's additive `close()` method; close drivers before releasing their lifecycle registration. Cache-disabled DI drivers are disposed with their container.

## Learn more

- GitHub (package): https://github.com/open-mercato/open-mercato/tree/main/packages/search
- GitHub (project): https://github.com/open-mercato/open-mercato
- Docs: https://docs.openmercato.com

## License

MIT
