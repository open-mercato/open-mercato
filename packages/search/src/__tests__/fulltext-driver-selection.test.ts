const mockCreateMeilisearchDriver = jest.fn((options: Record<string, unknown>) => ({ id: 'meilisearch', options }))
const mockReportSearchError = jest.fn()
const mockSearchWarn = jest.fn()

jest.mock('../fulltext/drivers/meilisearch', () => ({
  createMeilisearchDriver: (options: Record<string, unknown>) => mockCreateMeilisearchDriver(options),
}))
jest.mock('../lib/debug', () => ({
  reportSearchError: (...args: unknown[]) => mockReportSearchError(...args),
  searchWarn: (...args: unknown[]) => mockSearchWarn(...args),
}))

import { createFulltextDriver, meilisearchDriverFactory } from '../fulltext/drivers'
import { registerFulltextDriverFactory, type FulltextDriverFactory } from '../fulltext/drivers/registry'

const REPORTED_KEY = Symbol.for('@open-mercato/search/fulltext-driver-reported-selections')
const originalEnv = { ...process.env }

function fakeFactory(overrides: Partial<FulltextDriverFactory> = {}): FulltextDriverFactory & { create: jest.Mock } {
  return {
    id: 'fake',
    describe: () => ({ id: 'fake', label: 'Fake', envVars: [] }),
    isConfigured: (env = process.env) => Boolean(env.FAKE_URL),
    create: jest.fn((config) => ({ id: 'fake', config } as never)),
    ...overrides,
  } as FulltextDriverFactory & { create: jest.Mock }
}

let unregister: (() => void) | null = null

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv }
  delete process.env.FULLTEXT_DRIVER
  delete process.env.MEILISEARCH_HOST
  delete process.env.MEILISEARCH_API_KEY
  delete process.env.MEILISEARCH_INDEX_PREFIX
  delete process.env.FAKE_URL
  delete (globalThis as Record<symbol, unknown>)[REPORTED_KEY]
})

afterEach(() => {
  unregister?.()
  unregister = null
  process.env = originalEnv
})

describe('createFulltextDriver selection', () => {
  it('returns null and reports nothing when no driver is configured', () => {
    expect(createFulltextDriver()).toBeNull()
    expect(mockReportSearchError).not.toHaveBeenCalled()
    expect(mockSearchWarn).not.toHaveBeenCalled()
  })

  it('keeps the Meilisearch auto-detect path with env and option overrides', () => {
    process.env.MEILISEARCH_HOST = 'http://meili.test'
    process.env.MEILISEARCH_API_KEY = 'key'
    const fieldPolicyResolver = () => undefined
    createFulltextDriver({ fieldPolicyResolver, defaultLimit: 7 })
    expect(mockCreateMeilisearchDriver).toHaveBeenCalledWith(expect.objectContaining({
      host: 'http://meili.test', apiKey: 'key', indexPrefix: undefined, fieldPolicyResolver, defaultLimit: 7,
    }))

    delete process.env.MEILISEARCH_HOST
    createFulltextDriver({ meilisearch: { host: 'http://override.test', indexPrefix: 'custom' } })
    expect(mockCreateMeilisearchDriver).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'http://override.test', indexPrefix: 'custom' }))
  })

  it('uses a registered provider factory when FULLTEXT_DRIVER selects it', () => {
    const factory = fakeFactory()
    unregister = registerFulltextDriverFactory(factory)
    process.env.FULLTEXT_DRIVER = 'fake'
    process.env.FAKE_URL = 'http://fake.test'
    const encryptionMapResolver = async () => []
    const driver = createFulltextDriver({ encryptionMapResolver, defaultLimit: 3 })
    expect(driver).toEqual({ id: 'fake', config: { encryptionMapResolver, fieldPolicyResolver: undefined, defaultLimit: 3 } })
    expect(factory.create).toHaveBeenCalledTimes(1)
    expect(mockCreateMeilisearchDriver).not.toHaveBeenCalled()
  })

  it('auto-detects a single configured provider factory without FULLTEXT_DRIVER', () => {
    unregister = registerFulltextDriverFactory(fakeFactory())
    process.env.FAKE_URL = 'http://fake.test'
    expect(createFulltextDriver()?.id).toBe('fake')
    expect(mockSearchWarn).not.toHaveBeenCalled()
  })

  it('prefers Meilisearch and warns once when more than one driver is configured', () => {
    unregister = registerFulltextDriverFactory(fakeFactory())
    process.env.FAKE_URL = 'http://fake.test'
    process.env.MEILISEARCH_HOST = 'http://meili.test'
    expect(createFulltextDriver()?.id).toBe('meilisearch')
    createFulltextDriver()
    expect(mockSearchWarn).toHaveBeenCalledTimes(1)
    expect(mockReportSearchError).not.toHaveBeenCalled()
  })

  it('returns an unhealthy stand-in and reports once for an unknown FULLTEXT_DRIVER', async () => {
    process.env.FULLTEXT_DRIVER = 'typesense'
    process.env.MEILISEARCH_HOST = 'http://meili.test'
    const driver = createFulltextDriver()
    expect(driver?.id).toBe('unavailable')
    await expect(driver?.isHealthy()).resolves.toBe(false)
    await expect(driver?.search('x', { tenantId: 't' })).resolves.toEqual([])
    await expect(driver?.index({ recordId: 'r', entityId: 'a:b', tenantId: 't', fields: {} })).rejects.toThrow('typesense')
    expect(createFulltextDriver()?.id).toBe('unavailable')
    expect(mockReportSearchError).toHaveBeenCalledTimes(1)
    expect(mockReportSearchError.mock.calls[0][2]).toBe('search.fulltext_driver_unknown')
    expect(mockCreateMeilisearchDriver).not.toHaveBeenCalled()
  })

  it('returns an unhealthy stand-in and reports once for a selected but unconfigured driver', () => {
    unregister = registerFulltextDriverFactory(fakeFactory())
    process.env.FULLTEXT_DRIVER = 'fake'
    expect(createFulltextDriver()?.id).toBe('unavailable')
    expect(mockReportSearchError).toHaveBeenCalledTimes(1)
    expect(mockReportSearchError.mock.calls[0][2]).toBe('search.fulltext_driver_unconfigured')
  })

  it('honours an explicit driver option over the environment', () => {
    unregister = registerFulltextDriverFactory(fakeFactory())
    process.env.MEILISEARCH_HOST = 'http://meili.test'
    process.env.FAKE_URL = 'http://fake.test'
    expect(createFulltextDriver({ driver: 'fake' })?.id).toBe('fake')
    expect(createFulltextDriver({ driver: 'nope' })?.id).toBe('unavailable')
    delete process.env.FAKE_URL
    expect(createFulltextDriver({ driver: 'fake' })?.id).toBe('unavailable')
  })

  it('describes the built-in Meilisearch driver', () => {
    const descriptor = meilisearchDriverFactory.describe()
    expect(descriptor.envVars.map((entry) => entry.name)).toEqual(['MEILISEARCH_HOST', 'MEILISEARCH_API_KEY', 'MEILISEARCH_INDEX_PREFIX'])
    expect(descriptor.envVars.find((entry) => entry.name === 'MEILISEARCH_API_KEY')?.secret).toBe(true)
    expect(meilisearchDriverFactory.isConfigured({ MEILISEARCH_HOST: ' ' })).toBe(false)
    expect(meilisearchDriverFactory.isConfigured({ MEILISEARCH_HOST: 'http://meili.test' })).toBe(true)
  })
})
