import type { AwilixContainer } from 'awilix'
import { resolveWebSearchProvider } from '../webSearchProvider'
import type { WebSearchProviderId, WebSearchRuntimeConfig } from '../config'

const container = {
  resolve: () => {
    throw new Error('not used')
  },
  hasRegistration: () => false,
} as unknown as AwilixContainer

function configFor(overrides: Partial<WebSearchRuntimeConfig> & { provider: WebSearchProviderId }): WebSearchRuntimeConfig {
  return {
    baseUrl: null,
    tavilyApiKey: null,
    maxResults: 10,
    maxBytes: 65536,
    timeoutMs: 10000,
    allowDomains: [],
    denyDomains: [],
    ratePerRun: 20,
    ratePerTenantPerMinute: 120,
    ...overrides,
  }
}

describe('resolveWebSearchProvider', () => {
  it('defaults to the model-native adapter for provider=model', () => {
    const provider = resolveWebSearchProvider(container, configFor({ provider: 'model' }))
    expect(provider?.id).toBe('model-native')
  })

  it('returns the Tavily adapter when a key is present', () => {
    const provider = resolveWebSearchProvider(container, configFor({ provider: 'tavily', tavilyApiKey: 'k' }))
    expect(provider?.id).toBe('tavily')
  })

  it('returns null for tavily without a key', () => {
    expect(resolveWebSearchProvider(container, configFor({ provider: 'tavily' }))).toBeNull()
  })

  it('returns the SearXNG adapter when a base URL is present', () => {
    const provider = resolveWebSearchProvider(container, configFor({ provider: 'searxng', baseUrl: 'https://sx.local' }))
    expect(provider?.id).toBe('searxng')
  })

  it('returns null for searxng without a base URL', () => {
    expect(resolveWebSearchProvider(container, configFor({ provider: 'searxng' }))).toBeNull()
  })

  it('returns null for none / unimplemented brave / exa', () => {
    expect(resolveWebSearchProvider(container, configFor({ provider: 'none' }))).toBeNull()
    expect(resolveWebSearchProvider(container, configFor({ provider: 'brave' }))).toBeNull()
    expect(resolveWebSearchProvider(container, configFor({ provider: 'exa' }))).toBeNull()
  })
})
