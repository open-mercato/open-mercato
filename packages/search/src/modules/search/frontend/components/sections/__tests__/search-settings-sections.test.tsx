/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { FulltextSearchSection } from '../FulltextSearchSection'
import { VectorSearchSection } from '../VectorSearchSection'

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: () => {},
}))

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response
}

function brokenJsonResponse(init?: { ok?: boolean; status?: number }) {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
  } as unknown as Response
}

const fulltextConfig = {
  driver: 'meilisearch' as const,
  configured: true,
  envVars: {
    MEILISEARCH_HOST: { set: true, hint: 'host' },
    MEILISEARCH_API_KEY: { set: true, hint: 'api key' },
  },
  optionalEnvVars: {
    MEILISEARCH_INDEX_PREFIX: { set: false, default: 'om_', hint: 'prefix' },
    SEARCH_EXCLUDE_ENCRYPTED_FIELDS: { set: false, default: true, hint: 'exclude' },
  },
}

const vectorStoreConfig = {
  currentDriver: 'pgvector' as const,
  configured: true,
  drivers: [
    {
      id: 'pgvector' as const,
      name: 'pgvector',
      configured: true,
      implemented: true,
      envVars: [{ name: 'DATABASE_URL', set: true, hint: 'db' }],
    },
  ],
}

const baseEmbeddingSettings = {
  openaiConfigured: true,
  autoIndexingEnabled: true,
  autoIndexingLocked: false,
  lockReason: null,
  embeddingConfig: {
    providerId: 'openai' as const,
    model: 'text-embedding-3-small',
    dimension: 1536,
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
  configuredProviders: ['openai' as const],
  indexedDimension: 1536,
  reindexRequired: false,
  documentCount: 9,
}

describe('search settings sections', () => {
  const mockFlash = flash as jest.MockedFunction<typeof flash>
  const mockReadApiResultOrThrow = readApiResultOrThrow as jest.MockedFunction<typeof readApiResultOrThrow>
  const originalFetch = global.fetch

  beforeEach(() => {
    mockFlash.mockReset()
    mockReadApiResultOrThrow.mockReset()
  })

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch
      return
    }
    delete (global as typeof globalThis & { fetch?: typeof fetch }).fetch
  })

  it('shows flash(error) when fulltext reindex fails', async () => {
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/query_index/status') {
        return Promise.resolve(jsonResponse({ logs: [], errors: [] }))
      }
      if (url === '/api/search/reindex') {
        return Promise.resolve(jsonResponse({ error: 'Backend failed' }, { ok: false, status: 500 }))
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch

    renderWithProviders(
      <FulltextSearchSection
        fulltextConfig={fulltextConfig}
        fulltextConfigLoading={false}
        fulltextStats={{ numberOfDocuments: 12, isIndexing: false, fieldDistribution: {} }}
        fulltextReindexLock={null}
        loading={false}
        onStatsUpdate={jest.fn()}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
      />,
      { dict: {} },
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Index Management' }))
    fireEvent.click(screen.getByRole('button', { name: 'Full Reindex' }))
    const confirmButtons = screen.getAllByRole('button', { name: 'Full Reindex' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1] as HTMLElement)

    await waitFor(() => {
      expect(mockFlash).toHaveBeenCalledWith('Backend failed', 'error')
    })
  })

  it('refreshes stats after successful fulltext reindex', async () => {
    const onStatsUpdate = jest.fn()
    const onRefresh = jest.fn().mockResolvedValue(undefined)
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/query_index/status') {
        return Promise.resolve(jsonResponse({ logs: [], errors: [] }))
      }
      if (url === '/api/search/reindex') {
        return Promise.resolve(jsonResponse({
          ok: true,
          action: 'reindex',
          result: { entitiesProcessed: 2, recordsIndexed: 34, errors: [] },
          stats: { numberOfDocuments: 34, isIndexing: false, fieldDistribution: {} },
        }))
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch

    renderWithProviders(
      <FulltextSearchSection
        fulltextConfig={fulltextConfig}
        fulltextConfigLoading={false}
        fulltextStats={{ numberOfDocuments: 12, isIndexing: false, fieldDistribution: {} }}
        fulltextReindexLock={null}
        loading={false}
        onStatsUpdate={onStatsUpdate}
        onRefresh={onRefresh}
      />,
      { dict: {} },
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Index Management' }))
    fireEvent.click(screen.getByRole('button', { name: 'Full Reindex' }))
    const confirmButtons = screen.getAllByRole('button', { name: 'Full Reindex' })
    fireEvent.click(confirmButtons[confirmButtons.length - 1] as HTMLElement)

    await waitFor(() => {
      expect(onStatsUpdate).toHaveBeenCalledWith({
        numberOfDocuments: 34,
        isIndexing: false,
        fieldDistribution: {},
      })
    })
    expect(onRefresh).toHaveBeenCalled()
    expect(mockFlash).toHaveBeenCalledWith('Operation completed successfully: 34 documents indexed', 'success')
  })

  it('keeps fulltext activity logs visible after malformed JSON on refresh', async () => {
    let broken = false
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url !== '/api/query_index/status') throw new Error(`Unexpected fetch ${url}`)
      if (broken) return Promise.resolve(brokenJsonResponse())
      return Promise.resolve(jsonResponse({
        logs: [
          {
            id: 'log-1',
            source: 'fulltext.indexer',
            handler: 'api:search.reindex',
            level: 'info',
            entityType: 'customers:person',
            recordId: null,
            message: 'Fulltext indexed 12 records',
            details: null,
            occurredAt: '2026-04-12T10:00:00.000Z',
          },
        ],
        errors: [],
      }))
    }) as typeof fetch

    renderWithProviders(
      <FulltextSearchSection
        fulltextConfig={fulltextConfig}
        fulltextConfigLoading={false}
        fulltextStats={{ numberOfDocuments: 12, isIndexing: false, fieldDistribution: {} }}
        fulltextReindexLock={null}
        loading={false}
        onStatsUpdate={jest.fn()}
        onRefresh={jest.fn().mockResolvedValue(undefined)}
      />,
      { dict: {} },
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    await screen.findByText('Fulltext indexed 12 records')

    broken = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(screen.getByText('Fulltext indexed 12 records')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    })
  })

  it('keeps vector activity logs visible after a 500 response', async () => {
    let fail = false
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url !== '/api/query_index/status') throw new Error(`Unexpected fetch ${url}`)
      if (fail) return Promise.resolve(jsonResponse({}, { ok: false, status: 500 }))
      return Promise.resolve(jsonResponse({
        logs: [
          {
            id: 'vector-log-1',
            source: 'vector.indexer',
            handler: 'api:search.embeddings.reindex',
            level: 'info',
            entityType: 'customers:person',
            recordId: null,
            message: 'Vector embeddings queued',
            details: null,
            occurredAt: '2026-04-12T10:00:00.000Z',
          },
        ],
        errors: [],
      }))
    }) as typeof fetch

    renderWithProviders(
      <VectorSearchSection
        embeddingSettings={baseEmbeddingSettings}
        embeddingLoading={false}
        vectorStoreConfig={vectorStoreConfig}
        vectorStoreConfigLoading={false}
        vectorReindexLock={null}
        onEmbeddingSettingsUpdate={jest.fn()}
        onRefreshEmbeddings={jest.fn().mockResolvedValue(undefined)}
      />,
      { dict: {} },
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    await screen.findByText('Vector embeddings queued')

    fail = true
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => {
      expect(screen.getByText('Vector embeddings queued')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    })
  })

  it('rolls back vector auto-indexing optimistic update when save fails', async () => {
    let rejectSave: ((reason?: unknown) => void) | null = null
    mockReadApiResultOrThrow.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Promise((_resolve, reject) => {
          rejectSave = reject
        })
      }
      throw new Error('Unexpected readApiResultOrThrow call')
    })
    global.fetch = jest.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/query_index/status') {
        return Promise.resolve(jsonResponse({ logs: [], errors: [] }))
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch

    function Harness() {
      const [settings, setSettings] = React.useState(baseEmbeddingSettings)
      return (
        <VectorSearchSection
          embeddingSettings={settings}
          embeddingLoading={false}
          vectorStoreConfig={vectorStoreConfig}
          vectorStoreConfigLoading={false}
          vectorReindexLock={null}
          onEmbeddingSettingsUpdate={setSettings}
          onRefreshEmbeddings={jest.fn().mockResolvedValue(undefined)}
        />
      )
    }

    renderWithProviders(<Harness />, { dict: {} })

    fireEvent.click(screen.getByRole('tab', { name: 'Index Management' }))
    const checkbox = screen.getByLabelText('Enable auto-indexing') as HTMLInputElement

    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(checkbox.checked).toBe(false)
    })

    rejectSave?.(new Error('Save failed'))

    await waitFor(() => {
      expect(checkbox.checked).toBe(true)
    })
  })
})
