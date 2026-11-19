jest.mock('@open-mercato/core/modules/configs/lib/module-config-service', () => ({
  createModuleConfigService: (container: { resolve: (name: string) => unknown }) => container.resolve('moduleConfigService'),
}))
jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => ({
  withAdvisoryXactLock: (
    em: { transactional: (callback: () => Promise<unknown>) => Promise<unknown> },
    _key: string,
    callback: (transactionEm: unknown) => Promise<unknown>,
  ) => em.transactional(() => callback(em)),
}))

import type { EmbeddingProviderConfig } from '../../../../../vector'
import { EMBEDDING_CONFIG_KEY } from '../../../../../vector'
import { SEARCH_AUTO_INDEX_CONFIG_KEY } from '../../../lib/auto-indexing'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}))
jest.mock('../../../../../lib/debug', () => ({
  searchError: jest.fn(), reportSearchError: jest.fn(), searchDebug: jest.fn(), searchDebugWarn: jest.fn(),
}))

import { POST } from '../route'

const originalConfig: EmbeddingProviderConfig = {
  providerId: 'openai', model: 'text-embedding-3-small', dimension: 1536, updatedAt: '2026-01-01T00:00:00Z',
}
const nextConfig = { ...originalConfig, model: 'text-embedding-ada-002' }
const otherTenantConfig = { ...originalConfig, model: 'other-tenant-model' }
const originalEnv = { ...process.env }

describe('tenant embedding updates preserve the shared index', () => {
  const configs = new Map<string, unknown>()
  const rows = new Map([['tenant-a', ['vector-a']], ['tenant-b', ['vector-b']]])
  const recreateWithDimension = jest.fn(async () => { rows.clear() })
  const getTableDimension = jest.fn()
  const setValue = jest.fn()
  const invalidate = jest.fn()
  const updateConfig = jest.fn()
  const dispose = jest.fn()
  const key = (tenantId: string, name: string) => `${tenantId}:${name}`

  function prepare(tenantId = 'tenant-a') {
    mockGetAuthFromRequest.mockResolvedValueOnce({ sub: 'user', tenantId })
    const service = {
      getValue: async (_module: string, name: string, options: { scope?: { tenantId?: string } }) =>
        configs.get(key(options.scope?.tenantId ?? '', name)) ?? null,
      getRecord: async (_module: string, name: string, scope?: { tenantId?: string }) => ({
        value: configs.get(key(scope?.tenantId ?? '', name)), source: 'tenant',
      }),
      setValue,
      invalidate,
    }
    mockCreateRequestContainer.mockResolvedValueOnce({
      resolve: (name: string) => {
        if (name === 'moduleConfigService') return service
        if (name === 'vectorDrivers') return [{ id: 'pgvector', getTableDimension, recreateWithDimension, count: async () => rows.get(tenantId)?.length ?? 0 }]
        if (name === 'vectorEmbeddingService') return { updateConfig }
        if (name === 'em') return {
          transactional: async <T,>(callback: () => Promise<T>): Promise<T> => {
            const snapshot = new Map(configs)
            try { return await callback() } catch (error) {
              configs.clear()
              for (const [entryKey, value] of snapshot) configs.set(entryKey, value)
              throw error
            }
          },
        }
        throw new Error(`[internal] Unknown service ${name}`)
      },
      dispose,
    })
  }

  function request(embeddingConfig: unknown = nextConfig, extra: Record<string, unknown> = {}, expectedVersion?: string) {
    return new Request('http://localhost/api/search/embeddings', {
      method: 'POST', headers: {
        'content-type': 'application/json',
        ...(expectedVersion ? { 'x-om-ext-optimistic-lock-expected-updated-at': expectedVersion } : {}),
      },
      body: JSON.stringify({ embeddingConfig, ...extra }),
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-placeholder', MISTRAL_API_KEY: 'test-placeholder' }
    delete process.env.OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING
    delete process.env.DISABLE_VECTOR_SEARCH_AUTOINDEXING
    configs.clear()
    configs.set(key('tenant-a', EMBEDDING_CONFIG_KEY), originalConfig)
    configs.set(key('tenant-b', EMBEDDING_CONFIG_KEY), otherTenantConfig)
    configs.set(key('tenant-a', SEARCH_AUTO_INDEX_CONFIG_KEY), true)
    rows.set('tenant-a', ['vector-a'])
    rows.set('tenant-b', ['vector-b'])
    getTableDimension.mockResolvedValue(1536)
    setValue.mockImplementation(async (_module: string, name: string, value: unknown, scope: { tenantId: string }) => {
      configs.set(key(scope.tenantId, name), value)
    })
  })
  afterAll(() => { process.env = originalEnv })

  it.each([
    ['model', nextConfig],
    ['provider', { providerId: 'mistral', model: 'mistral-embed', dimension: 1536 }],
    ['output dimensionality', { ...nextConfig, dimension: 3072, outputDimensionality: 1536 }],
  ])('saves a compatible %s change without clearing either tenant', async (_description, config) => {
    prepare()
    const response = await POST(request(config))
    expect(response.status).toBe(200)
    expect((await response.json()).settings).toMatchObject({ reindexRequired: true, indexedDimension: 1536, documentCount: 1 })
    expect(configs.get(key('tenant-a', EMBEDDING_CONFIG_KEY))).toMatchObject({ ...config, updatedAt: expect.any(String) })
    expect(configs.get(key('tenant-b', EMBEDDING_CONFIG_KEY))).toEqual(otherTenantConfig)
    expect([...rows]).toEqual([['tenant-a', ['vector-a']], ['tenant-b', ['vector-b']]])
    expect(recreateWithDimension).not.toHaveBeenCalled()
    expect(updateConfig).not.toHaveBeenCalled()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('rejects an incompatible first tenant override against an existing shared index', async () => {
    configs.delete(key('tenant-a', EMBEDDING_CONFIG_KEY))
    prepare()
    expect((await POST(request({ ...nextConfig, dimension: 768 }))).status).toBe(409)
    expect(setValue).not.toHaveBeenCalled()
    expect(rows.get('tenant-b')).toEqual(['vector-b'])
    expect(recreateWithDimension).not.toHaveBeenCalled()
  })

  it('accepts unchanged compatible settings without requesting reindex', async () => {
    prepare()
    const response = await POST(request(originalConfig))
    expect(response.status).toBe(200)
    expect((await response.json()).settings.reindexRequired).toBe(false)
    expect(recreateWithDimension).not.toHaveBeenCalled()
  })

  it('rejects a stale provider edit before either settings key changes', async () => {
    prepare()
    const saved = await POST(request(nextConfig, {}, originalConfig.updatedAt))
    expect(saved.status).toBe(200)
    const savedVersion = (await saved.json()).settings.embeddingConfig.updatedAt
    const beforeA = configs.get(key('tenant-a', EMBEDDING_CONFIG_KEY))
    const writes = setValue.mock.calls.length
    prepare()
    const stale = await POST(request(originalConfig, { autoIndexingEnabled: false }, originalConfig.updatedAt))
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ code: 'optimistic_lock_conflict', currentUpdatedAt: savedVersion })
    expect(setValue).toHaveBeenCalledTimes(writes)
    expect(configs.get(key('tenant-a', EMBEDDING_CONFIG_KEY))).toEqual(beforeA)
    expect(configs.get(key('tenant-a', SEARCH_AUTO_INDEX_CONFIG_KEY))).toBe(true)
    expect(configs.get(key('tenant-b', EMBEDDING_CONFIG_KEY))).toEqual(otherTenantConfig)
  })

  it('uses a stable first-override version and rejects its stale reuse', async () => {
    configs.delete(key('tenant-a', EMBEDDING_CONFIG_KEY))
    prepare()
    const first = await POST(request(nextConfig, {}, '1970-01-01T00:00:00.000Z'))
    expect(first.status).toBe(200)
    const stored = configs.get(key('tenant-a', EMBEDDING_CONFIG_KEY))
    prepare()
    expect((await POST(request(originalConfig, {}, '1970-01-01T00:00:00.000Z'))).status).toBe(409)
    expect(configs.get(key('tenant-a', EMBEDDING_CONFIG_KEY))).toEqual(stored)
  })

  it('refuses tenantless writes before resolving any persistence service', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce({ sub: 'user' })
    expect((await POST(request())).status).toBe(401)
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
  })

  it.each([
    { ...nextConfig, dimension: 768 },
    { ...nextConfig, outputDimensionality: 768 },
  ])('rejects incompatible dimensions before changing either settings key', async (config) => {
    prepare()
    const response = await POST(request(config, { autoIndexingEnabled: false }))
    expect(response.status).toBe(409)
    expect(setValue).not.toHaveBeenCalled()
    expect(configs.get(key('tenant-a', SEARCH_AUTO_INDEX_CONFIG_KEY))).toBe(true)
    expect(configs.get(key('tenant-a', EMBEDDING_CONFIG_KEY))).toEqual(originalConfig)
    expect(rows.get('tenant-b')).toEqual(['vector-b'])
    expect(recreateWithDimension).not.toHaveBeenCalled()
  })

  it.each(['missing table', 'catalog failure'])('fails closed on %s without settings or index changes', async (reason) => {
    if (reason === 'missing table') getTableDimension.mockResolvedValue(null)
    else getTableDimension.mockRejectedValue(new Error('[internal] catalog unavailable'))
    prepare()
    expect((await POST(request(nextConfig, { autoIndexingEnabled: false }))).status).toBe(503)
    expect(setValue).not.toHaveBeenCalled()
    expect(rows.size).toBe(2)
    expect(recreateWithDimension).not.toHaveBeenCalled()
  })

  it('rolls back both settings keys and invalidates cached settings after a failed write', async () => {
    setValue.mockImplementation(async (_module: string, name: string, value: unknown, scope: { tenantId: string }) => {
      if (name === SEARCH_AUTO_INDEX_CONFIG_KEY) throw new Error('[internal] injected failure')
      configs.set(key(scope.tenantId, name), value)
    })
    prepare()
    expect((await POST(request(nextConfig, { autoIndexingEnabled: false }))).status).toBe(500)
    expect(configs.get(key('tenant-a', EMBEDDING_CONFIG_KEY))).toEqual(originalConfig)
    expect(configs.get(key('tenant-a', SEARCH_AUTO_INDEX_CONFIG_KEY))).toBe(true)
    expect(invalidate).toHaveBeenCalledWith('vector', undefined, { tenantId: 'tenant-a' })
    expect(updateConfig).not.toHaveBeenCalled()
    expect(rows.size).toBe(2)
    expect(recreateWithDimension).not.toHaveBeenCalled()
  })

  it('rejects a concurrent incompatible request while a compatible update preserves both tenants', async () => {
    prepare('tenant-a')
    prepare('tenant-b')
    const responses = await Promise.all([POST(request(nextConfig)), POST(request({ ...nextConfig, dimension: 768 }))])
    expect(responses.map((response) => response.status)).toEqual([200, 409])
    expect(configs.get(key('tenant-b', EMBEDDING_CONFIG_KEY))).toEqual(otherTenantConfig)
    expect(rows.size).toBe(2)
    expect(recreateWithDimension).not.toHaveBeenCalled()
  })
})
