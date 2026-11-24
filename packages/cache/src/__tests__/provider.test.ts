import { inspect } from 'node:util'
import {
  CACHE_PROVIDER_API_VERSION,
  CacheProviderError,
  createCacheProviderHostContext,
  defineCacheProvider,
  defineCacheProviderRegistration,
  getPreparedCacheProvider,
  prepareCacheProviderSelection,
  resetCacheProviderSelectionForTests,
  resolveCacheProvider,
  setCacheProviderRegistrations,
  type CacheProviderDefinition,
  type CacheProviderErrorCode,
  type CacheProviderRegistration,
  type CacheProviderSettingsSchema,
} from '../provider'
import { createMemoryStrategy } from '../strategies/memory'

const SECRET = 'sup3r-s3cret-password-value'

type FixtureConfig = { url: string; password: string; placement: 'local' | 'shared' }

const fixtureSchema: CacheProviderSettingsSchema<FixtureConfig> = {
  safeParse(input) {
    const record = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
    const issues: Array<{ path: PropertyKey[]; message: string }> = []
    if (typeof record.url !== 'string' || !record.url.startsWith('fixture://')) {
      issues.push({ path: ['url'], message: `expected fixture url, received ${String(record.url)}` })
    }
    if (typeof record.password !== 'string' || record.password.length < 4) {
      issues.push({ path: ['auth', 'password'], message: `bad password ${String(record.password)}` })
    }
    if (issues.length > 0) return { success: false, error: { issues } }
    return {
      success: true,
      data: {
        url: record.url as string,
        password: record.password as string,
        placement: record.placement === 'local' ? 'local' : 'shared',
      },
    }
  },
}

function fixtureDefinition(id = 'acme/fixture'): CacheProviderDefinition<FixtureConfig> {
  return defineCacheProvider<FixtureConfig>({
    id,
    settings: fixtureSchema,
    capability: (config) => ({ placement: config.placement }),
    create: () => ({ ...createMemoryStrategy(), healthcheck: async () => {}, close: async () => {} }),
  })
}

function registration(overrides: Partial<CacheProviderRegistration> & { id?: string } = {}): CacheProviderRegistration {
  const id = overrides.id ?? 'acme/fixture'
  return defineCacheProviderRegistration({
    id,
    load: async () => fixtureDefinition(id),
    settings: () => ({ url: 'fixture://local', password: SECRET }),
    ...overrides,
  })
}

const baseEnv = { CACHE_PROVIDER: 'acme/fixture', CACHE_PROVIDER_NAMESPACE: 'deploy-1' }

async function expectProviderError(promise: Promise<unknown>, code: CacheProviderErrorCode): Promise<CacheProviderError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(CacheProviderError)
    const providerError = error as CacheProviderError
    expect(providerError.code).toBe(code)
    return providerError
  }
  throw new Error(`expected CacheProviderError ${code}`)
}

function expectRedacted(error: CacheProviderError) {
  expect(error.message).not.toContain(SECRET)
  expect(JSON.stringify(error)).not.toContain(SECRET)
  expect(inspect(error, { depth: 10 })).not.toContain(SECRET)
  expect(String(error.stack)).not.toContain(SECRET)
}

describe('cache provider contract', () => {
  afterEach(() => {
    resetCacheProviderSelectionForTests()
  })

  it('defineCacheProvider stamps the supported api version', () => {
    const definition = fixtureDefinition()
    expect(definition.apiVersion).toBe(CACHE_PROVIDER_API_VERSION)
    expect(CACHE_PROVIDER_API_VERSION).toBe(1)
  })

  it('defineCacheProviderRegistration has no side effects', () => {
    const load = jest.fn(async () => fixtureDefinition())
    const settings = jest.fn(() => ({}))
    const result = defineCacheProviderRegistration({ id: 'acme/fixture', load, settings })
    expect(result.id).toBe('acme/fixture')
    expect(load).not.toHaveBeenCalled()
    expect(settings).not.toHaveBeenCalled()
  })

  it('returns null when CACHE_PROVIDER is unset or empty', async () => {
    const reg = registration({ load: jest.fn(async () => fixtureDefinition()), settings: jest.fn(() => ({})) })
    expect(await resolveCacheProvider([reg], { env: {} })).toBeNull()
    expect(await resolveCacheProvider([reg], { env: { CACHE_PROVIDER: '' } })).toBeNull()
    expect(await resolveCacheProvider([reg], { env: { CACHE_PROVIDER: '   ' } })).toBeNull()
    expect(reg.load).not.toHaveBeenCalled()
    expect(reg.settings).not.toHaveBeenCalled()
  })

  it('resolves the selected provider with config, placement and namespace', async () => {
    const resolved = await resolveCacheProvider([registration()], { env: baseEnv })
    expect(resolved).not.toBeNull()
    expect(resolved?.id).toBe('acme/fixture')
    expect(resolved?.placement).toBe('shared')
    expect(resolved?.namespace).toBe('deploy-1')
    expect(resolved?.config).toEqual({ url: 'fixture://local', password: SECRET, placement: 'shared' })
  })

  it('honours an explicit selectedId over the environment', async () => {
    const resolved = await resolveCacheProvider(
      [registration(), registration({ id: 'acme/other', load: async () => fixtureDefinition('acme/other') })],
      { env: baseEnv, selectedId: 'acme/other' },
    )
    expect(resolved?.id).toBe('acme/other')
  })

  it('never loads or evaluates settings of inactive registrations', async () => {
    const inactiveLoad = jest.fn(async () => fixtureDefinition('acme/inactive'))
    const inactiveSettings = jest.fn(() => ({ url: 'fixture://x', password: SECRET }))
    const activeSettings = jest.fn(() => ({ url: 'fixture://x', password: SECRET }))
    await resolveCacheProvider(
      [
        registration({ id: 'acme/inactive', load: inactiveLoad, settings: inactiveSettings }),
        registration({ settings: activeSettings }),
      ],
      { env: baseEnv },
    )
    expect(inactiveLoad).not.toHaveBeenCalled()
    expect(inactiveSettings).not.toHaveBeenCalled()
    expect(activeSettings).toHaveBeenCalledTimes(1)
  })

  describe('registration validation', () => {
    it.each(['memory', 'redis', 'sqlite', 'jsonfile', 'custom'])('rejects reserved id %s', async (id) => {
      await expectProviderError(resolveCacheProvider([registration({ id })], { env: {} }), 'reserved_id')
    })

    it.each(['Acme/fixture', 'acme/', '/fixture', 'acme/fix ture', 'acme/a/b', ''])('rejects invalid id %p', async (id) => {
      await expectProviderError(resolveCacheProvider([registration({ id })], { env: {} }), 'invalid_registration')
    })

    it('rejects missing load or settings functions', async () => {
      const noLoad = { id: 'acme/fixture', settings: () => ({}) } as unknown as CacheProviderRegistration
      const noSettings = { id: 'acme/fixture', load: async () => fixtureDefinition() } as unknown as CacheProviderRegistration
      await expectProviderError(resolveCacheProvider([noLoad], { env: {} }), 'invalid_registration')
      await expectProviderError(resolveCacheProvider([noSettings], { env: {} }), 'invalid_registration')
    })

    it('rejects duplicate ids before loading anything', async () => {
      const load = jest.fn(async () => fixtureDefinition())
      const error = await expectProviderError(
        resolveCacheProvider([registration({ load }), registration({ load })], { env: baseEnv }),
        'duplicate_id',
      )
      expect(error.providerId).toBe('acme/fixture')
      expect(load).not.toHaveBeenCalled()
    })

    it('rejects a reserved selection', async () => {
      await expectProviderError(
        resolveCacheProvider([registration()], { env: { ...baseEnv, CACHE_PROVIDER: 'redis' } }),
        'reserved_id',
      )
    })

    it('reports an unregistered selection', async () => {
      const error = await expectProviderError(
        resolveCacheProvider([registration()], { env: { ...baseEnv, CACHE_PROVIDER: 'acme/missing' } }),
        'not_registered',
      )
      expect(error.providerId).toBe('acme/missing')
    })
  })

  describe('definition validation', () => {
    it('wraps load failures without leaking the cause', async () => {
      const cause = new Error(`connect failed with password=${SECRET}`)
      const error = await expectProviderError(
        resolveCacheProvider([registration({ load: async () => { throw cause } })], { env: baseEnv }),
        'load_failed',
      )
      expect(error.originalError).toBe(cause)
      expect(Object.keys(error)).not.toContain('originalError')
      expectRedacted(error)
    })

    it('rejects unsupported api versions', async () => {
      const definition = { ...fixtureDefinition(), apiVersion: 2 } as unknown as CacheProviderDefinition<unknown>
      await expectProviderError(
        resolveCacheProvider([registration({ load: async () => definition })], { env: baseEnv }),
        'unsupported_api_version',
      )
    })

    it('rejects id mismatch between registration and definition', async () => {
      await expectProviderError(
        resolveCacheProvider([registration({ load: async () => fixtureDefinition('acme/else') })], { env: baseEnv }),
        'id_mismatch',
      )
    })

    it('rejects malformed definitions', async () => {
      const broken = { apiVersion: 1, id: 'acme/fixture', settings: {}, capability: () => ({ placement: 'shared' }), create: () => null } as unknown as CacheProviderDefinition<unknown>
      await expectProviderError(
        resolveCacheProvider([registration({ load: async () => broken })], { env: baseEnv }),
        'invalid_registration',
      )
      await expectProviderError(
        resolveCacheProvider([registration({ load: async () => null as unknown as CacheProviderDefinition<unknown> })], { env: baseEnv }),
        'invalid_registration',
      )
    })

    it('rejects an invalid placement from capability()', async () => {
      const definition = { ...fixtureDefinition(), capability: () => ({ placement: 'global' }) } as unknown as CacheProviderDefinition<unknown>
      await expectProviderError(
        resolveCacheProvider([registration({ load: async () => definition })], { env: baseEnv }),
        'invalid_registration',
      )
    })
  })

  describe('settings', () => {
    it('reports only field paths for invalid settings', async () => {
      const error = await expectProviderError(
        resolveCacheProvider(
          [registration({ settings: () => ({ url: `http://${SECRET}`, password: 'x' }) })],
          { env: baseEnv },
        ),
        'invalid_settings',
      )
      expect(error.fieldPaths).toEqual(['url', 'auth.password'])
      expect(error.message).toContain('url')
      expect(error.message).toContain('auth.password')
      expect(error.message).not.toContain('expected fixture url')
      expectRedacted(error)
    })

    it('wraps a throwing settings function without leaking the cause', async () => {
      const error = await expectProviderError(
        resolveCacheProvider(
          [registration({ settings: () => { throw new Error(`env ${SECRET} missing`) } })],
          { env: baseEnv },
        ),
        'invalid_settings',
      )
      expectRedacted(error)
    })

    it('requires a namespace', async () => {
      await expectProviderError(
        resolveCacheProvider([registration()], { env: { CACHE_PROVIDER: 'acme/fixture' } }),
        'missing_namespace',
      )
    })

    it.each(['has space', 'a'.repeat(65), 'tenant:1', 'ns/1'])('rejects invalid namespace %p', async (namespace) => {
      const error = await expectProviderError(
        resolveCacheProvider([registration()], { env: { ...baseEnv, CACHE_PROVIDER_NAMESPACE: namespace } }),
        'invalid_namespace',
      )
      expect(error.message).not.toContain(namespace)
    })
  })

  describe('error serialization', () => {
    it('serializes code, provider id and field paths only', () => {
      const error = new CacheProviderError('invalid_settings', 'bad', { providerId: 'acme/fixture', fieldPaths: ['url'], cause: SECRET })
      expect(JSON.parse(JSON.stringify(error))).toEqual({
        name: 'CacheProviderError',
        code: 'invalid_settings',
        message: 'bad',
        providerId: 'acme/fixture',
        fieldPaths: ['url'],
      })
      expectRedacted(error)
    })
  })

  describe('process selection holder', () => {
    const originalEnv = { ...process.env }

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('returns null when no provider is selected', async () => {
      delete process.env.CACHE_PROVIDER
      setCacheProviderRegistrations([registration()])
      await expect(prepareCacheProviderSelection()).resolves.toBeNull()
      expect(getPreparedCacheProvider()).toBeNull()
    })

    it('evaluates settings exactly once per process', async () => {
      process.env.CACHE_PROVIDER = 'acme/fixture'
      process.env.CACHE_PROVIDER_NAMESPACE = 'deploy-1'
      const settings = jest.fn(() => ({ url: 'fixture://x', password: SECRET }))
      const load = jest.fn(async () => fixtureDefinition())
      setCacheProviderRegistrations([registration({ settings, load })])
      const [first, second] = await Promise.all([prepareCacheProviderSelection(), prepareCacheProviderSelection()])
      const third = await prepareCacheProviderSelection()
      expect(first).toBe(second)
      expect(third).toBe(first)
      expect(settings).toHaveBeenCalledTimes(1)
      expect(load).toHaveBeenCalledTimes(1)
      expect(getPreparedCacheProvider()).toBe(first)
    })

    it('throws not_resolved when selection is required but not prepared', () => {
      process.env.CACHE_PROVIDER = 'acme/fixture'
      setCacheProviderRegistrations([registration()])
      try {
        getPreparedCacheProvider()
        throw new Error('expected not_resolved')
      } catch (error) {
        expect((error as CacheProviderError).code).toBe('not_resolved')
      }
    })

    it('treats empty CACHE_PROVIDER as unset in the accessor', () => {
      process.env.CACHE_PROVIDER = ''
      expect(getPreparedCacheProvider()).toBeNull()
    })

    it('memoizes and rethrows a failed selection', async () => {
      process.env.CACHE_PROVIDER = 'acme/missing'
      process.env.CACHE_PROVIDER_NAMESPACE = 'deploy-1'
      setCacheProviderRegistrations([registration()])
      await expectProviderError(prepareCacheProviderSelection(), 'not_registered')
      await expectProviderError(prepareCacheProviderSelection(), 'not_registered')
      expect(() => getPreparedCacheProvider()).toThrow(CacheProviderError)
    })

    it('is shared through a global symbol', async () => {
      process.env.CACHE_PROVIDER = 'acme/fixture'
      process.env.CACHE_PROVIDER_NAMESPACE = 'deploy-1'
      setCacheProviderRegistrations([registration()])
      await prepareCacheProviderSelection()
      const holder = (globalThis as Record<symbol, unknown>)[Symbol.for('@open-mercato/cache/provider-selection')]
      expect(holder).toBeDefined()
    })
  })

  describe('host context', () => {
    it('exposes namespace, codec helpers and a redacting logger', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const context = createCacheProviderHostContext({ id: 'acme/fixture', namespace: 'deploy-1' }, { defaultTtl: 500, codec: { compression: 'gzip', compressionMinBytes: 1 } })
        expect(context.namespace).toBe('deploy-1')
        expect(context.defaultTtl).toBe(500)
        const json = JSON.stringify({ value: 'x'.repeat(200) })
        const encoded = context.helpers.encode(json)
        expect(Buffer.isBuffer(encoded)).toBe(true)
        expect(context.helpers.decode(encoded)).toBe(json)
        expect(context.helpers.matchPattern('a:b', 'a:*')).toBe(true)
        context.logger.warn('reconnecting', { password: SECRET, attempt: 2, nested: { token: SECRET } })
        const logged = inspect(warn.mock.calls)
        expect(logged).not.toContain(SECRET)
        expect(logged).toContain('attempt')
      } finally {
        warn.mockRestore()
      }
    })
  })
})
