---
title: "Keep raw SQL out of API route handlers"
modules: ["customer_accounts","customers"]
areas: ["module-data","integration","testing"]
topics: ["data-scoping","filters","testing"]
---

# Keep raw SQL out of API route handlers

**Context**: The customer portal signup route (`packages/core/src/modules/customer_accounts/api/signup.ts`) inlined a tenant-bound organization lookup as a raw `em.getConnection().execute(...)` call. The SQL was only a handful of lines, but it put persistence knowledge into a route file and made regression tests reach into route internals to pin the `WHERE id = ? AND tenant_id = ?` predicate.

**Problem**: Raw SQL in route handlers blurs the layering between HTTP plumbing and persistence. It is easy to drift: the same SQL gets copy-pasted into other routes, each copy is re-audited separately, and security-critical predicates (tenant binding, soft-delete filters) can silently diverge between callers. API routes should read as orchestration — parse, validate, authorize, delegate, respond — not as SQL authors.

**Rule**: API route handlers must not contain raw SQL. Extract DB reads/writes into a named helper in the module's `lib/` (for simple lookups) or a service in `services/` (for stateful or multi-step logic), and import the helper from the route. The helper is the single place where the predicate is defined, audited, and regression-tested. MikroORM entity calls (`findOneWithDecryption`, repository methods) are acceptable in routes when they are single-liner lookups by stable primary keys; anything with a custom `WHERE`, `JOIN`, or raw `execute(...)` belongs in a helper.

**Applies to**: All API route files under `packages/**/api/**` and `apps/**/api/**`. When moving existing inline SQL out of a route, keep the regression test pointed at the helper source so the predicate stays pinned even after the relocation.
