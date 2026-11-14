# Production encryption fail-closed

## TLDR

OpenMercato must not persist fields covered by an encryption map when production encryption is disabled, KMS is unhealthy, or a DEK cannot be resolved. Production configuration is validated during Core bootstrap, mapped writes fail before ORM persistence, and a public minimal readiness endpoint keeps an unhealthy replica out of service.

This is MIT Core infrastructure. It introduces no customer-specific configuration and no Enterprise dependency.

## Overview

The current encryption path is fail-open. `TenantDataEncryptionService.encryptEntityPayload()` returns the original payload when KMS or a DEK is unavailable, while bootstrap registers the MikroORM subscriber only when KMS is already healthy. A protected write can therefore reach PostgreSQL as plaintext during a configuration error or KMS outage.

The implementation follows the readiness separation described by the official Kubernetes probe guidance and keeps the response body minimal. Vault deployments use the existing KMS circuit breaker; the Vault health API remains the operator-level source for cluster health.

## Problem Statement

Four paths must be closed:

1. Production can start with `TENANT_DATA_ENCRYPTION=false`.
2. An unhealthy/no-op KMS prevents subscriber registration instead of preventing writes.
3. A missing tenant or system DEK returns plaintext to the ORM.
4. The fullapp production profile currently runs with `NODE_ENV=development` and a bundled development fallback key.

## Proposed Solution

### Required-mode policy

Encryption is required when `NODE_ENV=production`. `TENANT_DATA_ENCRYPTION_REQUIRED=true` enables the same policy in staging or tests. Production cannot opt out through an environment override.

Core bootstrap rejects required mode when encryption is disabled or KMS has no healthy Vault/derived-key path. Bootstrap errors propagate through request-container creation instead of being swallowed.

### Protected-write guard

The encryption subscriber is registered whenever encryption is enabled or required, including when KMS is unhealthy. The service resolves the map before deciding whether a write must be blocked:

- no map or no mapped value in the payload: unchanged;
- mapped value and encryption deliberately disabled outside required mode: legacy development behavior;
- mapped value and required encryption disabled, KMS unhealthy, or DEK unavailable: throw `TenantDataEncryptionUnavailableError` before persistence;
- healthy KMS and DEK: existing AES-GCM encryption path.

### Readiness

`GET /api/configs/health/ready` is public, unauthenticated and contains no configuration details. It returns:

- `200 { "status": "ready" }` when required runtime checks pass;
- `503 { "status": "not_ready", "check": "tenant_data_encryption" }` otherwise.

The Docker healthcheck uses this endpoint. This is readiness, not liveness: an unhealthy encryption dependency removes the replica from traffic without claiming the process is dead.

### Production fullapp profile

`compose.fullapp.yml` becomes an actual production runtime profile:

- `NODE_ENV=production` for app and MCP;
- no bundled data-encryption fallback key;
- a required non-default JWT secret;
- Vault variables forwarded to app and MCP;
- required encryption policy enabled;
- healthcheck targets the readiness endpoint.

`compose.fullapp.dev.yml` keeps the explicit development defaults.

## Architecture

```text
Core bootstrap
  -> validate required mode and KMS path
  -> register encryption subscriber even during KMS outage

ORM write
  -> resolve entity encryption map
  -> mapped value?
       no  -> persist normally
       yes -> resolve DEK
                available   -> encrypt, persist ciphertext
                unavailable -> throw, persist nothing

readiness probe
  -> request container / Core bootstrap
  -> encryption readiness
  -> 200 or 503
```

## Data Models

No database entity, column or migration changes.

## API Contracts

The readiness endpoint is additive. Existing API routes and successful response shapes do not change. A protected write that previously could persist plaintext now fails with the existing route-level error handling because the ORM flush throws.

No internal KMS state, tenant id, secret source or error detail is returned by readiness.

## Configuration

- `NODE_ENV=production`: always requires encryption.
- `TENANT_DATA_ENCRYPTION_REQUIRED=true`: enables required mode outside production.
- `TENANT_DATA_ENCRYPTION=true`: must remain enabled in required mode.
- `VAULT_ADDR` and `VAULT_TOKEN`, or `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`: provide a usable KMS path.

## Migration & Backward Compatibility

The new environment variable, error class, readiness type and endpoint are additive. Development behavior remains compatible by default.

Production behavior intentionally changes from fail-open to fail-closed. A production deployment without Vault or a dedicated fallback key must configure one before upgrading. No stored data is rewritten.

## Implementation Plan

1. Add required-mode parsing, configuration validation, typed write failure and readiness state in Shared.
2. Keep the encryption subscriber active during KMS failure and propagate required bootstrap errors in Core.
3. Add the public readiness route with unit and integration coverage.
4. Harden the production fullapp profile and update operator documentation.
5. Run focused tests, builds, generation and Compose validation, then commit as `OM-SEC-002`.

## Testing Strategy

- required policy in production and explicit non-production opt-in;
- bootstrap rejection for disabled encryption and unhealthy KMS;
- persistence guard for unhealthy KMS and missing DEK;
- unmapped payload remains writable;
- readiness `200`, `503` and bootstrap-failure paths;
- integration request to the generated readiness route;
- Docker Compose configuration renders only with required production secrets.

## Risks & Impact Review

#### KMS outage blocks mapped writes
- **Scenario**: Vault and the dedicated fallback are both unavailable.
- **Severity**: High
- **Affected area**: Writes to fields covered by encryption maps
- **Mitigation**: Fail before persistence, return unhealthy readiness, preserve unmapped operations, and support a stable dedicated fallback.
- **Residual risk**: Protected write availability follows KMS availability by design.

#### Existing production deployment lacks a dedicated key
- **Scenario**: A deployment relied on the bundled development fallback or no-op KMS.
- **Severity**: High
- **Affected area**: Startup and readiness after upgrade
- **Mitigation**: Clear startup error, production deployment template without hidden defaults, and documented Vault/fallback setup.
- **Residual risk**: Operators must supply and retain the root secret before upgrade.

#### Readiness causes traffic removal during a transient failure
- **Scenario**: KMS health briefly changes to unhealthy.
- **Severity**: Medium
- **Affected area**: Load balancer capacity
- **Mitigation**: Existing KMS recovery circuit breaker, Docker retries and readiness semantics instead of process termination.
- **Residual risk**: Remaining replicas carry more load during an outage.

## Final Compliance Report - 2026-08-20

### AGENTS.md Files Reviewed

- `AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/core/AGENTS.md`
- `.ai/specs/AGENTS.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix

| Rule source | Rule | Status | Notes |
|---|---|---|---|
| Root security rules | Never bypass encryption helpers | Compliant | Enforcement stays inside the shared encryption service and subscriber. |
| Shared rules | Infrastructure only | Compliant | Policy is generic and imports no domain package. |
| Core API rules | Route exports metadata and OpenAPI | Compliant | Readiness is additive, public and minimal. |
| Backward compatibility | Additive public contracts | Compliant | New env, endpoint, type and error; production failure behavior is an intentional security fix. |
| Tenant isolation | Do not cross tenant boundaries | Compliant | Existing per-call tenant/org map and DEK resolution remain unchanged. |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API | Pass | No data model change. |
| API matches deployment probe | Pass | Docker targets the new route. |
| Risks cover writes | Pass | KMS, DEK and deployment configuration failures are covered. |
| Cache behavior | Pass | Existing map and DEK caches remain unchanged. |

### Non-Compliant Items

None identified.

### Verdict

Fully compliant: approved for implementation.

## Changelog

### 2026-08-20

- Created and implemented the neutral MIT Core specification for `OM-SEC-002`.
- Review: security passed, performance passed, cache passed, commands N/A, risks passed. Verdict: approved.
- Validation: generation, Shared/Core builds, focused lint, 37 unit tests, `TC-CONF-007` integration test and production Compose rendering passed.
