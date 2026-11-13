import { z } from 'zod'
import { CONTRACT_VERSION, SECRET_PLACEHOLDER, defineAdapterModule } from '@open-mercato/web-research'
import { createFakeAdapter } from '@open-mercato/web-research/testing/fakeAdapter'

const mockSetValue = jest.fn().mockResolvedValue(undefined)
const mockEncrypt = jest.fn(async (_container: unknown, _tenant: string, options: unknown) => ({
  adapterOptions: options,
  encrypted: true,
}))
const mockInvalidate = jest.fn().mockResolvedValue(undefined)
const mockResolveSettings = jest.fn()
const mockGetAuth = jest.fn()
const mockContainer = {
  resolve: (name: string) => {
    if (name === 'moduleConfigService') return { setValue: mockSetValue }
    if (name === 'webResearchAdapterEntries') return adapters
    throw new Error(`[internal] Unexpected service: ${name}`)
  },
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuth(...args),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => mockContainer,
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))
jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ warn: jest.fn() }) }),
}))
jest.mock('../../../../lib/webSearch/policy', () => ({
  ...jest.requireActual('../../../../lib/webSearch/policy'),
  resolveWebSearchSettings: (...args: unknown[]) => mockResolveSettings(...args),
}))
jest.mock('../../../../lib/webSearch/registry', () => ({ hostCapabilitiesFor: () => ({}) }))
jest.mock('../../../../lib/webSearch/healthCache', () => ({
  invalidateWebSearchHealthCache: (...args: unknown[]) => mockInvalidate(...args),
}))
jest.mock('../../../../lib/webSearch/secretStorage', () => ({
  adapterSecretFields: () => ({}),
  canEncryptSecrets: async () => true,
  encryptAdapterSecrets: (...args: Parameters<typeof mockEncrypt>) => mockEncrypt(...args),
}))

import { PUT } from '../route'

const adapters = ['tavily', 'firecrawl', 'exa'].map((id) => ({
  packageName: `fixture-${id}`,
  module: defineAdapterModule({
    id,
    kind: 'api',
    contractVersion: CONTRACT_VERSION,
    optionsSchema: z.object({
      apiKey: z.string().optional(),
      accessToken: z.string().optional(),
      baseUrl: z.string().optional(),
      endpoint: z.url().optional(),
      searchEndpoint: z.string().url().optional(),
      fallbackUrl: z.url().default('https://fallback.example'),
      timeoutMs: z.number().optional(),
    }),
    createAdapter: () => createFakeAdapter({ id }),
  }),
}))

const original = { apiKey: 'fixture-key', baseUrl: 'https://original.example' }

async function save(adapterOptions?: Record<string, unknown>) {
  return PUT(new Request('http://localhost/api/agent_orchestrator/web-search/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(adapterOptions === undefined ? {} : { adapterOptions }) }),
  }))
}

function expectNoWrite() {
  expect(mockEncrypt).not.toHaveBeenCalled()
  expect(mockSetValue).not.toHaveBeenCalled()
  expect(mockInvalidate).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetAuth.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1' })
  mockResolveSettings.mockResolvedValue({
    policy: {},
    guardrails: {},
    source: 'tenant',
    adapterOptions: { tavily: { ...original }, firecrawl: { ...original }, exa: { ...original } },
  })
})

describe('web-search credential destination binding', () => {
  it.each(['tavily', 'firecrawl', 'exa'])('rejects a retarget with a masked %s key before any write', async (id) => {
    const response = await save({ [id]: { apiKey: SECRET_PLACEHOLDER, baseUrl: 'https://new.example' } })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'agent_orchestrator.webSearch.errors.reenterCredentials' })
    expectNoWrite()
  })

  it.each(['endpoint', 'searchEndpoint', 'fallbackUrl'])('protects every URL option, including %s', async (field) => {
    const response = await save({ tavily: { ...original, apiKey: SECRET_PLACEHOLDER, [field]: 'https://new.example' } })
    expect(response.status).toBe(400)
    expectNoWrite()
  })

  it('rejects removing an explicit URL to switch to the adapter default', async () => {
    expect((await save({ tavily: { apiKey: SECRET_PLACEHOLDER } })).status).toBe(400)
    expectNoWrite()
  })

  it('rejects adding an explicit URL to a previously default destination', async () => {
    mockResolveSettings.mockResolvedValue({ policy: {}, guardrails: {}, source: 'tenant', adapterOptions: { tavily: { apiKey: 'fixture-key' } } })
    expect((await save({ tavily: { apiKey: SECRET_PLACEHOLDER, baseUrl: 'https://new.example' } })).status).toBe(400)
    expectNoWrite()
  })

  it('keeps a hidden key when URL options stay omitted and adapter defaults still apply', async () => {
    mockResolveSettings.mockResolvedValue({ policy: {}, guardrails: {}, source: 'tenant', adapterOptions: { tavily: { apiKey: 'fixture-key' } } })
    expect((await save({ tavily: { apiKey: SECRET_PLACEHOLDER, timeoutMs: 1000 } })).status).toBe(200)
    expect(mockEncrypt.mock.calls[0][2]).toEqual({ tavily: { apiKey: 'fixture-key', timeoutMs: 1000 } })
  })

  it('preserves masked credentials and other adapters when saving unrelated options', async () => {
    expect((await save({ tavily: { ...original, apiKey: SECRET_PLACEHOLDER, timeoutMs: 1000 } })).status).toBe(200)
    expect(mockEncrypt.mock.calls[0][2]).toEqual({
      tavily: { ...original, timeoutMs: 1000 }, firecrawl: original, exa: original,
    })
    expect(mockSetValue).toHaveBeenCalledWith('agent_orchestrator', 'web_search', expect.any(Object), { tenantId: 'tenant-1' })
    expect(mockInvalidate).toHaveBeenCalledWith(mockContainer, 'tenant-1')
  })

  it('allows retargeting with fresh credentials', async () => {
    const incoming = { apiKey: 'fixture-replacement', baseUrl: 'https://new.example' }
    expect((await save({ tavily: incoming })).status).toBe(200)
    expect(mockEncrypt.mock.calls[0][2]).toMatchObject({ tavily: incoming })
  })

  it('allows retargeting without restoring an omitted secret', async () => {
    const incoming = { baseUrl: 'https://new.example' }
    expect((await save({ tavily: incoming })).status).toBe(200)
    expect(mockEncrypt.mock.calls[0][2]).toEqual({ tavily: incoming, firecrawl: original, exa: original })
  })

  it('rejects removing another URL option even when baseUrl is unchanged', async () => {
    mockResolveSettings.mockResolvedValue({
      policy: {}, guardrails: {}, source: 'tenant',
      adapterOptions: { tavily: { ...original, fallbackUrl: 'https://custom.example' } },
    })
    expect((await save({ tavily: { ...original, apiKey: SECRET_PLACEHOLDER } })).status).toBe(400)
    expectNoWrite()
  })

  it('preserves hidden credentials with unchanged explicit default URL values', async () => {
    const options = { ...original, fallbackUrl: 'https://fallback.example' }
    mockResolveSettings.mockResolvedValue({ policy: {}, guardrails: {}, source: 'tenant', adapterOptions: { tavily: options } })
    expect((await save({ tavily: { ...options, apiKey: SECRET_PLACEHOLDER } })).status).toBe(200)
    expect(mockEncrypt.mock.calls[0][2]).toEqual({ tavily: options })
  })

  it('requires every masked secret to be re-entered even when another secret is fresh', async () => {
    expect((await save({ tavily: { apiKey: 'fixture-replacement', accessToken: SECRET_PLACEHOLDER, baseUrl: 'https://new.example' } })).status).toBe(400)
    expectNoWrite()
  })

  it('rejects the whole update when a later adapter retargets a hidden key', async () => {
    expect((await save({
      tavily: { ...original, apiKey: SECRET_PLACEHOLDER },
      exa: { apiKey: SECRET_PLACEHOLDER, baseUrl: 'https://new.example' },
    })).status).toBe(400)
    expectNoWrite()
  })

  it('preserves all adapters when the settings update omits adapter options', async () => {
    expect((await save()).status).toBe(200)
    expect(mockEncrypt.mock.calls[0][2]).toEqual({ tavily: original, firecrawl: original, exa: original })
  })

  it('rejects unauthenticated and unscoped writes before restoring secrets', async () => {
    mockGetAuth.mockResolvedValueOnce(null)
    expect((await save()).status).toBe(401)
    mockGetAuth.mockResolvedValueOnce({ sub: 'user-1' })
    expect((await save()).status).toBe(400)
    expect(mockResolveSettings).not.toHaveBeenCalled()
    expectNoWrite()
  })
})
