/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  VectorSearchSection,
  type VectorSearchSectionProps,
} from '../VectorSearchSection'

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: jest.fn(),
}))

const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

const flashMock = jest.fn()

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

const embeddingSettings: NonNullable<VectorSearchSectionProps['embeddingSettings']> = {
  openaiConfigured: true,
  autoIndexingEnabled: true,
  autoIndexingLocked: false,
  lockReason: null,
  embeddingConfig: {
    providerId: 'openai',
    model: 'text-embedding-3-small',
    dimension: 1536,
    updatedAt: '2026-07-26T12:00:00.000Z',
  },
  embeddingConfigSource: 'tenant',
  configuredProviders: ['openai', 'ollama'],
  providerAvailability: [
    { providerId: 'openai', available: true },
    { providerId: 'ollama', available: true },
  ],
  indexedDimension: null,
  reindexRequired: false,
  documentCount: 0,
}

const vectorStoreConfig: NonNullable<VectorSearchSectionProps['vectorStoreConfig']> = {
  currentDriver: 'pgvector',
  configured: true,
  drivers: [
    {
      id: 'pgvector',
      name: 'pgvector',
      configured: true,
      implemented: true,
      envVars: [],
    },
  ],
}

function renderSection(
  settings: NonNullable<VectorSearchSectionProps['embeddingSettings']> = embeddingSettings,
  storeConfig: NonNullable<VectorSearchSectionProps['vectorStoreConfig']> = vectorStoreConfig,
) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <VectorSearchSection
        embeddingSettings={settings}
        embeddingLoading={false}
        vectorStoreConfig={storeConfig}
        vectorStoreConfigLoading={false}
        vectorReindexLock={null}
        onEmbeddingSettingsUpdate={jest.fn()}
        onRefreshEmbeddings={jest.fn().mockResolvedValue(undefined)}
      />
    </I18nProvider>,
  )
}

describe('VectorSearchSection provider controls', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn(() => new Promise(() => undefined)),
    })
  })

  it('renders the provider configuration controls outside the provider button', () => {
    const { container } = renderSection()

    const providerButton = screen.getByRole('button', { name: /Ollama \(Local\)/ })
    fireEvent.click(providerButton)

    const configuration = document.getElementById('provider-ollama-configuration')
    const applyButton = screen.getByRole('button', { name: 'Apply' })
    const cancelButton = screen.getByRole('button', { name: 'Cancel' })

    expect(configuration).not.toBeNull()
    expect(providerButton.getAttribute('aria-expanded')).toBe('true')
    expect(configuration?.contains(applyButton)).toBe(true)
    expect(configuration?.contains(cancelButton)).toBe(true)
    expect(providerButton.contains(configuration)).toBe(false)
    expect(container.querySelector('button button')).toBeNull()
  })

  it('does not expose disclosure metadata for unavailable providers', () => {
    const unavailableSettings = {
      ...embeddingSettings,
      configuredProviders: ['openai'],
      providerAvailability: [
        { providerId: 'openai', available: true },
        { providerId: 'ollama', available: false, reason: 'Unavailable' },
      ],
    }

    renderSection(unavailableSettings)

    const providerButton = screen.getByRole('button', { name: /Ollama \(Local\)/ })

    expect(providerButton).toHaveProperty('disabled', true)
    expect(providerButton.getAttribute('aria-expanded')).toBeNull()
    expect(providerButton.getAttribute('aria-controls')).toBeNull()
    expect(providerButton.parentElement?.classList.contains('cursor-not-allowed')).toBe(true)
    expect(document.getElementById('provider-ollama-configuration')).toBeNull()
  })
})

describe('VectorSearchSection Ollama base URL', () => {
  beforeEach(() => {
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue(null)
    flashMock.mockReset()
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn(() => new Promise(() => undefined)),
    })
  })

  const savedEmbeddingConfigs = () =>
    readApiResultOrThrowMock.mock.calls
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as { embeddingConfig?: Record<string, unknown> })
      .map((body) => body.embeddingConfig)
      .filter(Boolean)

  it('shows a base URL field only for the Ollama provider', () => {
    renderSection()

    expect(screen.queryByLabelText('Base URL')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Ollama \(Local\)/ }))

    const input = screen.getByLabelText('Base URL')
    expect(input).toHaveProperty('value', '')
    expect(screen.getByText('Leave empty to use the OLLAMA_BASE_URL environment variable.')).toBeTruthy()
  })

  it('sends the typed base URL with the Ollama embedding config', async () => {
    renderSection({ ...embeddingSettings, embeddingConfig: null })

    fireEvent.click(screen.getByRole('button', { name: /Ollama \(Local\)/ }))
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: ' http://ollama.internal:11434 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(savedEmbeddingConfigs()).toHaveLength(1))
    expect(savedEmbeddingConfigs()[0]).toMatchObject({
      providerId: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://ollama.internal:11434',
    })
  })

  it('pre-fills a saved base URL and keeps it when another setting is applied', async () => {
    renderSection({
      ...embeddingSettings,
      embeddingConfig: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        baseUrl: 'http://ollama.internal:11434',
        updatedAt: '2026-07-26T12:00:00.000Z',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /Ollama \(Local\)/ }))
    expect(screen.getByLabelText('Base URL')).toHaveProperty('value', 'http://ollama.internal:11434')
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://ollama-2.internal:11434' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(savedEmbeddingConfigs()).toHaveLength(1))
    expect(savedEmbeddingConfigs()[0]).toMatchObject({ providerId: 'ollama', baseUrl: 'http://ollama-2.internal:11434' })
  })

  it('omits the base URL when the field is cleared', async () => {
    renderSection({
      ...embeddingSettings,
      embeddingConfig: {
        providerId: 'ollama',
        model: 'nomic-embed-text',
        dimension: 768,
        baseUrl: 'http://ollama.internal:11434',
        updatedAt: '2026-07-26T12:00:00.000Z',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: /Ollama \(Local\)/ }))
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(savedEmbeddingConfigs()).toHaveLength(1))
    expect(savedEmbeddingConfigs()[0]).not.toHaveProperty('baseUrl')
  })

  it('shows the server message when the base URL is rejected', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error('Ollama base URL is not allowed.'))
    renderSection({ ...embeddingSettings, embeddingConfig: null })

    fireEvent.click(screen.getByRole('button', { name: /Ollama \(Local\)/ }))
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'http://10.0.0.5:11434' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Ollama base URL is not allowed.', 'error'))
    expect(flashMock).not.toHaveBeenCalledWith('Embedding provider saved', 'success')
    expect(screen.getByLabelText('Base URL')).toHaveProperty('value', 'http://10.0.0.5:11434')
  })

  it('falls back to a generic message when the rejection carries none', async () => {
    readApiResultOrThrowMock.mockRejectedValue(new Error(''))
    renderSection({ ...embeddingSettings, embeddingConfig: null })

    fireEvent.click(screen.getByRole('button', { name: /Ollama \(Local\)/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith('Failed to save settings', 'error'))
  })
})

describe('VectorSearchSection store availability', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn(() => new Promise(() => undefined)),
    })
  })

  it('warns that the vector store is unavailable and surfaces the driver reason', () => {
    renderSection(embeddingSettings, {
      ...vectorStoreConfig,
      drivers: [
        {
          ...vectorStoreConfig.drivers[0],
          available: false,
          unavailableReason: 'extension "vector" is not available on this PostgreSQL server',
        },
      ],
    })

    expect(screen.getByText('Vector store is not available')).toBeTruthy()
    expect(screen.getByText(/extension "vector" is not available/)).toBeTruthy()
  })

  it('keeps the banner hidden while the store is reachable', () => {
    renderSection(embeddingSettings, {
      ...vectorStoreConfig,
      drivers: [{ ...vectorStoreConfig.drivers[0], available: true, unavailableReason: null }],
    })

    expect(screen.queryByText('Vector store is not available')).toBeNull()
  })
})
