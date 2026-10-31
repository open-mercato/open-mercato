---
title: "The decryption `scope` argument is not a WHERE filter"
modules: ["warranty_claims","shared","customers"]
areas: ["module-data","architecture","testing"]
<<<<<<< HEAD
topics: ["data-scoping","access-control","command-pattern"]
=======
topics: ["data-scoping","access-control","command-pattern","historical-attribution","row-locking","reference-integrity"]
>>>>>>> 52db3dc0d (fix(customers): scope interaction author and owner references (#8358))
---

# The decryption `scope` argument is not a WHERE filter

**Context**: `findOneWithDecryption` / `findWithDecryption` (`@open-mercato/shared/lib/encryption/find`) accept a `scope` argument, so hand-written loaders passed `{ id }` as the where clause and trusted `scope` to apply tenant filtering.

**Problem**: `scope` only selects the decryption key (`decryptEntitiesWithFallbackScope`); it is never added to the query `where`. `findOneWithDecryption(em, Entity, { id }, {}, { tenantId, organizationId })` runs `em.findOne(Entity, { id })` with no tenant scoping, and this repo has no global MikroORM tenant filter — so command/action/subscriber loaders are cross-tenant readable and mutable by UUID. The same trap applies to child-collection loads by FK (`{ claim: id }`). `makeCrudRoute` list/detail routes are scoped by the factory, so a tenant-isolation test that only exercises the list route will not catch the hole in command action endpoints.

**Rule**: Put `tenantId`, `organizationId`, and `deletedAt: null` in the `where` object of every hand-written loader, including child-collection loads by FK; treat the `scope` argument as decryption-only. Add a tenant-isolation integration assertion that exercises a command action endpoint (transition/comment/assign), not just the list route, and run it against a second organization inside the seeded tenant rather than a fresh API-created tenant whose user JWT is rejected by RBAC routes.

**Multi-organization enrichment (#7531)**: Scope each referenced entity according to its own model. User profiles belong to a tenant and may have a different home organization from an authorized customer record; do not equate those organizations or drop legitimate attribution. Keep tenant predicates and record-scope-qualified keys for batched author enrichment. Separate live-user validation for new assignments from historical reads and snapshot restoration: soft deletion must not erase prior attribution or prevent undo. Test HQ/Branch authors, offboarded users through all replay paths, all-organization/descendant views, and foreign-tenant poisoned references.

**Historical fixture lifecycle**: Inspect the actual delete command before using an HTTP DELETE to model soft deletion. `auth.users.delete` hard-deletes (`soft: false`), so a successful response does not leave a historical user row. When testing `deleted_at` semantics that the API cannot express, use the existing database-fixture helper for the newly owned row, scope by ID/tenant/organization, assert it remains, and restore its flag in `finally` before normal API cleanup. Preserve the historical profile assertions.

**Applies to**: Command handlers, action endpoints, subscribers, enrichers, and any loader that reads an entity by id or FK outside a `makeCrudRoute` factory.
