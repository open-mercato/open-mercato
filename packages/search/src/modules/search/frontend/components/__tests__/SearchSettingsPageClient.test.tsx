/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { SearchSettingsPageClient } from '../SearchSettingsPageClient'

const mockReadApiResultOrThrow = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => Promise<unknown>) => run(),
}))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../sections/GlobalSearchSection', () => ({ GlobalSearchSection: () => null }))
jest.mock('../sections/FulltextSearchSection', () => ({ FulltextSearchSection: () => null }))

const configuredSettings = {
  openaiConfigured: false,
  autoIndexingEnabled: true,
  autoIndexingLocked: false,
  lockReason: null,
  embeddingConfig: {
    providerId: 'ollama', model: 'tenant-custom-model', dimension: 1536,
    baseUrl: 'https://provider.example/saved', updatedAt: '2026-07-26T12:00:00.000Z',
  },
  configuredProviders: ['ollama'],
  indexedDimension: 1536,
  reindexRequired: false,
  documentCount: 2,
}

describe('search embedding settings loading', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn(async (input: string) => ({
        ok: true,
        json: async () => input.endsWith('vector-store')
          ? { currentDriver: 'pgvector', configured: true, drivers: [] }
          : {},
      })),
    })
    mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
      if (url === '/api/search/embeddings') throw new Error('Provider settings are unavailable')
      return { settings: { strategies: [] } }
    })
  })

  it.each(['section', 'page'])('shows the load error and recovers through the %s Refresh action', async (location) => {
    render(<I18nProvider locale="en" dict={{}}><SearchSettingsPageClient /></I18nProvider>)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Provider settings are unavailable')
    expect(screen.queryByRole('button', { name: /Ollama \(Local\)/ })).toBeNull()
    mockReadApiResultOrThrow.mockImplementation(async (url: string) => url === '/api/search/embeddings'
      ? { settings: configuredSettings }
      : { settings: { strategies: [] } })
    const refreshes = screen.getAllByRole('button', { name: 'Refresh', exact: true })
    fireEvent.click(location === 'section' ? refreshes[0] : refreshes[refreshes.length - 1])
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('button', { name: /Ollama \(Local\)/ })).toHaveProperty('disabled', false)
    expect(screen.getByLabelText('Base URL')).toHaveProperty('value', 'https://provider.example/saved')
  })

  it('treats a missing settings payload as a load error rather than empty provider configuration', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({})
    render(<I18nProvider locale="en" dict={{}}><SearchSettingsPageClient /></I18nProvider>)
    expect((await screen.findByRole('alert')).textContent).toContain('Failed to load settings')
    expect(screen.queryByRole('button', { name: /Ollama \(Local\)/ })).toBeNull()
  })
})
