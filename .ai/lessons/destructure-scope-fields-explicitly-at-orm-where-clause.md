---
title: "Destructure scope fields explicitly at ORM where-clause boundaries"
modules: ["incidents"]
areas: ["module-data"]
topics: ["command-pattern","data-scoping","type-normalization"]
---

# Destructure scope fields explicitly at ORM where-clause boundaries

**Context**: A snapshot loader spread a command-result object into an ORM where-scope (`{ ...scope }`). Under MikroORM v7's stricter query validation the spread carried an extra structurally-typed property that maps to no column, so every postmortem save returned 400.

**Problem**: Spreading a structurally-typed object into a where clause silently widens the query with whatever else that object happens to carry. The type system accepts it because the shape is compatible, and the failure only surfaces at runtime as a rejected query.

**Rule**: At any ORM where-clause boundary, destructure the scope fields you mean — `{ organizationId, tenantId }` — instead of spreading a result or context object. Never `...scope` into a filter.

**Applies to**: Command snapshot loaders, CRUD scope helpers, and any `em.find` / `em.findOne` filter built from a service or command result.
