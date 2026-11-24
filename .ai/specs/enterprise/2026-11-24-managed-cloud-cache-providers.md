# Enterprise managed cloud cache providers

Extends: .ai/specs/2026-11-24-pluggable-cache-providers.md

## TLDR

Ship separate commercial npm providers for Azure Managed Redis, Amazon ElastiCache and Google Cloud Memorystore through the pluggable cache contract. Each advertised engine, topology and authentication profile requires evidence from an authorized live managed instance before it is marked supported.

## Overview

Enterprise operators can select a managed application cache with deployment-native TLS, credentials and endpoint discovery. They install only the package for the service they use. Application modules continue to use the same Awilix `cache` service, TTL and tags. The managed adapters cover the application cache contract. Engine-specific counters, sessions, leaderboards and data-grid operations have separate product and API requirements.

## Problem Statement

An engine-compatible protocol alone cannot qualify a managed offering. Azure's clustering policy determines client construction and allowed commands. AWS engine and deployment mode determine discovery and authentication. Google's Valkey, Redis, and Redis Cluster offerings have different endpoints and identity options. The stock Redis strategy has one connection input and its operation set was designed for a standalone Redis server. Authentication, topology and command compatibility therefore need provider-owned settings and live verification.

## Proposed Solution

Use three commercial packages with separate topology and auth schemas, clients and runbooks. Reuse the v1 provider contract, tenant wrapper, default TTL/codec and conformance kit from the [OSS extension spec](../2026-11-24-pluggable-cache-providers.md). Managed services can share tested wire-level implementation where their command sets and consistency models match. The commercial packages own identity and deployment-specific behavior.

## Delta

### Capability: managed-cloud-cache-providers

#### ADDED Requirement: Enterprise managed adapter activation

Official managed adapters SHALL be individually installable through the commercial distribution path and activatable only in an enabled and authorized Enterprise deployment.

##### Scenario: Enterprise adapter selected

- WHEN an Enterprise operator installs one official adapter, enables Enterprise and selects a valid provider registration
- THEN the deployment uses it for the same cache DI consumers and uses the provider-specific settings and health probe

##### Scenario: Enterprise unavailable

- WHEN an official managed adapter is selected without Enterprise activation or its licensed distribution access
- THEN activation fails with an actionable sanitized diagnostic and no cloud connection or local fallback

#### ADDED Requirement: Verified managed profiles

The project SHALL mark a managed configuration supported after running cache conformance against that service with its actual engine, topology, auth profile and TLS configuration.

##### Scenario: Sandbox profile lacks live evidence

- WHEN a profile has only mocks or self-hosted container evidence, or its live test could not run
- THEN the release records the specific profile as unverified and excludes it from the supported settings matrix

## Architecture

### Commercial boundary

- Each row below is its own npm package and release unit, licensed through the [Enterprise license](../../../packages/enterprise/LICENSE.md) and shipped using the approved commercial package access path. Keep packages and cloud SDKs out of the default OSS install and public artifact publish set. Qualify tarball contents and dependency graphs of clean OSS and Enterprise installs.
- Follow the existing Enterprise opt-in pattern used by [the application module configuration](../../../apps/mercato/src/modules.ts). The enterprise host provides activation to official commercial registrations and validates it before provider SDK loading, settings access or client creation. Gate the official provider factory as well as the supported registration path. Use the same check in server, workers and structural maintenance. Commercial package access and operator entitlement belong to the Enterprise distribution process. The environment switch alone is a runtime enable flag.
- Reserve the official provider IDs for those registrations. A selection with a missing package, mismatched ID/API version, or disabled commercial gate fails explicitly. Generic third-party OSS provider extension remains available and does not require a commercial package.

### Package and support matrix

These are the target profiles, grouped by managed offering. A package can land support incrementally. Its schema and docs list only combinations with live qualification. Pin supported service versions and client versions in the implementation record.

| npm package and managed engine | Topologies to qualify | Auth and configuration to qualify |
|---|---|---|
| `@open-mercato/cache-provider-azure-managed-redis` · Azure Managed Redis, Redis Enterprise | Non-clustered, OSS clustering with discovery and slot routing, and Enterprise proxy policy as separate profiles. Prove the command/paging strategy on the proxy policy. | Host, port, policy, CA settings, TLS with hostname verification, Microsoft Entra identity and refresh/re-auth on every relevant connection. Validate separately any access-key profile offered, with rotation and reconnect. [Azure clustering policies](https://learn.microsoft.com/en-us/azure/redis/choose-clustering-policy), [Microsoft Entra authentication](https://learn.microsoft.com/en-us/azure/redis/entra-for-authentication) |
| `@open-mercato/cache-provider-aws-elasticache` · Valkey, Redis OSS, Memcached | For **each** Redis-compatible engine, node-based cluster mode disabled (writable primary), node-based cluster mode enabled (configuration endpoint), and Serverless. For Memcached, node-based cluster with tested discovery/routing and Serverless TLS endpoint. | Discriminated settings by engine and deployment mode. Redis-compatible profiles exercise applicable least-privilege ACL user credentials and IAM auth with refresh, re-auth/reconnect and correct signing resource. Memcached uses its documented connectivity and TLS profile, with the node-based discovery path tested separately. [ElastiCache deployment and engine options](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/WhatIs.corecomponents.html), [IAM authentication](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth-iam.html), [TLS](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/in-transit-encryption.html), [Memcached Auto Discovery](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/AutoDiscovery.html) |
| `@open-mercato/cache-provider-google-memorystore` · Memorystore for Valkey, Redis and Redis Cluster | Qualify Valkey cluster-mode enabled and disabled separately, Redis at its primary endpoint, and Redis Cluster at its discovery endpoint. | Product, endpoints, topology, CA and auth mode. Exercise Valkey and Redis Cluster IAM with Google workload credentials, token refresh and new shard connections. Exercise Redis AUTH for the standalone Redis offering. Additional native auth options require their own live evidence. [Memorystore for Valkey](https://docs.cloud.google.com/memorystore/docs/valkey/faq), [Redis access control](https://docs.cloud.google.com/memorystore/docs/redis/access-control), [Redis Cluster IAM](https://docs.cloud.google.com/memorystore/docs/cluster/about-iam-auth), [Redis Cluster TLS](https://docs.cloud.google.com/memorystore/docs/cluster/about-in-transit-encryption) |

Each package validates only its own fields, including the topology/auth pairing, namespace, endpoint roles, transport trust and deadline bounds. Prefer short-lived workload identity where provided. The supported connections verify TLS certificates and hostnames. No verification bypass is an advertised mode. Ensure authentication succeeds on each connection after reconnect, resharding or rotation. For Redis-compatible engines use primary reads and confirm the scoped command set under the actual managed role. For ElastiCache Memcached reuse the CAS bucket design and prove the needed conditional commands, item limits, discovery and routing on both deployment modes.

A connectivity check proves access only. Before promoting a profile, exercise tag invalidation, enumeration, namespace fencing, and partial-failure handling using actual commands on that service. Use a TLS-capable text protocol client for Serverless Memcached and batch multi-key reads within its 16 KB command limit. Test the Azure Enterprise proxy with its narrower multikey command set. Cross-region active-active deployments need separate consistency qualification. If an operation is blocked or unsafe in a topology, qualify an alternate implementation on that topology or keep the profile disabled. Never return synthetic success or silently route to another provider. [ElastiCache command restrictions](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/SupportedCommands.html), [Azure cross-slot restrictions](https://learn.microsoft.com/en-us/azure/redis/choose-clustering-policy#multikey-commands-and-crossslot-behavior)

## Data Model

The managed cache holds the versioned disposable entries, tags and metadata in the selected deployment namespace. It uses no Mercato SQL table or per-tenant credential store. Credentials and identity objects belong to runtime secret injection and client connection state. Keep tokens, certificate material and connection strings out of persisted settings, logs and test reports.

## API Contracts

Use the same server-only provider extension, `CACHE_PROVIDER` selection, `CacheStrategy`, tenant wrapper and `cache` DI token. There are no new HTTP routes or ACL features. Normal application readiness and existing cache management and maintenance exercise the effective adapter. The provider's health probe is non-mutating and must return failure on missing access, DNS/TLS errors, or connectivity/auth timeouts.

## Implementation-time live verification

1. The cloud environment owner identifies an approved **non-production** instance for each profile, the engine/version, topology, cache data-plane endpoint, auth mode, trust requirements, and a runner with approved network reachability. Use a dedicated disposable backend or an owner-approved isolated test namespace and synthetic data. Resource provisioning, failover drills, rotation or other paid or disruptive changes require separate authorization.
2. The environment owner supplies auth during implementation through the approved CI secret store, workload identity/federation, or the approved local secret runner. For Azure supply the authorized Entra principal/data access assignment or a dedicated test access key. For AWS supply scoped IAM or Redis user access for applicable profiles and network permissions for Memcached. For Google supply the authorized workload identity/cache permission or standalone Redis AUTH secret. Keep TLS trust material in the approved runtime channel when it is not public. Do not request or copy secret values in chat, Git, PRs, command arguments, or artifacts.
3. Use a trusted protected verification job or explicitly authorized runner, separate from public PR jobs. Run the shared suite against two independent clients/processes where possible, verify cross-tenant/global/other-namespace isolation, and run representative app readiness and cache-based write invalidation. Cover real client auth, timeout, denied/expired credential, refresh or rotation across live connections, reconnect/topology discovery, applicable failover, and graceful close. Run the least-privilege command set and verify that log redaction survives supplied failure cases.
4. Record the package build/version, target engine/version, mode, auth kind, verification date, runner/job reference, per-test totals and pass/fail status. Report generic profile IDs and stable error codes only. Clean up by namespace and verify no remaining fixtures, or document the test TTL and expiry check where cleanup could not finish. Missing credentials, missing network access or disallowed drills are blocked evidence for the profile. Container and mock tests continue as independent preflight.
5. Promotion is per supported profile. Positive credential tests using another service, a local emulator, or connectivity alone never satisfy the live gate. Re-run affected live profiles when supported SDK, auth flow, topology routing, allowlist or wire behavior changes.

## Migration & Backward Compatibility

Managed providers are explicit opt-ins. Apply the coordinated rollout and rollback from the OSS extension spec. Keep each deployment on a single effective provider and use a new namespace when switching storage layout or service. Check credential and network reachability before cutover. Preserve the maintained target while rolling back, then expire or remove only its authorized namespace when appropriate. Existing stock Redis and its settings continue to follow the legacy behavior.

## Risks & Impact Review

| Scenario | Severity and affected area | Mitigation and residual risk |
|---|---|---|
| Short-lived credentials expire during a pool reconnect or on a newly discovered shard | High · readiness and cache consumers | Test refresh, reconnection and steady-state permissions across all applicable connections. Bound retries and propagate safe failures. Identity or network outages can still make cache operations unavailable. |
| A managed service accepts Redis commands selectively or returns stale replica data | High · invalidation correctness | Use the topology-specific client and prove all required operations on the actual data-plane endpoint, including partial failures. Block unsupported combinations. Failover may still discard recent writes under the service's replication policy. |
| A cloud-only package or credentials ship in public artifacts | High · Enterprise licensing and data access | Inspect public tarballs/dependency graphs. Opt in through commercial packaging and use protected secret injection. Verify redaction against failure output. |
| The test account has broad permissions or runs against a production cache | High · cloud resources and tenants | Require an owner-approved sandbox and scoped credentials and namespace. Use synthetic data, deadline-limited tests and scoped cleanup. Disruptive cases require a dedicated approved environment. |
| Authentication and reachability block real verification | Medium · support claims and delivery schedule | Prepare tests and run preflight without secrets. Track blocked profiles individually and promote only with live evidence. |

## Phasing

1. Establish commercial packaging, the activation boundary and the protected live harness on top of the shared v1 extension.
2. Deliver Azure Managed Redis as its live profiles qualify.
3. Deliver Amazon ElastiCache and Google Cloud Memorystore independently. Add each engine/topology/auth profile as its own live gate passes.

## Implementation Plan

### Phase 1 — Packaging and live harness

1. Pin OSS and Enterprise default install behavior, then prove an official commercial fixture cannot load or connect without activation. Verify the runtime gate on web, worker and cache maintenance.
2. Establish the commercial release manifests, one protected runbook per provider and a conformance harness driven by explicit approved sandbox profiles. Prove missing-secret output is actionable and fully redacted.

### Phase 2 — Azure

1. Build the Azure package and qualify the Non-clustered and OSS clustering profiles with Entra identity, TLS and refresh tests.
2. Qualify the Enterprise proxy policy with its allowed command set, then activate only the tested policy/auth combinations in package settings and docs.

### Phase 3 — AWS and Google

1. Build ElastiCache and qualify the node-based and Serverless Valkey, Redis OSS and Memcached paths. Release only profiles with remote conformance evidence.
2. Build Memorystore and qualify Valkey, Redis and Redis Cluster profiles independently, exercising the corresponding identity, discovery and certificate requirements.
3. Record profile-by-profile compatibility, verified evidence and operator configuration. Archive the landed Delta into `.ai/specs/enterprise/capabilities/managed-cloud-cache-providers.md` as requirements ship.

## Final Compliance Report — 2026-11-24

| Rule source | Spec coverage |
|---|---|
| Enterprise and spec guides | Official managed providers are optional commercial packages with runtime activation. The shared extension and OSS engines are covered by the companion specification. |
| Cache and core guides | Existing DI, tenant scope and tag invalidation apply. Support requires actual managed-service validation, including failure and lifecycle paths. |
| QA and compatibility guides | Live tests are separately authorized and gated, keep isolated fixtures and use secret injection. Existing contracts and stock paths are covered by the shared specification. |

**Design status** · Proposed. Commercial support is pending implementation, sandbox access, and live evidence for each advertised profile.

## Changelog

- 2026-11-24 · Drafted commercial package boundaries, managed service profiles, and credentialed verification gates.
