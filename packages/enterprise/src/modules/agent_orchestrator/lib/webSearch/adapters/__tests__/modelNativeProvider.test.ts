const mockResolveModel = jest.fn()
const mockGenerateText = jest.fn()

jest.mock('ai', () => ({ generateText: (...args: unknown[]) => mockGenerateText(...args) }))
jest.mock('@ai-sdk/anthropic', () => ({ anthropic: { tools: { webSearch_20250305: jest.fn(() => ({})) } } }))
jest.mock('@ai-sdk/openai', () => ({ openai: { tools: { webSearch: jest.fn(() => ({})) } } }))
jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => ({
  createModelFactory: () => ({ resolveModel: (...args: unknown[]) => mockResolveModel(...args) }),
}))

import type { AwilixContainer } from 'awilix'
import { isWebSearchProviderError } from '@open-mercato/web-search'
import { createModelNativeProvider } from '../modelNativeProvider'

const container = {} as AwilixContainer

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (err) {
    return isWebSearchProviderError(err) ? err.code : undefined
  }
  return undefined
}

describe('createModelNativeProvider', () => {
  beforeEach(() => {
    mockResolveModel.mockReset()
    mockGenerateText.mockReset()
  })

  it('maps url sources to results (anthropic), deduping and capping', async () => {
    mockResolveModel.mockReturnValue({ model: {}, providerId: 'anthropic', modelId: 'claude' })
    mockGenerateText.mockResolvedValue({
      sources: [
        { sourceType: 'url', url: 'https://a.example', title: 'A' },
        { sourceType: 'url', url: 'https://a.example', title: 'dup' },
        { sourceType: 'url', url: 'https://b.example' },
        { sourceType: 'document', url: 'https://doc.example' },
      ],
    })
    const results = await createModelNativeProvider(container).search('q', { limit: 5 })
    expect(results).toEqual([
      { title: 'A', url: 'https://a.example', snippet: '' },
      { title: 'https://b.example', url: 'https://b.example', snippet: '' },
    ])
  })

  it('throws unsupported for a provider without native search', async () => {
    mockResolveModel.mockReturnValue({ model: {}, providerId: 'deepinfra', modelId: 'x' })
    expect(await codeOf(createModelNativeProvider(container).search('q'))).toBe('unsupported')
  })

  it('throws provider_unhealthy when the factory throws (no provider/key)', async () => {
    mockResolveModel.mockImplementation(() => {
      throw new Error('api_key_missing')
    })
    expect(await codeOf(createModelNativeProvider(container).search('q'))).toBe('provider_unhealthy')
  })

  it('healthCheck reports ok for a native-capable provider', async () => {
    mockResolveModel.mockReturnValue({ model: {}, providerId: 'openai', modelId: 'gpt' })
    expect(await createModelNativeProvider(container).healthCheck()).toEqual({ ok: true })
  })

  it('healthCheck reports not-ok when unavailable', async () => {
    mockResolveModel.mockImplementation(() => {
      throw new Error('no_provider_configured')
    })
    const health = await createModelNativeProvider(container).healthCheck()
    expect(health.ok).toBe(false)
  })
})
