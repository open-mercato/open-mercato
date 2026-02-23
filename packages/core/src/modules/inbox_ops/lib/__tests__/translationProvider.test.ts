/** @jest-environment node */

const mockGenerateObject = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}))

jest.mock('@open-mercato/shared/lib/ai/opencode-provider', () => ({
  resolveFirstConfiguredOpenCodeProvider: jest.fn(() => 'openai'),
  resolveOpenCodeModel: jest.fn(() => ({ modelId: 'gpt-4o', modelWithProvider: 'openai:gpt-4o' })),
  resolveOpenCodeProviderApiKey: jest.fn(() => 'test-key'),
  resolveOpenCodeProviderId: jest.fn((id: string) => id || 'openai'),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/llmProvider', () => ({
  createStructuredModel: jest.fn(async () => 'mock-model'),
  resolveExtractionProviderId: jest.fn(() => 'openai'),
  withTimeout: jest.fn(async (promise: Promise<unknown>) => promise),
}))

import { translateProposalContent } from '../translationProvider'

describe('translateProposalContent', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('calls generateObject with correct translation prompt', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: {
        summary: 'Kunde möchte 10 Widgets bestellen',
        actions: { 'action-1': 'Bestellung erstellen' },
      },
    })

    const result = await translateProposalContent({
      summary: 'Customer wants to order 10 widgets',
      actionDescriptions: { 'action-1': 'Create order' },
      sourceLanguage: 'en',
      targetLocale: 'de',
    })

    expect(mockGenerateObject).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'mock-model',
        system: expect.stringContaining('English'),
        prompt: expect.stringContaining('Customer wants to order 10 widgets'),
        temperature: 0,
      }),
    )
    expect(mockGenerateObject.mock.calls[0][0].system).toContain('German')

    expect(result.summary).toBe('Kunde möchte 10 Widgets bestellen')
    expect(result.actions['action-1']).toBe('Bestellung erstellen')
  })

  it('preserves action ID mapping in the response', async () => {
    const actionDescriptions = {
      'id-aaa': 'Create contact for John',
      'id-bbb': 'Create order for widgets',
      'id-ccc': 'Log activity',
    }

    mockGenerateObject.mockResolvedValueOnce({
      object: {
        summary: 'Resumen traducido',
        actions: {
          'id-aaa': 'Crear contacto para John',
          'id-bbb': 'Crear pedido de widgets',
          'id-ccc': 'Registrar actividad',
        },
      },
    })

    const result = await translateProposalContent({
      summary: 'Translated summary',
      actionDescriptions,
      sourceLanguage: 'en',
      targetLocale: 'es',
    })

    expect(Object.keys(result.actions)).toEqual(['id-aaa', 'id-bbb', 'id-ccc'])
    expect(result.actions['id-aaa']).toBe('Crear contacto para John')
  })

  it('throws when API key is missing', async () => {
    const { resolveOpenCodeProviderApiKey } = require('@open-mercato/shared/lib/ai/opencode-provider')
    resolveOpenCodeProviderApiKey.mockReturnValueOnce(null)

    await expect(
      translateProposalContent({
        summary: 'Test',
        actionDescriptions: {},
        sourceLanguage: 'en',
        targetLocale: 'de',
      }),
    ).rejects.toThrow('Missing API key')
  })
})
