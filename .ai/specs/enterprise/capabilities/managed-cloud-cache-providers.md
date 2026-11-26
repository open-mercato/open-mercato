# Capability: managed-cloud-cache-providers

Enterprise operators can install an official managed cloud cache adapter and activate it only in an enabled Enterprise deployment; a profile is advertised only after live evidence.

## Requirement: Enterprise managed adapter activation

Official managed adapters SHALL be individually installable through the commercial distribution path and activatable only in an enabled and authorized Enterprise deployment.

### Scenario: Enterprise adapter selected

- WHEN an Enterprise operator installs one official adapter, adds its registration to `src/providers/cache.ts`, enables Enterprise, and selects it with `CACHE_PROVIDER`
- THEN the deployment uses it for the same cache DI consumers and uses the provider-specific settings and health probe

### Scenario: Enterprise unavailable

- WHEN an official managed adapter is selected without Enterprise activation or its licensed distribution access
- THEN activation fails with an actionable sanitized diagnostic and no cloud connection or local fallback

Activation gate (2026-11-24): `OM_ENABLE_ENTERPRISE_MODULES` + `OM_ENABLE_ENTERPRISE_MODULES_CACHE_PROVIDERS`, checked before settings access, SDK import or client creation in web, worker and maintenance paths. Packages are private and Enterprise-licensed, excluded from the public publish set and default installs; the commercial registry publish path is pending release-owner definition.

Source: .ai/specs/enterprise/2026-11-24-managed-cloud-cache-providers.md

## Requirement: Verified managed profiles

The project SHALL mark a managed configuration supported after running cache conformance against that service with its actual engine, topology, auth profile and TLS configuration.

### Scenario: Sandbox profile lacks live evidence

- WHEN a profile has only mocks or self-hosted container evidence, or its live test could not run
- THEN the release records the specific profile as unverified and excludes it from the supported settings matrix

Status (2026-11-24): every first profile (Azure non-clustered + Entra + TLS; ElastiCache node-based Valkey cluster-mode-disabled + IAM + TLS; Memorystore for Valkey cluster-mode-enabled + IAM + TLS) passed container preflight only and is recorded unverified (blocked: no approved sandbox/credentials).

Source: .ai/specs/enterprise/2026-11-24-managed-cloud-cache-providers.md
