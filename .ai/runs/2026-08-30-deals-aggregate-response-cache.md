# Deals aggregate response cache — execution plan

Source doc: .ai/specs/2026-08-30-deals-aggregate-response-cache.md

## Goal

Add a tenant-safe, organization-safe 30-second read-through cache to `GET /api/customers/deals/aggregate` so repeated kanban aggregate reads skip SQL and currency conversion while preserving the existing request, response, authorization, and invalidation contracts.

## Scope

- Add route-local cache eligibility, canonical key construction, schema-validated reads, fail-open writes, and `customers.deal` collection tags.
- Cover disabled, bypassed, hit, miss, malformed, failure, normalization, partitioning, and multi-organization behavior with focused unit tests.
- Add a self-contained integration test proving an observable cache hit, explicit query-parameter bypasses, and command-driven invalidation.
- Run the configured validation gate and the authoritative automated review/autofix pass before marking the pull request complete.

## Non-goals

- No caching for `search` or `isStuck` requests.
- No cache changes for other deal or customer routes.
- No single-flight locking, new cache backend, environment variable, schema migration, UI, response header, API shape, ACL, event, or locale change.
- No attempt to invalidate this short-lived response when exchange rates or wall-clock-relative overdue state changes.

## Implementation Plan

### Phase 1: Route-local read-through cache

1. Add route-local constants and pure helpers for eligibility, filter-set normalization, SHA-256 key construction, and `customers.deal` collection tags.
2. Resolve the opt-in cache after effective tenant and organization scope, then return a schema-validated hit before base-currency work.
3. Store the final aggregate response for 30 seconds with per-organization collection tags, tenant cache context, and fail-open error handling.
4. Preserve the uncached control flow for bypassed, disabled, unauthorized, invalid, and cache-failure requests.

### Phase 2: Regression proof and delivery gate

5. Add focused unit coverage for hits, misses, disabled/bypassed requests, malformed values, backend errors, key normalization and partitioning, and exact tags.
6. Add the self-contained `TC-CRM-5785` integration scenario covering an observable hit, both bypasses, and supported-write invalidation.
7. Run focused tests followed by every configured validation command in order, fixing only regressions introduced by this change.
8. Run `om-auto-review-pr` in autofix mode, record the verdict and any follow-up commits, and complete the PR handoff.

## Risks

- A missing tenant, currency-scope organization, organization-set, or filter axis could expose or conflate scoped aggregates. The key builder and tests must pin every response input.
- Using a resource tag other than `customers.deal` would miss existing post-commit invalidation. Tests must assert the shared collection tags exactly.
- Cache backend failures must never turn the existing successful route into an error path. Both read and write failures remain fail-open.
- Fully converted totals may lag exchange-rate changes or a midnight overdue transition for up to 30 seconds; the short TTL is the accepted bound.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Route-local read-through cache

- [ ] 1.1 Add cache eligibility, key, and tag helpers
- [ ] 1.2 Return schema-validated cache hits before aggregate computation
- [ ] 1.3 Store final responses with TTL, tags, tenant context, and fail-open handling
- [ ] 1.4 Preserve disabled, bypassed, invalid, unauthorized, and failure behavior

### Phase 2: Regression proof and delivery gate

- [ ] 2.1 Add focused unit cache coverage
- [ ] 2.2 Add self-contained TC-CRM-5785 integration coverage
- [ ] 2.3 Pass focused and configured validation gates
- [ ] 2.4 Pass authoritative review/autofix and complete handoff
