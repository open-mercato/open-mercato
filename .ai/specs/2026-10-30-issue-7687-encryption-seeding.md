# Issue #7687: provision encryption policies on every tenant and organization creation path

## Problem and scope

With `TENANT_DATA_ENCRYPTION=yes`, `auth add-org` persisted a tenant and organization without emitting their existing directory creation events. The entities-owned organization subscriber therefore never seeded its policy. `directory.tenants.create` already emits `directory.tenant.created`, but no entities subscriber handled it. A missing policy allows mapped fields to be written as plaintext.

The scope is the auth CLI, tenant provisioning subscribers owned by entities, and focused regressions. This extends the existing organization inline/retry pattern from #7629 and retains the canonical upsert invariant documented in `2026-10-04-encryption-map-scope-uniqueness.md`.

## Implementation

- After persisting each CLI-created record, emit its existing directory creation event through the request container's event bus. Await inline delivery and use the existing `rethrowHandlerErrors` option so a failed policy seed cannot produce a successful CLI completion message. Preserve CLI arguments and success output.
- An ephemeral entities subscriber handles `directory.tenant.created`, seeding default tenant-global policies through `upsertEncryptionMaps`. The new tenant is `payload.id`: a tenant is a global record and its event's `tenantId` and `organizationId` remain null. The actor's tenant is never the destination.
- A persistent entities subscriber invokes the same tenant handler for durable retry. The existing organization subscriber continues to handle organization creation. Both use canonical conflict-safe upserts and best-effort post-write cache invalidation; system-scoped declarations remain code-resolved.
- Auth and directory do not import entities business logic. Directory command code and public event payloads remain unchanged.

## Verification

- CLI component integration exercises real event delivery and both seeding handlers, asserting persistence precedes policy materialization and both scopes exist before success. It covers disabled encryption and an inline database failure.
- Directory command coverage runs real command side-effect registration, data-engine flushing, event delivery and tenant policy seeding, preserving global scope and excluding the actor tenant.
- Subscriber cases cover record-ID scope selection, system-scope exclusion, invalid payloads, disabled encryption, the canonical upsert retry, and invalidation failure.
- A self-contained opt-in PostgreSQL fixture (`OM_PG_INTEGRATION=1`) runs the ordinary CLI handler and real hierarchy rebuild against a disposable PostgreSQL 16 database. It verifies both active policies, encryption of the first protected payload in each scope, and no duplicate policies after queued redelivery. The fixture removes its database by stopping the container; it does not apply application migrations.

## Migration & Backward Compatibility

No database schema, API surface, exported signature, event ID, CLI flag, success output or authentication contract changes. New subscribers use the existing discovery convention; run normal module generation during deployment. No migration or compatibility waiver is needed.

Existing affected tenants and organizations require an operator audit. The existing `mercato entities seed-encryption --tenant <tenant-id>` and `--tenant <tenant-id> --org <organization-id>` commands can materialize policies for previously created scopes. These commands alone do not retroactively encrypt plaintext rows. Re-encryption/backfill of existing data is outside this creation-path fix and must follow the relevant entity's operational procedure.

## Residual risks

CLI persistence remains per-record autocommit. An inline seed error rejects the command but may leave a newly created tenant or organization persisted, as with existing partial CLI provisioning errors. Operators should inspect the failed scope before retrying. Directory command side effects retain their existing best-effort inline delivery and durable retry semantics: a transient seed failure can defer policy creation until retry. This patch does not change event-bus delivery contracts or claim a transactional policy guarantee for that path.

## Changelog

- 2026-10-30: Confirmed both omitted paths at `3b2ea82ea7`; implemented existing lifecycle delivery and entities-owned tenant seeding with focused and disposable PostgreSQL regressions for #7687.
