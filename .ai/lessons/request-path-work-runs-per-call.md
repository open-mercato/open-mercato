---
title: "Request-path work runs per call, not per request"
modules: ["shared","core","query_index","customers","auth"]
areas: ["architecture","module-data"]
topics: ["performance","dependency-injection","auth-context","service-lifetimes","resource-disposal"]
---

# Request-path work runs per call, not per request

**Context**: Measured on the encrypted `bench-v1` dataset (20k companies) at `586cee8`: one `GET /api/customers/companies?id=` builds four request containers, each with a full bootstrap, resolves staff auth twice and sends 51 SQL statements, three of them for the company. Node spends about 25 ms of CPU on it. One company create sends about 111 statements. Count containers in `pg_stat_statements`: the `query_index` registrar sends one `select distinct entity_id from custom_field_defs` per container.

**Problem and rules**:

- The dispatcher has already verified auth and passes it as `ctx.auth`. `getAuthFromRequest` / `getAuthFromCookies` in a handler repeats JWT verification and the canonical session and role queries. Use `ctx.auth` (#2958).
- `createRequestContainer()` forks an EntityManager, runs every module DI registrar and, while `OM_BOOTSTRAP_CACHE` is off, the whole bootstrap. Call it once per handler and pass the container or services down; never in `lib/` helpers, loops or callbacks (#2223, #2977).
- Memos keyed by EntityManager, such as the encryption policy memo, miss across forks: every extra fork reads `encryption_maps` again. Reuse the owning operation's `em` within that operation; independent `createRequestContainer()` callers must retain separate units of work even inside one HTTP request. Optimizing registration does not authorize sharing managed entities.
- DI registrars run for every container: no database queries, timers or `bus.on` there (#2967).
- Synchronous key derivation blocks the event loop: `pbkdf2Sync` with 310,000 iterations costs about 200 ms. Keep it off request paths and memoize deterministic results.
- Check a change with a statement count: the `pg_stat_statements` delta over N sequential requests, or the ORM query log.

**Process-root review correction (#9837)**: Audit work by lifetime, not only factory signatures. Caller setup must not await process-wide queue reconciliation; defer it after activation into an owned background scope with observed failure and cleanup. Cache caller-independent Meilisearch initialization per generation when encrypted-field filtering is off, but retain caller scope for SQL-backed encryption policy. Custom event buses need the complete legacy registration path unless their subscriber-definition lifecycle is explicitly supported. Calendar/provider/webhook global writes belong in activation hooks, so discarded generations cannot publish them. Cover each boundary with a regression test.

**Generation retirement correction (#9837)**: Dropping a published root promise does not dispose its singleton cache, and disposing an Awilix child only cleans that child. Retain generation ownership through every caller and nested scope, retire on invalidation, and dispose the root exactly once after all owned scopes finish cleanup. Test an already-published generation with live callers, nested scopes that outlive their parent, invalidation during acquisition/setup, and rejecting disposers. Every scope owner must call `dispose()`; do not rely on garbage collection to close resources.
