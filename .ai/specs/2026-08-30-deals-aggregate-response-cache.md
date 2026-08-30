# Deals aggregate response cache

## 📝 TLDR

Cache successful `GET /api/customers/deals/aggregate` responses for 30 seconds when the request does not carry `search` or `isStuck`. The cache remains opt-in through the existing `ENABLE_CRUD_API_CACHE` flag, is partitioned by effective tenant, sorted organization scope, and normalized filters, and is invalidated by the same `customers.deal` collection tags already emitted after supported deal writes.

The public endpoint, authorization rules, request schema, and response body remain unchanged. Cache read/write failures fail open to the current database and exchange-rate path.

## Resolved assumptions (autonomous defaults)

| # | Question | Applied default | Why | Confirm? |
|---|---|---|---|---|
| Q1 | Should the endpoint cache unconditionally or follow the existing CRUD cache switch? | Follow `ENABLE_CRUD_API_CACHE`. | Reusing the established opt-in preserves operator control and matches the sibling deal-detail cache. | ok |
| Q2 | What TTL within the requested 30–60 second range should ship? | 30 seconds. | The lower bound limits exchange-rate and wall-clock-relative overdue staleness while still collapsing repeated kanban requests. | ok |
| Q3 | Which write-side invalidation resource is authoritative? | Use `customers.deal`, expanded through the shared CRUD tag helpers. | Deal commands declare `resourceKind: 'customers.deal'`; `customers.customer_deal` would not match their collection tags. | ok |
| Q4 | Should `search` and `isStuck=false` requests be cacheable? | Bypass whenever either query parameter is present, regardless of parsed truthiness. | This follows the issue's conservative v1 boundary and avoids hidden dependencies on token-index or staleness-clock behavior. | ok |

## 📝 Problem Statement

The kanban board calls the aggregate endpoint once per render for lane counts and currency totals. The 2026-08-28 production-topology benchmark measured 18.67 s p95 at 20 offered journeys/s even though PostgreSQL reported the aggregate statement at roughly 4 ms, showing that repeated requests amplify framework, scope-resolution, and currency-service overhead rather than database execution time.

The route currently recomputes the same organization-scoped aggregate and currency conversion for every identical request. Supported deal writes already publish post-commit CRUD invalidation tags, but this route does not participate in that cache contract.

## 📝 Proposed Solution

Add a narrow read-through cache around the fully converted aggregate response. Resolve the existing cache through DI, execute cache operations inside the tenant cache context, hash a canonical request identity, attach one `customers.deal` collection tag for every organization in the effective read scope, and degrade to the uncached path whenever caching is disabled or unavailable.

Requests carrying `search` or `isStuck` remain uncached in the first version. No UI, schema, event, ACL, OpenAPI, or response-contract change is included.

## 📝 Overview

### Scope

This specification covers one independently deployable capability: caching the computed response of the existing deals aggregate GET route. The implementation stays inside the customers module and reuses the platform cache and CRUD invalidation contracts.

The cache saves the work that can safely occur after authorization and organization-scope resolution:

- optional base-currency resolution;
- the grouped `customer_deals` SQL query;
- exchange-rate lookup and conversion;
- aggregate reduction and sorting.

Authentication, request validation, request-container creation, and effective organization-scope resolution still run on every request. These steps are required before a safe tenant- and organization-partitioned key can be built.

### Related work

- Issue [#5785](https://github.com/open-mercato/open-mercato/issues/5785) supplies the benchmark evidence and delivery constraints.
- PR [#5777](https://github.com/open-mercato/open-mercato/pull/5777) is the program-level performance roadmap; it explicitly requires focused implementation specifications for individual changes.
- `.ai/specs/2026-06-05-cache-safety-always-consistent.md` documents that CRUD response-cache invalidation runs synchronously after supported writes commit.
- `.ai/specs/2026-07-30-crud-fail-open-hardening.md` establishes fail-open cache behavior and careful cache-key partitioning as security requirements.
- `packages/core/src/modules/customers/api/deals/[id]/route.ts` is the closest in-module read-through cache precedent.

### Market reference

[Medusa's Caching Module concepts](https://docs.medusajs.com/resources/infrastructure-modules/caching/concepts) recommend hashed custom keys for computed data and list-level tags that are invalidated on create, update, and delete. [Directus' cache configuration](https://docs.directus.io/self-hosted/config-options) similarly separates an explicit cache-enable switch, TTL, and automatic purge behavior. This design adopts those useful properties through Open Mercato's existing primitives: opt-in activation, deterministic hashed keys, short TTL, and write-driven collection-tag invalidation. It rejects a framework-wide or HTTP-proxy cache because this endpoint already has a module-local tenant-scoped cache service and authorization-aware inputs.

## Goals and Non-Goals

### Goals

- Collapse repeated identical kanban aggregate calls onto one cached, fully converted `AggregateResponse` for 30 seconds.
- Preserve tenant and organization isolation for single-org, multi-org, and all-org callers.
- Reuse the exact `customers.deal` resource tags that supported deal create, update, delete, undo, and redo paths already invalidate after commit.
- Preserve current output for every uncached, bypassed, disabled-cache, or cache-backend-failure path.
- Pin cache hits, invalidation, bypass rules, scope partitioning, and fail-open behavior with unit and executable integration coverage.

### Non-Goals

- Caching `GET /api/customers/deals` or any other CRUD/list route.
- Caching `search` or `isStuck` aggregate requests.
- Eliminating authentication, container creation, or organization-scope work; those are tracked separately by #2958, #2977, and #2978.
- Adding single-flight or distributed cache-miss locking.
- Changing cache backends, defaults, or `ENABLE_CRUD_API_CACHE` semantics.
- Changing exchange-rate storage or adding currency-write invalidation tags in this increment.
- Adding response headers, UI indicators, schema migrations, events, ACL features, or new configuration variables.

## Current Behavior

`packages/core/src/modules/customers/api/deals/aggregate/route.ts` currently performs the following work on every valid request:

1. authenticate and validate query parameters;
2. create a request container and resolve the effective organization scope;
3. resolve all organization IDs the caller may read;
4. resolve the optional base currency;
5. build a scoped SQL predicate, including optional relation/date/status filters;
6. execute one aggregate query grouped by pipeline stage and currency;
7. load exchange rates and convert totals;
8. serialize the response.

The response is not user-personalized beyond the explicit filter parameters and the effective tenant/organization read scope. The current route also uses `orgFilterIds[0]` as the organization for base-currency and exchange-rate resolution, so that first organization is a distinct response input even when the readable organization set is otherwise identical. Search-token results and stuck-deal detection are the two remaining exceptions because they depend on external projection state or a time-relative calculation, so both are excluded from caching.

Supported deal commands report `resourceKind: 'customers.deal'`. The shared CRUD invalidator canonicalizes that resource and deletes collection tags shaped as:

```text
crud:customers.deal:tenant:<tenantId>:org:<organizationId>:collection
```

Using `customers.customer_deal` would create a different tag and would leave cached lane headers stale after a write.

## 📝 Architecture

### Request flow

```text
authenticated GET
  → validate query
  → create request container
  → resolve effective tenant + readable organization IDs
  → eligibility check
      ├─ disabled / search present / isStuck present → current compute path
      └─ eligible
          → tenant-scoped cache get
              ├─ valid hit → return cached AggregateResponse
              └─ miss/error/invalid value
                  → current base-currency + SQL + conversion path
                  → best-effort tenant-scoped cache set with collection tags
                  → return fresh AggregateResponse
```

### Cache eligibility

The route may read or write this cache only when all conditions hold:

1. `isCrudCacheEnabled()` is true;
2. `resolveCrudCache(container)` returns the expected cache surface;
3. the original URL has no `search` query parameter;
4. the original URL has no `isStuck` query parameter;
5. authentication, query validation, tenant resolution, and organization-scope resolution succeeded.

Parameter *presence* controls the two bypasses. `?search=`, `?isStuck=false`, and their truthy variants all bypass. This is intentionally more conservative than inspecting parsed truthiness and is pinned in tests.

Only successful `200` aggregate bodies are cached. `400` and `401` responses never touch the cache.

### Canonical key

Add small route-local pure helpers rather than a new shared abstraction. Construct a fixed-shape object with:

```ts
{
  tenantId: effectiveTenantId,
  currencyScopeOrganizationId: orgFilterIds[0] ?? null,
  organizationIds: [...orgFilterIds].sort(),
  pipelineId: parsed.data.pipelineId ?? null,
  status: normalizeStringSet(parsed.data.status),
  ownerUserId: normalizeStringSet(parsed.data.ownerUserId),
  personId: normalizeStringSet(parsed.data.personId),
  companyId: normalizeStringSet(parsed.data.companyId),
  expectedCloseAtFrom: parsed.data.expectedCloseAtFrom ?? null,
  expectedCloseAtTo: parsed.data.expectedCloseAtTo ?? null,
  isOverdue: parsed.data.isOverdue === true,
}
```

`normalizeStringSet` trims, removes duplicates, and sorts without mutating parsed input. The fixed property order plus normalized arrays makes `JSON.stringify` deterministic. Hash that JSON with Node's `createHash('sha256')` and build the versioned key:

```text
customers:deal:aggregate:v1:<sha256>
```

The digest includes the tenant, the current first organization used for currency resolution, and the full sorted organization set even though `runWithCacheTenant(effectiveTenantId, ...)` also namespaces the backend. The first-organization axis preserves current behavior when the same readable set arrives in a different order; the sorted set partitions the rows included in the SQL query. Tenant duplication is intentional defense in depth and makes incorrect cache-context use unable to cross tenants.

The key does not include caller identity because the route has no implicit per-user row predicate: authorization grants access to the route, while the row set is completely determined by tenant, effective organization set, and explicit filters. If a future change adds caller-dependent filtering or response decoration, it MUST add that axis to the signature or disable this cache before the change ships.

### Read behavior

- Resolve the cache only after the request container and safe organization scope exist.
- Execute `cache.get(key)` inside `runWithCacheTenant(effectiveTenantId, ...)`.
- Validate a non-null hit with `aggregateResponseSchema.safeParse` before returning it. A corrupt or old-shape value is treated as a miss.
- A cache exception is logged through the existing structured/debug cache path and treated as a miss. It never changes the HTTP status.
- Place the lookup before base-currency resolution so a hit skips all safe-to-skip work listed in Scope.

### Write behavior

- Cache the final `AggregateResponse`, including `baseCurrencyCode`, converted totals, and missing-rate disclosures.
- Execute `cache.set` inside the same tenant cache context.
- Set `ttl: 30_000`.
- Build tags with `buildCollectionTags('customers.deal', effectiveTenantId, sortedOrganizationIds)`. A multi-org entry receives one collection tag per readable organization, so a write in any contributing organization invalidates it.
- A cache-set exception is logged and ignored; the fresh response still succeeds.

### Invalidation and commit boundary

No new write hook is introduced. Existing supported deal commands emit CRUD side effects after the domain write commits. The command bus calls the shared cache invalidator for `customers.deal`, which deletes both record and collection tags for the written tenant/organization. Because aggregate entries use those collection tags, create, update, delete, undo, and redo invalidate them without coupling the aggregate route to command implementations.

Direct SQL writes or integrations that bypass commands cannot emit those tags. Such unsupported writes may leave an entry stale for at most 30 seconds; the TTL is the fallback safety bound.

## 📝 Data Model

No database entity, column, index, migration, generated registry, or persisted cache schema changes. Cache entries are ephemeral `AggregateResponse` values stored through `CacheStrategy`.

The payload contains organization-scoped commercial aggregates. It is not credential material or directly identifying PII, but it remains tenant-sensitive; both the tenant cache context and hashed tenant/scope signature are mandatory.

## 📝 API Contracts

### `GET /api/customers/deals/aggregate`

Request validation, authorization metadata, query names, HTTP statuses, OpenAPI documentation, and the response schema remain unchanged.

Successful response:

```ts
type AggregateResponse = {
  baseCurrencyCode: string | null
  perStage: Array<{
    stageId: string
    count: number
    openCount: number
    totalInBaseCurrency: number
    byCurrency: Array<{ currency: string; total: number; count: number }>
    convertedAll: boolean
    missingRateCurrencies: string[]
  }>
}
```

No cache-status response header is added. Caching is an internal latency optimization and does not create a new wire contract.

## 📝 UI/UX

No UI file or user-facing copy changes. Existing kanban lane headers consume the byte-compatible response and benefit from lower repeat latency without new states or controls. Mockups and current-app screenshots are not applicable.

## Internationalization

No new user-facing strings or locale keys.

## Configuration, Rollout, and Observability

- Existing `ENABLE_CRUD_API_CACHE` remains the only activation switch; default behavior stays unchanged when it is off.
- Existing `CACHE_STRATEGY` selection determines memory, SQLite, or Redis behavior. No provider-specific code is added.
- The fixed TTL is 30 seconds; no environment variable is added for this route-specific value.
- Reuse structured cache debug logging for read/store failures. Do not log raw cache payloads, request search terms, tokens, or credentials.
- Compare the benchmark journey `crm_deal_aggregate` before and after with caching enabled. Warm identical requests should execute zero aggregate SQL statements and zero exchange-rate lookups after the first miss.

Rollback is one code revert. Existing entries expire after 30 seconds and the versioned key can be bumped if a future response-internal representation needs an immediate namespace cutover.

## 📝 Edge Cases & Failure Scenarios

| Scenario | Expected behavior |
|---|---|
| Cache disabled | No cache service resolution or get/set; current behavior is byte-compatible. |
| Cache service absent | Compute normally and return the fresh response. |
| Cache get throws | Log without sensitive data, compute normally, then make a best-effort set. |
| Cache set throws | Return the fresh response; no retry on the request path. |
| Cached value fails schema validation | Treat as a miss and overwrite with a valid response after computation. |
| Organization IDs arrive in a different order but keep the same first/currency-scope organization | Sorted set identity yields the same entry and the same sorted tag set. |
| The same organization set arrives with a different first/currency-scope organization | The explicit currency-scope axis selects a different entry, preserving current base-currency behavior. |
| Filter arrays contain duplicates or different order | Normalization yields the same semantic key. |
| Caller changes selected/readable organizations | The organization-set axis selects a different entry. |
| Any contributing organization's deal changes through a command | Its collection tag invalidates the multi-org aggregate entry after commit. |
| `search` is present, including empty | Bypass cache and run the current search behavior. |
| `isStuck` is present, including `false` | Bypass cache and run the current staleness behavior. |
| `isOverdue=true` crosses midnight | A pre-midnight entry can remain for at most 30 seconds after the date boundary. |
| Exchange rate changes or a lookup transiently returns partial data | The fully assembled response can remain for at most 30 seconds; existing `convertedAll` and `missingRateCurrencies` disclosure remains intact. |
| Two requests miss concurrently | Both may compute and store the same deterministic value; single-flight is out of scope. |

## Migration & Backward Compatibility

This change is behavior-preserving for public contracts:

- The existing API URL and HTTP method are unchanged.
- Request and response schemas are unchanged.
- Authorization metadata and ACL feature IDs are unchanged.
- No database, event, notification, DI token, import path, CLI, or generated-file contract changes.
- `ENABLE_CRUD_API_CACHE=false` reproduces current uncached behavior.
- Cache backend failures preserve current successful responses by failing open.

The only observable difference with caching enabled is bounded freshness: supported deal writes invalidate immediately after commit, while exchange-rate changes, date boundaries, and unsupported direct database writes can remain visible through a previous aggregate for up to 30 seconds.

## Testing Strategy

### Unit coverage

Add a focused cache suite beside the existing aggregate route tests. It MUST verify:

1. disabled caching does not resolve or call the cache;
2. a miss runs base-currency, SQL, and exchange-rate work once, then stores the final response with `ttl: 30_000` and exact `customers.deal` tags;
3. a valid hit skips base-currency resolution, aggregate SQL, and exchange-rate lookup;
4. a malformed cached value is ignored;
5. cache get and set exceptions fail open;
6. `search` and `isStuck` parameter presence bypasses both get and set, including empty/false values;
7. sorted/deduplicated filter arrays and the organization set produce a stable key;
8. tenant, first/currency-scope organization, organization set, pipeline, status, owner, person, company, close-date, and overdue differences partition keys;
9. multi-org entries carry every organization-specific collection tag;
10. the current aggregate correctness tests remain green.

Because `isCrudCacheEnabled()` memoizes its environment read, the test suite must isolate module imports with the repository's established `jest.resetModules()` pattern instead of changing the flag after a shared import.

### Executable integration coverage

Add `packages/core/src/modules/customers/__integration__/TC-CRM-5785-deals-aggregate-cache.spec.ts`. The integration runner already starts the app with `ENABLE_CRUD_API_CACHE=true`.

The test is self-contained:

1. create a unique pipeline, stage, and deal through shared CRM API fixtures;
2. call the aggregate endpoint with the unique `pipelineId` to warm the entry and capture the matching `byCurrency` total;
3. update the deal's non-encrypted `value_amount` directly through the shared `withClient` database fixture, deliberately bypassing side effects;
4. repeat the identical aggregate request and assert the old value is returned, proving the second request was a cache hit rather than another SQL computation;
5. call variants containing `?search=` and `?isStuck=false` and assert they observe the direct database value, proving both bypass paths;
6. create a second deal in the same pipeline through `POST /api/customers/deals`, then repeat the original aggregate request and assert both the new count and the direct database value are visible, proving supported command invalidation;
7. delete both deals, the stage, and the pipeline in `finally`, using API cleanup helpers in dependency order.

The direct SQL mutation exists only to make a cache hit observable from outside the process; it targets a non-encrypted numeric field and is cleaned up through the owning API.

### Validation

Run the smallest focused commands first, then the configured repository gate:

```bash
yarn workspace @open-mercato/core test --runInBand packages/core/src/modules/customers/api/deals/aggregate
npx playwright test --config .ai/qa/tests/playwright.config.ts packages/core/src/modules/customers/__integration__/TC-CRM-5785-deals-aggregate-cache.spec.ts
yarn build:packages
yarn generate
yarn build:packages
yarn i18n:check-sync
yarn i18n:check-usage
yarn typecheck
yarn test
yarn build:app
```

No database migration command is required.

## 📝 Risks & Impact Review

### Cross-tenant or cross-organization cache collision

- **Scenario**: Two callers with different data scopes resolve the same cache entry and one receives the other's commercial aggregates.
- **Severity**: Critical
- **Affected area**: Customers aggregate API and kanban lane headers.
- **Mitigation**: Include effective tenant, the first organization used for currency resolution, and the full sorted organization ID set in the SHA-256 input; execute operations inside `runWithCacheTenant`; and test scope partitioning plus multi-org tags.
- **Residual risk**: None under the current route invariant that no implicit user-specific row predicate exists.

### Missed invalidation after a supported deal write

- **Scenario**: A create, update, delete, undo, or redo completes but lane counts or totals remain stale.
- **Severity**: High
- **Affected area**: Customers kanban accuracy.
- **Mitigation**: Reuse `buildCollectionTags('customers.deal', ...)`, the exact resource kind emitted by deal commands, and add a real API-write integration test.
- **Residual risk**: Direct database writes and non-conforming integrations do not emit command side effects; TTL bounds this to 30 seconds.

### Stale currency conversion

- **Scenario**: A rate changes after an entry is cached, or a transient rate lookup produces a partial response that is reused.
- **Severity**: Medium
- **Affected area**: Displayed lane monetary totals.
- **Mitigation**: Use the shortest requested TTL, preserve `convertedAll` and `missingRateCurrencies`, and cache no longer than 30 seconds.
- **Residual risk**: A correctly disclosed or previously complete total can lag rate state for up to 30 seconds, below the daily granularity of the route's rate lookup.

### Midnight overdue transition

- **Scenario**: An `isOverdue=true` request cached immediately before midnight is served just after `CURRENT_DATE` changes.
- **Severity**: Low
- **Affected area**: Overdue-filtered lane counts.
- **Mitigation**: The 30-second TTL strictly bounds the transition window.
- **Residual risk**: A count can lag the date boundary for at most 30 seconds.

### Cache backend degradation

- **Scenario**: Redis, SQLite, or the memory strategy throws or returns an incompatible value.
- **Severity**: Medium
- **Affected area**: Aggregate availability and latency.
- **Mitigation**: Treat read errors and invalid values as misses; ignore write errors; preserve structured logging; never cache error responses.
- **Residual risk**: Latency returns to the current uncached baseline while the cache is impaired.

### Cache stampede on cold or expired keys

- **Scenario**: Many identical requests miss simultaneously and all execute the expensive path.
- **Severity**: Medium
- **Affected area**: Tail latency at cold start and every TTL boundary.
- **Mitigation**: Keep computation idempotent and the key deterministic; measure the post-change benchmark before expanding scope.
- **Residual risk**: The first concurrent cohort may duplicate work. Single-flight is explicitly deferred to a separate feature because it changes shared cache coordination semantics.

### Incorrect future personalization

- **Scenario**: A later change adds caller-specific deal filtering without updating the cache signature.
- **Severity**: Critical
- **Affected area**: Tenant-internal data authorization.
- **Mitigation**: Document the current no-implicit-user-filter invariant beside the key helper and add a cache-safety test that fails when new key-affecting filters are introduced without an explicit axis or bypass.
- **Residual risk**: Future reviewers must preserve that invariant; the versioned key allows an immediate namespace bump when needed.

## 📋 Phasing

### Phase 1 — Route-local read-through cache

Implement the eligible-request key, read, validation, write, tag, TTL, and fail-open behavior in the existing route. This phase is independently shippable and leaves the endpoint contract unchanged.

### Phase 2 — Regression and integration proof

Pin cache mechanics in unit tests and prove cache-hit, bypass, and command invalidation behavior through the real API/database stack. Re-run the benchmark journey after the automated gate.

## 📋 Implementation Plan

### Phase 1 — Route-local read-through cache

1. Add route-local constants and pure helpers for eligibility, filter-set normalization, SHA-256 key construction, and `customers.deal` collection tags.
2. After resolving the effective tenant and organization IDs, resolve the opt-in cache and return a schema-validated hit before base-currency work.
3. Store the final `AggregateResponse` with `ttl: 30_000` and per-organization collection tags, wrapping both cache operations with tenant context and fail-open logging.
4. Keep bypassed, disabled, unauthorized, invalid-query, and cache-failure control flow byte-compatible.

### Phase 2 — Regression and integration proof

5. Add the focused unit cache suite covering hits, misses, errors, bypass, key normalization/partitioning, and tag identity.
6. Add the self-contained `TC-CRM-5785` API integration test proving the hit, bypass, and supported-write invalidation path.
7. Run focused tests and the configured validation gate; fix only regressions caused by this change.
8. Record implementation and validation results in this spec's changelog before PR handoff.

### File Manifest

| File | Action | Purpose |
|---|---|---|
| `packages/core/src/modules/customers/api/deals/aggregate/route.ts` | Modify | Add the narrow read-through cache without changing the response contract. |
| `packages/core/src/modules/customers/api/deals/aggregate/__tests__/cache.test.ts` | Add | Pin eligibility, key, tags, hit/miss, and fail-open behavior. |
| `packages/core/src/modules/customers/api/deals/aggregate/__tests__/route.test.ts` | Verify / minimally adjust | Keep existing aggregation correctness coverage compatible with the cache-disabled default. |
| `packages/core/src/modules/customers/__integration__/TC-CRM-5785-deals-aggregate-cache.spec.ts` | Add | Prove cache hit, bypass, and command-driven invalidation in the real app stack. |
| `.ai/specs/2026-08-30-deals-aggregate-response-cache.md` | Add / update | Record the approved design and implementation evidence. |

## Final Compliance Report — 2026-08-30

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `.ai/specs/AGENTS.md`
- `.ai/qa/AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/cache/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| Root `AGENTS.md` | Preserve behavior unless a spec requests change; keep changes minimal and integrated through real call sites. | Compliant | One existing GET route plus focused tests; wire behavior is unchanged. |
| Root `AGENTS.md` | Never expose cross-tenant data or omit tenant/organization scoping. | Compliant | Tenant context, tenant hash input, currency-scope organization, and full sorted organization scope are mandatory key axes. |
| Root `AGENTS.md` | Use the closest package/module guides and check existing specs. | Compliant | Customers, cache, core, QA, cache-safety, and cache-hardening guidance are incorporated. |
| `packages/core/AGENTS.md` | Every API route exports `openApi`. | Compliant | The existing `openApi` export remains unchanged. |
| `packages/core/AGENTS.md` | Preserve API contracts and organization scoping. | Compliant | URL, query schema, metadata, responses, and SQL scope remain unchanged. |
| `packages/core/src/modules/customers/AGENTS.md` | Customers is the reference module; do not bypass command side effects. | Compliant | Reads reuse the command bus's post-commit `customers.deal` invalidation rather than adding a parallel write path. |
| `packages/cache/AGENTS.md` | Resolve cache through DI; tenant-scope keys; use tag-based invalidation. | Compliant | `resolveCrudCache`, `runWithCacheTenant`, hashed tenant/scope identity, and `buildCollectionTags` are required. |
| `packages/cache/AGENTS.md` | Do not invent raw Redis/SQLite/memory clients or per-tag helpers. | Compliant | The route uses only `CacheStrategy.get/set` and shared CRUD tag helpers. |
| `.ai/qa/AGENTS.md` | Integration tests are self-contained, deterministic, use shared helpers, and clean up fixtures. | Compliant | `TC-CRM-5785` creates and deletes its pipeline, stage, and deal in `finally`. |
| `BACKWARD_COMPATIBILITY.md` | Stable API URLs and request/response shapes cannot change incompatibly. | Compliant | No public surface changes; caching is server-internal and opt-in. |
| Root design-system and UI rules | User-facing UI must use semantic tokens and shared primitives. | N/A | No UI-rendering file or user-facing copy changes. |
| Root optimistic-locking rule | New editable entities and mutation forms require version headers. | N/A | No entity or mutation surface is added. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | No data model or API shape changes. |
| API contracts match UI/UX section | Pass | The existing UI consumes the unchanged response. |
| Risks cover all write operations | Pass | No new write exists; existing deal writes and unsupported direct writes are both covered. |
| Commands defined for all mutations | Pass | Existing commands remain the only supported mutation path. |
| Cache strategy covers the read API | Pass | Eligibility, key axes, tags, TTL, hit validation, failures, and invalidation are specified. |

### Non-Compliant Items

None.

### Verdict

**Fully compliant: Approved — ready for implementation.**

## Changelog

### 2026-08-30

- Initial focused specification for issue #5785.
- Resolved autonomous defaults in favor of the existing cache flag, a 30-second TTL, the verified `customers.deal` invalidation resource, and conservative query-parameter-presence bypasses.
- Added the first/currency-scope organization as a distinct key axis after adversarial review found that sorting the readable organization set alone could merge responses using different base currencies.
- Added unit and self-contained integration coverage requirements for cache hit, bypass, fail-open behavior, and post-command invalidation.

### Review — 2026-08-30

- **Reviewer**: Primary agent plus a fresh-context scope-cohesion reviewer.
- **Security**: Passed — tenant context, tenant digest input, first/currency-scope organization, full organization set, schema-validated hits, and fail-open behavior cover the identified isolation risks.
- **Performance**: Passed — a warm hit skips base-currency, aggregate SQL, exchange-rate, reduction, and sort work; cold-miss stampede is explicitly bounded as residual risk and kept out of this route-local change.
- **Cache**: Passed — the design uses DI, `runWithCacheTenant`, the existing opt-in gate, a 30-second TTL, and the exact post-commit `customers.deal` collection tags.
- **Commands**: Passed — the GET route adds no mutation and relies on existing deal commands for post-commit invalidation.
- **Risks**: Passed — tenant collision, invalidation gaps, exchange-rate/date staleness, backend failure, cold stampede, and future personalization are each paired with mitigation and residual risk.
- **Scope cohesion**: Passed — the spec contains one independently deployable aggregate-cache capability; testing and invalidation are required safety proof, while other route caches, single-flight, framework optimization, and UI/config changes remain explicit non-goals.
- **Verdict**: Approved.
