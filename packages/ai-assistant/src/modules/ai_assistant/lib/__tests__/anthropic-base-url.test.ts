jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

import {
  createAnthropicAdapter,
  normalizeAnthropicBaseUrl,
} from '../llm-adapters/anthropic'

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  warn: jest.Mock
}

describe('normalizeAnthropicBaseUrl', () => {
  it('appends /v1 to a bare host', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1',
    )
  })

  it('appends /v1 to a host with a trailing slash', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com/')).toBe(
      'https://api.anthropic.com/v1',
    )
  })

  it('leaves URLs with a real path unchanged', () => {
    expect(
      normalizeAnthropicBaseUrl('https://gw.example.com/anthropic'),
    ).toBe('https://gw.example.com/anthropic')
  })

  it('leaves invalid URL strings unchanged', () => {
    expect(normalizeAnthropicBaseUrl('anthropic.example.com')).toBe(
      'anthropic.example.com',
    )
  })
})

describe('AnthropicAdapter base URL resolution', () => {
  it('normalizes ANTHROPIC_BASE_URL during model creation', () => {
    const previousBaseUrl = process.env.ANTHROPIC_BASE_URL
    mockLogger.warn.mockClear()
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'

    try {
      const model = createAnthropicAdapter().createModel({
        apiKey: 'sk-ant-test',
        modelId: 'claude-haiku-4-5-20251001',
      })

      expect(model).toBeDefined()
      expect(mockLogger.warn).toHaveBeenCalledTimes(1)
      expect(mockLogger.warn).toHaveBeenCalledWith('Anthropic base URL was normalized', {
        from: 'https://api.anthropic.com',
        to: 'https://api.anthropic.com/v1',
      })
    } finally {
      if (previousBaseUrl === undefined) {
        delete process.env.ANTHROPIC_BASE_URL
      } else {
        process.env.ANTHROPIC_BASE_URL = previousBaseUrl
      }
    }
  })
})
