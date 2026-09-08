# CRUD Fail-Open Hardening — Identity-Partitioned List Cache, Create-Command Mutation Guards, DI Registrar Logging

## TLDR

Three fail-open defects in shared CRUD infrastructure (`packages/shared`) are fixed in one change:

1. **Cross-user list cache leak.** `buildCrudCacheKey` in `packages/shared/src/lib/crud/factory.ts` had no caller-identity segment and read the original request URL, so two users in the same tenant/org scope requesting the identical URL shared one cache entry. With `ENABLE_CRUD_API_CACHE=true` this leaks live today on `staff` time-projects (`?mine=true` narrows by `ctx.auth.sub` inside `buildFilters`) and on `scheduler` jobs (the `isSuperAdmin` branch adds a system-jobs filter, exposing system-job rows including `target_payload` to non-superadmins). The key now carries a `user:` segment derived from `auth.keyId ?? auth.sub`.
2. **Mutation guards never ran on command-based creates.** The POST command branch of `makeCrudRoute` never invoked `runMutationGuards` (the direct branch has run create guards since the optimistic-locking coverage work). Guards now run on the create command branch with `operation: 'create'` and `resourceId: null`, mirroring the direct branch. The separate id-less update/delete skip (`&& candidateId`) is deliberately **kept**: the `{ body }`-wrap `mapInput` idiom is a documented row-level guard opt-out (see Design Decisions).
3. **Silent DI registrar failures.** A module `di.ts` registrar that threw during `createRequestContainer` was swallowed by an empty `catch {}` (`packages/shared/src/lib/di/container.ts`), so a miswired module lost all its services with no trace. The catch now logs through the shared logger facade (`Module DI registrar failed`, with `registrarIndex` and `err`) while keeping fail-open boot semantics.

## Overview

`makeCrudRoute` is the shared CRUD factory every module list/mutation route builds on, and `createRequestContainer` wires every request container. All three defects share one failure mode: a security- or correctness-relevant mechanism degrades to "not enforced" without any error or log — the same silent fail-open pattern already remediated for organization scope in `.ai/specs/implemented/2026-05-29-org-scope-fail-open-authorization-hardening.md`.

Related specs and docs:

- `.ai/specs/2026-05-24-crud-api-performance-quick-wins.md` — names the `ENABLE_CRUD_API_CACHE` response cache as pre-existing and out of its scope.
- `.ai/specs/2026-06-05-cache-safety-always-consistent.md` — covers invalidation consistency of the same cache; key partitioning was out of its scope.
- `.ai/specs/implemented/2026-05-25-oss-optimistic-locking.md` and `.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md` — introduced `crudMutationGuardService` and the guard registry this change extends to the create command branch.
- `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx` — documents the `{ body }`-wrap row-level guard opt-out this change preserves.

## Problem Statement

### 1. List cache shared across identities

`buildCrudCacheKey` segments were `crud | resource | GET | pathname | tenant | selectedOrg | scope | query (original URL) [| enrichers]`. Nothing derived from the caller's identity was included, while the cached payload can vary per caller through at least four channels:

- `opts.list.buildFilters(validated, ctx)` can narrow by `ctx.auth` — live examples: `packages/core/src/modules/staff/api/timesheets/time-projects/route.ts` (`?mine=true` → assigned-project ids of the calling user, or a zero-UUID empty page) and `packages/scheduler/src/modules/scheduler/api/jobs/buildFilters.ts` (`isSuperAdmin` gates a system-jobs branch under `omitAutomaticTenantOrgScope: true`).
- Before-interceptor query rewrites feed the engine query (`interceptorRequest.query` re-parses into `validated`), and interceptor execution itself is feature-gated per user.
- The stored payload embeds `hooks.afterList` and after-interceptor output (the store runs after both).
- Response enrichers produce per-user output (e.g. `customers.private-email-count`, `staff.timesheets-projects-portfolio`); they are currently kept out of the stored payload only because no enricher sets `cacheableOnListHit: true` yet — the enricher signature partitions by enricher set, never by user.

**Attack precondition:** `ENABLE_CRUD_API_CACHE=true` (default off, global, no per-route opt-out) plus two callers in the same tenant/org scope on the same URL. The priming caller's rows are then served to every subsequent caller until invalidation.

### 2. Guards skipped on the create command branch

The POST `useCommand` branch had no `runMutationGuards` call between input mapping and `commandBus.execute`. The direct branch has run create guards since the optimistic-locking coverage work. Any guard declaring `operations: ['create']` was silently ignored for command-based creates — including the create-app template's own `example.todo-limit` reference guard on a command-based todos route.

The related-looking `&& candidateId` skip on the PUT/DELETE command branches is **not** part of this defect: commands whose `mapInput` wraps the payload (`{ body: payload }` in `makeSalesLineRoute` and the order/quote-adjustment routes) null `candidateId` deliberately, opting out of row-level guards and leaving the command-level `enforceCommandOptimisticLock` check as the sole guard. That contract is documented in `concurrency-locking.mdx` and the shipped UI relies on it (those PUTs carry the parent document's lock header, which must not be compared against the line row).

### 3. Swallowed DI registrar errors

`for (const reg of diRegistrars) { try { reg?.(container) } catch {} }` dropped the error entirely. The failure surfaced only later as an unrelated Awilix resolution error, with no root cause in any log — in conflict with the repo's structured-logging facade rules (`.ai/specs/2026-07-02-structured-logging-facade.md`).

## Proposed Solution

1. **Identity segment in the cache key.** `buildCrudCacheKey` appends `user:${normalizeTagSegment((ctx.auth?.keyId ?? ctx.auth?.sub) ?? null)}` after the `scope:` segment. `keyId ?? sub` mirrors the existing `actorUserId` precedent in the same file, so API-key callers partition by key id. Entries are never shared across identities.
2. **Guards on the create command branch.** After the sync `*.creating` block and before `commandBus.execute`, the branch resolves user features, collects guards (`collectAndRunGuards`), and calls `runMutationGuards` with `operation: 'create'`, `resourceId: null`, and the mapped command input as `mutationPayload`. `modifiedPayload` merges spread-style into the command input (command-branch convention; no schema re-parse after `mapInput`). `afterSuccess` callbacks run after the response is built, with `resourceId` resolved via `pickFirstIdentifier(result.id, resolvedPayload.id)` — the payload fallback covers commands that expose the id under another key but map it into the response (e.g. `lineId` → `id` in `makeSalesLineRoute`). When neither yields an id, `afterSuccess` is skipped (`MutationGuardAfterInput.resourceId` is non-nullable).
3. **Log DI registrar failures.** The catch logs `logger.error('Module DI registrar failed', { registrarIndex, err })` and continues. Fail-open boot semantics are preserved deliberately: one broken optional module must not take down every request container, and the sibling app-level registrar failure a few lines below already logs-and-continues.

### Design Decisions

- **Identity segment is unconditional**, not "only when interceptors are registered": the live leaks come from `buildFilters`, which is invisible to any registry probe, and enricher/after-hook variance would bypass an interceptor-scoped partition too. Correctness beats hit-rate here; the cache is opt-in and off by default.
- **The id-less update/delete guard skip is retained.** An earlier iteration of this change removed `&& candidateId`; adversarial review refuted it: (a) the `{ body }`-wrap opt-out is a documented contract downstream guards may rely on, and (b) in the default deployment the legacy bridge coerces `resourceId: null` to `''`, so every sales line/adjustment edit (whose UI always sends the parent document's lock header) would fire a guaranteed-failing `em.findOne({ id: '' })` and a false-alarm `Reader query failed — optimistic locking is DISABLED` error log per save. Closing the id-less gap properly requires a designed contract change (e.g. an explicit per-action `resourceId` resolver so guards receive the real row id) — deferred to the platform work tracked for the record-level permissions design.
- **DI registrar failures stay fail-open (log, not rethrow)**: rethrowing would turn one broken third-party module into a process-wide request failure. A fail-closed canary is a module-level concern (out of scope here).

### Alternatives Considered

- *Key from the post-interceptor effective query* — covers only the query-rewrite channel; buildFilters/after-hook/enricher variance still leaks. Rejected as insufficient alone.
- *Per-route `cache: { sharedAcrossUsers: true }` opt-in to restore cross-user sharing* — viable additive follow-up if hit rates matter later; not needed for correctness now.
- *Running id-less update/delete commands through guards with `resourceId: null`* — rejected after adversarial review (see Design Decisions).
- *Module-id in the DI registrar log* — the generated `diRegistrars` array carries bare `register` functions; attaching module ids is an additive generator/`BootstrapData` change (BC-allowed) but beyond this surgical fix. The loop index is deterministic (enabled-module order) and logged instead.

### Known Limitations

- **Command-branch guard payload shape.** On command routes, `mutationPayload` is the post-`mapInput` command input (matching the existing update/delete command-branch convention), so for enveloping routes a guard sees `{ body: {...} }` rather than the domain payload, and a `modifiedPayload` returned by a guard merges at the envelope's top level. Guards targeting command routes must account for the envelope.
- **resourceKind granularity.** Command routes derive `resourceKind` from the command id (`deriveResourceFromCommandId`), so sub-resource commands collide with their parent (e.g. `sales.orders.lines.upsert` → `sales.order`). A create guard targeting `sales.order` also runs for line/adjustment creates.
- **Identity segment sanitization.** `normalizeTagSegment` maps characters outside `[a-zA-Z0-9._-]` to `-`; distinct non-UUID subs could collide post-sanitization (e.g. email-shaped subs). Platform user subs and API key ids are UUIDs, so there is no in-platform exposure; deployments minting JWTs with free-form subs should be aware.

## User Stories / Use Cases

- A staff member requesting `?mine=true` lists never receives another user's assigned projects, cache on or off.
- A non-superadmin never receives cached system-job rows (including payloads) primed by a superadmin.
- A module (e.g. the create-app template's `example.todo-limit`, or a future permissions module) registering a create guard sees it enforced on command-based creates.
- A platform operator sees a `Module DI registrar failed` error log the moment a module's `di.ts` breaks, instead of debugging downstream resolution errors.

## Architecture

All changes stay inside `packages/shared`; no new services, DI keys, or module contracts. The guard call added to the create command branch reuses the existing `collectAndRunGuards` / `runMutationGuards` / `runGuardAfterSuccessCallbacks` helpers.

## Data Models

None. No database structure changes.

## API Contracts

No route URLs, request schemas, or response schemas change. Behavior changes (intended):

- Command-based POST routes now return the guard's error (default 422/`Operation blocked by guard`) when a registered create guard blocks; previously the command executed unconditionally. The OSS optimistic-lock guard is unaffected (its bridge registers update/delete only, and it short-circuits creates).
- `x-om-cache: hit` responses are now always same-identity hits.
- Id-less command PUT/DELETE behavior is unchanged (documented opt-out preserved).

Backward compatibility per `BACKWARD_COMPATIBILITY.md`: no listed contract surface is touched — no exported type narrowed, no DI key changes, `makeCrudRoute(opts)` signature unchanged, cache key shape is not a contract surface.

## Internationalization (i18n)

None. The new log line is operator-facing diagnostics through the logger facade, not user-facing copy; guard rejection bodies come from the guards themselves.

## UI/UX

None. No UI-rendering files touched (the two `apps/docs` edits are documentation content).

## Configuration

No new configuration. `ENABLE_CRUD_API_CACHE` semantics unchanged (global, default off); its entries are now identity-partitioned.

## Migration & Compatibility

- Cache entries written under the pre-fix key shape are never read again (every lookup now includes the `user:` segment). They are removed by the existing tag-based invalidation on the next mutation of their resource; entries for never-mutated resources persist as bounded dead weight (the CRUD cache stores no TTL), which is storage overhead, not a leak. No migration or manual flush required.
- Expected hit-rate drop on multi-user shared lists is the correctness cost; a shared-cache opt-in can be added later as an additive `ListConfig` field if needed.
- Downstream guards declaring `operations: ['create']` now run on command-based creates; that is the guards' declared intent.

## Implementation Plan

Single phase, shipped with this spec.

### File Manifest

- `packages/shared/src/lib/crud/factory.ts` — `user:` cache-key segment; create-command-branch guard run + afterSuccess (with response-payload id fallback); clarifying comment on the retained id-less opt-out.
- `packages/shared/src/lib/di/container.ts` — registrar loop logs failures (`registrarIndex`, `err`).
- `packages/shared/src/lib/crud/__tests__/crud-factory.cache-user-scope.test.ts` — new; route-level identity-partition coverage.
- `packages/shared/src/lib/crud/__tests__/crud-factory.test.ts` — create-command guard tests (block, modifiedPayload merge, afterSuccess incl. payload-id fallback) and regression pins for the id-less opt-out; `registerMutationGuards([])` reset in `beforeEach`.
- `packages/shared/src/lib/di/__tests__/registrar-error-log.test.ts` — new; throwing registrar is logged and skipped, container stays usable.
- `apps/docs/docs/framework/api/crud-factory.mdx` — cache-key section documents the `user:` segment.
- `apps/docs/docs/framework/data-integrity/concurrency-locking.mdx` — FAQ disambiguates the lock guard (never on create) from registry create guards (both branches).

### Testing Strategy

Route-level jest tests exercise the full factory pipeline (auth → interceptors → cache → engine → guards → command bus) with a Map-backed cache and switchable caller identity — the same harness style as `crud-factory.enricher-cache.test.ts`, which is the repo's existing coverage vehicle for cache-key partitioning:

- Same identity: miss then hit; engine queried once.
- Second identity, identical URL: miss, own rows, distinct entry; first identity still hits its own entry.
- Key contains `user:<keyId ?? sub>`; API-key callers partition by key id.
- POST command branch: blocking create guard → 4xx and `commandBus.execute` not called; passing guard → `modifiedPayload` merged into command input; `afterSuccess` receives the command result id, with the response-payload fallback covered separately.
- Id-less command PUT/DELETE: regression pins assert both static registry guards and the DI guard service are NOT invoked and the command executes (the documented opt-out).
- DI: throwing registrar → `logger.error('Module DI registrar failed', …)`, subsequent registrar still runs, container resolves its services.

Playwright integration tests are not applicable to this change: `ENABLE_CRUD_API_CACHE` is off in the integration environment (the leak is unobservable either way there), and the guard-branch change is observable only with a blocking guard registered, which cannot be installed through the public API. The route-level suites above cross the same component boundaries end-to-end in-process.

## Risks & Impact Review

### Tenant & Data Isolation Risks

- The identity segment strictly tightens partitioning; tenant/org segments are unchanged. Residual risk: an interceptor varying its rewrite on a non-identity request header would still share entries within one identity — no such interceptor exists in-repo; noted for the future shared-cache opt-in design.
- Enricher outputs remain excluded from stored payloads until an enricher opts into `cacheableOnListHit`; with identity partitioning, a future per-user cacheable enricher no longer leaks across users.

### Risk Register

| Risk | Severity | Affected area | Mitigation | Residual |
|---|---|---|---|---|
| Cache hit-rate drop on shared lists | Low | Perf (flag-gated feature) | Flag default off; additive shared-cache opt-in possible later | Accepted |
| A downstream create guard newly runs on command creates and blocks traffic | Medium | Third-party guards | That is the guard's declared intent (`operations: ['create']`); direct branch already behaved this way; called out in this spec | Low |
| Guard `afterSuccess` skipped when neither the command result nor the response payload exposes an id | Low | Guard callbacks | `pickFirstIdentifier` fallback covers the known `lineId`/`adjustmentId` family; documented | Accepted |
| Create guards written for a parent resource also run for sub-resource commands (resourceKind collision) | Low | Third-party guards | Documented under Known Limitations; inherent to `deriveResourceFromCommandId` | Accepted |
| Registrar log floods if a module throws per request | Low | Log volume | Single error-level line per registrar per container build | Accepted |

## Final Compliance Report — 2026-07-30

- `packages/shared` only (plus two `apps/docs` content edits); no domain imports added; no `any` on exported surfaces.
- No contract surface from `BACKWARD_COMPATIBILITY.md` modified; no deprecation protocol required. The documented `{ body }`-wrap guard opt-out is preserved.
- Validation (Runner: local): full ordered gate from `.ai/agentic.config.json` — `build:packages`, `generate` (no drift), `build:packages`, `i18n:check-sync`, `typecheck`, `test`, `build:app` all green; `i18n:check-usage` fails on the develop baseline (2 keys from `packages/ui/.../phone.tsx`, introduced by #4147) — pre-existing, unrelated to this change.
- Adversarial verification: 3 independent reviewers (correctness, downstream impact, tests+spec accuracy); the id-less guard change was refuted and reverted, afterSuccess id fallback and doc updates added in response; remaining findings recorded as Known Limitations.

## Changelog

- 2026-07-30 — Spec written and implemented in the same change (cache identity partitioning, create-command-branch guard coverage, DI registrar logging). Id-less update/delete guard skip retained as a documented opt-out after adversarial review; docs updated (cache-key section, lock-guard FAQ).
