---
title: "Classify entity metadata by ORM ownership before custom declarations"
modules: ["entities"]
areas: ["module-data"]
topics: ["access-control","filters"]
---

# Classify entity metadata by ORM ownership before custom declarations

**Context**: Entity metadata ACL filtering must distinguish module-owned ORM entities from genuinely custom entities, but `ce.ts` declarations can describe both kinds.

**Problem**: Treating every declared entity as custom made ORM-backed entities require `entities.records.view`, bypassing their owning module's mapped view permission.

**Rule**: Check `isOrmBackedSystemEntityId` first; only classify non-ORM declarations or registrations as custom for metadata authorization.

**Applies to**: entity definitions, entity catalogues, schema discovery, and other target-aware entity metadata ACL checks.
