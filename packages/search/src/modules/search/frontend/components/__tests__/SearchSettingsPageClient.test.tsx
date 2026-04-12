/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { SearchSettingsPageClient } from '../SearchSettingsPageClient'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: () => {},
}))

jest.mock('../sections/GlobalSearchSection', () => ({
  GlobalSearchSection: () => <div data-testid="global-search-section" />,
}))

jest.mock('../sections/FulltextSearchSection', () => ({
  FulltextSearchSection: () => <div data-testid="fulltext-search-section" />,
}))

jest.mock('../sections/VectorSearchSection', () => ({
  VectorSearchSection: () => <div data-testid="vector-search-section" />,
}))

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

describe('SearchSettingsPageClient', () => {
  const mockReadApiResultOrThrow = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
  const mockFlash = flash as jest.MockedFunction<typeof flash>
  const originalFetch = global.fetch

  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
    mockFlash.mockReset()
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/search/settings/global-search') {
        return Promise.resolve(jsonResponse({ enabledStrategies: ['tokens'] }))
      }
      if (url === '/api/search/settings/fulltext') {
        return Promise.resolve(jsonResponse({ driver: 'meilisearch', configured: true, envVars: {}, optionalEnvVars: {} }))
      }
      if (url === '/api/search/settings/vector-store') {
        return Promise.resolve(jsonResponse({ currentDriver: 'pgvector', configured: true, drivers: [] }))
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch
  })

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch
      return
    }
    delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch
  })

  it('shows an inline error and flashes when the main settings request fails', async () => {
    mockReadApiResultOrThrow.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/search/settings') throw new Error('Settings unavailable')
      if (url === '/api/search/embeddings') {
        return {
          settings: {
            openaiConfigured: false,
            autoIndexingEnabled: true,
            autoIndexingLocked: false,
            lockReason: null,
            embeddingConfig: null,
            configuredProviders: [],
            indexedDimension: null,
            reindexRequired: false,
            documentCount: null,
          },
        }
      }
      throw new Error(`Unexpected API call ${url}`)
    })

    renderWithProviders(<SearchSettingsPageClient />, { dict: {} })

    await waitFor(() => {
      expect(screen.getByText('Settings unavailable')).toBeInTheDocument()
    })
    expect(mockFlash).toHaveBeenCalledWith('Settings unavailable', 'error')
    expect(screen.getByTestId('global-search-section')).toBeInTheDocument()
    expect(screen.getByTestId('fulltext-search-section')).toBeInTheDocument()
    expect(screen.getByTestId('vector-search-section')).toBeInTheDocument()
  })
})
