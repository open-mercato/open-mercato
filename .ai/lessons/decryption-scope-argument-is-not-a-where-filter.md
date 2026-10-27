---
title: "The decryption `scope` argument is not a WHERE filter"
modules: ["warranty_claims","shared","customers","resources"]
areas: ["module-data","architecture","testing"]
topics: ["data-scoping","access-control","command-pattern","reference-integrity"]
---

# The decryption `scope` argument is not a WHERE filter

**Context**: `findOneWithDecryption` / `findWithDecryption` (`@open-mercato/shared/lib/encryption/find`) accept a `scope` argument, so hand-written loaders passed `{ id }` as the where clause and trusted `scope` to apply tenant filtering.

**Problem**: `scope` only selects the decryption key (`decryptEntitiesWithFallbackScope`); it is never added to the query `where`. `findOneWithDecryption(em, Entity, { id }, {}, { tenantId, organizationId })` runs `em.findOne(Entity, { id })` with no tenant scoping, and this repo has no global MikroORM tenant filter — so command/action/subscriber loaders are cross-tenant readable and mutable by UUID. The same trap applies to child-collection loads by FK (`{ claim: id }`). `makeCrudRoute` list/detail routes are scoped by the factory, so a tenant-isolation test that only exercises the list route will not catch the hole in command action endpoints.

**Rule**: Put `tenantId` and `organizationId` in the `where` object of every tenant-scoped hand-written loader, including child-collection loads by FK. Add `deletedAt: null` when the entity supports soft deletion; do not invent that property on entities that are hard-deleted. Treat the `scope` argument as decryption-only. Validate scalar parent references in the same scope before copying their identifiers or metadata. Exercise command/action or CRUD write endpoints in isolation tests, rather than testing only list routes. Cover a second organization in the caller tenant and a separate tenant; create foreign fixtures with a superadmin while keeping the tested actor authenticated in its original scope.

**Applies to**: Command handlers, action endpoints, subscribers, enrichers, and any loader that reads an entity by id or FK outside a `makeCrudRoute` factory.

**Replay lookup correction (#7667)**: Create undo/redo intentionally needs retained rows, so its lookup must include soft-deleted records and validate their tenant/organization before mutation. When the existing scope policy permits All organizations or a tenant-less system context, omit the absent query key with a conditional property spread: MikroORM treats an explicitly present `undefined` predicate as SQL `IS NULL`, which silently misses non-nullable scoped records. Retain the scope guards and test the actual query shape; a mock that ignores query predicates hides this failure.

**Ordinary mutation correction (#7714)**: Keep `deletedAt: null` on ordinary update/delete execute lookups even when their snapshot or replay helpers intentionally include retained rows. A hidden child must return 404 without mutation, removal, flush, or side effects; after redo it can be edited or deleted normally. Exercise both stages with a mock that applies the deletion predicate so broadening replay visibility cannot silently broaden ordinary mutation visibility.

**Evidence (issue #7851)**: The customers deal-stage loader accepted a foreign stage UUID and inferred its pipeline while copying the stage label into caller-owned deals, dictionaries, and history. Explicit stage predicates plus parent-pipeline validation reject those references before mutation. The correction ships 32 command regressions and `TC-CRM-7851-pipeline-reference-scope.spec.ts`; the saved HTTP regression passed locally and in CI, including stage-only inference for valid references.
