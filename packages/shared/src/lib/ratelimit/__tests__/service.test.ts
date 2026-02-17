import { RateLimiterService } from '../service'
import type { RateLimitConfig, RateLimitGlobalConfig } from '../types'

function createConfig(overrides: Partial<RateLimitGlobalConfig> = {}): RateLimitGlobalConfig {
  return {
    enabled: true,
    strategy: 'memory',
    keyPrefix: 'test',
    ...overrides,
  }
}

const defaultLimitConfig: RateLimitConfig = {
  points: 3,
  duration: 60,
  keyPrefix: 'test-endpoint',
}

describe('RateLimiterService', () => {
  let service: RateLimiterService

  afterEach(async () => {
    if (service) await service.destroy()
  })

  describe('disabled mode', () => {
    beforeEach(() => {
      service = new RateLimiterService(createConfig({ enabled: false }))
    })

    it('consume returns allowed when disabled', async () => {
      const result = await service.consume('key1', defaultLimitConfig)
      expect(result.allowed).toBe(true)
      expect(result.remainingPoints).toBe(defaultLimitConfig.points)
      expect(result.consumedPoints).toBe(0)
    })

    it('get returns null when disabled', async () => {
      const result = await service.get('key1', defaultLimitConfig)
      expect(result).toBeNull()
    })

    it('penalty returns allowed when disabled', async () => {
      const result = await service.penalty('key1', 5, defaultLimitConfig)
      expect(result.allowed).toBe(true)
    })

    it('reward returns allowed when disabled', async () => {
      const result = await service.reward('key1', 1, defaultLimitConfig)
      expect(result.allowed).toBe(true)
    })
  })

  describe('memory strategy', () => {
    beforeEach(() => {
      service = new RateLimiterService(createConfig())
    })

    it('allows requests within the limit', async () => {
      const result = await service.consume('ip1', defaultLimitConfig)
      expect(result.allowed).toBe(true)
      expect(result.remainingPoints).toBe(2)
      expect(result.consumedPoints).toBe(1)
    })

    it('rejects after all points are consumed', async () => {
      for (let i = 0; i < 3; i++) {
        await service.consume('ip2', defaultLimitConfig)
      }
      const result = await service.consume('ip2', defaultLimitConfig)
      expect(result.allowed).toBe(false)
      expect(result.remainingPoints).toBe(0)
      expect(result.msBeforeNext).toBeGreaterThan(0)
    })

    it('get returns current state without consuming', async () => {
      await service.consume('ip3', defaultLimitConfig)
      const state = await service.get('ip3', defaultLimitConfig)
      expect(state).not.toBeNull()
      expect(state!.consumedPoints).toBe(1)
      expect(state!.remainingPoints).toBe(2)
    })

    it('get returns null for unknown key', async () => {
      const state = await service.get('unknown-key', defaultLimitConfig)
      expect(state).toBeNull()
    })

    it('delete resets the counter', async () => {
      for (let i = 0; i < 3; i++) {
        await service.consume('ip4', defaultLimitConfig)
      }
      const blocked = await service.consume('ip4', defaultLimitConfig)
      expect(blocked.allowed).toBe(false)

      await service.delete('ip4', defaultLimitConfig)
      const afterDelete = await service.consume('ip4', defaultLimitConfig)
      expect(afterDelete.allowed).toBe(true)
      expect(afterDelete.consumedPoints).toBe(1)
    })

    it('penalty adds points to a key', async () => {
      await service.consume('ip5', defaultLimitConfig)
      const result = await service.penalty('ip5', 2, defaultLimitConfig)
      expect(result.consumedPoints).toBe(3)
      expect(result.remainingPoints).toBe(0)
    })

    it('reward returns points to a key', async () => {
      await service.consume('ip6', defaultLimitConfig)
      await service.consume('ip6', defaultLimitConfig)
      const result = await service.reward('ip6', 1, defaultLimitConfig)
      expect(result.consumedPoints).toBe(1)
      expect(result.allowed).toBe(true)
    })

    it('block prevents access for given duration', async () => {
      await service.block('ip7', 2, defaultLimitConfig)
      const result = await service.consume('ip7', defaultLimitConfig)
      expect(result.allowed).toBe(false)
      expect(result.msBeforeNext).toBeGreaterThan(0)
    })

    it('isolates different keys', async () => {
      for (let i = 0; i < 3; i++) {
        await service.consume('ip-a', defaultLimitConfig)
      }
      const resultA = await service.consume('ip-a', defaultLimitConfig)
      expect(resultA.allowed).toBe(false)

      const resultB = await service.consume('ip-b', defaultLimitConfig)
      expect(resultB.allowed).toBe(true)
    })
  })

  describe('limiter caching', () => {
    it('reuses the same limiter for the same config', async () => {
      service = new RateLimiterService(createConfig())
      await service.consume('key1', defaultLimitConfig)
      await service.consume('key2', defaultLimitConfig)

      const state1 = await service.get('key1', defaultLimitConfig)
      const state2 = await service.get('key2', defaultLimitConfig)
      expect(state1!.consumedPoints).toBe(1)
      expect(state2!.consumedPoints).toBe(1)
    })

    it('creates separate limiters for different configs', async () => {
      service = new RateLimiterService(createConfig())
      const configA: RateLimitConfig = { points: 5, duration: 60, keyPrefix: 'a' }
      const configB: RateLimitConfig = { points: 10, duration: 120, keyPrefix: 'b' }

      await service.consume('same-key', configA)
      await service.consume('same-key', configB)

      const stateA = await service.get('same-key', configA)
      const stateB = await service.get('same-key', configB)
      expect(stateA!.remainingPoints).toBe(4)
      expect(stateB!.remainingPoints).toBe(9)
    })
  })

  describe('block duration', () => {
    it('blocks key after exceeding limit when blockDuration is set', async () => {
      service = new RateLimiterService(createConfig())
      const config: RateLimitConfig = {
        points: 2,
        duration: 60,
        blockDuration: 5,
        keyPrefix: 'block-test',
      }

      await service.consume('ip-block', config)
      await service.consume('ip-block', config)
      const blocked = await service.consume('ip-block', config)
      expect(blocked.allowed).toBe(false)
      expect(blocked.msBeforeNext).toBeGreaterThan(0)
    })
  })

  describe('config validation', () => {
    it('readRateLimitConfig throws for invalid strategy', async () => {
      const originalEnv = process.env.RATE_LIMIT_STRATEGY
      process.env.RATE_LIMIT_STRATEGY = 'invalid'

      const { readRateLimitConfig } = await import('../config')
      expect(() => readRateLimitConfig()).toThrow('Invalid RATE_LIMIT_STRATEGY "invalid"')

      process.env.RATE_LIMIT_STRATEGY = originalEnv
    })

    it('readRateLimitConfig uses defaults', async () => {
      const originalEnabled = process.env.RATE_LIMIT_ENABLED
      const originalStrategy = process.env.RATE_LIMIT_STRATEGY
      const originalPrefix = process.env.RATE_LIMIT_KEY_PREFIX
      delete process.env.RATE_LIMIT_ENABLED
      delete process.env.RATE_LIMIT_STRATEGY
      delete process.env.RATE_LIMIT_KEY_PREFIX

      const { readRateLimitConfig } = await import('../config')
      const config = readRateLimitConfig()

      expect(config.enabled).toBe(true)
      expect(config.strategy).toBe('memory')
      expect(config.keyPrefix).toBe('rl')

      process.env.RATE_LIMIT_ENABLED = originalEnabled
      process.env.RATE_LIMIT_STRATEGY = originalStrategy
      process.env.RATE_LIMIT_KEY_PREFIX = originalPrefix
    })
  })

  describe('destroy', () => {
    it('clears all limiters on destroy', async () => {
      service = new RateLimiterService(createConfig())
      await service.consume('key', defaultLimitConfig)
      await service.destroy()

      // After destroy, creating a new consume should work fresh
      service = new RateLimiterService(createConfig())
      const result = await service.consume('key', defaultLimitConfig)
      expect(result.allowed).toBe(true)
      expect(result.consumedPoints).toBe(1)
    })
  })
})
