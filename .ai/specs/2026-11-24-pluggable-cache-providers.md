# Pluggable cache providers

Extends: .ai/specs/2026-10-15-cache-zstd-value-compression.md
Extends: .ai/specs/2026-11-05-redis-cache-batched-invalidation.md

## TLDR

Open Mercato operators can currently choose four built-in cache strategies. This proposal lets a deployment select an installed npm provider with its own typed configuration, including packages Open Mercato has never seen. Six opt-in open-source engine packages ship through that extension point, each tested against its actual engine in Docker.

## Overview

Cache provider selection is deployment-wide and takes effect on restart. Application modules keep using `container.resolve('cache')` and the existing cache methods for cache-aside reads, TTL, and tag invalidation. This feature covers application caching. Queue, rate-limiter and event transports, application-facing engine primitives, and per-tenant provider selection are outside its scope.

## Problem Statement

- [The cache factory](../../packages/cache/src/service.ts) selects from a fixed list of `memory`, `redis`, `sqlite` and `jsonfile`. `CacheServiceOptions` carries backend-specific options and the service owns the tenant wrapper, logical key enumeration, tag scoping and dependency fallback. An unrecognized legacy `CACHE_STRATEGY` value defaults to memory.
- [Core bootstrap](../../packages/core/src/bootstrap.ts) has a process singleton and a legacy request path, both with stock initialization fallback. [The request container](../../packages/shared/src/lib/di/container.ts) can also treat bootstrap errors as optional. Replacing the Awilix registration later would miss these boundaries and the [bootstrap-free structural purge](../../packages/cli/src/lib/post-generate-invalidation.ts).
- [Readiness](../../apps/mercato/src/app/api/healthz/route.ts), the [multi-instance startup check](../../packages/cli/src/lib/single-instance-strategy-guard.ts), and the [OAuth replay-store warning](../../packages/core/src/modules/communication_channels/lib/oauth-state.ts) currently special-case Redis. They need the effective selection when a provider is enabled.
- The compression and Redis batching specs cover existing storage and commands. This design builds on their current implementation. The stock Redis strategy uses a standalone client and multikey transactions/scripts. Cluster support is part of the new providers' qualification.

## Proposed Solution

Use an explicit app-owned registration list and one additive `CACHE_PROVIDER` selector. Keep the core independent of provider package names and deliver each adapter as a separately installable workspace and npm package. The [Enterprise companion](enterprise/2026-11-24-managed-cloud-cache-providers.md) qualifies cloud services through the same interface.

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

#### ADDED Requirement: Individually installable OSS adapters

The project SHALL publish separate, opt-in npm packages for Valkey, Redis, Memcached, KeyDB, Infinispan and Apache Ignite 2.x. Each advertised configuration requires passing real-engine verification.

##### Scenario: Fresh app with one adapter

- WHEN an operator installs only one supported adapter in a scaffolded app
- THEN that adapter works with the existing DI service and the other five providers remain optional dependencies at deployment time

## Architecture

### Registration and lifecycle

1. The application owns a server-only registration source at `<app root>/mercato.cache.ts`. It exports a list of explicit registrations with literal package import loaders, a provider ID, and a settings function. Generation emits a deterministic server manifest or an empty manifest. Follow the literal-import pattern of the existing generated bootstrap registries. Resolve the file in app context, include it in build tracing, and expose a narrow manifest loader for CLI maintenance. Generation does not evaluate settings or load adapters to discover them.
2. Run one resolver before cache construction on both core bootstrap paths and before CLI topology checks. The app's server bootstrap and the app-root loader for CLI, worker and scheduler supply the same generated manifest. The app-level DI registrar runs too late for this job. Add a provider-specific failure path through the legacy optional bootstrap catch. Prove this through real entry points, including direct Next server readiness and the production standalone build.
3. Validate registration IDs and the selected descriptor, then resolve and validate that provider's settings exactly once per process. Do not connect or evaluate settings for inactive providers. Keep `createCacheService(options?)` and `new CacheService(options?)` synchronous via a typed resolved provider input and a lazy strategy handle. Async operations await a shared in-flight client connect. Keep one owned client per process, bound initialization/reconnect times, and close clients idempotently on shutdown and failed initialization. When the legacy singleton is disabled, request scopes share provider transport or close owned handles on disposal. Refresh provider selection only on restart, including in production.
4. Apply the existing tenant-aware wrapper once to the provider's base `CacheStrategy`. Pass already-scoped physical keys and tags into drivers. Drivers independently fence the deployment namespace for value, index, scan, and maintenance operations. Keep namespace separate from endpoints and credentials, and reserve an explicit, stable namespace per deployment and adapter layout.
5. For `/api/healthz`, use the effective provider's non-mutating `healthcheck` and keep the response status/body contract. Use the resolved scope capability to drive the production multi-instance guard and the OAuth shared-store warning. The capability covers cross-process visibility. It does not make the existing OAuth `has`/ `set` sequence atomic or prevent backend eviction. Do not trust a replica read endpoint where stale reads could defeat invalidation. Keep existing behavior for stock strategies.
6. Cache admin API and `mercato configs cache` continue using scoped DI. For `mercato generate` with the configs module enabled, load just the generated cache manifest, resolve the same provider, use the existing cross-scope pattern purge, and close the maintenance client in `finally`. Keep the post-step best effort and report failures through its existing result and sanitized diagnostics. Builds and bootstrap-free commands that do not already purge must work without provider access.

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

No SQL tables, migrations or settings entities are introduced. A new provider owns a versioned disposable backend layout. Keep the platform's logical key/metadata pair, namespace and tenant separation, TTL in milliseconds, current-tag union semantics, glob matching, and provider-independent read/has/delete behavior. New adapters use the shared codec where serialized values are supported and define the maximum accepted encoded item size. `returnExpired` exposes expired records still retained by the backend, subject to physical expiry or eviction. Size and expired counts are scoped to retained metadata, with the same observation limits as the current service.

- Enumerate a namespace via bounded pages or deterministic shards. Deduplicate multi-tag candidates and count confirmed removals. Full operations either inspect their complete target or report failure. Avoid global flush, blocking key enumeration and unaudited key dumps.
- Candidate indexes, if used, must not lose membership for a live payload through eviction, expiry or partial writes. Re-read current tags and compare the observed version before removing a retagged entry. A provider may colocate data and metadata or use an authoritative bounded enumeration. Confirm success only when all required batches succeed. Document partial progress, retry semantics, and absence of a snapshot across concurrent writes. If the wrapper's second write fails, the provider integration must keep the data eligible for tag invalidation and reconcile or remove an orphan before claiming complete logical enumeration. Verify repair or cleanup cannot delete a newer concurrent write.
- Keep Redis-compatible cluster commands single-key or placed within the same hash slot, route mutations to primaries and follow topology changes. Test the primary and metadata writes, concurrent refresh/retag, failure between batches, and retry. No builtin key or wire formats are changed. [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)
- Memcached's portable protocol provides keyed access and CAS. Use a deterministic, bounded array of deployment buckets, each held in one CAS item with its own entries, tags and expiry metadata. Enumerate by fetching the known bucket keys. Missing or evicted buckets are misses in their entirety. CAS from the latest state for mutations and use atomic add for a missing bucket. Keep key and encoded bucket sizes under the configured server limits, cap retry/concurrency, reclaim expired entries, and document capacity eviction. Normal cache entries and tags must fit together within one item or produce an explicit error. Store per-entry logical TTL in the bucket to avoid shared expiry and protocol range surprises. No side index may hide a surviving value. [Memcached basic protocol](https://docs.memcached.org/protocols/basic/)

### Open-source provider catalog

Each proposed package lives in its own `packages/cache-provider-*` workspace, API-compatible with v1, and ships a README and runnable Docker recipe. First-party IDs follow `open-mercato/<package suffix>`, for example `open-mercato/valkey`. The initial release supports the modes listed below after qualification. Any additional mode advertised by a package takes the same qualification, and unsupported configuration combinations are rejected.

| npm package | Initial support and configuration | Required real-engine proof |
|---|---|---|
| `@open-mercato/cache-provider-valkey` | Valkey, single primary and Valkey Cluster. Endpoint seeds, ACL credentials, TLS and timeouts. | Valkey containers for standalone and a real sharded cluster. Test redirects, scope and failover/reconnect. [Valkey overview](https://valkey.io/topics/introduction/), [Valkey clients](https://valkey.io/clients/) |
| `@open-mercato/cache-provider-redis` | Redis Open Source, single primary and Redis Cluster. Endpoint seeds, ACL credentials, TLS and timeouts. Document exact tested versions and upstream licensing. | Redis containers for standalone and a real sharded cluster. Exercise stock-versus-opt-in configuration and slot-safe batches. [Redis licenses by version](https://redis.io/legal/licenses/), [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/) |
| `@open-mercato/cache-provider-memcached` | Self-hosted Memcached, one or more configured servers with identical routing across clients. Explicit item, bucket and CAS retry limits. | Memcached containers, including multi-server routing, TTL, item size, restart/eviction, conflicting writes and false-miss prevention after partial mutations. [Memcached basic protocol](https://docs.memcached.org/protocols/basic/) |
| `@open-mercato/cache-provider-keydb` | KeyDB single writable endpoint, TLS/auth as supported by the verified profile. Active-active replication requires separate consistency qualification. | KeyDB container, documented client compatibility, full tag, expiry and bounded enumeration suite. [KeyDB project](https://github.com/Snapchat/KeyDB) |
| `@open-mercato/cache-provider-infinispan` | Infinispan Server with a dedicated remote cache, endpoint, auth, TLS and cache name. Spike Hot Rod or REST for paged enumeration and conditional mutation. | Distributed Infinispan server containers. Prove that the chosen protocol provides atomic conditional replacement/removal and complete scoped enumeration, or use bounded CAS buckets if the protocol can support them. [Infinispan REST API](https://infinispan.org/docs/stable/titles/rest/rest.html), [JavaScript Hot Rod client](https://infinispan.org/docs/hotrod-clients/js-client/latest/) |
| `@open-mercato/cache-provider-ignite` | Apache Ignite **2.x** with a dedicated cache. Endpoint, auth, TLS and cache name. Pin a maintained, compatible thin-client path after the spike. | Ignite 2.x server containers. Verify scan pagination, conditional mutation, expiry and reconnect against the pinned client and server. [Ignite 2.x Node.js thin client](https://ignite.apache.org/docs/ignite2/latest/thin-clients/nodejs-thin-client), [Ignite expiry policies](https://ignite.apache.org/docs/ignite2/latest/configuring-caches/expiry-policies) |

Client selection remains an implementation qualification step. Verify maintenance status, licensing, supported Node/runtime targets, package ESM/types, binary safety, operation deadlines, shutdown, and the required engine operations before proposing a production dependency. Reuse proven wire-level code and the same conformance suite across providers. Keep transport/dependency ownership in the respective package.

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
- **Engine contract** · Reuse one suite with pinned container images and isolated namespaces. Use Testcontainers or the repo's Docker harness. For every row and advertised topology, run CRUD cache primitives, expiry with default and override, tag overlap/retag, glob and stats, scoped clear, cleanup, foreign namespace, interleaved tenant contexts, independent process propagation, reconnect, corrupt value behavior, bounded batch/failure, and close. Cover entries larger than a page and driver limits. CI publishes per-variant evidence and fails when a required engine test is skipped.
- **Application boundaries** · Run readiness for reachable, unavailable and misconfigured selections, cache admin API stats/authorized purge and denied access (see `TC-CONF-002/003`), and the cache management page's stats and purge through the existing admin workflow. Run a real cached CRUD list read plus post-commit write invalidation across processes, and a webhook or another runtime-dependent cache consumer. Verify global and tenant CLI stats/purge and maintenance-pattern targeting. Fixtures and namespaces are created per run and removed or allowed to expire in disposable environments.
- **Packaging and performance** · Run relevant cache/core/CLI tests, build packages, generate registries, and verify template sync for any mirrored readiness/env changes. Test package installation and type imports without other providers. Capture per supported topology key cardinality, payload sizes, p50/p95, command counts, timeout errors and cleanup under steady traffic and retag/invalidate churn. Compare to the stock Redis baseline and record the operating envelope before promotion.

## Phasing

1. Land the neutral v1 extension point with an independently packed fixture and stock regression coverage.
2. Ship the Valkey, Redis and KeyDB packages once each passes its container and installation gates.
3. Ship Memcached, Infinispan and Ignite 2.x as each passes its engine-specific feasibility, contract and performance gates. Cloud packages build on the same contract through the companion spec.

## Implementation Plan

### Phase 1 — Extension point

1. Pin stock selection/fallback, both DI bootstrap paths, health and generation purge behavior with characterization tests. Keep existing callers and published package exports working.
2. Add the server provider contract, schema validation, app manifest generation, synchronous strategy wrapper integration, and effective selection/lifecycle tests.
3. Connect readiness, production topology guard, OAuth warning and post-generate maintenance. Prove that an independently packed fixture drives the actual monorepo and standalone entry points, and pin the cache admin and CRUD workflows.
4. Publish provider-author and operator docs, typed configuration examples, sanitized diagnostics and coordinated cutover steps.

### Phase 2 — Redis-compatible packages

1. Prove the bounded, slot-safe storage and client primitives on standalone and clustered Valkey, then package and test Valkey.
2. Package Redis and KeyDB individually, each with its own pinned image matrix and compatible settings. Verify shared code does not alter the stock Redis layout or runtime defaults.

### Phase 3 — Other OSS engines

1. Prove and package the Memcached bucket protocol with two independent clients, forced contention, auth/TLS if advertised, eviction and size-limit tests.
2. Qualify the Infinispan and Ignite 2.x client paths against actual clusters. Package each with an isolated integration test lane. Hold any engine or variant that misses the correctness or runtime gate.
3. Record the accepted version/topology and performance envelopes per package. Archive the landed Delta into `.ai/specs/capabilities/pluggable-cache-providers.md` as the corresponding requirements ship.

## Final Compliance Report — 2026-11-24

| Rule source | Spec coverage |
|---|---|
| Root, cache and shared guides | Uses the existing DI token, tenant wrapper and tag invalidation. Adds a versioned provider contract without a public rename or removal. |
| Core and CLI guides | Keeps post-commit invalidation and public commands. Covers both bootstrap paths, deterministic generation and optional post-generation failures. |
| Create-app and QA guides | Requires scaffolded install verification, health/env template parity where touched, per-run fixtures, and real-engine tests for each adapter. |
| Specs and Enterprise guides | OSS extension and engines are specified here. Commercial distribution, activation and live-test prerequisites are in the companion spec. |
| Backward compatibility | Additive activation, preserved stock formats and defaults, and an explicit coordinated migration and rollback. |

**Design status** · Proposed. Client, topology and runtime checks are part of implementation qualification.

## Changelog

- 2026-11-24 · Drafted the npm provider extension point, six OSS adapters and their verification plan.
