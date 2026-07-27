/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  VectorSearchSection,
  type VectorSearchSectionProps,
} from '../VectorSearchSection'

jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({
  useAppEvent: jest.fn(),
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
) {
  return render(
    <I18nProvider locale="en" dict={{}}>
      <VectorSearchSection
        embeddingSettings={settings}
        embeddingLoading={false}
        vectorStoreConfig={vectorStoreConfig}
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
