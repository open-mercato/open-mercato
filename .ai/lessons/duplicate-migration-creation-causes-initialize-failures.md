---
title: "Duplicate migration creation causes initialize failures in fresh databases"
modules: ["customers"]
areas: ["module-data","testing","architecture"]
topics: ["database-migrations","runtime-startup","testing"]
---

# Duplicate migration creation causes initialize failures in fresh databases

**Context**: `yarn initialize` failed with `relation "customer_pipelines" already exists` because two customer migrations both created the same table.

**Problem**: Later migration `Migration20260226155449` repeated schema creation already handled by `Migration20260218191730`.

**Rule**: Before adding a migration, check existing module migrations for overlapping DDL. If a duplicate migration was already committed and may be in history, keep the file/class name stable and convert duplicate migration content to a no-op instead of deleting/renaming it.

**Applies to**: `packages/core/src/modules/*/migrations/*.ts` and initialize/ephemeral test bootstrap flows.
