---
title: "The decryption `scope` argument is not a WHERE filter"
modules: ["warranty_claims","shared","customers"]
areas: ["module-data","architecture","testing"]
topics: ["data-scoping","access-control","command-pattern"]
---

# The decryption `scope` argument is not a WHERE filter

**Context**: `findOneWithDecryption` / `findWithDecryption` (`@open-mercato/shared/lib/encryption/find`) accept a `scope` argument, so hand-written loaders passed `{ id }` as the where clause and trusted `scope` to apply tenant filtering.

**Problem**: `scope` only selects the decryption key (`decryptEntitiesWithFallbackScope`); it is never added to the query `where`. `findOneWithDecryption(em, Entity, { id }, {}, { tenantId, organizationId })` runs `em.findOne(Entity, { id })` with no tenant scoping, and this repo has no global MikroORM tenant filter — so command/action/subscriber loaders are cross-tenant readable and mutable by UUID. The same trap applies to child-collection loads by FK (`{ claim: id }`). `makeCrudRoute` list/detail routes are scoped by the factory, so a tenant-isolation test that only exercises the list route will not catch the hole in command action endpoints.

**Rule**: Put `tenantId`, `organizationId`, and `deletedAt: null` in the `where` object of every hand-written loader, including child-collection loads by FK; treat the `scope` argument as decryption-only. Add a tenant-isolation integration assertion that exercises a command action endpoint (transition/comment/assign), not just the list route, and run it against a second organization inside the seeded tenant rather than a fresh API-created tenant whose user JWT is rejected by RBAC routes.

**Applies to**: Command handlers, action endpoints, subscribers, enrichers, and any loader that reads an entity by id or FK outside a `makeCrudRoute` factory.
