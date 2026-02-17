# SPEC-029: Rate Limiting Utility

## Overview

A reusable, strategy-based rate limiting utility for Open Mercato using [`rate-limiter-flexible`](https://github.com/animir/node-rate-limiter-flexible). The utility lives in `packages/shared` as a shared library, is configurable via environment variables, and is available both as a DI service and a global singleton. Rate limiting supports two enforcement models: **metadata-driven** (IP-based, automatic via the dispatcher) and **handler-level** (compound key, manual in the route handler). Auth endpoints use handler-level enforcement with compound `IP:email` keys for stronger credential stuffing protection. Primary motivation is protecting authentication endpoints (login, password reset) against brute-force and credential stuffing attacks.

## Goals

- Provide a reusable `RateLimiterService` that any module can consume via DI or the global `getCachedRateLimiterService()` singleton.
- Support two strategies: **in-memory** (development / single-instance) and **Redis** (production / distributed).
- Make the service globally configurable via three environment variables (enabled, strategy, default key prefix).
- **Dual enforcement model**:
  - **Metadata-driven** — route files declare `rateLimit` in their `metadata` export; the catch-all API dispatcher enforces it automatically with IP-based keys. Zero boilerplate in route handlers.
  - **Handler-level** — route handlers call `getCachedRateLimiterService()` + `checkRateLimit()` directly for advanced key strategies (e.g., compound `IP:email` keys). Wrapped in fail-open `try/catch`.
- Return standard `429 Too Many Requests` responses with `Retry-After` and `X-RateLimit-*` headers.
- Expose the service via DI for advanced use cases (e.g., resetting counters on successful login, per-challenge-token limiting for 2FA).
- Integrate into auth endpoints as the first consumer.

## Non-Goals

- Database-backed rate limiting (PostgreSQL, MongoDB) — not needed given Redis availability.
- Per-tenant rate limit configuration UI — can be added later.
- Global API gateway rate limiting — this is application-level, per-endpoint limiting.
- Rate limiting for all API endpoints — only authentication and security-critical endpoints in the first iteration.

---

## Architecture

### Library

[`rate-limiter-flexible`](https://www.npmjs.com/package/rate-limiter-flexible) v9.x — well-maintained, supports multiple backends, atomic operations, insurance (fallback) limiters, and TypeScript types out of the box.

**Key classes used:**

| Class | Backend | Use Case |
|-------|---------|----------|
| `RateLimiterMemory` | Process memory | Development, single-instance, fallback |
| `RateLimiterRedis` | Redis (via `ioredis`) | Production, multi-instance |

The library provides atomic `consume` operations with sliding window semantics, automatic key expiration, and a built-in insurance mechanism (fallback to memory when Redis is down).

### Dual Enforcement Model

Rate limiting supports two complementary enforcement paths:

#### Path 1: Metadata-Driven (Dispatcher)

The API catch-all dispatcher (`apps/mercato/src/app/api/[...slug]/route.ts`) supports automatic IP-based rate limiting via route metadata, following the same pattern as `requireAuth`/`requireFeatures`. Any endpoint can opt-in by declaring `rateLimit` in its `metadata` export:

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js Request: POST /api/some-endpoint                    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/mercato/src/app/api/[...slug]/route.ts               │
│                                                             │
│  1. findApi(modules, method, pathname)                      │
│  2. extractMethodMetadata(api.metadata, method)             │
│  3. checkAuthorization(metadata, auth, req)                 │
│  4. if metadata.rateLimit → checkRateLimit(IP key)  ← AUTO │
│  5. api.handler(req, context)                               │
└─────────────────────────────────────────────────────────────┘
```

Example metadata declaration:

```typescript
export const metadata = {
  POST: {
    rateLimit: { points: 10, duration: 60, keyPrefix: 'my-endpoint' },
  },
}
```

#### Path 2: Handler-Level (Manual)

Auth endpoints use handler-level enforcement for compound `IP:email` keys. This provides stronger credential stuffing protection because the key includes both the client IP and the target email address. The two-layer check logic is centralized in `checkAuthRateLimit` (`packages/core/src/modules/auth/lib/rateLimitCheck.ts`):

```typescript
// Two-layer rate limit — checked before validation and DB work
const { error: rateLimitError, compoundKey } = await checkAuthRateLimit({
  req, ipConfig: loginIpRateLimitConfig, compoundConfig: loginRateLimitConfig, compoundIdentifier: email,
})
if (rateLimitError) return rateLimitError

// ... on successful auth, reset compound counter:
if (compoundKey) {
  await resetAuthRateLimit(compoundKey, loginRateLimitConfig)
}
```

Auth endpoints use handler-level because:
1. They need compound `IP:emailHash` keys (email is hashed with `computeEmailHash()`, extracted from the request body before validation).
2. They export `metadata = {}` (empty) — no dispatcher-level rate limiting.
3. The centralizer wraps all checks in fail-open `try/catch` — infrastructure failures never block login/reset flows.
4. The IP-only layer prevents email-rotation bypass (an attacker submitting unique emails per request).

### Service Singleton Pattern

The `RateLimiterService` uses a `globalThis`-cached singleton pattern (same as the DI container registrars) to survive tsx/webpack module duplication:

```typescript
// packages/core/src/bootstrap.ts
const RL_GLOBAL_KEY = '__openMercatoRateLimiterService__'

export function getCachedRateLimiterService(): RateLimiterService | null {
  let service = (globalThis as any)[RL_GLOBAL_KEY] ?? null
  if (!service) {
    try {
      const rateLimitConfig = readRateLimitConfig()
      service = new RateLimiterService(rateLimitConfig)
      service.initialize().catch((err) => {
        console.warn('[ratelimit] Async initialization failed:', err?.message || err)
      })
      ;(globalThis as any)[RL_GLOBAL_KEY] = service
    } catch (err) {
      console.warn('[ratelimit] Failed to create rate limiter service:', err?.message || err)
    }
  }
  return service
}
```

Key points:
- Lazy-initialized on first access (not at module import time).
- Redis `initialize()` is fire-and-forget — memory strategy works synchronously, and Redis has an in-memory insurance limiter so the first few requests are still protected.
- Returns `null` on creation failure (callers must null-check).
- Also registered in the DI container during `bootstrap()` for modules that prefer DI resolution.

### Service Layer

```
┌─────────────────────────────────────────┐
│           RateLimiterService            │
│  ┌───────────────────────────────────┐  │
│  │  rate-limiter-flexible instance   │  │
│  │  (Memory or Redis + insurance)    │  │
│  └───────────────────────────────────┘  │
│                                         │
│  consume(key, config) → RateLimitResult  │
│  get(key, config)     → RateLimitResult  │
│  delete(key, config)  → void             │
│  penalty(key, n, cfg) → RateLimitResult  │
│  reward(key, n, cfg)  → RateLimitResult  │
│  block(key, sec, cfg) → void             │
└─────────────────────────────────────────┘
           │
     Two access paths:
           │
    ┌──────┴──────────────────┐
    │                         │
  getCachedRateLimiterService()   DI: 'rateLimiterService'
  (globalThis singleton)          (container-registered)
    │                         │
  Dispatcher + Handlers     Advanced use cases
```

### Insurance (Fallback)

When strategy is `redis` and Redis becomes unavailable, `rate-limiter-flexible` automatically falls back to an in-memory `insuranceLimiter`. This ensures rate limiting continues to function (per-instance) even during Redis outages. No custom fallback logic is needed.

---

## Environment Variables

Four variables control the rate limiter globally:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `boolean` | `true` | Master switch. When `false`, all rate limit checks are skipped (returns allowed). |
| `RATE_LIMIT_STRATEGY` | `'memory' \| 'redis'` | `memory` | Backend strategy. Use `redis` in production for distributed limiting. |
| `RATE_LIMIT_KEY_PREFIX` | `string` | `'rl'` | Default key prefix for all rate limiter keys. Prevents collisions with other Redis data. |
| `RATE_LIMIT_TRUST_PROXY_DEPTH` | `number` | `1` | Number of trusted reverse proxies for `X-Forwarded-For` IP extraction. `0` = ignore `X-Forwarded-For` entirely. |

### Redis Connection

When `RATE_LIMIT_STRATEGY=redis`, the service reads the Redis URL from the existing `REDIS_URL` environment variable (already used by cache, events, and queue modules). No additional Redis URL variable is needed.

### Per-Endpoint Configuration (Hardcoded Defaults, ENV Overridable)

Each protected endpoint defines its own limits. Default values are hardcoded but can be overridden via environment variables for operational flexibility:

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_LOGIN_POINTS` | `5` | Max login attempts per IP+account pair per window |
| `RATE_LIMIT_LOGIN_DURATION` | `60` | Window in seconds (1 min) |
| `RATE_LIMIT_LOGIN_BLOCK_DURATION` | `60` | Block duration after exceeding limit (1 min) |
| `RATE_LIMIT_LOGIN_IP_POINTS` | `20` | Max total login attempts per IP per window (regardless of email) |
| `RATE_LIMIT_LOGIN_IP_DURATION` | `60` | Window in seconds (1 min) |
| `RATE_LIMIT_LOGIN_IP_BLOCK_DURATION` | `60` | Block duration after exceeding IP limit (1 min) |
| `RATE_LIMIT_RESET_POINTS` | `3` | Max password reset requests per IP+account pair per window |
| `RATE_LIMIT_RESET_DURATION` | `60` | Window in seconds (1 min) |
| `RATE_LIMIT_RESET_BLOCK_DURATION` | `60` | Block duration after exceeding limit (1 min) |
| `RATE_LIMIT_RESET_IP_POINTS` | `10` | Max total reset requests per IP per window (regardless of email) |
| `RATE_LIMIT_RESET_IP_DURATION` | `60` | Window in seconds (1 min) |
| `RATE_LIMIT_RESET_IP_BLOCK_DURATION` | `60` | Block duration after exceeding IP limit (1 min) |
| `RATE_LIMIT_RESET_CONFIRM_POINTS` | `5` | Max password reset confirmation attempts per IP per window |
| `RATE_LIMIT_RESET_CONFIRM_DURATION` | `300` | Window in seconds (5 min) |
| `RATE_LIMIT_2FA_VERIFY_POINTS` | `5` | Max 2FA verification attempts per challenge |
| `RATE_LIMIT_2FA_VERIFY_DURATION` | `300` | Window in seconds (5 min) |

These are secondary — the three core variables above are the primary configuration surface.

---

## File Layout

```
packages/shared/src/lib/ratelimit/
├── index.ts                    # Public exports
├── types.ts                    # TypeScript types and interfaces
├── service.ts                  # RateLimiterService class
├── config.ts                   # Environment variable reading
├── helpers.ts                  # checkRateLimit + getClientIp utilities
└── __tests__/
    └── service.test.ts         # Unit tests
```

### Package Dependency

`rate-limiter-flexible` is in `packages/shared/package.json` dependencies:

```json
{
  "dependencies": {
    "rate-limiter-flexible": "^9.0.0"
  }
}
```

Redis client (`ioredis`) is already available in the monorepo (used by cache and queue). The `RateLimiterRedis` class accepts an `ioredis` client via `storeClient` — we dynamically import `ioredis` only when the redis strategy is selected (same pattern as `packages/cache/src/strategies/redis.ts`).

---

## Type Definitions

```typescript
// packages/shared/src/lib/ratelimit/types.ts

/** Per-endpoint rate limit configuration (used in route metadata and direct calls) */
export interface RateLimitConfig {
  /** Max points (requests) allowed in the window */
  points: number
  /** Window duration in seconds */
  duration: number
  /** Block duration in seconds after limit is exceeded (0 = no block, just reject) */
  blockDuration?: number
  /** Key prefix for this specific limiter (appended to global prefix) */
  keyPrefix?: string
}

/** Result of a rate limit check */
export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean
  /** Remaining points in the current window */
  remainingPoints: number
  /** Milliseconds until the current window resets */
  msBeforeNext: number
  /** Total points consumed in the current window */
  consumedPoints: number
}

/** Strategy for rate limit storage */
export type RateLimitStrategy = 'memory' | 'redis'

/** Global configuration read from environment */
export interface RateLimitGlobalConfig {
  enabled: boolean
  strategy: RateLimitStrategy
  keyPrefix: string
  redisUrl?: string
  /** Number of trusted reverse proxies for X-Forwarded-For IP extraction (default: 1) */
  trustProxyDepth: number
}
```

---

## Service Implementation

```typescript
// packages/shared/src/lib/ratelimit/service.ts

import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible'
import type { RateLimitConfig, RateLimitResult, RateLimitGlobalConfig } from './types'

export class RateLimiterService {
  private globalConfig: RateLimitGlobalConfig
  private limiters = new Map<string, RateLimiterMemory | RateLimiterRedis>()
  private redisClient: unknown | null = null
  readonly trustProxyDepth: number

  constructor(globalConfig: RateLimitGlobalConfig) {
    this.globalConfig = globalConfig
    this.trustProxyDepth = globalConfig.trustProxyDepth ?? 1
  }

  async initialize(): Promise<void> {
    if (this.globalConfig.strategy === 'redis' && this.globalConfig.redisUrl) {
      const { default: Redis } = await import('ioredis')
      this.redisClient = new Redis(this.globalConfig.redisUrl, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      })
    }
  }

  async consume(key: string, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.globalConfig.enabled) {
      return { allowed: true, remainingPoints: config.points, msBeforeNext: 0, consumedPoints: 0 }
    }

    const limiter = this.getOrCreateLimiter(config)

    try {
      const res = await limiter.consume(key, 1)
      return this.toResult(res, true)
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        return this.toResult(error, false)
      }
      return { allowed: true, remainingPoints: config.points, msBeforeNext: 0, consumedPoints: 0 }
    }
  }

  async get(key: string, config: RateLimitConfig): Promise<RateLimitResult | null> {
    if (!this.globalConfig.enabled) return null

    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.get(key)
    return res ? this.toResult(res, res.remainingPoints > 0) : null
  }

  async delete(key: string, config: RateLimitConfig): Promise<void> {
    const limiter = this.getOrCreateLimiter(config)
    await limiter.delete(key)
  }

  async penalty(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.globalConfig.enabled) {
      return { allowed: true, remainingPoints: config.points, msBeforeNext: 0, consumedPoints: 0 }
    }
    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.penalty(key, points)
    return this.toResult(res, res.remainingPoints > 0)
  }

  async reward(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.globalConfig.enabled) {
      return { allowed: true, remainingPoints: config.points, msBeforeNext: 0, consumedPoints: 0 }
    }
    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.reward(key, points)
    return this.toResult(res, true)
  }

  async block(key: string, durationSec: number, config: RateLimitConfig): Promise<void> {
    const limiter = this.getOrCreateLimiter(config)
    await limiter.block(key, durationSec)
  }

  async destroy(): Promise<void> {
    if (this.redisClient && typeof (this.redisClient as any).disconnect === 'function') {
      await (this.redisClient as any).disconnect()
    }
    this.limiters.clear()
  }

  // --- Private ---

  private getOrCreateLimiter(config: RateLimitConfig): RateLimiterMemory | RateLimiterRedis {
    const cacheKey = `${config.keyPrefix ?? 'default'}:${config.points}:${config.duration}:${config.blockDuration ?? 0}`

    let limiter = this.limiters.get(cacheKey)
    if (limiter) return limiter

    const prefix = [this.globalConfig.keyPrefix, config.keyPrefix].filter(Boolean).join(':')

    const baseOpts = {
      keyPrefix: prefix,
      points: config.points,
      duration: config.duration,
      blockDuration: config.blockDuration ?? 0,
    }

    if (this.globalConfig.strategy === 'redis' && this.redisClient) {
      const insuranceLimiter = new RateLimiterMemory(baseOpts)
      limiter = new RateLimiterRedis({
        ...baseOpts,
        storeClient: this.redisClient as any,
        insuranceLimiter,
        rejectIfRedisNotReady: false,
      })
    } else {
      limiter = new RateLimiterMemory(baseOpts)
    }

    this.limiters.set(cacheKey, limiter)
    return limiter
  }

  private toResult(res: RateLimiterRes, allowed: boolean): RateLimitResult {
    return {
      allowed,
      remainingPoints: Math.max(res.remainingPoints, 0),
      msBeforeNext: res.msBeforeNext,
      consumedPoints: res.consumedPoints,
    }
  }
}
```

---

## Configuration Reader

```typescript
// packages/shared/src/lib/ratelimit/config.ts

import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { RateLimitGlobalConfig, RateLimitStrategy } from './types'

const VALID_STRATEGIES: RateLimitStrategy[] = ['memory', 'redis']

export function readRateLimitConfig(): RateLimitGlobalConfig {
  const strategy = (process.env.RATE_LIMIT_STRATEGY ?? 'memory') as RateLimitStrategy
  if (!VALID_STRATEGIES.includes(strategy)) {
    throw new Error(`Invalid RATE_LIMIT_STRATEGY "${strategy}". Must be one of: ${VALID_STRATEGIES.join(', ')}`)
  }

  const trustProxyDepth = parsePositiveInt(process.env.RATE_LIMIT_TRUST_PROXY_DEPTH) ?? 1

  return {
    enabled: parseBooleanWithDefault(process.env.RATE_LIMIT_ENABLED, true),
    strategy,
    keyPrefix: process.env.RATE_LIMIT_KEY_PREFIX ?? 'rl',
    redisUrl: process.env.REDIS_URL,
    trustProxyDepth,
  }
}
```

---

## Helper Functions

```typescript
// packages/shared/src/lib/ratelimit/helpers.ts

import { NextResponse } from 'next/server'
import type { RateLimitConfig } from './types'
import type { RateLimiterService } from './service'

export const RATE_LIMIT_ERROR_KEY = 'api.errors.rateLimit'
export const RATE_LIMIT_ERROR_FALLBACK = 'Too many requests. Please try again later.'

/**
 * Check rate limit for a request. Returns a 429 NextResponse if rate limited, or null if allowed.
 * Rate limit headers (X-RateLimit-*, Retry-After) are only included on 429 responses.
 */
export async function checkRateLimit(
  rateLimiterService: RateLimiterService,
  config: RateLimitConfig,
  key: string,
  errorMessage: string,
): Promise<NextResponse | null> {
  const result = await rateLimiterService.consume(key, config)

  if (!result.allowed) {
    const retryAfterSec = Math.ceil(result.msBeforeNext / 1000)
    return NextResponse.json(
      { error: errorMessage },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(config.points),
          'X-RateLimit-Remaining': String(result.remainingPoints),
          'X-RateLimit-Reset': String(retryAfterSec),
        },
      },
    )
  }

  return null
}

/**
 * Extract client IP from a request, respecting reverse proxy trust depth.
 * Returns null when the IP cannot be determined (callers skip rate limiting).
 */
export function getClientIp(req: Request, trustProxyDepth: number = 0): string | null {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded && trustProxyDepth > 0) {
    const ips = forwarded.split(',').map((ip) => ip.trim())
    const clientIndex = ips.length - trustProxyDepth
    return clientIndex >= 0 ? ips[clientIndex] : ips[0]
  }
  return req.headers.get('x-real-ip') ?? null
}
```

---

## Public Exports

```typescript
// packages/shared/src/lib/ratelimit/index.ts

export { RateLimiterService } from './service'
export { readRateLimitConfig } from './config'
export { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK } from './helpers'
export type { RateLimitConfig, RateLimitResult, RateLimitStrategy, RateLimitGlobalConfig } from './types'
```

---

## Bootstrap & DI Registration

```typescript
// In packages/core/src/bootstrap.ts

import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'

// globalThis-cached singleton (survives tsx/webpack module duplication)
const RL_GLOBAL_KEY = '__openMercatoRateLimiterService__'

export function getCachedRateLimiterService(): RateLimiterService | null {
  let service = (globalThis as any)[RL_GLOBAL_KEY] as RateLimiterService | null ?? null
  if (!service) {
    try {
      const rateLimitConfig = readRateLimitConfig()
      service = new RateLimiterService(rateLimitConfig)
      // Fire-and-forget async init (only needed for Redis strategy;
      // memory strategy works synchronously, and Redis has an in-memory
      // insurance limiter so the first few requests are still protected)
      service.initialize().catch((err) => {
        console.warn('[ratelimit] Async initialization failed:', (err as Error)?.message || err)
      })
      ;(globalThis as any)[RL_GLOBAL_KEY] = service
    } catch (err) {
      console.warn('[ratelimit] Failed to create rate limiter service:', (err as Error)?.message || err)
    }
  }
  return service
}

// Inside bootstrap(container):
// Register the singleton into DI for modules that prefer container resolution
try {
  const rateLimiterService = getCachedRateLimiterService()
  if (rateLimiterService) {
    container.register({ rateLimiterService: asValue(rateLimiterService) })
  }
} catch (err) {
  console.warn('[ratelimit] Failed to initialize rate limiter service:', (err as Error)?.message || err)
}
```

---

## Dispatcher Integration

### Changes to `apps/mercato/src/app/api/[...slug]/route.ts`

#### 1. Imports

```typescript
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'
import { getCachedRateLimiterService } from '@open-mercato/core/bootstrap'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
```

#### 2. Extend `MethodMetadata` type

```typescript
type MethodMetadata = {
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
  rateLimit?: RateLimitConfig  // ← NEW
}
```

#### 3. Extract `rateLimit` from metadata

In `extractMethodMetadata()`, add parsing of the `rateLimit` field:

```typescript
if (source.rateLimit && typeof source.rateLimit === 'object') {
  const rl = source.rateLimit as Record<string, unknown>
  if (typeof rl.points === 'number' && typeof rl.duration === 'number') {
    normalized.rateLimit = {
      points: rl.points,
      duration: rl.duration,
      blockDuration: typeof rl.blockDuration === 'number' ? rl.blockDuration : undefined,
      keyPrefix: typeof rl.keyPrefix === 'string' ? rl.keyPrefix : undefined,
    }
  }
}
```

#### 4. Add `checkRateLimit` call in `handleRequest()`

Insert rate limit check between `checkAuthorization` and handler invocation:

```typescript
if (methodMetadata?.rateLimit) {
  const rateLimiterService = getCachedRateLimiterService()
  if (rateLimiterService) {
    const clientIp = getClientIp(req, rateLimiterService.trustProxyDepth)
    if (clientIp) {
      const rateLimitError = await checkRateLimit(
        rateLimiterService,
        methodMetadata.rateLimit,
        clientIp,
        t(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK),
      )
      if (rateLimitError) return rateLimitError
    }
  }
}
```

Key points:
- Rate limit check runs **after** auth but **before** the handler.
- Uses `getCachedRateLimiterService()` (global singleton), not DI container resolution. Null-check ensures graceful degradation if service creation failed.
- Uses `getClientIp(req)` for the rate limit key (IP-based for metadata-driven enforcement).
- Uses `t()` from the dispatcher's existing `resolveTranslations()` call.
- Returns `NextResponse` with 429 on rate limit exceeded, consistent with how auth errors return `NextResponse` with 401/403.

---

## Integration Points (Auth Endpoints)

Auth endpoints use **handler-level enforcement** (not metadata-driven) because they need compound `IP:emailHash` keys for credential stuffing protection. All three endpoints export `metadata = {}` (empty). Auth endpoints use **two-layer rate limiting**: an IP-only layer caps total attempts from one IP, and a compound `IP:emailHash` layer caps attempts per account. Emails are SHA-256 hashed via `computeEmailHash()` so raw emails never appear in storage keys.

### Centralizer: `checkAuthRateLimit` / `resetAuthRateLimit`

The two-layer rate limit logic is centralized in `packages/core/src/modules/auth/lib/rateLimitCheck.ts` to avoid duplicating the 15+ line inline pattern across handlers:

```typescript
// packages/core/src/modules/auth/lib/rateLimitCheck.ts

export interface CheckAuthRateLimitOptions {
  req: Request
  ipConfig: RateLimitConfig
  compoundConfig?: RateLimitConfig
  /** Raw identifier for compound key (e.g., email). Hashed internally before use. */
  compoundIdentifier?: string
}

export interface CheckAuthRateLimitResult {
  error: NextResponse | null
  compoundKey: string | null
}

/**
 * Fail-open rate limit check for auth endpoints.
 * Layer 1: IP-only check with ipConfig.
 * Layer 2 (optional): compound IP + hashed identifier check with compoundConfig.
 */
export async function checkAuthRateLimit(options: CheckAuthRateLimitOptions): Promise<CheckAuthRateLimitResult>

/**
 * Best-effort reset of a compound rate-limit key after successful authentication.
 * Never throws — wrapped in try/catch.
 */
export async function resetAuthRateLimit(compoundKey: string, config: RateLimitConfig): Promise<void>
```

Key design decisions:
- **Fail-open at every level**: returns `{ error: null }` when the service is `null`, IP is unresolvable, or any exception is thrown.
- **Hashes email internally** via `computeEmailHash()` (SHA-256) — callers pass raw email, never construct compound keys themselves.
- **Returns `compoundKey`** so the caller can pass it to `resetAuthRateLimit` on successful authentication.
- **IP-only mode**: when `compoundConfig`/`compoundIdentifier` are omitted, only Layer 1 runs.

### 1. Login Endpoint (`packages/core/src/modules/auth/api/login.ts`)

**Rate limit configs** (module-level constants):

```typescript
const loginRateLimitConfig = readEndpointRateLimitConfig('LOGIN', {
  points: 5, duration: 60, blockDuration: 60, keyPrefix: 'login',
})
const loginIpRateLimitConfig = readEndpointRateLimitConfig('LOGIN_IP', {
  points: 20, duration: 60, blockDuration: 60, keyPrefix: 'login-ip',
})

export const metadata = {}
```

**Handler-level enforcement** via centralizer — two layers checked before validation and DB work:

```typescript
export async function POST(req: Request) {
  // ...
  const email = String(form.get('email') ?? '')

  const { error: rateLimitError, compoundKey: rateLimitCompoundKey } = await checkAuthRateLimit({
    req, ipConfig: loginIpRateLimitConfig, compoundConfig: loginRateLimitConfig, compoundIdentifier: email,
  })
  if (rateLimitError) return rateLimitError

  // ... validation, auth logic ...

  // Reset rate limit counter on successful login so legitimate users aren't penalized for prior typos
  if (rateLimitCompoundKey) {
    await resetAuthRateLimit(rateLimitCompoundKey, loginRateLimitConfig)
  }

  // ... issue JWT, set cookies ...
}
```

**OpenAPI documentation** includes a 429 error schema:

```typescript
const rateLimitErrorSchema = z.object({
  error: z.string().describe('Rate limit exceeded message'),
})

// In methods.POST.errors:
{ status: 429, description: 'Too many login attempts', schema: rateLimitErrorSchema }
```

### 2. Password Reset (`packages/core/src/modules/auth/api/reset.ts`)

**Rate limit configs**:

```typescript
const resetRateLimitConfig = readEndpointRateLimitConfig('RESET', {
  points: 3, duration: 60, blockDuration: 60, keyPrefix: 'reset',
})
const resetIpRateLimitConfig = readEndpointRateLimitConfig('RESET_IP', {
  points: 10, duration: 60, blockDuration: 60, keyPrefix: 'reset-ip',
})

export const metadata = {}
```

**Handler-level enforcement** via centralizer:

```typescript
export async function POST(req: Request) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '')

  const { error: rateLimitError } = await checkAuthRateLimit({
    req, ipConfig: resetIpRateLimitConfig, compoundConfig: resetRateLimitConfig, compoundIdentifier: email,
  })
  if (rateLimitError) return rateLimitError

  // ... rest of handler
}
```

**OpenAPI documentation** includes a 429 error schema:

```typescript
{ status: 429, description: 'Too many password reset requests', schema: rateLimitErrorSchema }
```

### 3. Password Reset Confirm (`packages/core/src/modules/auth/api/reset/confirm.ts`)

**Rate limit config** (ENV-overridable via `RATE_LIMIT_RESET_CONFIRM_*`):

```typescript
const resetConfirmRateLimitConfig = readEndpointRateLimitConfig('RESET_CONFIRM', {
  points: 5, duration: 300, keyPrefix: 'reset-confirm',
})

export const metadata = {}
```

**Handler-level enforcement** via centralizer — IP-only key (no email available at this point):

```typescript
export async function POST(req: Request) {
  // ...
  const { error: rateLimitError } = await checkAuthRateLimit({ req, ipConfig: resetConfirmRateLimitConfig })
  if (rateLimitError) return rateLimitError

  // ... rest of handler
}
```

**OpenAPI documentation** includes a 429 error schema:

```typescript
{ status: 429, description: 'Too many reset confirmation attempts', schema: rateLimitErrorSchema }
```

### 4. 2FA Verification (Future — SPEC-019)

For IP-based rate limiting, metadata-driven is sufficient:

```typescript
export const metadata = {
  POST: {
    rateLimit: {
      points: parseInt(process.env.RATE_LIMIT_2FA_VERIFY_POINTS ?? '5'),
      duration: parseInt(process.env.RATE_LIMIT_2FA_VERIFY_DURATION ?? '300'),
      keyPrefix: '2fa-verify',
    },
  },
}
```

For per-challenge-token limiting (more specific), the handler would call the service directly:

```typescript
const rateLimiterService = getCachedRateLimiterService()
if (rateLimiterService) {
  const result = await rateLimiterService.consume(challengeTokenId, {
    points: 5, duration: 300, keyPrefix: '2fa-challenge',
  })
  if (!result.allowed) {
    // Invalidate challenge token and return error
  }
}
```

### 5. Session Refresh (`packages/core/src/modules/auth/api/session/refresh.ts`)

Lower priority. Optional metadata-based rate limit.

---

## Response Format

When rate limited, the API returns:

```http
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
Retry-After: 47
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 47

{
  "error": "Too many requests. Please try again later."
}
```

The error message is translated according to the user's locale (resolved via `resolveTranslations()`).

Rate limit headers are **only** included on 429 responses (not on successful requests):

- `Retry-After`: Seconds until the client can retry.
- `X-RateLimit-Limit`: Maximum points allowed in the window.
- `X-RateLimit-Remaining`: Points remaining (always 0 on 429).
- `X-RateLimit-Reset`: Seconds until the window resets.

---

## `.env.example` Update

The following section is in `apps/mercato/.env.example`:

```bash
# ============================================================================
# Rate Limiting Configuration
# ============================================================================
# Master switch to enable/disable rate limiting globally (default: true)
RATE_LIMIT_ENABLED=true

# Storage strategy: 'memory' (single instance) or 'redis' (distributed)
# Redis strategy uses REDIS_URL for connection. Falls back to memory if Redis is unavailable.
RATE_LIMIT_STRATEGY=memory

# Key prefix for rate limiter keys in storage (default: rl)
RATE_LIMIT_KEY_PREFIX=rl

# Number of trusted reverse proxies for X-Forwarded-For IP extraction (default: 1).
# Set to the number of proxies (nginx, CloudFlare, ALB, etc.) between clients and the app.
# 0 = ignore X-Forwarded-For entirely (fall back to X-Real-IP).
# RATE_LIMIT_TRUST_PROXY_DEPTH=1

# Per-endpoint overrides (optional — sensible defaults are hardcoded)
# Auth endpoints use two-layer rate limiting:
#   1) IP-only layer (LOGIN_IP/RESET_IP) — caps total attempts from one IP
#   2) Compound layer (LOGIN/RESET) — caps attempts per IP+account pair (email is SHA-256 hashed)
# RATE_LIMIT_LOGIN_POINTS=5
# RATE_LIMIT_LOGIN_DURATION=60
# RATE_LIMIT_LOGIN_BLOCK_DURATION=60
# RATE_LIMIT_LOGIN_IP_POINTS=20
# RATE_LIMIT_LOGIN_IP_DURATION=60
# RATE_LIMIT_LOGIN_IP_BLOCK_DURATION=60
# RATE_LIMIT_RESET_POINTS=3
# RATE_LIMIT_RESET_DURATION=60
# RATE_LIMIT_RESET_BLOCK_DURATION=60
# RATE_LIMIT_RESET_IP_POINTS=10
# RATE_LIMIT_RESET_IP_DURATION=60
# RATE_LIMIT_RESET_IP_BLOCK_DURATION=60
# RATE_LIMIT_RESET_CONFIRM_POINTS=5
# RATE_LIMIT_RESET_CONFIRM_DURATION=300
# RATE_LIMIT_2FA_VERIFY_POINTS=5
# RATE_LIMIT_2FA_VERIFY_DURATION=300
```

---

## Internationalization

Both the dispatcher and handler-level enforcement use `resolveTranslations()` to get translated error messages. The `checkRateLimit` helper receives the translated error message as a plain `string` parameter — it does not import any i18n modules.

### i18n Keys

The following key is in the **app-level** locale files (`apps/mercato/src/i18n/{en,pl,de,es}.json`), alongside the existing `api.errors.*` keys:

| Key | EN | PL | DE | ES |
|-----|----|----|----|----|
| `api.errors.rateLimit` | Too many requests. Please try again later. | Zbyt wiele zapytań. Spróbuj ponownie później. | Zu viele Anfragen. Bitte versuchen Sie es später erneut. | Demasiadas solicitudes. Inténtelo de nuevo más tarde. |

### Exported Constants

The helper exports the key and fallback as constants so callers don't repeat magic strings:

```typescript
// packages/shared/src/lib/ratelimit/helpers.ts
export const RATE_LIMIT_ERROR_KEY = 'api.errors.rateLimit'
export const RATE_LIMIT_ERROR_FALLBACK = 'Too many requests. Please try again later.'

// Dispatcher usage:
t(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)

// Handler usage:
translate('api.errors.rateLimit', 'Too many requests. Please try again later.')
```

---

## Security Considerations

1. **Two-Layer Rate Limiting**: Auth endpoints use two rate limit layers: (a) an IP-only layer that caps total attempts from a single IP regardless of email rotation, and (b) a compound `IP:emailHash` layer that caps attempts against a specific account. The email is SHA-256 hashed via `computeEmailHash()` before being used in the key — raw emails never appear in rate limit storage keys. This prevents credential stuffing from a single IP against multiple accounts, and also limits attacks from distributed IPs against a single account.
2. **IP Extraction — Trust Proxy Depth**: `getClientIp` reads the Nth-from-last entry in `X-Forwarded-For` based on `RATE_LIMIT_TRUST_PROXY_DEPTH` (default: 1). The `X-Forwarded-For` header is a comma-separated list where each proxy appends the IP it received the request from. The leftmost entries are client-controlled and can be freely spoofed; only the rightmost entries (appended by trusted proxies) are reliable. **Misconfiguration risks**: if `trustProxyDepth` is too high (e.g., 2 when there's only 1 proxy), an attacker can prepend a fake IP to `X-Forwarded-For` and the function will read the spoofed value — effectively bypassing rate limiting because each request appears to come from a different IP. If it's too low, all clients behind the same proxy collapse into a single rate-limit bucket. Operators must set the depth to exactly match the number of reverse proxies in their deployment chain.
3. **Unidentifiable Clients**: When no IP can be determined (`getClientIp` returns `null`), rate limiting is skipped (fail-open) rather than collapsing all unidentified clients into a shared `'unknown'` bucket. This prevents legitimate users from being blocked by unrelated traffic and avoids creating a single shared bucket that an attacker could exploit.
4. **Key Collision**: The global `keyPrefix` + per-endpoint `keyPrefix` combination prevents collisions between endpoints and between Open Mercato instances sharing the same Redis.
5. **Fail-Open Design**: Handler-level enforcement wraps rate limit checks in `try/catch` to ensure rate limiter infrastructure failures never block authentication flows. The service itself also fails open on unexpected errors (not `RateLimiterRes`).
6. **Null-Safe Service Access**: `getCachedRateLimiterService()` returns `null` if creation fails. All callers null-check before using.
7. **Timing Attacks**: The generic "Too many requests" message does not leak whether the account exists.
8. **DDoS vs Brute-Force**: In-memory `blockDuration` (via `rate-limiter-flexible`'s built-in mechanism) can be configured for additional DDoS protection at the process level, independent of Redis.

---

## Testing Strategy

### Unit Tests (`packages/shared/src/lib/ratelimit/__tests__/service.test.ts`)

1. **Disabled mode**: Verify consume/get/penalty/reward all return `allowed: true` when `enabled: false`.
2. **Memory strategy — consume**: Verify allows requests within the limit, returns correct `remainingPoints` and `consumedPoints`.
3. **Memory strategy — reject**: Verify `allowed: false` after consuming all points, with `msBeforeNext > 0`.
4. **Memory strategy — get**: Verify returns current state without consuming; returns `null` for unknown key.
5. **Memory strategy — delete**: Verify resets the counter (consume is allowed again after delete).
6. **Memory strategy — penalty**: Verify adds penalty points to consumed count.
7. **Memory strategy — reward**: Verify returns points (reduces consumed count).
8. **Memory strategy — block**: Verify blocks key for given duration.
9. **Key isolation**: Verify different keys are independent (one blocked, another allowed).
10. **Limiter caching**: Verify same config reuses the same limiter instance; different configs create separate limiters.
11. **Block duration**: Verify `blockDuration` prevents access after exceeding limit.
12. **Config validation**: Verify `readRateLimitConfig()` throws for invalid strategy; uses correct defaults when env vars are unset.
13. **Destroy**: Verify clears all limiters and allows fresh start.

### Unit Tests — Auth Centralizer (`packages/core/src/modules/auth/lib/__tests__/rateLimitCheck.test.ts`)

Tests for `checkAuthRateLimit`:

1. **Fail-open when service is null**: Returns `{ error: null }` when `getCachedRateLimiterService()` returns null.
2. **Fail-open when IP is null**: Returns `{ error: null }` when `getClientIp` returns null.
3. **IP-only error**: Returns error response when IP rate limit is exceeded.
4. **Compound error**: Returns error when IP passes but compound `IP:hash` layer fails.
5. **Happy path**: Returns `{ error: null, compoundKey }` when both layers pass.
6. **IP-only mode**: Only Layer 1 runs when no `compoundConfig` is provided.
7. **Fail-open on exception**: Returns `{ error: null }` when `checkRateLimit` throws.
8. **Hashed email**: Verifies `computeEmailHash` is called, not raw email in compound key.

Tests for `resetAuthRateLimit`:

9. **Happy path**: Calls `rateLimiterService.delete` with correct args.
10. **No-op when service is null**: Graceful degradation.
11. **Swallows exceptions**: Never throws.

### Integration Tests — Auth Rate Limiting (`packages/core/src/modules/auth/__integration__/TC-AUTH-016.spec.ts`)

Playwright API-level tests verifying end-to-end rate limiting behavior:

1. **Login compound limit**: 6 attempts with same email + wrong password → 6th returns 429 with correct `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers.
2. **Independent email buckets**: 5 attempts for email-A, then 1 for email-B → email-B is not rate limited.
3. **Reset compound limit**: 4 reset requests with same email → 4th returns 429 with correct headers.
4. **Successful login resets counter**: 4 failed attempts + 1 successful login → next failed attempt is not 429.

### Integration Tests (Future)

1. **Metadata-driven enforcement**: Verify 429 response after N requests to a metadata-protected endpoint.
2. **Redis fallback**: Verify memory fallback when Redis is unavailable (if Redis strategy is configured).
3. **Reset confirm rate limiting**: Verify IP-only limiting on `/api/auth/reset/confirm`.

---

## Alternatives Considered

### 1. Custom Implementation (without library)

**Rejected.** `rate-limiter-flexible` provides atomic operations, insurance limiters, multiple backends, and battle-tested sliding window logic. Reimplementing this would be error-prone and wasteful.

### 2. `express-rate-limit`

**Rejected.** Designed for Express middleware, not Next.js App Router API routes. Would require awkward adapters. `rate-limiter-flexible` is framework-agnostic.

### 3. Using CacheService as Backend

**Rejected.** While the existing CacheService could store counters, it doesn't provide atomic increment operations or sliding window semantics. `rate-limiter-flexible` uses Lua scripts for atomic Redis operations — this is critical for distributed correctness.

### 4. Pure metadata-driven enforcement for auth endpoints

**Rejected for auth endpoints.** Metadata-driven enforcement only supports IP-based keys (the dispatcher calls `getClientIp(req)`). Auth endpoints need compound `IP:email` keys for credential stuffing protection. The email is available in the request body, which the dispatcher doesn't parse. Handler-level enforcement was chosen for auth endpoints; metadata-driven remains available for simpler endpoints.

### 5. PostgreSQL strategy

**Rejected.** Adds load to the primary database. Redis is already available and better suited for high-frequency counter operations. Memory fallback covers the no-Redis case.

### 6. DI-only access (no globalThis singleton)

**Rejected.** Next.js App Router with tsx/webpack can duplicate modules, causing multiple DI container instances. The `globalThis`-cached singleton pattern (same as used for DI registrars) ensures a single `RateLimiterService` instance across all request contexts. The service is also registered in DI for modules that prefer container resolution.

---

## Implementation Plan

### Phase 1: Core Library (Done)
1. Add `rate-limiter-flexible` to `packages/shared/package.json`.
2. Create `packages/shared/src/lib/ratelimit/types.ts`.
3. Create `packages/shared/src/lib/ratelimit/config.ts`.
4. Create `packages/shared/src/lib/ratelimit/service.ts`.
5. Create `packages/shared/src/lib/ratelimit/helpers.ts` (checkRateLimit + getClientIp + constants).
6. Create `packages/shared/src/lib/ratelimit/index.ts` (public exports).
7. Write unit tests.

### Phase 2: Bootstrap + Dispatcher Integration (Done)
1. Add `getCachedRateLimiterService()` singleton to `packages/core/src/bootstrap.ts`.
2. Register `rateLimiterService` in DI container during bootstrap.
3. Extend `MethodMetadata` type in `apps/mercato/src/app/api/[...slug]/route.ts`.
4. Add `rateLimit` parsing to `extractMethodMetadata()`.
5. Add `checkRateLimit()` call to `handleRequest()` (metadata-driven path).

### Phase 3: Auth Endpoint Integration (Done)
1. Add handler-level rate limiting to `/api/login` with compound `IP:email` key.
2. Add handler-level rate limiting to `/api/reset` with compound `IP:email` key.
3. Add handler-level rate limiting to `/api/reset/confirm` with IP key.
4. Add 429 error schemas to OpenAPI documentation for all three endpoints.

### Phase 4: Configuration & Documentation (Done)
1. Update `apps/mercato/.env.example` with rate limit variables.
2. Add `api.errors.rateLimit` to all locale files (`apps/mercato/src/i18n/{en,pl,de,es}.json`).

### Future Work
- 2FA verification rate limiting (SPEC-019).
- Session refresh rate limiting.
- Integration test for `/api/auth/reset/confirm` rate limiting.
- Metadata-driven enforcement integration test.

---

## Open Questions

1. ~~**Should successful login reset the rate limit counter?**~~ — **Resolved (2026-02-17).** Implemented: `rateLimiterService.delete(compoundKey, loginRateLimitConfig)` runs after successful auth. Only the compound key is reset (not the IP-only layer), so IP-level protection remains intact.
2. **Should rate limit state survive app restarts?** — With Redis strategy, yes. With memory strategy, no (acceptable for development). Document this trade-off.

---

## Changelog

### 2026-02-17 (Documentation & Test Coverage)
- **`checkAuthRateLimit` centralizer documented**: Replaced inline rate limit code in all three auth handler examples with the `checkAuthRateLimit`/`resetAuthRateLimit` helper from `packages/core/src/modules/auth/lib/rateLimitCheck.ts`. Added centralizer interface and design decisions section.
- **Per-endpoint env vars complete**: Added `RATE_LIMIT_RESET_CONFIRM_POINTS`/`RATE_LIMIT_RESET_CONFIRM_DURATION` to both the env vars table and `.env.example` section. Added `LOGIN_IP_*` and `RESET_IP_*` entries to the `.env.example` section to match the actual file.
- **Unit tests for centralizer**: Added 11 tests in `packages/core/src/modules/auth/lib/__tests__/rateLimitCheck.test.ts` covering fail-open behavior, two-layer checks, email hashing, and `resetAuthRateLimit`.
- **Integration tests implemented**: Added TC-AUTH-016 (`packages/core/src/modules/auth/__integration__/TC-AUTH-016.spec.ts`) with 4 Playwright API tests: compound limit enforcement for login and reset, independent email buckets, and successful-login counter reset. Updated Testing Strategy from "Future" to reflect implemented coverage.
- **Future Work updated**: Removed "Integration tests for the full request flow" (now implemented). Added specific remaining gaps: reset/confirm integration test, metadata-driven enforcement integration test.

### 2026-02-17 (Security Hardening)
- **IP spoofing prevention**: `getClientIp` now reads from the rightmost trusted entry in `X-Forwarded-For` based on configurable `RATE_LIMIT_TRUST_PROXY_DEPTH` (default: 1), instead of the leftmost (client-controlled) entry.
- **Eliminated `'unknown'` fallback bucket**: `getClientIp` returns `null` when IP cannot be determined. Callers skip rate limiting (fail-open) instead of collapsing all unidentifiable clients into a shared bucket.
- **`RateLimitGlobalConfig.trustProxyDepth`**: New required field on the global config type, read from `RATE_LIMIT_TRUST_PROXY_DEPTH` env var.
- **`RateLimiterService.trustProxyDepth`**: Exposed as readonly property so callers can pass it to `getClientIp`.
- **Hashed email in compound keys**: Compound rate limit keys now use `computeEmailHash()` (SHA-256) instead of raw email. Prevents PII leakage in rate limit storage (Redis/memory keys) and fixes key-length abuse where attackers submitted absurdly long email strings to create unique buckets.
- **Two-layer rate limiting**: Added IP-only rate limit layer (`LOGIN_IP`, `RESET_IP`) in addition to compound `IP:emailHash` layer. The IP-only layer caps total attempts from a single IP regardless of email rotation, preventing bypass via unique emails.
- **Successful login resets compound counter**: After successful authentication, `rateLimiterService.delete(compoundKey, loginRateLimitConfig)` resets the IP:emailHash counter. Only the compound key is reset — the IP-only layer remains untouched. Wrapped in best-effort try/catch.
- Updated all handler and dispatcher code to pass `trustProxyDepth` and guard against `null` IP.
- Updated Security Considerations section with trust proxy depth, null-IP handling, and two-layer model.

### 2026-02-09 (Implementation Update)
- Updated spec to match actual implementation.
- **Dual enforcement model**: documented metadata-driven (dispatcher) and handler-level (manual) paths. Auth endpoints use handler-level with compound `IP:email` keys; the dispatcher supports IP-based metadata-driven for future endpoints.
- **globalThis singleton**: documented `getCachedRateLimiterService()` pattern with lazy initialization and fire-and-forget Redis init. Service is also registered in DI.
- **Login defaults**: updated from 900s to 60s for both `duration` and `blockDuration` (matching actual code and `.env.example`).
- **Compound keys**: login and reset use `${clientIp}:${email.toLowerCase()}`; reset-confirm uses IP-only.
- **Fail-open try/catch**: documented the pattern used in all three auth handlers.
- **No successful login reset**: moved from "implemented" to "future work".
- **OpenAPI 429 schemas**: documented that all protected endpoints include rate limit error schemas in their OpenAPI docs.
- **Removed Alternative #4** ("per-handler enforceRateLimit calls — rejected") — the implementation actually uses handler-level enforcement for auth, so added new Alternative #4 explaining why pure metadata-driven was rejected for auth endpoints.
- Updated implementation plan to mark all phases as Done.
- Updated Open Questions to reflect resolved and remaining decisions.

### 2026-02-09 (Initial)
- Initial specification
- Added i18n support: `enforceRateLimit` accepts `errorMessage` param, callers pass `translate('api.errors.rateLimit')`. Added i18n keys section with translations for all supported locales.
- Fixed i18n key location to `apps/mercato/src/i18n/` (matches existing `api.errors.*` namespace)
- Fixed translation diacritics (PL, DE, ES)
- Fixed diagram to show `config` param on all service methods
- Fixed login integration: extracted config to variable so `delete` on success reuses the same limiter
- Fixed integration examples: added missing `container.resolve` and `getClientIp` calls
- **Major rewrite**: switched from per-handler `enforceRateLimit()` to metadata-driven approach via the API catch-all dispatcher. Route files now declare `rateLimit` in metadata (same pattern as `requireAuth`/`requireFeatures`). Eliminated `throw new Response()` bug — dispatcher returns `NextResponse` directly. Replaced `enforceRateLimit` with `checkRateLimit` helper. Added `RATE_LIMIT_ERROR_KEY`/`RATE_LIMIT_ERROR_FALLBACK` constants. Updated all integration examples to metadata declarations. Revised implementation plan to include dispatcher integration phase.
