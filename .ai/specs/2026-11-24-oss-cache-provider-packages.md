# Open-source cache provider packages

Extends: .ai/specs/2026-11-24-pluggable-cache-providers.md

## TLDR

Ship individually installable npm providers for Valkey, Redis, Memcached, KeyDB, Infinispan and Apache Ignite 2.x. Each package is a separate implementation and release scope. Support requires installing the packed package into a clean app and passing conformance against its real engine in Docker or Testcontainers.

## Overview

This document defines the OSS delivery catalog for the [v1 provider extension](2026-11-24-pluggable-cache-providers.md). Each adapter depends on the v1 extension and its own qualification. An operator installs the adapter for their chosen engine and configures it through the app-owned registration. Hosted Enterprise providers have a separate [delivery spec](enterprise/2026-11-24-managed-cloud-cache-providers.md).

## Problem Statement

The stock app supports standalone Redis alongside local strategies. Redis compatibility, distributed cache APIs and key/value stores use different routing, expiry, enumeration and mutation semantics. An adapter must preserve tag invalidation and tenant boundaries under its actual engine's conditions, including eviction and partial failures.

## Proposed Solution

Publish one `@open-mercato/cache-provider-*` package per engine, each with a strict settings schema, supported version/topology matrix, dependency declaration, operator README and runnable Docker recipe. Use the shared conformance kit and engine-specific tests. Select clients during implementation based on the needed operations, active maintenance, license, compatible Node targets, package ESM/types, binary safety, deadlines, reconnect and shutdown.

## Delta

### Capability: oss-cache-provider-packages

#### ADDED Requirement: Independent qualified engine adapter

Each listed engine SHALL have its own installable provider package with a supported settings matrix backed by real-engine evidence.

##### Scenario: One engine release qualifies

- WHEN one package passes its initial profile, packed installation and evidence checks
- THEN that package can ship on its own and an app can use it through the existing `cache` DI service

##### Scenario: An engine or additional profile has insufficient evidence

- WHEN an engine profile fails or skips required conformance
- THEN it is excluded from that package's supported matrix and sibling packages continue through their own release gates

## Architecture

Each provider implements the v1 server-only interface, owns its transport and validates deployment-specific settings. Use a compatible `@open-mercato/cache` peer dependency, separate `packages/cache-provider-*` workspaces and first-party IDs `open-mercato/<package suffix>`. Reuse shared codec and pattern helpers and common protocol code where wire behavior is demonstrated. Installing one provider needs no other provider package or unrelated engine client.

Redis-compatible providers must route mutations and consistency-sensitive reads to the primary. Batch only within a slot where required, handle redirects and reconfiguration, and verify complete namespace enumeration and tag invalidation under the claimed topology. Keep single-key operations or same-slot grouping where transactions or scripts require it. The stock Redis strategy retains its current driver and wire format. [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/)

### Delivery scopes and release gates

| Work item and npm package | First supported profile and settings | Engine-specific qualification and additional target profiles |
|---|---|---|
| Valkey · `@open-mercato/cache-provider-valkey` | Single writable Valkey endpoint, ACL credentials, TLS and timeouts. | Pass the suite on a Valkey container with authenticated TLS, then qualify Valkey Cluster separately with endpoint seeds, real sharding, redirects and failover/reconnect. [Valkey overview](https://valkey.io/topics/introduction/), [Valkey clients](https://valkey.io/clients/) |
| Redis · `@open-mercato/cache-provider-redis` | Single writable Redis Open Source endpoint, ACL credentials, TLS and timeouts. | Test stock versus opt-in selection and licensing by verified engine version. Qualify Redis Cluster separately on a sharded container topology with slot-safe batches. [Redis licenses by version](https://redis.io/legal/licenses/), [Redis Cluster specification](https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/) |
| Memcached · `@open-mercato/cache-provider-memcached` | One self-hosted server with explicit item, bucket and CAS retry limits. | Test coherent eviction, TTL, contention, restart and oversize writes. Qualify multiple servers with identical routing across clients and test auth/TLS on any advertised transport profile. [Memcached basic protocol](https://docs.memcached.org/protocols/basic/) |
| KeyDB · `@open-mercato/cache-provider-keydb` | One writable KeyDB endpoint, TLS/auth per verified profile. | Use a KeyDB container and prove actual Redis-client compatibility, full tag and expiry behavior, and bounded enumeration. Qualify active-active replication separately before advertising it. [KeyDB project](https://github.com/Snapchat/KeyDB) |
| Infinispan · `@open-mercato/cache-provider-infinispan` | Dedicated remote cache with endpoint, cache name, auth and TLS on a distributed Infinispan Server deployment. | Run distributed server containers. Spike Hot Rod or REST for complete scoped enumeration and atomic conditional replacement/removal. Use the bucket design only if the chosen protocol proves the necessary atomic operations and limits. [Infinispan REST API](https://infinispan.org/docs/stable/titles/rest/rest.html), [JavaScript Hot Rod client](https://infinispan.org/docs/hotrod-clients/js-client/latest/) |
| Apache Ignite 2.x · `@open-mercato/cache-provider-ignite` | Dedicated cache on an Apache Ignite **2.x** cluster with endpoint, cache name, auth and TLS. | Run Ignite 2.x server containers. Pin a maintained thin-client path after proving scan pagination, conditional mutation, expiry and reconnect on the actual versions. [Ignite 2.x Node.js thin client](https://ignite.apache.org/docs/ignite2/latest/thin-clients/nodejs-thin-client), [Ignite expiry policies](https://ignite.apache.org/docs/ignite2/latest/configuring-caches/expiry-policies) |

## Data model

Each adapter stores disposable scoped values and metadata in its versioned deployment namespace. No SQL data or migration is involved. Any candidate index must remain complete for live data through eviction and partial writes. Qualify the relationship between the v1 wrapper's value and metadata records and test retagging and retries across two processes.

Memcached uses fixed deployment buckets addressed by a deterministic key hash, each held in one CAS item with its own entries, tags and per-entry logical expiry. Fetch the known bucket keys for enumeration. Missing or evicted buckets are misses in their entirety. Mutations compare and swap from the latest bucket state, with atomic add for a missing bucket. Bound key and encoded item sizes, retries and concurrency. Reclaim expired entries, document capacity eviction, and report values too large for an item. Keep physical sharding, bucket count and routing fixed within a layout version. [Memcached basic protocol](https://docs.memcached.org/protocols/basic/)

## API Contracts

Use the unchanged tenant wrapper, `CacheStrategy`, cache administration and readiness paths. The package's settings schema accepts only combinations in its supported matrix. Document errors for unsupported settings, item limits, unavailable transport and timeout using the shared sanitized failure contract.

## Migration & Backward Compatibility

All packages are explicit opt-ins. Follow the shared coordinated cutover and rollback procedure, with a new namespace for an incompatible layout or Memcached bucket/routing change. Preserve the old cache backend until the operator can roll back safely. Package addition does not migrate or reload stock Redis cache values.

## Risks & Impact Review

| Scenario | Severity and affected area | Mitigation and residual risk |
|---|---|---|
| Retagging or index loss leaves live entries out of an invalidation | High · tenant-scoped caches | Ensure complete enumeration or safe index membership and conditional deletion. Test mixed operations across independent processes. Recovery of stale data on service failover depends on the advertised engine policy. |
| Memcached bucket contention or item limits dominate cache writes | Medium · workload latency and capacity | Bound bytes and attempts, verify expected churn and benchmark capacity. Publish the measured operating envelope and behavior at its limits. |
| Grid protocol or client lacks a required operation | High · provider completeness | Prove the chosen protocol on Docker before packaging. Hold that work item if it cannot preserve the contract. |
| Custom client introduces supply or platform risk | Medium · production install | Check license, maintenance, runtime and lockfile, then verify a fresh packaged install and shutdown. Client updates still require requalification of affected modes. |

## Verification

- Run the shared v1 conformance kit and the row-specific tests against pinned engine container images with isolated namespaces. Use Testcontainers or the repo's Docker harness. Required tests cannot pass by skipping or substituting an emulator. Capture version, topology, auth/transport profile, suite results and cleanup.
- Exercise two processes, tenant/global/foreign namespace isolation, TTL and overrides, current-tag union, batch limits, retagging and concurrent invalidation, process failover/reconnect, logical enumeration, cleanup and corrupt values. Check the exact readiness and authenticated cache stats/purge APIs and the existing cache-management page through the v1 app smoke. Verify a committed CRUD write invalidates another process's cached list.
- Pack and install each provider into a fresh standalone app without sibling adapters. Verify types, selection, startup and a basic cache workflow. Run the package build, tests and template parity checks where applicable.
- Record supported key cardinality, payload sizes, operation p50/p95, command counts, errors and cleanup under steady traffic and tag churn. Compare to stock Redis as a reference. Define the accepted operating envelope and latency budget per profile before promotion.

## Phasing

1. Release the shared v1 host and conformance kit using its own fixture.
2. Run the six work items in the catalog independently. Each can release when its first profile has real-engine evidence, working packaged installation, and published settings and limitations. Later profiles follow that same package-specific gate.

## Implementation Plan

### Phase 1 — Shared prerequisite

1. Adopt the released v1 API and conformance kit. Define a reproducible Docker and package-install invocation for each work item.

### Phase 2 — Independently shippable work items

1. For each catalog work item, prove its required protocol operations on the first engine profile and record the chosen storage layout, client, images and settings.
2. Implement and package that adapter. Pass shared and engine-specific conformance, the clean install and application smoke, and the performance qualification for its first profile.
3. Publish the adapter's README, supported matrix and recorded evidence. Archive the landed Delta into `.ai/specs/capabilities/oss-cache-provider-packages.md`, recording the completed package and qualified profiles as each work item ships.

## Final Compliance Report — 2026-11-24

| Rule source | Spec coverage |
|---|---|
| Cache and compatibility guides | Reuses the DI and tenant-aware contract, with optional packages and no stock format change. |
| QA and create-app guides | Requires real engine containers, independent fixtures and fresh standalone package installs. |
| Spec guide | Separate work item and completion gate per provider, with shared extension completion tracked in its own spec. |

**Design status** · Proposed. Engine support depends on the corresponding real-engine implementation evidence.

## Changelog

- 2026-11-24 · Extracted independent OSS package work items and Docker gates from the extension spec after scope review.
