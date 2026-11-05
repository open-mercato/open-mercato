/** @jest-environment node */

import type { AwilixContainer } from 'awilix'
import {
  createHealthService,
  deriveIntegrationHealthStatus,
  getEffectiveHealthCheckConfig,
  HEALTH_CHECK_TIMEOUT_MS,
} from '../health-service'
import {
  clearRegisteredIntegrations,
  registerBundle,
  registerIntegration,
} from '@open-mercato/shared/modules/integrations/types'

describe('health-service', () => {
  const scope = { organizationId: 'org-1', tenantId: 'tenant-1' }

  beforeEach(() => {
    clearRegisteredIntegrations()
  })

  afterEach(() => {
    clearRegisteredIntegrations()
  })

  it('returns unconfigured when integration has no health check', async () => {
    registerIntegration({ id: 'int_plain', title: 'Plain' })
    const stateService = {
      upsert: jest.fn(),
    }
    const logService = {
      scoped: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    }
    const container = { resolve: jest.fn() } as unknown as AwilixContainer
    const service = createHealthService(container, stateService as never, logService as never)
    const result = await service.runHealthCheck('int_plain', scope)
    expect(result.status).toBe('unconfigured')
    expect(result.latencyMs).toBeNull()
    expect(stateService.upsert).not.toHaveBeenCalled()
  })

  it('returns unconfigured when credentials are missing', async () => {
    registerIntegration({
      id: 'int_hc',
      title: 'With HC',
      healthCheck: { service: 'mockHealth' },
    })
    const stateService = { upsert: jest.fn() }
    const logService = { scoped: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }
    const container = {
      resolve: (name: string) => {
        if (name === 'integrationCredentialsService') {
          return { resolve: jest.fn(async () => null) }
        }
        throw new Error(`unexpected ${name}`)
      },
    } as unknown as AwilixContainer
    const service = createHealthService(container, stateService as never, logService as never)
    const result = await service.runHealthCheck('int_hc', scope)
    expect(result.status).toBe('unconfigured')
    expect(stateService.upsert).not.toHaveBeenCalled()
  })

  it('times out slow checks and persists unhealthy', async () => {
    jest.useFakeTimers()
    registerIntegration({
      id: 'int_slow',
      title: 'Slow',
      healthCheck: { service: 'mockHealth' },
    })
    const upsert = jest.fn()
    const stateService = { upsert }
    const scopedLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const logService = { scoped: () => scopedLogger }
    const checker = {
      check: jest.fn(
        () => new Promise<{ status: 'healthy' }>(() => {}),
      ),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'integrationCredentialsService') {
          return { resolve: jest.fn(async () => ({ k: 'v' })) }
        }
        if (name === 'mockHealth') return checker
        throw new Error(`unexpected ${name}`)
      },
    } as unknown as AwilixContainer
    const service = createHealthService(container, stateService as never, logService as never)
    const pending = service.runHealthCheck('int_slow', scope)
    await jest.advanceTimersByTimeAsync(HEALTH_CHECK_TIMEOUT_MS + 50)
    const result = await pending
    expect(result.status).toBe('unhealthy')
    expect(result.message).toMatch(/timed out/i)
    expect(typeof result.latencyMs).toBe('number')
    expect(upsert).toHaveBeenCalledWith(
      'int_slow',
      expect.objectContaining({
        lastHealthStatus: 'unhealthy',
        lastHealthLatencyMs: expect.any(Number),
      }),
      scope,
    )
    jest.useRealTimers()
  })

  it('persists healthy status and logs info on successful check', async () => {
    registerIntegration({
      id: 'int_ok',
      title: 'OK',
      healthCheck: { service: 'mockHealth' },
    })
    const upsert = jest.fn()
    const stateService = { upsert }
    const infoFn = jest.fn()
    const scopedLogger = { info: infoFn, warn: jest.fn(), error: jest.fn() }
    const logService = { scoped: () => scopedLogger }
    const checker = {
      check: jest.fn(async () => ({ status: 'healthy' as const, message: 'All good' })),
    }
    const container = {
      resolve: (name: string) => {
        if (name === 'integrationCredentialsService') {
          return { resolve: jest.fn(async () => ({ apiKey: 'sk_test' })) }
        }
        if (name === 'mockHealth') return checker
        throw new Error(`unexpected ${name}`)
      },
    } as unknown as AwilixContainer
    const service = createHealthService(container, stateService as never, logService as never)
    const result = await service.runHealthCheck('int_ok', scope)
    expect(result.status).toBe('healthy')
    expect(result.message).toBe('All good')
    expect(typeof result.latencyMs).toBe('number')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(upsert).toHaveBeenCalledWith(
      'int_ok',
      expect.objectContaining({
        lastHealthStatus: 'healthy',
        lastHealthLatencyMs: expect.any(Number),
      }),
      scope,
    )
    expect(infoFn).toHaveBeenCalledWith(
      'Health check passed',
      expect.objectContaining({ status: 'healthy' }),
    )
  })

  it('deriveIntegrationHealthStatus marks missing checker as unconfigured', () => {
    expect(
      deriveIntegrationHealthStatus({
        hasHealthCheck: false,
        hasCredentials: true,
        lastHealthStatus: 'healthy',
        lastHealthCheckedAt: new Date(),
      }),
    ).toBe('unconfigured')
  })

  it('getEffectiveHealthCheckConfig reads bundle-level health check', () => {
    registerBundle({
      id: 'b1',
      title: 'B',
      description: 'd',
      credentials: { fields: [] },
      healthCheck: { service: 'bundleHc' },
    })
    registerIntegration({ id: 'child', title: 'Child', bundleId: 'b1' })
    expect(getEffectiveHealthCheckConfig('child')?.service).toBe('bundleHc')
  })
})
