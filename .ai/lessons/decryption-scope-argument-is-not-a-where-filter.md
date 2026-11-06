---
title: "The decryption `scope` argument is not a WHERE filter"
modules: ["warranty_claims","shared","customers"]
areas: ["module-data","architecture","testing"]
topics: ["data-scoping","access-control","command-pattern","historical-attribution","row-locking","reference-integrity"]
---

# The decryption `scope` argument is not a WHERE filter

**Context**: `findOneWithDecryption` / `findWithDecryption` (`@open-mercato/shared/lib/encryption/find`) accept a `scope` argument, so hand-written loaders passed `{ id }` as the where clause and trusted `scope` to apply tenant filtering.

**Problem**: `scope` only selects the decryption key (`decryptEntitiesWithFallbackScope`); it is never added to the query `where`. `findOneWithDecryption(em, Entity, { id }, {}, { tenantId, organizationId })` runs `em.findOne(Entity, { id })` with no tenant scoping, and this repo has no global MikroORM tenant filter — so command/action/subscriber loaders are cross-tenant readable and mutable by UUID. The same trap applies to child-collection loads by FK (`{ claim: id }`). `makeCrudRoute` list/detail routes are scoped by the factory, so a tenant-isolation test that only exercises the list route will not catch the hole in command action endpoints.

**Rule**: Put `tenantId` and `organizationId` in the `where` object of every tenant-scoped hand-written loader, including child-collection loads by FK. Add `deletedAt: null` when the entity supports soft deletion; do not invent that property on entities that are hard-deleted. Treat the `scope` argument as decryption-only. Validate scalar parent references in the same scope before copying their identifiers or metadata. Exercise command/action or CRUD write endpoints in isolation tests, rather than testing only list routes. Cover a second organization in the caller tenant and a separate tenant; create foreign fixtures with a superadmin while keeping the tested actor authenticated in its original scope.

**Locking reads**: Apply the authorized scope predicates before a pessimistic lock is acquired. A scope check after `findOneWithDecryption(..., { id }, { lockMode })` can prevent mutation while still selecting and locking a foreign record. Test the execute path's query predicates as well as rejection, and carry the same authorized scope into transaction-bound undo snapshot loaders.

**Multi-organization enrichment (#7531)**: Scope each referenced entity according to its own model. User profiles belong to a tenant and may have a different home organization from an authorized customer record; do not equate those organizations or drop legitimate attribution. Keep tenant predicates and record-scope-qualified keys for batched author enrichment. Separate live-user validation for new assignments from historical reads and snapshot restoration: soft deletion must not erase prior attribution or prevent undo. Test HQ/Branch authors, offboarded users through all replay paths, all-organization/descendant views, and foreign-tenant poisoned references.

**Historical fixture lifecycle**: Inspect the actual delete command before using an HTTP DELETE to model soft deletion. `auth.users.delete` hard-deletes (`soft: false`), so a successful response does not leave a historical user row. When testing `deleted_at` semantics that the API cannot express, use the existing database-fixture helper for the newly owned row, scope by ID/tenant/organization, assert it remains, and restore its flag in `finally` before normal API cleanup. Preserve the historical profile assertions.

**Applies to**: Command handlers, action endpoints, subscribers, enrichers, and any loader that reads an entity by id or FK outside a `makeCrudRoute` factory.

**Evidence (issue #7851)**: The customers deal-stage loader accepted a foreign stage UUID and inferred its pipeline while copying the stage label into caller-owned deals, dictionaries, and history. Explicit stage predicates plus parent-pipeline validation reject those references before mutation. The correction ships 32 command regressions and `TC-CRM-7851-pipeline-reference-scope.spec.ts`; the saved HTTP regression passed locally and in CI, including stage-only inference for valid references.
