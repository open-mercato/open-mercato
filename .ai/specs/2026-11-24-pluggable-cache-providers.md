# Pluggable cache providers

Extends: .ai/specs/2026-10-15-cache-zstd-value-compression.md
Extends: .ai/specs/2026-11-05-redis-cache-batched-invalidation.md

## TLDR

Open Mercato operators can currently choose four built-in cache strategies. This proposal lets a deployment select an installed npm provider with its own typed configuration, including packages Open Mercato has never seen. A packed provider fixture proves the extension works independently. Engine packages follow in the linked delivery specs.

## Overview

Cache provider selection is deployment-wide and takes effect on restart. Application modules keep using `container.resolve('cache')` and the existing cache methods for cache-aside reads, TTL, and tag invalidation. This feature covers application caching. Queue, rate-limiter and event transports, application-facing engine primitives, and per-tenant provider selection are outside its scope.

## Problem Statement

- [The cache factory](../../packages/cache/src/service.ts) selects from a fixed list of `memory`, `redis`, `sqlite` and `jsonfile`. `CacheServiceOptions` carries backend-specific options and the service owns the tenant wrapper, logical key enumeration, tag scoping and dependency fallback. An unrecognized legacy `CACHE_STRATEGY` value defaults to memory.
- [Core bootstrap](../../packages/core/src/bootstrap.ts) has a process singleton and a legacy request path, both with stock initialization fallback. [The request container](../../packages/shared/src/lib/di/container.ts) can also treat bootstrap errors as optional. Replacing the Awilix registration later would miss these boundaries and the [bootstrap-free structural purge](../../packages/cli/src/lib/post-generate-invalidation.ts).
- [Readiness](../../apps/mercato/src/app/api/healthz/route.ts), the [multi-instance startup check](../../packages/cli/src/lib/single-instance-strategy-guard.ts), and the [OAuth replay-store warning](../../packages/core/src/modules/communication_channels/lib/oauth-state.ts) currently special-case Redis. They need the effective selection when a provider is enabled.
- The compression and Redis batching specs cover existing storage and commands. This design builds on their current implementation. The stock Redis strategy uses a standalone client and multikey transactions/scripts. Cluster support is part of the new providers' qualification.

## Proposed Solution

Use an explicit app-owned registration list in `src/providers/cache.ts` and one additive `CACHE_PROVIDER` selector. Infrastructure families use `src/providers/<family>.ts` in both app layouts, and start before their service is constructed. Browser-facing entry points never import these server-only registrations. Keep the core independent of provider package names. The [open-source provider catalog](2026-11-24-oss-cache-provider-packages.md) and [Enterprise companion](enterprise/2026-11-24-managed-cloud-cache-providers.md) specify independent delivery of adapter packages through this interface.

Keyv demonstrates independently packaged adapters and a common conformance suite. Symfony illustrates why tag invalidation deserves engine-specific implementation and verification. A generic get/set adaptor or an Awilix-only override would bypass required enumeration or process entry points. [Keyv adapter guidance](https://v5.keyv.org/docs/third-party-storage-adapters/), [Symfony Cache](https://symfony.com/doc/current/cache.html)

## Delta

### Capability: pluggable-cache-providers

#### ADDED Requirement: App-owned npm provider selection

The platform SHALL select an explicitly registered npm cache provider using deployment configuration and the provider's validated settings.

##### Scenario: Provider unknown to platform source

- WHEN a deployment installs a third-party package, registers the package's loader and settings, and selects its ID
- THEN the server, worker and cache maintenance resolve that provider through the same effective configuration, with no package-specific core change

##### Scenario: Invalid explicit selection

- WHEN the selected provider is missing, incompatible, disabled, misconfigured or unavailable
- THEN the affected runtime or operation reports a sanitized failure and never substitutes a local cache

#### ADDED Requirement: Scoped distributed cache behavior

A provider SHALL preserve documented tenant scope, TTL, enumeration and tag invalidation through the existing cache service.

##### Scenario: Remote invalidation

- WHEN one process overwrites a record's tags and another invalidates several tags for the same tenant
- THEN matching current entries are removed once and unrelated entries and other scopes survive. A subsequent read misses a removed entry unless another writer has repopulated it

## Architecture

### Registration and lifecycle

1. The application owns a server-only registration source at `<app root>/src/providers/cache.ts`. It exports a list of explicit registrations with literal package import loaders, a provider ID, and a settings function. Generation emits a deterministic server manifest or an empty manifest. Follow the literal-import pattern of the existing generated bootstrap registries. Resolve the file in app context, include it in build tracing, and expose a narrow manifest loader for CLI maintenance. Generation does not evaluate settings or load adapters to discover them.
2. Run one resolver before cache construction on both core bootstrap paths and before CLI topology checks. The app's server bootstrap and the app-root loader for CLI, worker and scheduler supply the same generated manifest. The app-level DI registrar runs too late for this job. Add a provider-specific failure path through the legacy optional bootstrap catch. Prove this through real entry points, including direct Next server readiness and the production standalone build.
3. Validate registration IDs and the selected descriptor, then resolve and validate that provider's settings exactly once per process. Do not connect or evaluate settings for inactive providers. Keep `createCacheService(options?)` and `new CacheService(options?)` synchronous via a typed resolved provider input and a lazy strategy handle. Async operations await a shared in-flight client connect. Keep one owned client per process, bound initialization/reconnect times, and close clients idempotently on shutdown and failed initialization. When the legacy singleton is disabled, request scopes share provider transport or close owned handles on disposal. Refresh provider selection only on restart, including in production.
4. Apply the existing tenant-aware wrapper once to the provider's base `CacheStrategy`. Pass already-scoped physical keys and tags into drivers. Drivers independently fence the deployment namespace for value, index, scan, and maintenance operations. Keep namespace separate from endpoints and credentials, and reserve an explicit, stable namespace per deployment and adapter layout.
5. For `/api/healthz`, use the effective provider's non-mutating `healthcheck` and keep the response status/body contract. Use the resolved scope capability to drive the production multi-instance guard and the OAuth shared-store warning. The capability covers cross-process visibility. It does not make the existing OAuth `has`/ `set` sequence atomic or prevent backend eviction. Do not trust a replica read endpoint where stale reads could defeat invalidation. Keep existing behavior for stock strategies.
6. Cache admin API and `mercato configs cache` continue using scoped DI. For `mercato generate` with the configs module enabled, load just the generated cache manifest, resolve the same provider, use the existing cross-scope pattern purge, and close the maintenance client in `finally`. Keep the post-step best effort and report failures through its existing result and sanitized diagnostics. Builds and bootstrap-free commands that do not already purge must work without provider access.

### Stock npm packages

The memory, SQLite, Redis and JSON file implementations ship as separate first-party npm packages and come with `@open-mercato/cache` by default. A typed host registry maps existing `CACHE_STRATEGY` names to the packaged factories. The synchronous cache API also uses this registry before app bootstrap. Preserve the memory default, programmatic strategy selection, dependency fallback, Redis key layout, local file paths, codecs and existing public strategy imports. App-provided npm adapters use explicit lazy registrations and their existing strict selection contract.

### Provider contract and configuration

The new server-only `@open-mercato/cache/provider` entry point owns the versioned definition helper and registration types. Names below are proposed API names.

| Contract | v1 behavior |
|---|---|
| `defineCacheProvider` | Supplies `apiVersion: 1`, a stable, namespaced ID, a provider-owned strict Zod schema, deployment capability derived from validated config, and a factory from typed config plus host context to a base `CacheStrategy`. Mandatory `healthcheck` and `close` for npm providers. |
| `defineCacheProviderRegistration` | Host declares an ID, a static lazy package loader and a typed settings function. The host rejects duplicate IDs, reserved built-in names, invalid syntax, version mismatch, and registration/descriptor ID mismatch before use. Export definition factories without registration side effects. |
| Host context | Deployment namespace and effective default TTL, codec settings and shared codec/pattern helpers. No request container, tenant credentials, arbitrary environment object or transport handle passes through the public strategy. |
| `CACHE_PROVIDER` | Exact registered ID. When set, it wins over the legacy strategy environment setting. Empty behaves as unset. Existing explicit programmatic stock `strategy` wins over ambient provider selection. Passing both explicit provider and explicit stock strategy is a configuration error. |
| `CACHE_PROVIDER_NAMESPACE` | Required for deployment-selected providers. A stable nonsecret identifier unique to the deployment on its backing service. Explicit programmatic setup supplies the same value through the resolved provider input. |
| Settings | Provider supplies the entire schema, examples, defaults and validation for endpoint lists, TLS, credentials, topology, timeouts and engine limits. App settings read named environment or secret references. Credentials stay in process and are redacted before logging or error reporting. Validate strict cross-field rules and surface field paths with safe error codes. |
| Capability | Resolved placement is `local` or `shared`. Unknown settings fail validation and local providers remain ineligible for declared multi-instance deployment under the existing guard policy. First-party shared configurations need cross-process conformance evidence. |

Example app-owned configuration. The npm import is in code and the environment selects its registered ID.

```ts
import { defineCacheProviderRegistration } from '@open-mercato/cache/provider'

export const cacheProviders = [
  defineCacheProviderRegistration({
    id: 'open-mercato/valkey',
    load: () => import('@open-mercato/cache-provider-valkey').then((module) => module.provider),
    settings: () => ({
      endpoints: [process.env.MERCATO_VALKEY_ENDPOINT ?? ''],
      tls: true,
    }),
  }),
]
```

Set `CACHE_PROVIDER=open-mercato/valkey` and the deployment namespace plus the package's documented variables at runtime. An installed npm package is trusted server code. There is no npm installation, filesystem import or unrestricted module resolution driven by a selector string. Providers use a compatible `@open-mercato/cache` peer dependency, declare their own clients and export server-only code. Keep the extension point common and cloud SDKs outside the stock cache package and public app dependency graph.

### Cache data model and semantics

No SQL tables, migrations or settings entities are introduced. A new provider owns a versioned disposable backend layout. Store each npm provider entry's logical key, value, and enumeration metadata in one physical record under a versioned host key. Keep namespace and tenant separation, TTL in milliseconds, current-tag union semantics, glob matching, and provider-independent read/has/delete behavior. New adapters use the shared codec where serialized values are supported and define the maximum accepted encoded item size. `returnExpired` exposes expired records still retained by the backend, subject to physical expiry or eviction. Size and expired counts are scoped to retained metadata, with the same observation limits as the current service.

- Enumerate a namespace via bounded pages or deterministic shards. Deduplicate multi-tag candidates and count confirmed removals. Full operations either inspect their complete target or report failure. Avoid global flush, blocking key enumeration and unaudited key dumps.
- Candidate indexes, if used, must not lose membership for a live payload through eviction, expiry or partial writes. Re-read current tags and compare the observed version before removing a retagged entry. A provider may colocate data and metadata or use an authoritative bounded enumeration. Confirm success only when all required batches succeed. Document partial progress, retry semantics, and absence of a snapshot across concurrent writes. If a write fails after the backend has committed it, the complete record remains eligible for enumeration and invalidation. The host must not roll back a failed write by deleting a concurrent replacement.
## API Contracts

Existing `CacheStrategy`, `CacheService`, Awilix token, HTTP routes, and CLI command shapes remain stable. The new entry point and optional provider input are additive. The existing cache admin route (`GET` and `POST /api/configs/cache`) still uses tenant scope and ACLs. `GET /api/healthz` probes the selected provider without exposing its version, endpoint, settings or error details. User-facing cache management and authorization are exercised through existing test paths.

## Migration & Backward Compatibility

With `CACHE_PROVIDER` unset, keep legacy selection precedence, defaults, connection settings, codecs and stock fallback. Existing Redis requires no reinstall or migration. Adoption uses a new provider namespace and a coordinated cutover for HTTP, workers, schedulers and maintenance. Do not run mixed-provider replicas for the same deployment. Plan for cold-cache load and independently handle short-lived security markers before switching. On rollback, coordinate all processes, clear the prior deployment cache using scoped tools before accepting traffic or wait for a verified safe expiry, then unset `CACHE_PROVIDER`. A backend shared with other deployments must never be globally purged.

## Risks & Impact Review

| Scenario | Severity and affected area | Mitigation and residual risk |
|---|---|---|
| A selection error silently becomes memory | High · runtime, shared invalidation and readiness | Propagate typed selection errors across bootstrap boundaries. Time out probes and operations and sanitize logs. Real backend outages can still render cache-dependent operations unavailable. |
| Index loss, stale replica reads or retag race leaves data visible | High · ACL, CRUD response and webhook caches | Verify current-version deletion, coherent eviction, primary reads and cross-process invalidation. Some existing consumers treat cache failure as best effort. Exercise their behavior and document the remaining failure and recovery window before claiming production suitability. |
| Auth or marker data disappears on cutover, expiry or eviction | High · consumers using cache for replay markers or revocation state | Benchmark and document eviction policies, avoid treating cache as durable truth, and qualify actual consumer behavior under the advertised policy. Operators must account for these limits during coordinated cold cutovers. |
| Namespace collision or broad maintenance clears unrelated data | High · multi-tenancy and shared cache deployment | Explicit deployment namespace, namespace-aware enumeration, foreign-key fixtures and denied unrestricted flush. Deliberate reuse of a namespace aliases deployments. |
| Full scans, shard contention or item limits dominate writes | Medium · invalidation latency and capacity | Measure realistic tag churn and mixed payloads with two processes before publishing each topology. Define and record a profile-specific supported limit and latency budget. Bound per-attempt work and retries. |
| Third-party package or diagnostic surfaces credentials | High · operator secrets | Explicit pinned package selection, dependency review, schema redaction and sanitized error causes. A trusted dependency still runs with process privileges. |

## Verification

- **Selection and backward compatibility** · Unit and entry-point tests cover built-ins, unknown legacy values, explicit override precedence, duplicate IDs, invalid/unsupported config, absent package, incompatible API version, unselected packages, singleton off, shutdown, and timeout/redaction. Use an independently packed npm fixture with a custom ID and schema to prove the host has no allowlist for open-source providers. Exercise monorepo and a freshly scaffolded Verdaccio install, production server, worker/scheduler CLI, and structural generation purge.
- **Provider conformance kit** · Run one reusable suite against the separately packed fixture in a disposable environment. The kit covers CRUD cache primitives, expiry with default and override, tag overlap/retag, glob and stats, scoped clear, cleanup, foreign namespace, interleaved tenant contexts, independent process propagation, reconnect, corrupt value behavior, bounded batch/failure, and close. Include enough entries to cross a batch boundary. Export the fixture lifecycle and assertions so delivery work can exercise each engine and topology.
- **Application boundaries** · Run readiness for reachable, unavailable and misconfigured selections, cache admin API stats/authorized purge and denied access (see `TC-CONF-002/003`), and the cache management page's stats and purge through the existing admin workflow. Run a real cached CRUD list read plus post-commit write invalidation across processes, and a webhook or another runtime-dependent cache consumer. Verify global and tenant CLI stats/purge and maintenance-pattern targeting. Fixtures and namespaces are created per run and removed or allowed to expire in disposable environments.
- **Packaging and performance** · Run relevant cache/core/CLI tests, build packages, generate registries, and verify template sync for any mirrored readiness/env changes. Install the fixture without engine packages. With provider selection unset, compare startup and cache calls to the stock baseline and confirm no opt-in adapter package is resolved.

## Phasing

1. Characterize stock behavior and add the optional provider contract and app registration manifest.
2. Extract the stock implementations into npm packages. Wire the shared early initialization into the application and maintenance paths. Release v1 after the packed fixture, conformance kit, stock regression checks and documentation pass. The delivery status of any engine package is independent of this release.

## Implementation Plan

### Phase 1 — Provider contract

1. Pin stock selection/fallback, both DI bootstrap paths, health and generation purge behavior with characterization tests.
2. Add the server provider contract, schema validation, app manifest generation, synchronous strategy wrapper integration, and effective selection/lifecycle tests.

### Phase 2 — Runtime, conformance kit and documentation

1. Connect readiness, production topology guard, OAuth warning and post-generate maintenance. Prove that an independently packed fixture drives the actual monorepo and standalone entry points, and pin the cache admin and CRUD workflows.
2. Publish the conformance kit, provider-author and operator docs, typed configuration examples, sanitized diagnostics and coordinated cutover steps.
3. Archive the Delta into `.ai/specs/capabilities/pluggable-cache-providers.md` when the fixture and stock regressions pass.

## Final Compliance Report — 2026-11-24

| Rule source | Spec coverage |
|---|---|
| Root, cache and shared guides | Uses the existing DI token, tenant wrapper and tag invalidation. Adds a versioned provider contract without a public rename or removal. |
| Core and CLI guides | Keeps post-commit invalidation and public commands. Covers both bootstrap paths, deterministic generation and optional post-generation failures. |
| Create-app and QA guides | Requires scaffolded install verification, health/env template parity where touched, and per-run fixtures through the conformance kit. |
| Specs and Enterprise guides | This spec defines the OSS extension contract. The delivery specs define engine and cloud package qualification. |
| Backward compatibility | Additive activation, preserved stock formats and defaults, and an explicit coordinated migration and rollback. |

**Design status** · Proposed. Runtime and packaging checks are part of v1 implementation qualification.

## Changelog

- 2026-11-24 · Drafted the npm provider extension point. Scope review separated v1 completion from adapter release qualification.

- 2026-11-26 · Adopted the shared `src/providers` placement and documented stock cache packaging and compatibility.

- 2026-11-27 · Colocated provider values and enumeration metadata, preserved provider settings during generation, and kept initialization retries independent of invalid strategy cleanup.
