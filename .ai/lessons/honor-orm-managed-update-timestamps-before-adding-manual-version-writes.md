---
title: "Honor ORM-managed update timestamps before adding manual version writes"
modules: ["wms"]
areas: ["module-data","testing"]
topics: ["concurrency","data-integrity","optimistic-locking"]
---

# Honor ORM-managed update timestamps before adding manual version writes

**Context**: A review treated an assignment demotion as missing an optimistic-lock version update because the command changed `isDefault` without assigning `updatedAt` explicitly.

**Problem**: The entity inherits an `updatedAt` property decorated with MikroORM `onUpdate`. Its managed Unit of Work updates that property when another tracked field changes and the entity is flushed, so requiring a second manual assignment duplicates framework behavior and produces a false-positive review finding.

**Rule**: Before flagging a missing timestamp or adding a manual version write, inspect inherited entity metadata and the persistence path. For managed MikroORM entities flushed through the Unit of Work, rely on `onUpdate`; add explicit timestamps only for raw/native writes or paths that intentionally bypass lifecycle hooks, and test those exceptions directly.

**Applies to**: optimistic locking, audit snapshots, command undo checks, and multi-entity mutations using inherited MikroORM lifecycle fields.
