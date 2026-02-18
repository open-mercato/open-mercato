# SPEC-ENT-002: Open Mercato Enterprise Health Endpoints (`live`, `ready`)

**Date:** 2026-02-17  
**Status:** Draft  
**Edition:** Enterprise  
**Scope:** Enterprise Edition runtime probes (public API endpoints)

## Overview
Open Mercato Enterprise needs first-class liveness/readiness endpoints for deployment health checks. Today, the app has an authenticated system-status API (`/api/configs/system-status`) intended for operators, not orchestrator probes.

This spec introduces probe-grade endpoints with explicit semantics:
- `live` indicates process health only.
- `ready` indicates whether the instance can safely serve traffic.

The primary purpose of this feature is to enable stable infrastructure deployment orchestration across environments (local, staging, production). With explicit `live` and `ready` probes, orchestrators and load balancers can make deterministic decisions about startup sequencing, traffic routing, restarts, and rollout safety, which reduces failed deployments, unhealthy traffic shifts, and probe-related flapping during releases.

## TLDR
**Key Points:**
- Introduce two public health probe endpoints for infrastructure:
  - `GET /api/health/live` returns plain `ok` with HTTP `200`
  - `GET /api/health/ready` returns readiness status based on service connectivity checks
- `live` must be dependency-free and constant-time.
- `ready` must validate core runtime dependencies (database, cache) and report configured external dependencies (queue Redis, search, KMS) with explicit check status.

**Scope:**
- New enterprise module API routes exposed by Enterprise Edition
- Shared readiness check contract and evaluator (enterprise module-local implementation)
- Integration tests for both endpoints and readiness failure behavior

**Concerns:**
- False negatives from transient external dependencies could flap readiness
- Need clear required-vs-optional check semantics to avoid accidental traffic drain

> **Market Reference**: Kubernetes probe semantics (`livenessProbe` vs `readinessProbe`) and Spring Boot Actuator health groups.  
> **Adopted**: strict split between "process alive" and "dependency readiness".  
> **Rejected**: single overloaded `/health` endpoint without role separation.

## Enterprise Availability
- This feature is Enterprise Edition only and must be implemented in `packages/enterprise`.
- The endpoints stay at `GET /api/health/live` and `GET /api/health/ready` but are registered by the enterprise `health` module.
- OSS builds do not include this module or these probe endpoints.

## Problem Statement
- There is no stable, public endpoint for load balancers/orchestrators to determine if an Open Mercato instance is alive.
- There is no endpoint that checks critical connectivity (database/cache) before the instance receives traffic.
- Existing APIs are either authenticated or too broad (environment/status views), and are not suitable for infrastructure probes.

## Proposed Solution
Add two enterprise module API routes:
- `packages/enterprise/src/modules/health/api/get/health/live.ts`
- `packages/enterprise/src/modules/health/api/get/health/ready.ts`

Add an enterprise module-local readiness evaluator:
- `packages/enterprise/src/modules/health/lib/readiness.ts` (exact path can vary)

Design goals:
- No auth required for probes
- Small deterministic response payloads
- Fast failure with bounded per-check timeout
- Distinguish required checks (`database`, `cache`) from optional checks (`queueRedis`, `searchFulltext`, `kms`)

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Separate `live` and `ready` routes | Matches platform standards and avoids mixed semantics |
| Keep route implementation in `packages/enterprise/src/modules/health` | Feature is Enterprise Edition functionality and should be discoverable via module auto-loading |
| Required checks drive HTTP code | `503` only when required checks fail |
| Optional checks reported but not traffic-blocking by default | Avoid unnecessary downtime while still exposing dependency health |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Reuse `/api/configs/system-status` | Auth-protected, operator-oriented, not probe-safe |
| One `/api/health` endpoint with mixed payload | Ambiguous semantics for infra tools |
| Fail readiness on any external degradation | Too strict for optional/fallback-enabled dependencies |

## User Stories / Use Cases
- As platform infrastructure, I want a liveness endpoint returning `200` quickly so restart policies can detect crashed processes.
- As a load balancer, I want readiness checks for core dependencies so traffic is sent only to healthy instances.
- As operations, I want structured dependency status in readiness responses to diagnose startup/runtime degradation quickly.

## Architecture
### Runtime Flow
1. `GET /api/health/live`
2. Route returns `ok` with `200` immediately (no container/DB/cache access)

1. `GET /api/health/ready`
2. Route calls readiness evaluator
3. Evaluator runs checks with timeout budget and captures status/latency/error per check
4. Response returns:
   - HTTP `200` when all required checks pass
   - HTTP `503` when any required check fails
   - JSON body with per-check results

### Check Matrix
| Check | Required | Mechanism |
|------|--------|--------|
| `database` | Yes | Resolve request container + execute lightweight DB probe (`SELECT 1`) via `EntityManager` connection |
| `cache` | Yes | Resolve `cache` strategy and execute `stats()` (or equivalent lightweight call) |
| `queueRedis` | Conditional | When `QUEUE_STRATEGY=async` (or equivalent), probe Redis connectivity used by queue strategy |
| `searchFulltext` | Conditional | When fulltext driver is configured, invoke strategy availability/health check |
| `kms` | Conditional | When tenant encryption is enabled, evaluate `kmsService.isHealthy()` |

### Detailed Service List For `ready`
1. `database` (PostgreSQL via MikroORM)
- Required: yes
- Why: Open Mercato cannot serve business APIs without DB access
- Check: run `SELECT 1` through request-scoped `EntityManager`/connection
- Timeout target: 500 ms
- On failure: mark `fail`, return HTTP `503`
- Env control:
  - `HEALTH_READY_CHECK_DATABASE_ENABLED=true|false` (default `true`)

2. `cache` (resolved DI cache strategy: memory/sqlite/redis/jsonfile)
- Required: yes
- Why: app bootstraps and many read paths expect cache abstraction to be available
- Check: resolve `cache` from DI and run `stats()` (or `has`/`get` noop probe)
- Timeout target: 300 ms
- On failure: mark `fail`, return HTTP `503`
- Env control:
  - `HEALTH_READY_CHECK_CACHE_ENABLED=true|false` (default `true`)

3. `cacheRedisBackend` (only when `CACHE_STRATEGY=redis`)
- Required: no
- Why: distinguish generic cache abstraction health from actual Redis backend connectivity
- Check: perform lightweight Redis-backed cache operation through cache service
- Timeout target: 300 ms
- On failure: mark `degraded` (unless deployment policy promotes it to required)
- Env control:
  - `HEALTH_READY_CHECK_CACHE_REDIS_BACKEND_ENABLED=true|false` (default `auto`)

4. `queueRedis` (only when `QUEUE_STRATEGY=async`)
- Required: no (default); recommended required in queue-heavy deployments
- Why: async events/workers depend on Redis queue infrastructure
- Check: create lightweight queue client probe (`getJobCounts` on dedicated health queue or minimal Redis ping through queue stack)
- Timeout target: 500 ms
- On failure: mark `degraded` by default; optionally `fail` via policy flag
- Env control:
  - `HEALTH_READY_CHECK_QUEUE_REDIS_ENABLED=true|false` (default `auto`)

5. `searchFulltext` (only when fulltext strategy/driver is configured)
- Required: no
- Why: search is auxiliary for most core CRUD operations
- Check: resolve fulltext strategy and call `isAvailable()` / driver health
- Timeout target: 500 ms
- On failure: mark `degraded`
- Env control:
  - `HEALTH_READY_CHECK_SEARCH_FULLTEXT_ENABLED=true|false` (default `auto`)

6. `searchVector` (only when vector search is enabled in runtime config)
- Required: no
- Why: semantic search is optional capability
- Check: resolve vector strategy/provider availability without indexing work
- Timeout target: 500 ms
- On failure: mark `degraded`
- Env control:
  - `HEALTH_READY_CHECK_SEARCH_VECTOR_ENABLED=true|false` (default `auto`)

7. `kms` (only when tenant data encryption is enabled)
- Required: no (default)
- Why: KMS affects encryption key lifecycle; existing runtime can run with fallback/noop modes depending on env
- Check: resolve `kmsService` and evaluate `isHealthy()`
- Timeout target: 200 ms
- On failure: mark `degraded` with explicit message (`vault unavailable`, `fallback active`, etc.)
- Env control:
  - `HEALTH_READY_CHECK_KMS_ENABLED=true|false` (default `auto`)

8. `emailDelivery` (only when onboarding/notification email delivery is enabled)
- Required: no
- Why: email outages should not usually remove instance from traffic
- Check: validate provider configuration and run provider-specific lightweight connectivity test when supported
- Timeout target: 700 ms
- On failure: mark `degraded`
- Env control:
  - `HEALTH_READY_CHECK_EMAIL_DELIVERY_ENABLED=true|false` (default `auto`)

9. `externalAiProviders` (only when AI assistant features are enabled and configured)
- Required: no
- Why: AI tooling is additive, not required for baseline ERP operations
- Check: provider client lightweight status/auth check, no billable inference call
- Timeout target: 700 ms
- On failure: mark `degraded`
- Env control:
  - `HEALTH_READY_CHECK_EXTERNAL_AI_PROVIDERS_ENABLED=true|false` (default `auto`)

### Required-by-Default Checks
- `database`
- `cache`

### Optional-by-Default Checks
- `cacheRedisBackend`
- `queueRedis`
- `searchFulltext`
- `searchVector`
- `kms`
- `emailDelivery`
- `externalAiProviders`

### Requiredness Rule
- Requiredness is static in code/spec:
  - Required: `database`, `cache`
  - Optional: all other checks
- Env variables only control whether a check runs (`enabled`/`disabled`).

## Configuration
Readiness checks MUST be configurable via env so deployments can define which services are health-critical.

### Env Model
1. Per-check enable/disable flag:
- `HEALTH_READY_CHECK_<CHECK_KEY>_ENABLED=true|false`
- `auto` behavior means enabled only when the related subsystem is configured.

### Precedence Rules
1. If `*_ENABLED=false`, check is always skipped.
2. If `*_ENABLED=true`, check always runs.
3. If `*_ENABLED` is unset, `auto` rules determine run/skip.
4. Requiredness does not change via env:
- `database` and `cache` remain required.
- Other checks remain optional.

### Deployment Notes
- Production teams can tune readiness strictness without redeploying code.
- Recommended baseline: keep `database` and `cache` required.
- Promote `queueRedis` to required when async queue/event processing is mission-critical.

### Readiness Status Rules
- Overall `readyStatus`:
  - `ok`: all required checks pass, optional checks pass/skip
  - `degraded`: all required checks pass, at least one optional check fails
  - `fail`: any required check fails
- HTTP status:
  - `200` for `ok` and `degraded`
  - `503` for `fail`

### Orchestration Pattern (Strategy)
Readiness checks are orchestrated via Strategy Pattern:
1. Each service check implements one strategy interface.
2. Orchestrator constructor registers all available strategies.
3. Orchestrator executes them in a loop, one by one.
4. Results are aggregated into final readiness payload/status.

#### Strategy Interface (Example)
```ts
export type HealthCheckStatus = 'ok' | 'fail' | 'skip'

export type HealthCheckResult = {
  name: string
  required: boolean
  status: HealthCheckStatus
  latencyMs: number
  message: string | null
}

export interface ReadyCheckStrategy {
  readonly checkKey: string
  readonly required: boolean
  isEnabled(): boolean
  run(): Promise<HealthCheckResult>
}
```

#### Base Strategy Utility (Example)
```ts
export abstract class BaseReadyCheckStrategy implements ReadyCheckStrategy {
  constructor(
    public readonly checkKey: string,
    public readonly required: boolean,
  ) {}

  isEnabled(): boolean {
    const envKey = `HEALTH_READY_CHECK_${this.checkKey.toUpperCase()}_ENABLED`
    const raw = process.env[envKey]
    if (raw === undefined || raw === null || raw === '') return true
    return raw.toLowerCase() === 'true'
  }

  abstract run(): Promise<HealthCheckResult>
}
```

#### Concrete Strategies (Example)
```ts
export class DatabaseReadyCheckStrategy extends BaseReadyCheckStrategy {
  constructor(private readonly em: EntityManager) {
    super('database', true)
  }

  async run(): Promise<HealthCheckResult> {
    const startedAt = Date.now()
    try {
      await this.em.getConnection().execute('select 1')
      return { name: this.checkKey, required: this.required, status: 'ok', latencyMs: Date.now() - startedAt, message: null }
    } catch (error) {
      return { name: this.checkKey, required: this.required, status: 'fail', latencyMs: Date.now() - startedAt, message: 'database unavailable' }
    }
  }
}

export class CacheReadyCheckStrategy extends BaseReadyCheckStrategy {
  constructor(private readonly cache: CacheStrategy) {
    super('cache', true)
  }

  async run(): Promise<HealthCheckResult> {
    const startedAt = Date.now()
    try {
      await this.cache.stats()
      return { name: this.checkKey, required: this.required, status: 'ok', latencyMs: Date.now() - startedAt, message: null }
    } catch {
      return { name: this.checkKey, required: this.required, status: 'fail', latencyMs: Date.now() - startedAt, message: 'cache unavailable' }
    }
  }
}
```

#### Orchestrator (Register In Constructor + Loop Execution)
```ts
export type ReadinessResponse = {
  status: 'ok' | 'degraded' | 'fail'
  timestamp: string
  durationMs: number
  checks: HealthCheckResult[]
}

export class ReadinessOrchestrator {
  private readonly strategies: ReadyCheckStrategy[]

  constructor(deps: {
    em: EntityManager
    cache: CacheStrategy
    queueRedisStrategy?: ReadyCheckStrategy
    searchFulltextStrategy?: ReadyCheckStrategy
    searchVectorStrategy?: ReadyCheckStrategy
    kmsStrategy?: ReadyCheckStrategy
    emailDeliveryStrategy?: ReadyCheckStrategy
    externalAiProvidersStrategy?: ReadyCheckStrategy
  }) {
    // Register all available strategies once in constructor
    this.strategies = [
      new DatabaseReadyCheckStrategy(deps.em),
      new CacheReadyCheckStrategy(deps.cache),
      ...(deps.queueRedisStrategy ? [deps.queueRedisStrategy] : []),
      ...(deps.searchFulltextStrategy ? [deps.searchFulltextStrategy] : []),
      ...(deps.searchVectorStrategy ? [deps.searchVectorStrategy] : []),
      ...(deps.kmsStrategy ? [deps.kmsStrategy] : []),
      ...(deps.emailDeliveryStrategy ? [deps.emailDeliveryStrategy] : []),
      ...(deps.externalAiProvidersStrategy ? [deps.externalAiProvidersStrategy] : []),
    ]
  }

  async run(): Promise<ReadinessResponse> {
    const startedAt = Date.now()
    const checks: HealthCheckResult[] = []

    // Invoke strategies one by one in a loop
    for (const strategy of this.strategies) {
      if (!strategy.isEnabled()) {
        checks.push({
          name: strategy.checkKey,
          required: strategy.required,
          status: 'skip',
          latencyMs: 0,
          message: 'disabled by env',
        })
        continue
      }

      checks.push(await strategy.run())
    }

    const hasRequiredFail = checks.some((c) => c.required && c.status === 'fail')
    const hasOptionalFail = checks.some((c) => !c.required && c.status === 'fail')
    const status: ReadinessResponse['status'] = hasRequiredFail ? 'fail' : hasOptionalFail ? 'degraded' : 'ok'

    return {
      status,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      checks,
    }
  }
}
```

#### Route Usage (Example)
```ts
export async function GET() {
  const container = await createRequestContainer()
  const orchestrator = new ReadinessOrchestrator({
    em: container.resolve('em'),
    cache: container.resolve('cache'),
    kmsStrategy: container.hasRegistration('kmsService')
      ? new KmsReadyCheckStrategy(container.resolve('kmsService'))
      : undefined,
  })

  const result = await orchestrator.run()
  const statusCode = result.status === 'fail' ? 503 : 200
  return NextResponse.json(result, { status: statusCode })
}
```

## Data Models
No persistent schema/migrations.

In-memory response contracts:

### `HealthCheckResult` (Singular)
- `name`: `'database' | 'cache' | 'queueRedis' | 'searchFulltext' | 'kms'`
- `required`: boolean
- `status`: `'ok' | 'fail' | 'skip'`
- `latencyMs`: number
- `message`: string | null

### `ReadinessResponse` (Singular)
- `status`: `'ok' | 'degraded' | 'fail'`
- `timestamp`: ISO string
- `durationMs`: number
- `checks`: `HealthCheckResult[]`

## API Contracts
### Liveness
- `GET /api/health/live`
- Auth: none
- Request body: none
- Response:
  - `200 text/plain`: `ok`
- Errors:
  - none (route must not depend on external services)

### Readiness
- `GET /api/health/ready`
- Auth: none
- Request body: none
- Response:
  - `200 application/json` when required checks pass (including degraded optional checks)
  - `503 application/json` when required checks fail

Example `200`:
```json
{
  "status": "ok",
  "timestamp": "2026-02-17T12:00:00.000Z",
  "durationMs": 18,
  "checks": [
    { "name": "database", "required": true, "status": "ok", "latencyMs": 7, "message": null },
    { "name": "cache", "required": true, "status": "ok", "latencyMs": 2, "message": null },
    { "name": "queueRedis", "required": false, "status": "skip", "latencyMs": 0, "message": "QUEUE_STRATEGY is local" }
  ]
}
```

Example `503`:
```json
{
  "status": "fail",
  "timestamp": "2026-02-17T12:00:00.000Z",
  "durationMs": 120,
  "checks": [
    { "name": "database", "required": true, "status": "fail", "latencyMs": 100, "message": "timeout" },
    { "name": "cache", "required": true, "status": "ok", "latencyMs": 3, "message": null }
  ]
}
```

## Migration & Compatibility
- No DB migration.
- Backward compatible: adds new endpoints only.
- No changes to existing authenticated status APIs.

## Implementation Plan
### Phase 1: Endpoint Contract and Core Checks
1. Add `live` route returning `ok` and HTTP `200`.
2. Add readiness evaluator with `database` and `cache` checks.
3. Add `ready` route returning `200/503` based on required check outcomes.
4. Add bounded check timeouts and stable error mapping.

### Phase 2: External Dependency Coverage
1. Add conditional `queueRedis` check for async queue mode.
2. Add conditional `searchFulltext` check when fulltext strategy is configured.
3. Add conditional `kms` check when tenant encryption is enabled.
4. Mark optional failures as `degraded` (non-503 by default).

### Phase 3: Testing and Operationalization
1. Add integration tests for `live` and `ready` endpoint behavior.
2. Add tests for readiness failure path (required dependency failure -> `503`).
3. Document probe configuration for deployment manifests.
4. Update product documentation in `apps/docs` (health endpoint contracts, env flags, and deployment probe examples).

### File Manifest (Proposed)
| File | Action | Purpose |
|------|--------|---------|
| `packages/enterprise/src/modules/health/api/get/health/live.ts` | Create | Public liveness probe (Enterprise module) |
| `packages/enterprise/src/modules/health/api/get/health/ready.ts` | Create | Public readiness probe (Enterprise module) |
| `packages/enterprise/src/modules/health/lib/readiness.ts` | Create | Dependency check orchestration |
| `.ai/qa/tests/integration/enterprise/health/enterprise-health-endpoints.spec.ts` | Create | Health endpoint integration coverage |
| `apps/docs/**` | Modify | Document health endpoints, env configuration, and orchestration usage |

### Documentation Requirement
- MUST update docs in `apps/docs` as part of the same implementation PR.
- Docs must include:
  - `GET /api/health/live` and `GET /api/health/ready` contract
  - readiness response schema (`ok` / `degraded` / `fail`)
  - per-check env flags (`HEALTH_READY_CHECK_<CHECK_KEY>_ENABLED`)
  - deployment probe examples (Kubernetes and/or container runtime)

### Integration Coverage (Required)
- `GET /api/health/live` returns `200` + body `ok`
- `GET /api/health/ready` returns `200` when DB/cache checks pass
- `GET /api/health/ready` returns `503` when DB check fails (mocked/controlled failure path)
- `GET /api/health/ready` keeps `200` with `status=degraded` when only optional checks fail
