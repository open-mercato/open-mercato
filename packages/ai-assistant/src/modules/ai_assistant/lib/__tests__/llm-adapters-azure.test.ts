import { createAzureAdapter } from '../llm-adapters/azure'

describe('AzureAdapter', () => {
  it('registers under the azure provider id', () => {
    expect(createAzureAdapter().id).toBe('azure')
  })

  it('needs an endpoint as well as a key', () => {
    // Unlike a hosted vendor there is no default host, so a key on its own would
    // report the provider ready and then fail on the first call.
    const adapter = createAzureAdapter()
    expect(adapter.isConfigured({ AZURE_OPENAI_API_KEY: 'k' })).toBe(false)
    expect(adapter.isConfigured({ AZURE_OPENAI_RESOURCE_NAME: 'contoso' })).toBe(false)
    expect(
      adapter.isConfigured({ AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_RESOURCE_NAME: 'contoso' }),
    ).toBe(true)
  })

  it('accepts an explicit base URL instead of a resource name', () => {
    const adapter = createAzureAdapter()
    expect(
      adapter.isConfigured({
        AZURE_OPENAI_API_KEY: 'k',
        AZURE_OPENAI_BASE_URL: 'https://contoso.openai.azure.com/openai',
      }),
    ).toBe(true)
  })

  it('reads the key from either supported variable', () => {
    const adapter = createAzureAdapter()
    expect(adapter.resolveApiKey({ AZURE_OPENAI_API_KEY: ' secret ' })).toBe('secret')
    expect(adapter.resolveApiKey({ AZURE_API_KEY: 'alt' })).toBe('alt')
    expect(adapter.resolveApiKey({ AZURE_OPENAI_API_KEY: '   ' })).toBeNull()
  })

  it('builds a model without reaching for the network', () => {
    const model = createAzureAdapter().createModel({
      apiKey: 'k',
      modelId: 'gpt-5.5',
      baseURL: 'https://contoso.openai.azure.com/openai',
    })
    expect(model).toBeDefined()
  })
})
