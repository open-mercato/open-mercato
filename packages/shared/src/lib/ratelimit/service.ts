import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible'
import type { RateLimitConfig, RateLimitResult, RateLimitGlobalConfig } from './types'

/** Narrow interface for the ioredis client — only the methods we actually use. */
interface RedisClient {
  disconnect(): void
}

export class RateLimiterService {
  private globalConfig: RateLimitGlobalConfig
  private limiters = new Map<string, RateLimiterMemory | RateLimiterRedis>()
  private redisClient: RedisClient | null = null

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
    if (!this.globalConfig.enabled) return
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
    if (!this.globalConfig.enabled) return
    const limiter = this.getOrCreateLimiter(config)
    await limiter.block(key, durationSec)
  }

  async destroy(): Promise<void> {
    if (this.redisClient) {
      this.redisClient.disconnect()
    }
    this.limiters.clear()
  }

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
        storeClient: this.redisClient,
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
