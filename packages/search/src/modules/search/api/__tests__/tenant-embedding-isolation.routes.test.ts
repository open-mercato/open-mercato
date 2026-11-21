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

import { asValue, createContainer } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EmbeddingProviderConfig } from '../../../../vector'

const mockAuth = jest.fn()
const mockContainer = jest.fn()
const mockEmbed = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: (...args: unknown[]) => mockAuth(...args) }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: () => mockContainer() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({ resolveTranslations: async () => ({ t: (key: string) => key }) }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({ selectedId: null, filterIds: null, allowedIds: null }),
}))
jest.mock('../../lib/global-search-config', () => ({ resolveGlobalSearchStrategies: async () => ['vector'] }))
jest.mock('../../lib/provider-probe', () => ({
  createEmbeddingProviderProbe: () => ({ checkAvailability: async () => ({ available: true }) }),
  checkAllProviders: async () => [],
}))
jest.mock('../../../../fulltext/drivers', () => ({ createFulltextDriver: () => null }))
jest.mock('ai', () => ({ embed: (...args: unknown[]) => mockEmbed(...args) }))
jest.mock('@ai-sdk/openai', () => ({ createOpenAI: () => ({ embedding: (model: string) => ({ provider: 'openai', model }) }) }))
jest.mock('ai-sdk-ollama', () => ({ createOllama: ({ baseURL }: { baseURL: string }) => ({ embedding: (model: string) => ({ provider: 'ollama', baseURL, model }) }) }))
jest.mock('../../../../vector/drivers/pgvector', () => ({ createPgVectorDriver: () => ({ id: 'pgvector', getTableDimension: async () => 1536, count: async () => 0, ensureReady: async () => {}, query: async () => [] }) }))
jest.mock('../../../../vector/drivers/chromadb', () => ({ createChromaDbDriver: () => ({}) }))
jest.mock('../../../../vector/drivers/qdrant', () => ({ createQdrantDriver: () => ({}) }))
jest.mock('../../../../queue/vector-indexing', () => ({ createVectorIndexingQueue: () => ({ close: async () => {} }) }))
jest.mock('../../../../queue/fulltext-indexing', () => ({ createFulltextIndexingQueue: () => ({ close: async () => {} }) }))

import { register } from '../../di'
import { registerSearchModule } from '../../../../di'
import { POST as saveSettings } from '../embeddings/route'
import { GET as globalSearch } from '../search/global/route'
import { GET as hybridSearch } from '../search/route'

const originalEnv = { ...process.env }
const tenantConfig: EmbeddingProviderConfig = {
  providerId: 'ollama', model: 'nomic-embed-text', dimension: 1536,
  baseUrl: 'https://tenant-a.example', updatedAt: '2026-01-01T00:00:00Z',
}

function requestContainer(configs: Map<string, EmbeddingProviderConfig>, instanceConfig?: EmbeddingProviderConfig) {
  const container = createContainer() as AppContainer
  const getValue = jest.fn(async (_module: string, _key: string, options: { scope?: { tenantId?: string } }) =>
    configs.get(options.scope?.tenantId ?? '') ?? instanceConfig ?? null)
  container.register({
    moduleConfigService: asValue({ getValue,
      getRecord: async (_module: string, _key: string, scope: { tenantId?: string }) => ({ value: configs.get(scope.tenantId ?? ''), source: 'tenant' }),
      invalidate: async () => {},
      setValue: async (_module: string, _key: string, value: EmbeddingProviderConfig, scope: { tenantId: string }) => { configs.set(scope.tenantId, value) },
    }),
    em: asValue({ transactional: async (callback: () => Promise<void>) => callback() }),
    rbacService: asValue({ loadAcl: async () => ({ isSuperAdmin: true, features: ['*'], organizations: null }) }),
  })
  register(container)
  registerSearchModule(container, { skipTokens: true, skipFulltext: true })
  return { container, getValue }
}

describe.each([['global', globalSearch], ['hybrid', hybridSearch]] as const)('%s search embedding tenant isolation', (_name, search) => {
  beforeEach(() => {
    jest.resetAllMocks()
    process.env = { ...originalEnv, OPENAI_API_KEY: 'test-placeholder' }
    delete process.env.SEARCH_DISABLE_SINGLETON_CACHE
    delete process.env.DATABASE_URL
    mockEmbed.mockResolvedValue({ embedding: [1, 0] })
  })
  afterAll(() => { process.env = originalEnv })

  it('saving A settings leaves B on the default provider', async () => {
    process.env.OM_SEARCH_OLLAMA_BASE_URL_ALLOWLIST = 'tenant-a.example'
    const configs = new Map<string, EmbeddingProviderConfig>()
    const saved = requestContainer(configs)
    const victim = requestContainer(configs)
    mockAuth.mockResolvedValueOnce({ tenantId: 'tenant-a', sub: 'user-a' }).mockResolvedValueOnce({ tenantId: 'tenant-b', sub: 'user-b' })
    mockContainer.mockResolvedValueOnce(saved.container).mockResolvedValueOnce(victim.container)
    const save = await saveSettings(new Request('http://localhost/api/search/embeddings', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ embeddingConfig: tenantConfig }),
    }))
    expect(save.status).toBe(200)
    expect(configs.get('tenant-a')).toMatchObject({ ...tenantConfig, updatedAt: expect.any(String) })
    expect(configs.has('tenant-b')).toBe(false)
    expect((await search(new Request('http://localhost/api/search/search?q=B-private-query&strategies=vector'))).status).toBe(200)
    expect(mockEmbed).toHaveBeenCalledWith(expect.objectContaining({ value: 'B-private-query', model: { provider: 'openai', model: expect.any(String) } }))
  })

  it.each(['env', 'instance'] as const)('keeps B on its %s provider after A loads a tenant override', async (fallback) => {
    const configs = new Map([['tenant-a', tenantConfig]])
    const instance = fallback === 'instance'
      ? { ...tenantConfig, providerId: 'openai' as const, model: 'text-embedding-3-small', baseUrl: undefined }
      : undefined
    const first = requestContainer(configs, instance)
    const second = requestContainer(configs, instance)
    mockAuth.mockResolvedValueOnce({ tenantId: 'tenant-a', sub: 'user-a' }).mockResolvedValueOnce({ tenantId: 'tenant-b', sub: 'user-b' })
    mockContainer.mockResolvedValueOnce(first.container).mockResolvedValueOnce(second.container)

    expect((await search(new Request('http://localhost/api/search/search?q=A-query&strategies=vector'))).status).toBe(200)
    expect((await search(new Request('http://localhost/api/search/search?q=B-private-query&strategies=vector'))).status).toBe(200)

    expect(first.getValue).toHaveBeenCalledWith('vector', expect.any(String), expect.objectContaining({ scope: { tenantId: 'tenant-a' } }))
    expect(second.getValue).toHaveBeenCalledWith('vector', expect.any(String), expect.objectContaining({ scope: { tenantId: 'tenant-b' } }))
    expect(mockEmbed.mock.calls.map(([options]) => options.model.provider)).toEqual(['ollama', 'openai'])
    expect(mockEmbed.mock.calls[1][0]).toMatchObject({ value: 'B-private-query', model: { provider: 'openai' } })
    expect(mockEmbed.mock.calls[1][0].model.baseURL).toBeUndefined()
  })

  it('keeps overlapping tenant queries on separate provider clients', async () => {
    const configs = new Map([['tenant-a', tenantConfig]])
    const first = requestContainer(configs)
    const second = requestContainer(configs)
    let releaseFirst: (() => void) | undefined
    let startedFirst: (() => void) | undefined
    const started = new Promise<void>((resolve) => { startedFirst = resolve })
    mockEmbed.mockImplementationOnce(async () => {
      startedFirst?.()
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      return { embedding: [1, 0] }
    })
    mockAuth.mockResolvedValueOnce({ tenantId: 'tenant-a', sub: 'user-a' }).mockResolvedValueOnce({ tenantId: 'tenant-b', sub: 'user-b' })
    mockContainer.mockResolvedValueOnce(first.container).mockResolvedValueOnce(second.container)
    const pending = search(new Request('http://localhost/api/search/search?q=A-query&strategies=vector'))
    await started
    try {
      expect((await search(new Request('http://localhost/api/search/search?q=B-private-query&strategies=vector'))).status).toBe(200)
      expect(mockEmbed.mock.calls[1][0].model.provider).toBe('openai')
    } finally { releaseFirst?.() }
    expect((await pending).status).toBe(200)
  })
})
