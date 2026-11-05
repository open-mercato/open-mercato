# PLAN — CRUD API performance quick wins (issue #2044)

Source spec: `.ai/specs/2026-05-24-crud-api-performance-quick-wins.md`
Tracking issue: open-mercato/open-mercato#2044
Branch: `task/74ca1a5b-ef3e-4e4d-99fe-4a192950a247`
Base: `develop`

## Tasks

> Authoritative status table. `Status` is `todo` or `done`. On landing a Step, flip `Status` to `done` and fill the `Commit` column with the short SHA. The first non-`done` row is the resume point for `auto-continue-pr`.

| Phase | Step | Title | Status | Commit |
|-------|------|-------|--------|--------|
| 0 | 0.1 | Seed run folder (plan, handoff, notify) | done | 0a347d6a0 |
| 1 | 1.1 | AccessLogService: add `logMany()` with batched INSERT + flushAccessLog hook | done | a7c8102c1 |
| 1 | 1.2 | factory.ts: batch + fire-and-forget `logCrudAccess` + `OM_CRUD_ACCESS_LOG_BLOCKING` | done | 68ca78035 |
| 1 | 1.3 | Unit tests for batch logging + blocking flag + flush hook | done | 3e993ba15 |
| 2 | 2.1 | custom-fields.ts: tag-invalidated cache for `loadCustomFieldDefinitionIndex` + per-request micro-cache | done | 561485cb6 |
| 2 | 2.2 | CF def cache: tags piggyback on existing `entities:definitions:*` invalidation; covered by unit tests | done | 561485cb6 |
| 3 | 3.1 | factory.ts: per-request `userFeatures` memo + default in-process LRU cache for RbacService | done | 1e441ff53 |
| 4 | 4.1 | organizationScope: short-TTL cache for `resolveOrganizationScopeForRequest` + invalidation hook + tests | done | e8ab1f38a |
| 5 | 5.1 | container.ts: process-scoped bootstrap once-guard + cached `encryption.isEnabled` | done | b7f4ed22c |
| 6 | 6.1 | Benchmark harness: run before/after micro-benchmark on integration stack | done | e17015b76 |
| 6 | 6.2 | Open PR + post benchmark comment with before/after numbers | done | (PR #2100) |

### Post-review fixes (auto-continue-pr resume on 2026-05-27)

- [x] Post-review fix: add missing `indexer: { entityType: 'example.todo' }` to `packages/shared/src/lib/crud/__tests__/user-features-memo.test.ts` so the `crud-indexer-config.test.ts` scanner stays green. — 85e0df6d3
- [x] Post-review fix: gate Phase 5 bootstrap once-guard behind `OM_BOOTSTRAP_CACHE=1` (default OFF) so per-request bootstrap is restored unless explicitly enabled — cached `tenantEncryptionService`/event-bus close over the first request's `em.fork`/container, which manifests as a 500 on `/api/customers/people` under `next start` in the ephemeral integration runtime. — 85e0df6d3
- [x] Post-review fix: parallelize encryption + parse in `AccessLogService.logManyInternal` / `writeChunk`. The first batched implementation iterated rows sequentially, so encryption-enabled tenants paid `N × per-row-encryption` wall-clock on every CRUD list response — strictly slower than develop's parallel `Promise.all(map(... service.log()))` fan-out and slow enough to make `addCustomLine` dialogs detach mid-click in `ephemeral-integration` shards 7/15 (TC-INT-005) and 12/15 (TC-SALES-001..017). Restores parallel encryption while keeping the single multi-row INSERT, plus a unit test asserting `encryptEntityPayload` peak in-flight > 1. — (this commit)

## Goal

Cut p50 latency for CRUD list/detail endpoints below 100 ms via five backward-compatible optimizations described in the spec. Measure the win with the existing `OM_PROFILE=*` profiler and publish before/after numbers on the PR.

## Scope

- `packages/core/src/modules/audit_logs/services/accessLogService.ts` — `logMany`
- `packages/shared/src/lib/crud/factory.ts` — `logCrudAccess` batch + fire-and-forget, `userFeatures` memo
- `packages/shared/src/lib/crud/custom-fields.ts` — cached `loadCustomFieldDefinitionIndex`
- `packages/core/src/modules/auth/services/rbacService.ts` + `auth/di.ts` — default in-process LRU
- `packages/core/src/modules/directory/utils/organizationScope.ts` — short-TTL cache + invalidation hook
- `packages/shared/src/lib/di/container.ts` — once-guard for bootstrap
- New env flags: `OM_CRUD_ACCESS_LOG_BLOCKING`, `OM_CF_DEF_CACHE_TTL_MS`, `OM_RBAC_DEFAULT_CACHE`, `OM_ORG_SCOPE_CACHE_TTL_MS`

## Non-goals

- No wire-format / public-type / ACL / data-model changes.
- No new HTTP-level response caching (orthogonal `ENABLE_CRUD_API_CACHE` exists).
- No encryption / KMS changes.
- No `BasicQueryEngine` rewrite.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Fire-and-forget access logs lose a row on crash | low | At-least-once already today; add `flushAccessLog()` helper + integration tests default to blocking via `OM_CRUD_ACCESS_LOG_BLOCKING=1`. |
| CF def cache stale | medium | Tag-invalidate on CustomFieldDef CRUD side-effects; bounded TTL (5 min, override via `OM_CF_DEF_CACHE_TTL_MS`). |
| RBAC memo desync mid-request | very low | Memo lifetime = single request via WeakMap on CrudCtx. |
| Org-scope cache staleness | low | 60s TTL with tag invalidation on `user_organizations`/`organizations` mutations; `OM_ORG_SCOPE_CACHE_TTL_MS=0` disables. |
| Bootstrap once-guard breaks HMR | low | Same `globalThis` pattern used by `getDiRegistrars` already; dev re-registration is idempotent. |

## External References

None — task brief was free-form; spec governs implementation.

## Implementation Plan

### Phase 1 — Batch + fire-and-forget access logs

**1.1** — Extend `AccessLogService`:
- New `logMany(payloads: AccessLogCreateInput[])` builds a single multi-row `INSERT ... VALUES (...),(...)` (chunked at 500 rows), batch-encrypts payloads per tenant when encryption is enabled, runs `rotate` once at end.
- Add `flushAccessLog()` returning a Promise that resolves once all in-flight `logMany`/`log` Promises drain (uses a module-level pending-Promise registry).
- Export `AccessLogServiceLike` updated additively with `logMany?` and `flush?`.

**1.2** — `factory.ts logCrudAccess`:
- Build the payload array; prefer `service.logMany?.(payloads)` when available, else fall back to per-row `service.log`.
- Wrap the call in fire-and-forget by default; `await` only when `process.env.OM_CRUD_ACCESS_LOG_BLOCKING === '1'`.
- Register the pending Promise in the access-log service so `flushAccessLog()` can drain it.
- Profiler `access_logged` mark records `mode: 'batch' | 'fanout' | 'blocking'` and `pending: N` for visibility.

**1.3** — Tests:
- Unit test: `logMany` writes N rows with correct columns and survives encryption-enabled tenants (or skips encryption assertion when service is null).
- Unit test: `logCrudAccess` defers when blocking flag is off and awaits when `OM_CRUD_ACCESS_LOG_BLOCKING=1`.
- Integration: 50-item CRUD list still yields 50 `access_logs` after `flushAccessLog()`.

### Phase 2 — CF def cache

**2.1** — Wrap `loadCustomFieldDefinitionIndex`:
- Add `loadCustomFieldDefinitionIndexCached(opts, container?)` thin wrapper. Resolves `cache` from container when available; computes key `cf:def:<tenantId>:<entitiesHash>:<orgsHash>:<fieldsetHash?>`; tags `cf:def:tenant:<tenantId>`, `cf:def:entity:<entityId>` (one per entity), `cf:def:org:<orgId>`.
- TTL from `OM_CF_DEF_CACHE_TTL_MS` (default 300000); `0` disables.
- Per-request micro-cache via a WeakMap keyed by `ctx`.

**2.2** — Invalidation:
- Hook into `CustomFieldDef` mutation paths (entities module create/update/delete commands or CRUD side-effects). When the module's existing side-effect path runs, call `cache.deleteByTags(['cf:def:tenant:<tenantId>', ...])`.
- Test: 2× back-to-back list calls in the same process emit exactly one `em.find(CustomFieldDef, ...)` (assert via a spy or by counting executed SQL).

### Phase 3 — RBAC memo + default LRU

**3.1** — `factory.ts`:
- New `resolveUserFeaturesOnce(ctx)` reads/writes a WeakMap keyed on `ctx` so both interceptor and enricher paths share one resolved `Promise<string[] | undefined>`.
- `auth/di.ts`: when no `cache` registration exists, register a process-scoped in-memory LRU `CacheStrategy` for RBAC. Opt-out via `OM_RBAC_DEFAULT_CACHE=off`.

### Phase 4 — Org-scope cache

**4.1** — `organizationScope.ts`:
- Cache `resolveOrganizationScopeForRequest` results keyed `org-scope:<userId>:<tenantId>` with tags `org-scope:user:<userId>`, `org-scope:tenant:<tenantId>`.
- TTL from `OM_ORG_SCOPE_CACHE_TTL_MS` (default 60000); `0` disables.
- Invalidate via `emitCrudSideEffects` for `user_organizations` and `organizations` writes (or expose a small `invalidateOrganizationScopeCache(userId|tenantId)` helper module side-effects can call).

### Phase 5 — Bootstrap once-guard

**5.1** — `container.ts`:
- `globalThis.__openMercatoBootstrapped__` flag set after first `bootstrap(container)` call. Once set, only the request-scoped bindings (em, queryEngine, dataEngine, commandBus) are re-issued per request; the cache/event-bus/encryption side-effects are skipped.
- Cache `tenantEncryptionService.isEnabled?.()` result for the process lifetime in a module-level boolean.

### Phase 6 — Benchmark + PR

**6.1** — Benchmark harness:
- Add `.ai/runs/2026-05-27-crud-api-perf-quick-wins/benchmark.mjs`: warms up the dev/integration stack, hits a representative CRUD list endpoint (`/api/customers/people?pageSize=50`) N times, captures `[crud:profile]` JSON, computes p50/p95 with and without each phase (toggled via env flags).
- Run twice — once against `git stash` of the optimizations (or before-commit baseline captured before merging Phase 1), once after.

**6.2** — Open PR, post benchmark comment with before/after numbers and the validation-gate output.
