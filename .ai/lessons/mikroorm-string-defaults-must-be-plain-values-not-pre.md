---
title: "MikroORM string defaults must be plain values, not pre-quoted SQL fragments"
modules: ["entities"]
areas: ["module-data"]
topics: ["generated-files","database-migrations","runtime-startup"]
---

# MikroORM string defaults must be plain values, not pre-quoted SQL fragments

**Context**: The webhooks module declared text defaults as `"'pending'"`, `"'POST'"`, and `"'http'"` in entity metadata.

**Problem**: MikroORM treated those values as literal strings and generated migration SQL with doubled quotes like `default ''pending''`, which broke `yarn initialize` when PostgreSQL tried to create the tables.

**Rule**: For `@Property(... default: ...)` on string/text columns, pass the plain value such as `'pending'` or `'POST'`. Use `defaultRaw` only when you intentionally need a database expression.

**Applies to**: `packages/webhooks/src/modules/webhooks/data/entities.ts` and future MikroORM entities with string defaults.
