import { createMemoryStrategy } from '@open-mercato/cache'
import type { Module } from '../../modules/registry'
import { getModules } from '../../lib/modules/registry'
import { resetModuleContractOverridesForTests } from '../../modules/overrides'
import {
  authorizeFeatures,
  filterGrantsByModuleAvailability,
  getGrantNarrowingPlanCountForTests,
  hasGrantNarrowingPlanForTests,
  resolveEffectiveFeatures,
} from '../featurePolicy'
import {
  TENANT_MODULE_AVAILABILITY_DI_KEY,
  TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY,
  buildTenantModuleAvailabilityCacheTag,
  createTenantModuleAvailability,
  getTenantModuleAvailabilityGeneration,
  MAX_TRACKED_TENANT_MODULE_AVAILABILITY_STATES,
  resetTenantModuleAvailabilityStateForTests,
  resolveTenantModuleAvailability,
  type TenantModuleAvailabilityProvider,
} from '../tenantModuleAvailability'
import { registerTelemetryRuntime, type TelemetryRuntime } from '../../lib/telemetry/runtime'

jest.mock('../../lib/modules/registry', () => ({
  getModules: jest.fn(),
}))

const mockGetModules = jest.mocked(getModules)

const modules: Module[] = [
  {
    id: 'auth',
    features: [
      { id: 'auth.users.view', title: 'View users', module: 'auth' },
    ],
  },
  {
    id: 'sales',
    features: [
      { id: 'sales.orders.view', title: 'View orders', module: 'sales' },
      { id: 'sales.orders.manage', title: 'Manage orders', module: 'sales' },
    ],
    setup: {
      defaultCustomerRoleFeatures: {
        buyer: ['portal.orders.view'],
      },
    },
  },
  {
    id: 'sales_channels',
    features: [
      { id: 'sales_channels.view', title: 'View channels', module: 'sales_channels' },
    ],
  },
  {
    id: 'dashboards',
    features: [
      { id: 'analytics.view', title: 'View analytics', module: 'dashboards' },
    ],
  },
  {
    id: 'customer_accounts',
    setup: {
      defaultCustomerRoleFeatures: {
        portal_admin: ['portal.*'],
        buyer: ['portal.account.manage'],
      },
    },
  },
]

function createProvider(
  unavailableByTenant: Record<string, readonly string[]>,
  overrides: Partial<TenantModuleAvailabilityProvider> = {},
): TenantModuleAvailabilityProvider & { getUnavailableModuleIds: jest.Mock } {
  return {
    governedModuleIds: ['sales', 'dashboards'],
    ...overrides,
    getUnavailableModuleIds: jest.fn(async ({ tenantId }: { tenantId: string }) => unavailableByTenant[tenantId] ?? []),
  }
}

describe('feature policy with per-tenant module availability', () => {
  beforeEach(() => {
    mockGetModules.mockReturnValue(modules)
    resetModuleContractOverridesForTests()
  })

  afterEach(() => {
    resetModuleContractOverridesForTests()
    jest.resetAllMocks()
  })

  it.each([
    { label: 'explicit grant', grantedFeatures: ['sales.orders.view'], unrestricted: false },
    { label: 'module wildcard', grantedFeatures: ['sales.*'], unrestricted: false },
    { label: 'global wildcard', grantedFeatures: ['*'], unrestricted: false },
    { label: 'super admin', grantedFeatures: [], unrestricted: true },
  ])('denies features of an unavailable module for a $label', ({ grantedFeatures, unrestricted }) => {
    const unavailableModuleIds = new Set(['sales'])
    expect(authorizeFeatures(['sales.orders.view'], { grantedFeatures, unrestricted })).toBe(true)
    expect(authorizeFeatures(['sales.orders.view'], { grantedFeatures, unrestricted, unavailableModuleIds })).toBe(false)
  })

  it('keeps features of other modules available', () => {
    expect(authorizeFeatures(['auth.users.view'], {
      grantedFeatures: ['*'],
      unrestricted: true,
      unavailableModuleIds: ['sales'],
    })).toBe(true)
  })

  it('denies a mixed requirement when any feature belongs to an unavailable module', () => {
    expect(authorizeFeatures(['auth.users.view', 'sales.orders.view'], {
      grantedFeatures: ['*'],
      unavailableModuleIds: ['sales'],
    })).toBe(false)
  })

  it('resolves ownership through declared modules for off-convention features', () => {
    expect(authorizeFeatures(['analytics.view'], {
      grantedFeatures: ['analytics.*'],
      unavailableModuleIds: ['dashboards'],
    })).toBe(false)
    expect(resolveEffectiveFeatures(['*'], { unavailableModuleIds: ['dashboards'] })).not.toContain('analytics.view')
  })

  it('denies portal features owned by an unavailable module even to a portal admin', () => {
    const subject = { grantedFeatures: ['portal.*'], unrestricted: true, unavailableModuleIds: ['sales'] }
    expect(authorizeFeatures(['portal.orders.view'], subject)).toBe(false)
    expect(authorizeFeatures(['portal.account.manage'], subject)).toBe(true)
    expect(resolveEffectiveFeatures(['portal.*'], { unavailableModuleIds: ['sales'] })).toEqual(['portal.account.manage'])
  })

  it('removes unavailable modules from effective features without changing the rest', () => {
    expect(resolveEffectiveFeatures(['*'])).toEqual([
      'auth.users.view',
      'sales.orders.view',
      'sales.orders.manage',
      'portal.orders.view',
      'sales_channels.view',
      'analytics.view',
      'portal.account.manage',
    ])
    expect(resolveEffectiveFeatures(['*'], { unavailableModuleIds: new Set(['sales']) })).toEqual([
      'auth.users.view',
      'sales_channels.view',
      'analytics.view',
      'portal.account.manage',
    ])
    expect(resolveEffectiveFeatures(['sales.orders.view', 'sales.custom.export', 'auth.users.view'], {
      unavailableModuleIds: ['sales'],
    })).toEqual(['auth.users.view'])
  })

  it('drops explicit grants of unavailable modules when the registry is unavailable', () => {
    mockGetModules.mockImplementation(() => {
      throw new Error('registry unavailable')
    })
    expect(resolveEffectiveFeatures(['sales.orders.view', 'auth.users.view'], {
      unavailableModuleIds: ['sales'],
    })).toEqual(['auth.users.view'])
  })

  it('does not confuse a module with another module whose id it prefixes', () => {
    const subject = { grantedFeatures: ['*'], unrestricted: true }
    expect(authorizeFeatures(['sales_channels.view'], { ...subject, unavailableModuleIds: ['sales'] })).toBe(true)
    expect(authorizeFeatures(['sales.orders.view'], { ...subject, unavailableModuleIds: ['sales_channels'] })).toBe(true)
    expect(authorizeFeatures(['sales_channels.view'], { ...subject, unavailableModuleIds: ['sales_channels'] })).toBe(false)
    expect(resolveEffectiveFeatures(['sales.*', 'sales_channels.*'], { unavailableModuleIds: ['sales'] }))
      .toEqual(['sales_channels.view'])
    expect(filterGrantsByModuleAvailability(['sales.*', 'sales_channels.*'], ['sales'])).toEqual(['sales_channels.*'])
  })

  it.each([
    'sales',
    'sales.*',
    'sales.orders-export.view',
    'sales.orders.view.extra',
    'sales.Orders.View',
  ])('denies unusual feature id %s owned by an unavailable module', (featureId) => {
    expect(authorizeFeatures([featureId], {
      grantedFeatures: ['*'],
      unrestricted: true,
      unavailableModuleIds: ['sales'],
    })).toBe(false)
  })

  it('never authorizes a global wildcard requirement while a module is unavailable', () => {
    expect(authorizeFeatures(['*'], {
      grantedFeatures: ['*'],
      unrestricted: true,
      unavailableModuleIds: ['sales'],
    })).toBe(false)
  })

  it('treats object-prototype names as plain module ids', () => {
    expect(authorizeFeatures(['auth.users.view'], {
      grantedFeatures: ['*'],
      unrestricted: true,
      unavailableModuleIds: ['__proto__', 'constructor', 'toString'],
    })).toBe(true)
    expect(filterGrantsByModuleAvailability(['auth.users.view', 'constructor.view'], ['constructor']))
      .toEqual(['auth.users.view'])
  })

  it('assigns a feature declared by several modules to the module named by its prefix', () => {
    mockGetModules.mockReturnValue([
      ...modules,
      { id: 'reports', setup: { defaultCustomerRoleFeatures: { buyer: ['invoices.portal.view'] } } },
      { id: 'invoices', setup: { defaultCustomerRoleFeatures: { buyer: ['invoices.portal.view'] } } },
    ])
    expect(authorizeFeatures(['invoices.portal.view'], {
      grantedFeatures: ['*'],
      unrestricted: true,
      unavailableModuleIds: ['invoices'],
    })).toBe(false)
    expect(authorizeFeatures(['invoices.portal.view'], {
      grantedFeatures: ['*'],
      unrestricted: true,
      unavailableModuleIds: ['reports'],
    })).toBe(true)
  })

  it('treats an empty unavailable set exactly like no restriction', () => {
    expect(resolveEffectiveFeatures(['*'], { unavailableModuleIds: [] })).toEqual(resolveEffectiveFeatures(['*']))
    expect(authorizeFeatures(['sales.orders.view'], {
      grantedFeatures: ['sales.*'],
      unavailableModuleIds: new Set(),
    })).toBe(true)
  })

  it('filters raw grants and expanded wildcards by module availability', () => {
    expect(filterGrantsByModuleAvailability(['sales.*', 'sales.orders.view', 'auth.users.view', 'analytics.*'], ['sales', 'dashboards']))
      .toEqual(['auth.users.view'])
    expect(filterGrantsByModuleAvailability(['sales.*'], undefined)).toEqual(['sales.*'])
    expect(filterGrantsByModuleAvailability(['auth.*', 'sales.*'], [])).toEqual(['auth.*', 'sales.*'])
  })

  it('evicts the least recently used narrowing plan instead of dropping every plan', () => {
    filterGrantsByModuleAvailability(['sales.*'], ['sales'])
    for (let index = 0; index < 15; index += 1) {
      filterGrantsByModuleAvailability(['sales.*'], [`other_${index}`])
      filterGrantsByModuleAvailability(['sales.*'], ['sales'])
    }
    filterGrantsByModuleAvailability(['sales.*'], ['other_overflow'])

    expect(getGrantNarrowingPlanCountForTests()).toBe(16)
    expect(hasGrantNarrowingPlanForTests(['sales'])).toBe(true)
    expect(hasGrantNarrowingPlanForTests(['other_0'])).toBe(false)
  })

  it('narrows a wildcard shared by several modules to the concrete features still available', () => {
    expect(filterGrantsByModuleAvailability(['portal.*'], ['sales'])).toEqual(['portal.account.manage'])
  })

  it('fails closed for wildcards it cannot expand when the registry is unavailable', () => {
    mockGetModules.mockImplementation(() => {
      throw new Error('registry unavailable')
    })
    expect(filterGrantsByModuleAvailability(['*', 'sales.*', 'auth.*', 'sales.orders.view', 'auth.users.view'], ['sales']))
      .toEqual(['auth.*', 'auth.users.view'])
  })
})

type ReportedError = { code?: string }

function captureReportedErrors(): { codes: string[]; restore: () => void } {
  const codes: string[] = []
  const runtime: TelemetryRuntime = {
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => ({}),
    continueTrace: (_carrier, _name, run) => run(),
    recordHttpDuration: () => undefined,
    reportError: (_error, context?: ReportedError) => {
      codes.push(context?.code ?? '')
    },
    shutdown: async () => undefined,
  }
  return { codes, restore: registerTelemetryRuntime(runtime) }
}

describe('createTenantModuleAvailability', () => {
  beforeEach(() => {
    mockGetModules.mockReturnValue(modules)
    resetTenantModuleAvailabilityStateForTests()
  })

  afterEach(() => {
    jest.resetAllMocks()
    jest.useRealTimers()
  })

  it('answers per tenant and caches each tenant set', async () => {
    const provider = createProvider({ 'tenant-a': ['sales'] })
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    await expect(availability.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(false)
    await expect(availability.isModuleAvailable('sales', { tenantId: 'tenant-b' })).resolves.toBe(true)
    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })).resolves.toEqual(new Set(['sales']))
    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })).resolves.toEqual(new Set(['sales']))

    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(2)
    expect(provider.getUnavailableModuleIds).toHaveBeenCalledWith({ tenantId: 'tenant-a' })
    expect(provider.getUnavailableModuleIds).toHaveBeenCalledWith({ tenantId: 'tenant-b' })
  })

  it('never consults the provider for ungoverned modules', async () => {
    const provider = createProvider({ 'tenant-a': ['sales'] })
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    await expect(availability.isModuleAvailable('auth', { tenantId: 'tenant-a' })).resolves.toBe(true)
    expect(provider.getUnavailableModuleIds).not.toHaveBeenCalled()
  })

  it('ignores module ids the provider does not govern', async () => {
    const provider = createProvider({ 'tenant-a': ['sales', 'auth'] })
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })).resolves.toEqual(new Set(['sales']))
  })

  it('re-reads a tenant after explicit invalidation, leaving other tenants cached', async () => {
    const state: Record<string, string[]> = { 'tenant-a': ['sales'], 'tenant-b': ['dashboards'] }
    const provider = createProvider(state)
    provider.getUnavailableModuleIds.mockImplementation(async ({ tenantId }) => state[tenantId] ?? [])
    const cache = createMemoryStrategy()
    const availability = createTenantModuleAvailability({ provider, cache })

    await availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })
    await availability.getUnavailableModuleIds({ tenantId: 'tenant-b' })
    state['tenant-a'] = []

    await expect(availability.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(false)
    await availability.invalidate('tenant-a')
    await expect(availability.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(true)
    await availability.getUnavailableModuleIds({ tenantId: 'tenant-b' })

    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(3)
  })

  it('invalidates through the exported cache tag from another service instance', async () => {
    const provider = createProvider({ 'tenant-a': ['sales'] })
    const cache = createMemoryStrategy()
    const first = createTenantModuleAvailability({ provider, cache })
    await first.getUnavailableModuleIds({ tenantId: 'tenant-a' })

    await createTenantModuleAvailability({ provider, cache }).invalidate('tenant-a')
    await first.getUnavailableModuleIds({ tenantId: 'tenant-a' })

    expect(buildTenantModuleAvailabilityCacheTag('tenant-a')).toBe('tenant_module_availability:tenant:tenant-a')
    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(2)
  })

  it('expires cached sets after the bounded TTL', async () => {
    const provider = createProvider({ 'tenant-a': ['sales'] }, { cacheTtlMs: 5 })
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    await availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })

    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight provider call between concurrent checks for a tenant', async () => {
    const provider = createProvider({ 'tenant-a': ['sales'] })
    const availability = createTenantModuleAvailability({ provider, cache: null })

    const results = await Promise.all([
      availability.isModuleAvailable('sales', { tenantId: 'tenant-a' }),
      availability.isModuleAvailable('sales', { tenantId: 'tenant-a' }),
      availability.isModuleAvailable('dashboards', { tenantId: 'tenant-a' }),
    ])

    expect(results).toEqual([false, false, true])
    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(1)
  })

  it('fails closed for governed modules when the provider throws, without caching the failure', async () => {
    const provider = createProvider({})
    provider.getUnavailableModuleIds
      .mockRejectedValueOnce(new Error('entitlement store offline'))
      .mockResolvedValue([])
    const cache = createMemoryStrategy()
    const availability = createTenantModuleAvailability({ provider, cache, failureRetryMs: 0 })

    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' }))
      .resolves.toEqual(new Set(['sales', 'dashboards']))
    await expect(availability.isModuleAvailable('auth', { tenantId: 'tenant-a' })).resolves.toBe(true)
    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })).resolves.toEqual(new Set())
    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the provider exceeds its timeout', async () => {
    const provider = createProvider({}, { timeoutMs: 10 })
    provider.getUnavailableModuleIds.mockImplementation(() => new Promise(() => undefined))
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    await expect(availability.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(false)
    await expect(availability.isModuleAvailable('dashboards', { tenantId: 'tenant-a' })).resolves.toBe(false)
  })

  it('fails closed when the provider returns a malformed value', async () => {
    const provider = createProvider({})
    provider.getUnavailableModuleIds.mockResolvedValue('sales' as unknown as string[])
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' }))
      .resolves.toEqual(new Set(['sales', 'dashboards']))
  })

  it('backs off from a failing provider for the retry window', async () => {
    const provider = createProvider({})
    provider.getUnavailableModuleIds.mockRejectedValue(new Error('entitlement store offline'))
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy(), failureRetryMs: 60_000 })

    await availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })
    await availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })

    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(1)
  })

  it('shares back-off and in-flight state across provider objects re-created per request', async () => {
    let calls = 0
    const hungProviderForRequest = (): TenantModuleAvailabilityProvider => ({
      governedModuleIds: ['dashboards', 'sales'],
      timeoutMs: 40,
      getUnavailableModuleIds: () => {
        calls += 1
        return new Promise<readonly string[]>(() => undefined)
      },
    })
    const cache = createMemoryStrategy()
    const requestCheck = () => createTenantModuleAvailability({ provider: hungProviderForRequest(), cache, failureRetryMs: 60_000 })
      .getUnavailableModuleIds({ tenantId: 'tenant-a' })

    const concurrent = await Promise.all([requestCheck(), requestCheck(), requestCheck()])
    expect(concurrent).toEqual([new Set(['sales', 'dashboards']), new Set(['sales', 'dashboards']), new Set(['sales', 'dashboards'])])
    expect(calls).toBe(1)

    const started = Date.now()
    for (let request = 0; request < 5; request += 1) {
      await expect(requestCheck()).resolves.toEqual(new Set(['sales', 'dashboards']))
    }
    expect(Date.now() - started).toBeLessThan(40)
    expect(calls).toBe(1)
  })

  it('does not cache an answer that was in flight when the tenant was invalidated', async () => {
    let releaseStaleAnswer: (value: readonly string[]) => void = () => undefined
    const provider = createProvider({})
    provider.getUnavailableModuleIds
      .mockImplementationOnce(() => new Promise<readonly string[]>((resolve) => {
        releaseStaleAnswer = resolve
      }))
      .mockResolvedValue([])
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    const staleCheck = availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await availability.invalidate('tenant-a')
    releaseStaleAnswer(['sales'])
    await staleCheck

    await expect(availability.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(true)
    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(2)
  })

  it('keeps cached answers of providers governing different modules apart', async () => {
    const cache = createMemoryStrategy()
    const salesProvider = createProvider({ 'tenant-a': ['sales'] }, { governedModuleIds: ['sales'] })
    const dashboardsProvider = createProvider({ 'tenant-a': ['dashboards'] }, { governedModuleIds: ['dashboards'] })

    await expect(createTenantModuleAvailability({ provider: salesProvider, cache }).getUnavailableModuleIds({ tenantId: 'tenant-a' }))
      .resolves.toEqual(new Set(['sales']))
    await expect(createTenantModuleAvailability({ provider: dashboardsProvider, cache }).getUnavailableModuleIds({ tenantId: 'tenant-a' }))
      .resolves.toEqual(new Set(['dashboards']))
    expect(dashboardsProvider.getUnavailableModuleIds).toHaveBeenCalledTimes(1)
  })

  it('never caches an in-flight answer once its tenant version was evicted from the bounded store', async () => {
    let releaseStaleAnswer: (value: readonly string[]) => void = () => undefined
    const provider = createProvider({})
    provider.getUnavailableModuleIds
      .mockImplementationOnce(() => new Promise<readonly string[]>((resolve) => {
        releaseStaleAnswer = resolve
      }))
      .mockResolvedValue([])
    const cache = createMemoryStrategy()
    const availability = createTenantModuleAvailability({ provider, cache })

    const staleCheck = availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const before = getTenantModuleAvailabilityGeneration('tenant-a')
    await availability.invalidate('tenant-a')
    for (let index = 0; index < MAX_TRACKED_TENANT_MODULE_AVAILABILITY_STATES; index += 1) {
      await createTenantModuleAvailability({ provider, cache: null }).invalidate(`tenant-${index}`)
    }
    expect(getTenantModuleAvailabilityGeneration('tenant-a')).not.toBe(before)
    releaseStaleAnswer(['sales'])
    await staleCheck

    await expect(availability.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(true)
  })

  it('never caches an answer that was in flight in another process when the tenant was invalidated', async () => {
    type AvailabilityModule = typeof import('../tenantModuleAvailability')
    const loadProcessCopy = (): AvailabilityModule => {
      let copy: AvailabilityModule | null = null
      jest.isolateModules(() => {
        copy = jest.requireActual<AvailabilityModule>('../tenantModuleAvailability')
      })
      return copy!
    }
    const sharedCache = createMemoryStrategy()
    let currentAnswer: readonly string[] = ['sales']
    let releaseStaleAnswer: (value: readonly string[]) => void = () => undefined
    const slowProcessProvider = createProvider({})
    slowProcessProvider.getUnavailableModuleIds.mockImplementationOnce(() => new Promise<readonly string[]>((resolve) => {
      releaseStaleAnswer = resolve
    }))
    const otherProcessProvider = createProvider({})
    otherProcessProvider.getUnavailableModuleIds.mockImplementation(async () => currentAnswer)

    const slowProcess = loadProcessCopy().createTenantModuleAvailability({ provider: slowProcessProvider, cache: sharedCache })
    const otherProcess = loadProcessCopy().createTenantModuleAvailability({ provider: otherProcessProvider, cache: sharedCache })

    const staleCheck = slowProcess.getUnavailableModuleIds({ tenantId: 'tenant-a' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    currentAnswer = []
    await otherProcess.invalidate('tenant-a')
    releaseStaleAnswer(['sales'])
    await staleCheck

    await expect(otherProcess.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(true)
    expect(otherProcessProvider.getUnavailableModuleIds).toHaveBeenCalledTimes(1)
  })

  it('drops an entry written after another process invalidated between the stamp check and the write', async () => {
    type AvailabilityModule = typeof import('../tenantModuleAvailability')
    const loadProcessCopy = (): AvailabilityModule => {
      let copy: AvailabilityModule | null = null
      jest.isolateModules(() => {
        copy = jest.requireActual<AvailabilityModule>('../tenantModuleAvailability')
      })
      return copy!
    }
    const sharedCache = createMemoryStrategy()
    let currentAnswer: readonly string[] = ['sales']
    const writerProvider = createProvider({})
    writerProvider.getUnavailableModuleIds.mockImplementation(async () => currentAnswer)
    const invalidatorProvider = createProvider({})
    invalidatorProvider.getUnavailableModuleIds.mockImplementation(async () => currentAnswer)
    const invalidator = loadProcessCopy().createTenantModuleAvailability({ provider: invalidatorProvider, cache: sharedCache })
    let invalidatedDuringWrite = false
    const writerCache = {
      get: (key: string) => sharedCache.get(key),
      delete: (key: string) => sharedCache.delete(key),
      deleteByTags: (tags: string[]) => sharedCache.deleteByTags(tags),
      set: async (key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) => {
        if (!invalidatedDuringWrite && !key.startsWith('tenant_module_availability_stamp:')) {
          invalidatedDuringWrite = true
          currentAnswer = []
          await invalidator.invalidate('tenant-a')
        }
        await sharedCache.set(key, value, options)
      },
    }
    const writer = loadProcessCopy().createTenantModuleAvailability({ provider: writerProvider, cache: writerCache })

    await expect(writer.getUnavailableModuleIds({ tenantId: 'tenant-a' })).resolves.toEqual(new Set(['sales']))
    expect(invalidatedDuringWrite).toBe(true)

    await expect(invalidator.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(true)
    expect(invalidatorProvider.getUnavailableModuleIds).toHaveBeenCalledTimes(1)
  })

  it('keeps invalidation stamps apart from entries whatever the governed module ids are', async () => {
    const provider = createProvider({ 'tenant-a': ['invalidated'] }, { governedModuleIds: ['invalidated'] })
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    await availability.invalidate('tenant-a')
    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })).resolves.toEqual(new Set(['invalidated']))
    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })).resolves.toEqual(new Set(['invalidated']))

    expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(1)
  })

  it('drops the cached answer and reports when the post-write stamp re-check fails', async () => {
    const reported = captureReportedErrors()
    try {
      const sharedCache = createMemoryStrategy()
      let stampReads = 0
      const flakyCache = {
        get: async (key: string) => {
          if (key.startsWith('tenant_module_availability_stamp:')) {
            stampReads += 1
            if (stampReads === 3) throw new Error('cache offline')
          }
          return sharedCache.get(key)
        },
        set: (key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) => sharedCache.set(key, value, options),
        delete: (key: string) => sharedCache.delete(key),
        deleteByTags: (tags: string[]) => sharedCache.deleteByTags(tags),
      }
      const provider = createProvider({ 'tenant-a': ['sales'] })
      const availability = createTenantModuleAvailability({ provider, cache: flakyCache })

      await availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })
      await createTenantModuleAvailability({ provider, cache: sharedCache }).getUnavailableModuleIds({ tenantId: 'tenant-a' })

      expect(provider.getUnavailableModuleIds).toHaveBeenCalledTimes(2)
      expect(reported.codes).toContain('tenant_module_availability.cache_recheck_failed')
    } finally {
      reported.restore()
    }
  })

  it('reports cache read and write failures and still answers from the provider', async () => {
    const reported = captureReportedErrors()
    try {
      const provider = createProvider({ 'tenant-a': ['sales'] })
      const failingCache = {
        get: async () => {
          throw new Error('cache offline')
        },
        set: async () => {
          throw new Error('cache offline')
        },
        delete: async () => false,
        deleteByTags: async () => 0,
      }
      const availability = createTenantModuleAvailability({ provider, cache: failingCache })

      await expect(availability.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(false)
      expect(new Set(reported.codes)).toEqual(new Set([
        'tenant_module_availability.cache_read_failed',
        'tenant_module_availability.cache_write_failed',
      ]))
    } finally {
      reported.restore()
    }
  })

  it('reports a provider failure with a stable code', async () => {
    const reported = captureReportedErrors()
    try {
      const provider = createProvider({})
      provider.getUnavailableModuleIds.mockRejectedValue(new Error('entitlement store offline'))
      await createTenantModuleAvailability({ provider, cache: null }).getUnavailableModuleIds({ tenantId: 'tenant-a' })
      expect(reported.codes).toEqual(['tenant_module_availability.provider_failed'])
    } finally {
      reported.restore()
    }
  })

  it('does not call a provider that governs no modules', async () => {
    const provider = createProvider({ 'tenant-a': ['sales'] }, { governedModuleIds: [] })
    const availability = createTenantModuleAvailability({ provider, cache: createMemoryStrategy() })

    await expect(availability.getUnavailableModuleIds({ tenantId: 'tenant-a' })).resolves.toEqual(new Set())
    expect(provider.getUnavailableModuleIds).not.toHaveBeenCalled()
  })
})

describe('resolveTenantModuleAvailability', () => {
  beforeEach(() => {
    resetTenantModuleAvailabilityStateForTests()
  })

  function createContainer(registrations: Record<string, unknown>) {
    return {
      hasRegistration: (name: string) => name in registrations,
      resolve: <T,>(name: string): T => registrations[name] as T,
    }
  }

  it('returns null when no provider is registered', () => {
    expect(resolveTenantModuleAvailability(createContainer({ cache: createMemoryStrategy() }))).toBeNull()
  })

  it('returns null for an invalid provider registration and reports it once per process', () => {
    const reported = captureReportedErrors()
    try {
      for (let request = 0; request < 3; request += 1) {
        expect(resolveTenantModuleAvailability(createContainer({
          [TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY]: { governedModuleIds: ['sales'] },
        }))).toBeNull()
      }
      expect(reported.codes).toEqual(['tenant_module_availability.provider_invalid'])
    } finally {
      reported.restore()
    }
  })

  it('builds the service from the registered provider and cache', async () => {
    const provider = createProvider({ 'tenant-a': ['sales'] })
    const availability = resolveTenantModuleAvailability(createContainer({
      [TENANT_MODULE_AVAILABILITY_PROVIDER_DI_KEY]: provider,
      cache: createMemoryStrategy(),
    }))

    expect(TENANT_MODULE_AVAILABILITY_DI_KEY).toBe('tenantModuleAvailability')
    await expect(availability?.isModuleAvailable('sales', { tenantId: 'tenant-a' })).resolves.toBe(false)
  })
})
