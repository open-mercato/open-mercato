# SPEC-021: Rate Limiting Utility

## Overview

Add a reusable, strategy-based rate limiting utility to Open Mercato using [`rate-limiter-flexible`](https://github.com/animir/node-rate-limiter-flexible). The utility lives in `packages/shared` as a shared library, is configurable via environment variables, and is injectable through DI. Rate limiting is enforced **automatically** via the existing API catch-all dispatcher — route files just declare a `rateLimit` property in their `metadata` export, the same way they declare `requireAuth` or `requireFeatures`. Primary motivation is protecting authentication endpoints (login, password reset, 2FA verification) against brute-force and credential stuffing attacks.

## Goals

- Provide a reusable `RateLimiterService` that any module can consume via DI.
- Support two strategies: **in-memory** (development / single-instance) and **Redis** (production / distributed).
- Make the service globally configurable via three environment variables (enabled, strategy, default key prefix).
- **Metadata-driven enforcement** — route files declare `rateLimit` in their `metadata` export; the catch-all API dispatcher (`apps/mercato/src/app/api/[...slug]/route.ts`) enforces it automatically before the handler runs. Zero boilerplate in route handlers.
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

### Metadata-Driven Enforcement

Rate limiting plugs into the existing API catch-all dispatcher, which already enforces `requireAuth`, `requireRoles`, and `requireFeatures` via route metadata. Adding `rateLimit` follows the exact same pattern:

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js Request: POST /api/login                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  apps/mercato/src/app/api/[...slug]/route.ts               │
│                                                             │
│  1. findApi(modules, method, pathname)                      │
│  2. extractMethodMetadata(api.metadata, method)             │
│  3. checkAuthorization(metadata, auth, req)  ← existing    │
│  4. checkRateLimit(metadata, req, t)         ← NEW         │
│  5. api.handler(req, context)                               │
└─────────────────────────────────────────────────────────────┘
```

Route files declare rate limits declaratively:

```typescript
// packages/core/src/modules/auth/api/login.ts
export const metadata = {
  POST: {
    rateLimit: { points: 5, duration: 900, blockDuration: 900, keyPrefix: 'login' },
  },
}
```

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
     DI: 'rateLimiterService'
           │
    ┌──────┴──────────────┐
    │                     │
  Dispatcher           Handlers
  (automatic)          (advanced: delete/penalty/reward)
```

### Insurance (Fallback)

When strategy is `redis` and Redis becomes unavailable, `rate-limiter-flexible` automatically falls back to an in-memory `insuranceLimiter`. This ensures rate limiting continues to function (per-instance) even during Redis outages. No custom fallback logic is needed.

---

## Environment Variables

Three new variables control the rate limiter globally:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `RATE_LIMIT_ENABLED` | `boolean` | `true` | Master switch. When `false`, all rate limit checks are skipped (returns allowed). |
| `RATE_LIMIT_STRATEGY` | `'memory' \| 'redis'` | `memory` | Backend strategy. Use `redis` in production for distributed limiting. |
| `RATE_LIMIT_KEY_PREFIX` | `string` | `'rl'` | Default key prefix for all rate limiter keys. Prevents collisions with other Redis data. |

### Redis Connection

When `RATE_LIMIT_STRATEGY=redis`, the service reads the Redis URL from the existing `REDIS_URL` environment variable (already used by cache, events, and queue modules). No additional Redis URL variable is needed.

### Per-Endpoint Configuration (Hardcoded Defaults, ENV Overridable)

Each protected endpoint defines its own limits in metadata. Default values are hardcoded but can be overridden via environment variables for operational flexibility:

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_LOGIN_POINTS` | `5` | Max failed login attempts per window |
| `RATE_LIMIT_LOGIN_DURATION` | `900` | Window in seconds (15 min) |
| `RATE_LIMIT_LOGIN_BLOCK_DURATION` | `900` | Block duration after exceeding limit (15 min) |
| `RATE_LIMIT_RESET_POINTS` | `3` | Max password reset requests per window |
| `RATE_LIMIT_RESET_DURATION` | `600` | Window in seconds (10 min) |
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

Add `rate-limiter-flexible` to `packages/shared/package.json` dependencies:

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

  constructor(globalConfig: RateLimitGlobalConfig) {
    this.globalConfig = globalConfig
  }

  /** Initialize Redis client if strategy is redis. Call once at bootstrap. */
  async initialize(): Promise<void> {
    if (this.globalConfig.strategy === 'redis' && this.globalConfig.redisUrl) {
      const { default: Redis } = await import('ioredis')
      this.redisClient = new Redis(this.globalConfig.redisUrl, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      })
    }
  }

  /**
   * Consume 1 point for the given key.
   * Returns the result with allowed/remaining/reset info.
   */
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
      // On unexpected errors (Redis down, etc.), allow the request
      // The insurance limiter handles Redis failures internally
      return { allowed: true, remainingPoints: config.points, msBeforeNext: 0, consumedPoints: 0 }
    }
  }

  /** Get current state without consuming a point */
  async get(key: string, config: RateLimitConfig): Promise<RateLimitResult | null> {
    if (!this.globalConfig.enabled) return null

    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.get(key)
    return res ? this.toResult(res, res.remainingPoints > 0) : null
  }

  /** Reset (delete) rate limit state for a key */
  async delete(key: string, config: RateLimitConfig): Promise<void> {
    const limiter = this.getOrCreateLimiter(config)
    await limiter.delete(key)
  }

  /** Add penalty points to a key */
  async penalty(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.globalConfig.enabled) {
      return { allowed: true, remainingPoints: config.points, msBeforeNext: 0, consumedPoints: 0 }
    }
    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.penalty(key, points)
    return this.toResult(res, res.remainingPoints > 0)
  }

  /** Return (reward) points to a key */
  async reward(key: string, points: number, config: RateLimitConfig): Promise<RateLimitResult> {
    if (!this.globalConfig.enabled) {
      return { allowed: true, remainingPoints: config.points, msBeforeNext: 0, consumedPoints: 0 }
    }
    const limiter = this.getOrCreateLimiter(config)
    const res = await limiter.reward(key, points)
    return this.toResult(res, true)
  }

  /** Manually block a key for a duration */
  async block(key: string, durationSec: number, config: RateLimitConfig): Promise<void> {
    const limiter = this.getOrCreateLimiter(config)
    await limiter.block(key, durationSec)
  }

  /** Clean up Redis connection on shutdown */
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

  return {
    enabled: parseBooleanWithDefault(process.env.RATE_LIMIT_ENABLED, true),
    strategy,
    keyPrefix: process.env.RATE_LIMIT_KEY_PREFIX ?? 'rl',
    redisUrl: process.env.REDIS_URL,
  }
}
```

---

## Dispatcher Helper

```typescript
// packages/shared/src/lib/ratelimit/helpers.ts

import { NextResponse } from 'next/server'
import type { RateLimitConfig, RateLimitResult } from './types'
import type { RateLimiterService } from './service'

/** Default i18n key and English fallback for rate limit errors */
export const RATE_LIMIT_ERROR_KEY = 'api.errors.rateLimit'
export const RATE_LIMIT_ERROR_FALLBACK = 'Too many requests. Please try again later.'

/**
 * Check rate limit for a request. Called by the API catch-all dispatcher.
 *
 * Returns `NextResponse` with 429 status if rate limited, or `null` if allowed.
 * The dispatcher already has `t` from `resolveTranslations()`, so the translated
 * error message is passed in directly.
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
 * Extract client IP from a Next.js/standard Request.
 * Checks x-forwarded-for, x-real-ip, then falls back to 'unknown'.
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') ?? 'unknown'
}
```

---

## DI Registration

```typescript
// In packages/core/src/bootstrap.ts (or equivalent bootstrap file)
import { RateLimiterService } from '@open-mercato/shared/lib/ratelimit'
import { readRateLimitConfig } from '@open-mercato/shared/lib/ratelimit/config'

// During container setup:
const rateLimitConfig = readRateLimitConfig()
const rateLimiterService = new RateLimiterService(rateLimitConfig)
await rateLimiterService.initialize()

container.register({
  rateLimiterService: asValue(rateLimiterService),
})
```

---

## Dispatcher Integration

### Changes to `apps/mercato/src/app/api/[...slug]/route.ts`

#### 1. Extend `MethodMetadata` type

```typescript
import type { RateLimitConfig } from '@open-mercato/shared/lib/ratelimit/types'

type MethodMetadata = {
  requireAuth?: boolean
  requireRoles?: string[]
  requireFeatures?: string[]
  rateLimit?: RateLimitConfig  // ← NEW
}
```

#### 2. Extract `rateLimit` from metadata

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

#### 3. Add `checkRateLimit` call in `handleRequest()`

Insert rate limit check between `checkAuthorization` and handler invocation:

```typescript
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'

async function handleRequest(
  method: HttpMethod,
  req: NextRequest,
  paramsPromise: Promise<{ slug: string[] }>
): Promise<Response> {
  const { t } = await resolveTranslations()
  const params = await paramsPromise
  const pathname = '/' + (params.slug?.join('/') ?? '')
  const api = findApi(modules, method, pathname)
  if (!api) return NextResponse.json({ error: t('api.errors.notFound', 'Not Found') }, { status: 404 })
  const auth = await getAuthFromRequest(req)

  const methodMetadata = extractMethodMetadata(api.metadata, method)
  const authError = await checkAuthorization(methodMetadata, auth, req)
  if (authError) return authError

  // ── Rate Limiting (NEW) ───────────────────────────────────────────
  if (methodMetadata?.rateLimit) {
    const container = await createRequestContainer()
    const rateLimiterService = container.resolve<RateLimiterService>('rateLimiterService')
    const clientIp = getClientIp(req)
    const rateLimitError = await checkRateLimit(
      rateLimiterService,
      methodMetadata.rateLimit,
      clientIp,
      t(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK),
    )
    if (rateLimitError) return rateLimitError
  }
  // ──────────────────────────────────────────────────────────────────

  const handlerContext: HandlerContext = { params: api.params, auth }
  return await runWithCacheTenant(auth?.tenantId ?? null, () => api.handler(req, handlerContext))
}
```

Key points:
- Rate limit check runs **after** auth but **before** the handler — same position as in the existing flow.
- Uses `getClientIp(req)` for the rate limit key (IP-based by default).
- Uses `t()` from the dispatcher's existing `resolveTranslations()` call — no extra i18n work needed.
- Returns `NextResponse` with 429 on rate limit exceeded, consistent with how auth errors return `NextResponse` with 401/403.

---

## Integration Points (Route Metadata)

Each route file declares its rate limit configuration in `metadata`. Zero code changes in the handler body.

### 1. Login Endpoint (`packages/core/src/modules/auth/api/login.ts`)

```typescript
export const metadata = {
  POST: {
    rateLimit: {
      points: parseInt(process.env.RATE_LIMIT_LOGIN_POINTS ?? '5'),
      duration: parseInt(process.env.RATE_LIMIT_LOGIN_DURATION ?? '900'),
      blockDuration: parseInt(process.env.RATE_LIMIT_LOGIN_BLOCK_DURATION ?? '900'),
      keyPrefix: 'login',
    },
  },
}
```

**Optional handler-level enhancement** — reset the rate limit counter on successful login so legitimate users aren't locked out after a few typos:

```typescript
// At the end of the POST handler, after successful auth:
const rateLimiterService = container.resolve<RateLimiterService>('rateLimiterService')
await rateLimiterService.delete(getClientIp(req), {
  points: parseInt(process.env.RATE_LIMIT_LOGIN_POINTS ?? '5'),
  duration: parseInt(process.env.RATE_LIMIT_LOGIN_DURATION ?? '900'),
  blockDuration: parseInt(process.env.RATE_LIMIT_LOGIN_BLOCK_DURATION ?? '900'),
  keyPrefix: 'login',
})
```

### 2. Password Reset (`packages/core/src/modules/auth/api/reset.ts`)

```typescript
export const metadata = {
  POST: {
    rateLimit: {
      points: parseInt(process.env.RATE_LIMIT_RESET_POINTS ?? '3'),
      duration: parseInt(process.env.RATE_LIMIT_RESET_DURATION ?? '600'),
      keyPrefix: 'reset',
    },
  },
}
```

No handler-level changes needed. The metadata is sufficient.

### 3. Password Reset Confirm (`packages/core/src/modules/auth/api/reset/confirm.ts`)

```typescript
export const metadata = {
  POST: {
    rateLimit: { points: 5, duration: 300, keyPrefix: 'reset-confirm' },
  },
}
```

### 4. 2FA Verification (Future — SPEC-019)

For IP-based rate limiting, metadata is sufficient:

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
// Inside the POST handler:
const rateLimiterService = container.resolve<RateLimiterService>('rateLimiterService')
const result = await rateLimiterService.consume(challengeTokenId, {
  points: 5, duration: 300, keyPrefix: '2fa-challenge',
})
if (!result.allowed) {
  // Invalidate challenge token and return error
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
Retry-After: 847
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 847

{
  "error": "Too many requests. Please try again later."
}
```

The error message is translated according to the user's locale (resolved by the dispatcher's existing `resolveTranslations()` call).

- `Retry-After`: Seconds until the client can retry.
- `X-RateLimit-Limit`: Maximum points allowed in the window.
- `X-RateLimit-Remaining`: Points remaining.
- `X-RateLimit-Reset`: Seconds until the window resets.

---

## `.env.example` Update

Add the following section to `apps/mercato/.env.example`:

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

# Per-endpoint overrides (optional — sensible defaults are hardcoded)
# RATE_LIMIT_LOGIN_POINTS=5
# RATE_LIMIT_LOGIN_DURATION=900
# RATE_LIMIT_LOGIN_BLOCK_DURATION=900
# RATE_LIMIT_RESET_POINTS=3
# RATE_LIMIT_RESET_DURATION=600
# RATE_LIMIT_2FA_VERIFY_POINTS=5
# RATE_LIMIT_2FA_VERIFY_DURATION=300
```

---

## Internationalization

The dispatcher already calls `resolveTranslations()` at the top of `handleRequest()` and has `t` available. The `checkRateLimit` helper receives the translated error message as a plain `string` parameter — it does not import any i18n modules (same pattern as `withScopedPayload` in `scoped.ts`).

### i18n Keys

Add the following key to the **app-level** locale files (`apps/mercato/src/i18n/{en,pl,de,es}.json`), alongside the existing `api.errors.*` keys (`api.errors.unauthorized`, `api.errors.forbidden`, etc.):

| Key | EN | PL | DE | ES |
|-----|----|----|----|----|
| `api.errors.rateLimit` | Too many requests. Please try again later. | Zbyt wiele zapytań. Spróbuj ponownie później. | Zu viele Anfragen. Bitte versuchen Sie es später erneut. | Demasiadas solicitudes. Inténtelo de nuevo más tarde. |

### Exported Constants

The helper exports the key and fallback as constants so callers (and the dispatcher) don't repeat magic strings:

```typescript
// packages/shared/src/lib/ratelimit/helpers.ts
export const RATE_LIMIT_ERROR_KEY = 'api.errors.rateLimit'
export const RATE_LIMIT_ERROR_FALLBACK = 'Too many requests. Please try again later.'

// Dispatcher usage:
t(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK)
```

---

## Security Considerations

1. **IP Extraction**: Use `x-forwarded-for` (first entry) behind reverse proxies. Document that operators must configure their proxy to set this header correctly (otherwise all clients share the same rate limit key).
2. **Key Collision**: The global `keyPrefix` + per-endpoint `keyPrefix` combination prevents collisions between endpoints and between Open Mercato instances sharing the same Redis.
3. **Error Suppression**: When `rate-limiter-flexible` throws unexpected errors (not `RateLimiterRes`), the service allows the request through. This prevents rate limiting infrastructure failures from blocking all users (fail-open for availability, not security).
4. **Timing Attacks**: The generic "Too many requests" message does not leak whether the account exists.
5. **Successful Login Reset**: After a successful login, the rate limit counter for that IP is reset. This prevents legitimate users from being locked out after a few typos.
6. **DDoS vs Brute-Force**: In-memory `blockDuration` (via `rate-limiter-flexible`'s `inMemoryBlockOnConsumed`) can be configured for additional DDoS protection at the process level, independent of Redis.

---

## Testing Strategy

### Unit Tests (`packages/shared/src/lib/ratelimit/__tests__/service.test.ts`)

1. **Memory strategy**: Verify consume/get/delete/penalty/reward/block operations.
2. **Disabled mode**: Verify all operations return `allowed: true` when `enabled: false`.
3. **Config validation**: Verify invalid strategy throws.
4. **Limiter caching**: Verify same config reuses the same limiter instance.
5. **Rate exceeded**: Verify `allowed: false` after consuming all points.
6. **Block duration**: Verify key stays blocked for the configured duration.

### Integration Tests

1. **Metadata-driven enforcement**: Verify 429 response after N requests to a metadata-protected endpoint.
2. **Login rate limiting**: Verify 429 after N failed login attempts.
3. **Reset on success**: Verify counter resets after successful login.
4. **Response headers**: Verify `Retry-After`, `X-RateLimit-*` headers.
5. **Password reset limiting**: Verify email abuse prevention.
6. **Redis fallback**: Verify memory fallback when Redis is unavailable (if Redis strategy is configured).
7. **No rate limit**: Verify endpoints without `rateLimit` in metadata are unaffected.

---

## Alternatives Considered

### 1. Custom Implementation (without library)

**Rejected.** `rate-limiter-flexible` provides atomic operations, insurance limiters, multiple backends, and battle-tested sliding window logic. Reimplementing this would be error-prone and wasteful.

### 2. `express-rate-limit`

**Rejected.** Designed for Express middleware, not Next.js App Router API routes. Would require awkward adapters. `rate-limiter-flexible` is framework-agnostic.

### 3. Using CacheService as Backend

**Rejected.** While the existing CacheService could store counters, it doesn't provide atomic increment operations or sliding window semantics. `rate-limiter-flexible` uses Lua scripts for atomic Redis operations — this is critical for distributed correctness.

### 4. Per-handler `enforceRateLimit()` calls (previous SPEC version)

**Rejected.** Required each route handler to manually resolve the service from DI, call `resolveTranslations()`, extract client IP, and call the helper. The metadata-driven approach eliminates this boilerplate: route files declare `rateLimit` in metadata, the dispatcher handles everything.

### 5. PostgreSQL strategy

**Rejected.** Adds load to the primary database. Redis is already available and better suited for high-frequency counter operations. Memory fallback covers the no-Redis case.

---

## Implementation Plan

### Phase 1: Core Library
1. Add `rate-limiter-flexible` to `packages/shared/package.json`.
2. Create `packages/shared/src/lib/ratelimit/types.ts`.
3. Create `packages/shared/src/lib/ratelimit/config.ts`.
4. Create `packages/shared/src/lib/ratelimit/service.ts`.
5. Create `packages/shared/src/lib/ratelimit/helpers.ts` (checkRateLimit + getClientIp + constants).
6. Create `packages/shared/src/lib/ratelimit/index.ts` (public exports).
7. Write unit tests.

### Phase 2: DI + Dispatcher Integration
1. Register `rateLimiterService` in bootstrap.
2. Initialize Redis connection at startup (if strategy is redis).
3. Add graceful shutdown (destroy).
4. Extend `MethodMetadata` type in `apps/mercato/src/app/api/[...slug]/route.ts`.
5. Add `rateLimit` parsing to `extractMethodMetadata()`.
6. Add `checkRateLimit()` call to `handleRequest()`.

### Phase 3: Auth Endpoint Integration
1. Add `rateLimit` to `/api/login` metadata.
2. Add `rateLimit` to `/api/reset` metadata.
3. Add `rateLimit` to `/api/reset/confirm` metadata.
4. Add login success counter reset (handler-level `delete()`).
5. Write integration tests.

### Phase 4: Configuration & Documentation
1. Update `apps/mercato/.env.example` with rate limit variables.
2. Add `api.errors.rateLimit` to all locale files (`apps/mercato/src/i18n/{en,pl,de,es}.json`).
3. Verify build succeeds.
4. Update this SPEC with implementation results.

---

## Open Questions

1. **Should successful login reset the rate limit counter?** — Current spec says yes (delete key on success). This is friendlier to users who mistype passwords but slightly weaker against distributed attacks. Decision: reset on success (user experience wins for auth-level rate limiting; DDoS is handled at infrastructure level).
2. **Should we rate limit by email in addition to IP?** — Could add a secondary limiter keyed by email to prevent credential stuffing from multiple IPs. Deferred to a follow-up if needed. For this, the handler would call the service directly (not metadata-driven).
3. **Should rate limit state survive app restarts?** — With Redis strategy, yes. With memory strategy, no (acceptable for development). Document this trade-off.

---

## Changelog

### 2026-02-09
- Initial specification
- Added i18n support: `enforceRateLimit` accepts `errorMessage` param, callers pass `translate('api.errors.rateLimit')`. Added i18n keys section with translations for all supported locales.
- Fixed i18n key location to `apps/mercato/src/i18n/` (matches existing `api.errors.*` namespace)
- Fixed translation diacritics (PL, DE, ES)
- Fixed diagram to show `config` param on all service methods
- Fixed login integration: extracted config to variable so `delete` on success reuses the same limiter
- Fixed integration examples: added missing `container.resolve` and `getClientIp` calls
- **Major rewrite**: switched from per-handler `enforceRateLimit()` to metadata-driven approach via the API catch-all dispatcher. Route files now declare `rateLimit` in metadata (same pattern as `requireAuth`/`requireFeatures`). Eliminated `throw new Response()` bug — dispatcher returns `NextResponse` directly. Replaced `enforceRateLimit` with `checkRateLimit` helper. Added `RATE_LIMIT_ERROR_KEY`/`RATE_LIMIT_ERROR_FALLBACK` constants. Updated all integration examples to metadata declarations. Revised implementation plan to include dispatcher integration phase.
