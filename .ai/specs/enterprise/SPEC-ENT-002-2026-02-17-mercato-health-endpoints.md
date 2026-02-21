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
- `ready` must validate all enabled runtime dependencies and report each with explicit check status.

**Scope:**
- New enterprise module API routes exposed by Enterprise Edition
- Shared readiness check contract and evaluator (enterprise module-local implementation)
- Integration tests for both endpoints and readiness failure behavior

**Concerns:**
- False negatives from transient external dependencies could flap readiness
- Enabling too many checks without tuning timeouts could slow readiness response

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
- All checks run or skip based solely on `HEALTH_READY_CHECK_<KEY>_ENABLED` env flag

### Design Decisions
| Decision | Rationale |
|----------|-----------|
| Separate `live` and `ready` routes | Matches platform standards and avoids mixed semantics |
| Keep route implementation in `packages/enterprise/src/modules/health` | Feature is Enterprise Edition functionality and should be discoverable via module auto-loading |
| Any enabled failed check drives HTTP code | `503` when any enabled check fails |
| Checks enabled/disabled via env only | No required/optional distinction — all checks are equal; behaviour controlled purely by `ENABLED` flag |

### Alternatives Considered
| Alternative | Why Rejected |
|-------------|-------------|
| Reuse `/api/configs/system-status` | Auth-protected, operator-oriented, not probe-safe |
| One `/api/health` endpoint with mixed payload | Ambiguous semantics for infra tools |
| Fail readiness only on core dependency degradation | All enabled checks are equal — operators choose which to enable |

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
3. Evaluator runs all enabled checks in parallel with timeout budget, captures status/latency/error per check
4. Response returns:
   - HTTP `200` when all enabled checks pass
   - HTTP `503` when any enabled check fails
   - JSON body with per-check results

### Check Matrix
| Check | Mechanism |
|------|--------|
| `database` | Execute lightweight DB probe (`SELECT 1`) via `EntityManager` connection |
| `cache` | Execute `stats()` (or equivalent lightweight call) via resolved `cache` strategy |
| `queueRedis` | Probe Redis connectivity used by queue strategy |
| `searchFulltext` | Invoke fulltext strategy availability/health check |
| `kms` | Evaluate `kmsService.isHealthy()` |

Whether each check runs and whether its failure blocks traffic (HTTP 503) is controlled exclusively by env variables — see Configuration.

### Detailed Service List For `ready`
1. `database` (PostgreSQL via MikroORM)
- Check: run `SELECT 1` through request-scoped `EntityManager`/connection
- Timeout target: 500 ms
- Env control:
  - `HEALTH_READY_CHECK_DATABASE_ENABLED=true|false` (default `true`)
  - `HEALTH_READY_CHECK_DATABASE_TIMEOUT_MS` (default `500`)

2. `cache` (resolved DI cache strategy: memory/sqlite/redis/jsonfile)
- Check: resolve `cache` from DI and run `stats()` (or `has`/`get` noop probe)
- Timeout target: 300 ms
- Env control:
  - `HEALTH_READY_CHECK_CACHE_ENABLED=true|false` (default `true`)
  - `HEALTH_READY_CHECK_CACHE_TIMEOUT_MS` (default `300`)

3. `cacheRedisBackend`
- Check: perform lightweight Redis-backed cache operation through cache service
- Timeout target: 300 ms
- Env control:
  - `HEALTH_READY_CHECK_CACHE_REDIS_BACKEND_ENABLED=true|false` (default `false`)
  - `HEALTH_READY_CHECK_CACHE_REDIS_BACKEND_TIMEOUT_MS` (default `300`)

4. `queueRedis`
- Check: create lightweight queue client probe (`getJobCounts` on dedicated health queue or minimal Redis ping through queue stack)
- Timeout target: 500 ms
- Env control:
  - `HEALTH_READY_CHECK_QUEUE_REDIS_ENABLED=true|false` (default `false`)
  - `HEALTH_READY_CHECK_QUEUE_REDIS_TIMEOUT_MS` (default `500`)

5. `searchFulltext`
- Check: resolve fulltext strategy and call `isAvailable()` / driver health
- Timeout target: 500 ms
- Env control:
  - `HEALTH_READY_CHECK_SEARCH_FULLTEXT_ENABLED=true|false` (default `false`)
  - `HEALTH_READY_CHECK_SEARCH_FULLTEXT_TIMEOUT_MS` (default `500`)

6. `searchVector`
- Check: resolve vector strategy/provider availability without indexing work
- Timeout target: 500 ms
- Env control:
  - `HEALTH_READY_CHECK_SEARCH_VECTOR_ENABLED=true|false` (default `false`)
  - `HEALTH_READY_CHECK_SEARCH_VECTOR_TIMEOUT_MS` (default `500`)

7. `kms`
- Check: resolve `kmsService` and evaluate `isHealthy()`
- Timeout target: 200 ms
- Env control:
  - `HEALTH_READY_CHECK_KMS_ENABLED=true|false` (default `false`)
  - `HEALTH_READY_CHECK_KMS_TIMEOUT_MS` (default `200`)

8. `emailDelivery`
- Check: validate provider configuration and run provider-specific lightweight connectivity test when supported
- Timeout target: 700 ms
- Env control:
  - `HEALTH_READY_CHECK_EMAIL_DELIVERY_ENABLED=true|false` (default `false`)
  - `HEALTH_READY_CHECK_EMAIL_DELIVERY_TIMEOUT_MS` (default `700`)

9. `externalAiProviders`
- Check: provider client lightweight status/auth check, no billable inference call
- Timeout target: 700 ms
- Env control:
  - `HEALTH_READY_CHECK_EXTERNAL_AI_PROVIDERS_ENABLED=true|false` (default `false`)
  - `HEALTH_READY_CHECK_EXTERNAL_AI_PROVIDERS_TIMEOUT_MS` (default `700`)

### Env-Controlled Defaults
Each check has a code-level default for `enabled`. This default can be overridden via env variable — no code changes needed. The table below lists the shipped defaults:

| Check | `ENABLED` default |
|-------|-------------------|
| `database` | `true` |
| `cache` | `true` |
| `cacheRedisBackend` | `false` |
| `queueRedis` | `false` |
| `searchFulltext` | `false` |
| `searchVector` | `false` |
| `kms` | `false` |
| `emailDelivery` | `false` |
| `externalAiProviders` | `false` |

`ENABLED` accepts only `true` or `false`. No `auto` mode exists.

## Configuration
Readiness checks MUST be configurable via env so deployments can define which services are health-critical.

### Env Model
1. Per-check enable flag:
- `HEALTH_READY_CHECK_<CHECK_KEY>_ENABLED=true|false`
- Accepted values: `true` or `false` only. Unset behaves as the code-level default.
- When `false`, the check is skipped and reported with `status: skip`.

2. Global timeout (total readiness budget):
- `HEALTH_READY_TOTAL_TIMEOUT_MS` — hard wall-clock deadline for the entire readiness run (default: `1500`).

3. Per-check timeout overrides:
- `HEALTH_READY_CHECK_<CHECK_KEY>_TIMEOUT_MS` — overrides the in-code default for that check.
- Example: `HEALTH_READY_CHECK_DATABASE_TIMEOUT_MS=500`, `HEALTH_READY_CHECK_CACHE_TIMEOUT_MS=300`.
- Effective per-check timeout is `min(envOverride ?? codeDefault, remainingGlobalBudget)`.

4. Optional result TTL cache:
- `HEALTH_READY_CACHE_TTL_MS` — when set, the orchestrator returns a cached `ReadinessResponse` if the last result is younger than this value (in milliseconds). Reduces dependency load at high probe frequency. Disabled by default (unset).

### Precedence Rules
1. If `*_ENABLED=false`, check is always skipped.
2. If `*_ENABLED=true`, check always runs.
3. If `*_ENABLED` is unset, the code-level default applies.
4. Timeout precedence: env override → code default → remaining global budget (whichever is smallest wins).

### Deployment Notes
- Production teams can enable or disable any check without redeploying code.
- To enable an additional check: set `HEALTH_READY_CHECK_QUEUE_REDIS_ENABLED=true`.
- To disable a default-enabled check: set `HEALTH_READY_CHECK_DATABASE_ENABLED=false` (use with caution).
- Set `HEALTH_READY_CACHE_TTL_MS=2000` to protect dependencies under high-frequency Kubernetes liveness polling.

### Readiness Status Rules
- Overall `readyStatus`:
  - `ok`: all enabled checks pass or are skipped
  - `fail`: any enabled check fails
- HTTP status:
  - `200` for `ok`
  - `503` for `fail`

### Orchestration Pattern (Strategy)
Readiness checks are orchestrated via Strategy Pattern:
1. Each service check implements one strategy interface.
2. Orchestrator constructor registers all available strategies.
3. Orchestrator executes all enabled checks **in parallel** with per-check and global timeouts.
4. Results are aggregated into final readiness payload/status.

#### Parallel Execution with Timeouts
The orchestrator enforces two layers of timeout protection:

- **Per-check timeout**: each strategy runs inside a `Promise.race` against its own deadline. Computed as `min(perCheckDefault, remainingGlobalBudget)`.
- **Global deadline**: a single `HEALTH_READY_TOTAL_TIMEOUT_MS` deadline wraps all checks. Checks still running when the deadline fires are immediately marked `fail` with `"global timeout exceeded"`.

Execution steps:
1. Compute `deadline = Date.now() + HEALTH_READY_TOTAL_TIMEOUT_MS`.
2. Launch all enabled checks concurrently (`Promise.allSettled` or equivalent).
3. Each check resolves within its per-check timeout or returns `fail`.
4. `Promise.race` between all-settled and global deadline marks any remaining in-flight checks as `fail`.
5. Aggregate results and compute final status.

#### Strategy Interface (Example)
```ts
export type HealthCheckStatus = 'ok' | 'fail' | 'skip'

export type HealthCheckResult = {
  name: string
  status: HealthCheckStatus
  latencyMs: number
  message: string | null
}

export interface ReadyCheckStrategy {
  readonly checkKey: string
  isEnabled(): boolean
  resolveTimeoutMs(): number
  run(): Promise<HealthCheckResult>
}
```

#### Base Strategy Utility (Example)
```ts
export abstract class BaseReadyCheckStrategy implements ReadyCheckStrategy {
  constructor(
    public readonly checkKey: string,
    private readonly defaultEnabled: boolean,
    private readonly defaultTimeoutMs: number,
  ) {}

  isEnabled(): boolean {
    const envKey = `HEALTH_READY_CHECK_${this.checkKey.toUpperCase()}_ENABLED`
    const raw = process.env[envKey]
    if (raw === undefined || raw === null || raw === '') return this.defaultEnabled
    return raw.toLowerCase() === 'true'
  }

  resolveTimeoutMs(): number {
    const envKey = `HEALTH_READY_CHECK_${this.checkKey.toUpperCase()}_TIMEOUT_MS`
    const raw = process.env[envKey]
    if (raw === undefined || raw === null || raw === '') return this.defaultTimeoutMs
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : this.defaultTimeoutMs
  }

  abstract run(): Promise<HealthCheckResult>
}
```

#### Concrete Strategies (Example)
```ts
export class DatabaseReadyCheckStrategy extends BaseReadyCheckStrategy {
  constructor(private readonly em: EntityManager) {
    // defaults: enabled=true, timeout=500ms
    super('database', true, 500)
  }

  async run(): Promise<HealthCheckResult> {
    const startedAt = Date.now()
    try {
      await this.em.getConnection().execute('select 1')
      return { name: this.checkKey, status: 'ok', latencyMs: Date.now() - startedAt, message: null }
    } catch {
      return { name: this.checkKey, status: 'fail', latencyMs: Date.now() - startedAt, message: 'database unavailable' }
    }
  }
}

export class CacheReadyCheckStrategy extends BaseReadyCheckStrategy {
  constructor(private readonly cache: CacheStrategy) {
    // defaults: enabled=true, timeout=300ms
    super('cache', true, 300)
  }

  async run(): Promise<HealthCheckResult> {
    const startedAt = Date.now()
    try {
      await this.cache.stats()
      return { name: this.checkKey, status: 'ok', latencyMs: Date.now() - startedAt, message: null }
    } catch {
      return { name: this.checkKey, status: 'fail', latencyMs: Date.now() - startedAt, message: 'cache unavailable' }
    }
  }
}
```

#### Orchestrator (Parallel Execution with Global Deadline)
```ts
export type ReadinessResponse = {
  status: 'ok' | 'fail'
  timestamp: string
  durationMs: number
  checks: HealthCheckResult[]
}

const DEFAULT_TOTAL_TIMEOUT_MS = 1500

function resolveGlobalTimeoutMs(): number {
  const raw = process.env['HEALTH_READY_TOTAL_TIMEOUT_MS']
  if (!raw) return DEFAULT_TOTAL_TIMEOUT_MS
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TOTAL_TIMEOUT_MS
}

function withTimeout(promise: Promise<HealthCheckResult>, timeoutMs: number, strategy: ReadyCheckStrategy): Promise<HealthCheckResult> {
  const startedAt = Date.now()
  return Promise.race([
    promise,
    new Promise<HealthCheckResult>((resolve) =>
      setTimeout(() => resolve({
        name: strategy.checkKey,
        status: 'fail',
        latencyMs: Date.now() - startedAt,
        message: 'check timeout exceeded',
      }), timeoutMs),
    ),
  ])
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
    const totalTimeoutMs = resolveGlobalTimeoutMs()
    const deadline = startedAt + totalTimeoutMs

    const skipped: HealthCheckResult[] = []
    const pending: Array<{ strategy: ReadyCheckStrategy; promise: Promise<HealthCheckResult> }> = []

    for (const strategy of this.strategies) {
      if (!strategy.isEnabled()) {
        skipped.push({
          name: strategy.checkKey,
          status: 'skip',
          latencyMs: 0,
          message: 'disabled by env',
        })
        continue
      }

      const remaining = deadline - Date.now()
      const perCheckTimeout = Math.min(strategy.resolveTimeoutMs(), Math.max(remaining, 0))
      pending.push({ strategy, promise: withTimeout(strategy.run(), perCheckTimeout, strategy) })
    }

    // Race all checks against the global deadline
    const globalTimeoutResult = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), Math.max(deadline - Date.now(), 0)),
    )

    const settled = await Promise.race([
      Promise.all(pending.map((p) => p.promise)),
      globalTimeoutResult,
    ])

    let resolved: HealthCheckResult[]
    if (settled === null) {
      // Global deadline fired — mark any unresolved checks as failed
      resolved = pending.map(({ strategy }) => ({
        name: strategy.checkKey,
        status: 'fail' as const,
        latencyMs: Date.now() - startedAt,
        message: 'global timeout exceeded',
      }))
    } else {
      resolved = settled
    }

    const checks = [...skipped, ...resolved]
    const hasFail = checks.some((c) => c.status === 'fail')
    const status: ReadinessResponse['status'] = hasFail ? 'fail' : 'ok'

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
- `status`: `'ok' | 'fail' | 'skip'`
- `latencyMs`: number
- `message`: string | null

### `ReadinessResponse` (Singular)
- `status`: `'ok' | 'fail'`
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
  - `200 application/json` when all enabled checks pass
  - `503 application/json` when any enabled check fails

Example `200`:
```json
{
  "status": "ok",
  "timestamp": "2026-02-17T12:00:00.000Z",
  "durationMs": 18,
  "checks": [
    { "name": "database", "status": "ok", "latencyMs": 7, "message": null },
    { "name": "cache", "status": "ok", "latencyMs": 2, "message": null },
    { "name": "queueRedis", "status": "skip", "latencyMs": 0, "message": "disabled by env" }
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
    { "name": "database", "status": "fail", "latencyMs": 100, "message": "database unavailable" },
    { "name": "cache", "status": "ok", "latencyMs": 3, "message": null }
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
  - timeout env flags (`HEALTH_READY_TOTAL_TIMEOUT_MS`, `HEALTH_READY_CHECK_<CHECK_KEY>_TIMEOUT_MS`, `HEALTH_READY_CACHE_TTL_MS`)
  - deployment probe examples (Kubernetes and/or container runtime)

### Integration Coverage (Required)
- `GET /api/health/live` returns `200` + body `ok`
- `GET /api/health/ready` returns `200` with `status=ok` when all enabled checks pass
- `GET /api/health/ready` returns `503` with `status=fail` when any enabled check fails (mocked/controlled failure path)
- `GET /api/health/ready` skips a check with `status=skip` when its `ENABLED` flag is `false`
- `GET /api/health/ready` responds within `HEALTH_READY_TOTAL_TIMEOUT_MS` even when a check hangs (global deadline enforced)
- `GET /api/health/ready` marks a timed-out check as `fail` with `"global timeout exceeded"` or `"check timeout exceeded"` in `message`
- `GET /api/health/ready` returns a cached result within `HEALTH_READY_CACHE_TTL_MS` when TTL cache is enabled (verified via response `timestamp` unchanged)
