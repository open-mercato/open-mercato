import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import en from '../../i18n/en.json'
import pl from '../../i18n/pl.json'
import de from '../../i18n/de.json'
import es from '../../i18n/es.json'
import ko from '../../i18n/ko.json'

let mockLocale: keyof typeof mockDictionaries | undefined = 'pl'
const mockDictionaries = { en, pl, de, es, ko }
const mockAuth = jest.fn()
const mockContainer = jest.fn()
const mockProbe = jest.fn()
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: () => mockAuth() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: () => mockContainer() }))
jest.mock('next/headers', () => ({
  cookies: async () => ({ get: () => mockLocale ? { value: mockLocale } : undefined }),
  headers: async () => new Headers({ 'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8' }),
}))
jest.mock('@open-mercato/shared/lib/i18n/app-dictionaries', () => ({
  loadAppDictionary: async (locale: keyof typeof mockDictionaries) => mockDictionaries[locale],
}))
jest.mock('../../lib/embedding-config', () => ({
  resolveEmbeddingConfigResult: async () => ({ config: null, source: 'env' }),
  resolveEmbeddingConfig: async () => null,
  getConfiguredProviders: () => ['ollama'],
  getEffectiveDimension: () => 1536,
}))
jest.mock('../../lib/auto-indexing', () => ({
  envDisablesAutoIndexing: () => false,
  resolveAutoIndexingEnabled: async () => true,
}))

import { GET as fulltextGET } from '../settings/fulltext/route'
import { GET as embeddingsGET, POST as embeddingsPOST } from '../embeddings/route'
import { localizeProviderAvailability } from '../../lib/provider-diagnostics'
import { createEmbeddingProviderProbe } from '../../lib/provider-probe'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'

const originalEnv = { ...process.env }
const req = () => new Request('http://localhost/api/search/settings/fulltext')

beforeEach(() => {
  process.env = { ...originalEnv }
  mockLocale = 'pl'
  delete process.env.OM_FORCE_LOCALE
  mockAuth.mockResolvedValue({ sub: 'user', tenantId: 'tenant', orgId: 'org' })
  mockProbe.mockResolvedValue({ available: false, reason: 'internal English failure' })
  mockContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'embeddingProviderProbe') return { checkAvailability: mockProbe }
      if (name === 'vectorDrivers') return []
      if (name === 'moduleConfigService') return { setValue: jest.fn() }
      throw new Error(`[internal] unexpected service ${name}`)
    },
    dispose: jest.fn(),
  })
})
afterEach(() => { process.env = originalEnv; jest.restoreAllMocks() })

test.each(['en', 'pl', 'de', 'es', 'ko'] as const)('fulltext hints resolve the %s dictionary without changing the response shape', async (locale) => {
  mockLocale = locale
  process.env.MEILISEARCH_HOST = ' http://search.test:7700 '
  process.env.MEILISEARCH_API_KEY = 'never-return-this-secret'
  process.env.MEILISEARCH_INDEX_PREFIX = 'tenant'
  process.env.SEARCH_EXCLUDE_ENCRYPTED_FIELDS = 'true'
  const response = await fulltextGET(req())
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    driver: 'meilisearch', configured: true,
    envVars: {
      MEILISEARCH_HOST: { set: true, hint: mockDictionaries[locale]['search.settings.fulltext.hints.host'] },
      MEILISEARCH_API_KEY: { set: true, hint: mockDictionaries[locale]['search.settings.fulltext.hints.apiKey'] },
    },
    optionalEnvVars: {
      MEILISEARCH_INDEX_PREFIX: { set: true, value: 'tenant', default: 'om', hint: mockDictionaries[locale]['search.settings.fulltext.hints.indexPrefix'] },
      SEARCH_EXCLUDE_ENCRYPTED_FIELDS: { set: true, value: true, default: false, hint: mockDictionaries[locale]['search.settings.fulltext.hints.excludeEncrypted'] },
    },
  })
})

test('unconfigured fulltext retains booleans and omitted optional value', async () => {
  for (const key of ['MEILISEARCH_HOST', 'MEILISEARCH_API_KEY', 'MEILISEARCH_INDEX_PREFIX', 'SEARCH_EXCLUDE_ENCRYPTED_FIELDS']) delete process.env[key]
  const body = await (await fulltextGET(req())).json()
  expect(body).toMatchObject({ driver: null, configured: false, envVars: { MEILISEARCH_HOST: { set: false }, MEILISEARCH_API_KEY: { set: false } } })
  expect(body.optionalEnvVars.MEILISEARCH_INDEX_PREFIX).not.toHaveProperty('value')
})

test('authenticated routes reject anonymous requests', async () => {
  mockAuth.mockResolvedValue(null)
  expect((await fulltextGET(req())).status).toBe(401)
  expect((await embeddingsGET(req())).status).toBe(401)
})

test('cached provider diagnostics translate per request and never leak internal metadata', async () => {
  const cache = new Map<string, unknown>()
  delete process.env.OPENAI_API_KEY
  const probe = createEmbeddingProviderProbe({ resolve: () => ({
    get: async (key: string) => cache.get(key),
    set: async (key: string, value: unknown) => { cache.set(key, value) },
  }) } as unknown as AppContainer)
  mockProbe.mockImplementation((providerId: string) => providerId === 'openai'
    ? probe.checkAvailability('openai')
    : Promise.resolve({ available: true, models: 3 }))
  for (const locale of ['en', 'pl', 'de', 'es', 'ko', 'pl'] as const) {
    mockLocale = locale
    const response = await embeddingsGET(req())
    expect(response.status).toBe(200)
    const { settings } = await response.json()
    expect(Object.keys(settings).sort()).toEqual(['openaiConfigured', 'autoIndexingEnabled', 'autoIndexingLocked', 'lockReason', 'embeddingConfig', 'embeddingConfigSource', 'configuredProviders', 'providerAvailability', 'indexedDimension', 'reindexRequired', 'documentCount'].sort())
    expect(settings.providerAvailability[0]).toEqual({ providerId: 'openai', available: false, reason: createTranslator(mockDictionaries[locale])('search.settings.providers.diagnostics.missingKey', { envKey: 'OPENAI_API_KEY', provider: 'OpenAI' }) })
    expect(settings.providerAvailability[1]).toEqual({ providerId: 'google', available: true, models: 3 })
  }
  expect(cache.size).toBe(1)
  expect([...cache.values()][0]).toMatchObject({ reason: 'Set OPENAI_API_KEY to enable OpenAI' })
})

test('provider save rejection localizes the reason without persisting settings', async () => {
  const response = await embeddingsPOST(new Request('http://localhost/api/search/embeddings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ embeddingConfig: { providerId: 'ollama', model: 'test', dimension: 1536 } }),
  }))
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: pl['search.api.errors.providerUnavailable'], reason: pl['search.settings.providers.diagnostics.unavailable'] })
})

test.each(['unknownProvider', 'ollamaResponse', 'ollamaTimeout', 'ollamaUnreachable', 'missingKey'] as const)('translates %s diagnostics in every supported locale', (key) => {
  for (const dictionary of Object.values(mockDictionaries)) {
    const t = createTranslator(dictionary)
    const result = localizeProviderAvailability({ available: false, reason: 'English detail', diagnostic: { key, params: { provider: 'Ollama', envKey: 'KEY', status: 503, baseUrl: 'http://localhost:11434' } } }, t)
    expect(result.reason).toBe(t(`search.settings.providers.diagnostics.${key}`, { provider: 'Ollama', envKey: 'KEY', status: 503, baseUrl: 'http://localhost:11434' }))
    expect(result.reason).not.toMatch(/English detail|search\.settings|\{\w+\}/)
    expect(result).not.toHaveProperty('diagnostic')
  }
})

test('uses Accept-Language when no locale cookie is present', async () => {
  mockLocale = undefined
  const response = await fulltextGET(req())
  expect((await response.json()).envVars.MEILISEARCH_HOST.hint).toBe(pl['search.settings.fulltext.hints.host'])
})

test.each([
  ['google', 'GOOGLE_GENERATIVE_AI_API_KEY'], ['mistral', 'MISTRAL_API_KEY'], ['cohere', 'COHERE_API_KEY'],
  ['bedrock', 'AWS_ACCESS_KEY_ID'],
] as const)('the %s producer supplies translatable missing-credential diagnostics', async (provider, envKey) => {
  delete process.env[envKey]
  const probe = createEmbeddingProviderProbe({ resolve: () => { throw new Error('[internal] no cache') } } as unknown as AppContainer)
  const result = localizeProviderAvailability(await probe.checkAvailability(provider), createTranslator(pl))
  expect(result.available).toBe(false)
  expect(result.reason).toMatch(/^Ustaw /)
  expect(result.reason).toContain(envKey)
  expect(result).not.toHaveProperty('diagnostic')
})

test.each(['response', 'timeout', 'unreachable'] as const)('the Ollama %s producer supplies localized API diagnostics', async (mode) => {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    if (mode === 'response') return new Response('', { status: 503 })
    throw Object.assign(new Error('network error'), { name: mode === 'timeout' ? 'AbortError' : 'Error' })
  })
  const probe = createEmbeddingProviderProbe({ resolve: () => { throw new Error('[internal] no cache') } } as unknown as AppContainer)
  const result = localizeProviderAvailability(await probe.checkAvailability('ollama', { baseUrl: 'http://localhost:11434' }), createTranslator(pl))
  expect(result.available).toBe(false)
  expect(result.reason).toMatch(mode === 'response' ? /zwróciła kod 503/ : /jest nieosiągalna/)
  expect(result.reason).toContain('http://localhost:11434')
  expect(result).not.toHaveProperty('diagnostic')
})
