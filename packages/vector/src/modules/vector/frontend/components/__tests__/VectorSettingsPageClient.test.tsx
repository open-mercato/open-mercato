/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../../../../../../tests/helpers/renderWithProviders'
import { VectorSettingsPageClient } from '../VectorSettingsPageClient'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const baseProps = {
  statusTitle: 'Vector search',
  statusEnabledMessage: 'OpenAI connected',
  statusDisabledMessage: 'OpenAI missing',
  autoIndexingLabel: 'Auto indexing',
  autoIndexingDescription: 'Automatically index new content',
  autoIndexingLockedMessage: 'Locked by admin',
  toggleSuccessMessage: 'Updated settings',
  toggleErrorMessage: 'Failed to update settings',
  refreshLabel: 'Refresh',
  savingLabel: 'Saving…',
  loadingLabel: 'Loading…',
  embeddingProviderTitle: 'Embedding Provider',
  embeddingProviderLabel: 'Provider',
  embeddingModelLabel: 'Model',
  embeddingDimensionLabel: 'Dimension',
  embeddingNotConfiguredLabel: 'not configured',
  embeddingCustomModelOption: 'Custom...',
  embeddingCustomModelNameLabel: 'Model Name',
  embeddingCustomDimensionLabel: 'Dimensions',
  embeddingChangeWarningTitle: 'Warning',
  embeddingChangeWarningDescription: 'Requires reindex',
  embeddingChangeWarningBullet1: 'Delete embeddings',
  embeddingChangeWarningBullet2: 'Recreate table',
  embeddingChangeWarningBullet3: 'Regenerate embeddings',
  embeddingChangeWarningNote: 'Search unavailable',
  embeddingCancelLabel: 'Cancel',
  embeddingConfirmLabel: 'Confirm',
  embeddingProviderSuccessMessage: 'Saved',
  embeddingProviderErrorMessage: 'Failed',
  reindexTitle: 'Reindex',
  reindexDescription: 'Regenerate all',
  reindexButton: 'Reindex All',
  reindexWarning: 'May incur costs',
  reindexConfirmTitle: 'Confirm Reindex',
  reindexConfirmDescription: 'Will regenerate',
  reindexConfirmButton: 'Start',
  reindexSuccessMessage: 'Started',
  reindexErrorMessage: 'Failed',
  reindexingLabel: 'Reindexing...',
}

const settings = {
  openaiConfigured: true,
  autoIndexingEnabled: true,
  autoIndexingLocked: false,
  lockReason: null,
  embeddingConfig: {
    providerId: 'openai' as const,
    model: 'text-embedding-3-small',
    dimension: 1536,
    updatedAt: '2024-01-01T00:00:00Z',
  },
  configuredProviders: ['openai', 'ollama'] as const,
  indexedDimension: 1536,
  reindexRequired: false,
}

describe('VectorSettingsPageClient', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  describe('auto-indexing settings', () => {
    it('loads and displays vector settings', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getAllByText('OpenAI connected').length).toBeGreaterThan(0)
      })
      expect(screen.getByLabelText('Auto indexing')).toBeChecked()
    })

    it('rolls back toggle changes when the update fails', async () => {
      ;(readApiResultOrThrow as jest.Mock)
        .mockResolvedValueOnce({ settings })
        .mockRejectedValueOnce(new Error('nope'))

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)
      const checkbox = await screen.findByLabelText('Auto indexing')

      fireEvent.click(checkbox)

      await waitFor(() => {
        expect(flash).toHaveBeenCalledWith('nope', 'error')
      })
      expect(checkbox).toBeChecked()
    })
  })

  describe('embedding provider selection', () => {
    it('displays provider dropdown with configured providers', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Provider')).toBeInTheDocument()
      })

      const providerSelect = screen.getByLabelText('Provider') as HTMLSelectElement
      expect(providerSelect.value).toBe('openai')
    })

    it('displays model dropdown with predefined models', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Model')).toBeInTheDocument()
      })

      const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
      expect(modelSelect.value).toBe('text-embedding-3-small')
    })

    it('shows Custom option in model dropdown', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Model')).toBeInTheDocument()
      })

      expect(screen.getByText('Custom...')).toBeInTheDocument()
    })

    it('shows custom model inputs when Custom is selected', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Model')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'custom' } })

      expect(screen.getByLabelText('Model Name')).toBeInTheDocument()
      expect(screen.getByLabelText('Dimensions')).toBeInTheDocument()
    })

    it('shows Apply/Cancel buttons when model selection changes', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Model')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'text-embedding-3-large' } })

      expect(screen.getByText('Confirm')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('resets selection when Cancel is clicked', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Model')).toBeInTheDocument()
      })

      const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
      fireEvent.change(modelSelect, { target: { value: 'text-embedding-3-large' } })

      expect(screen.getByText('Cancel')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Cancel'))

      expect(modelSelect.value).toBe('text-embedding-3-small')
    })

    it('shows confirmation dialog when Apply is clicked', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Model')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'text-embedding-3-large' } })
      fireEvent.click(screen.getByText('Confirm'))

      await waitFor(() => {
        expect(screen.getByText('Warning')).toBeInTheDocument()
        expect(screen.getByText('Requires reindex')).toBeInTheDocument()
      })
    })
  })

  describe('saved custom model display', () => {
    it('shows saved custom model in dropdown', async () => {
      const customModelSettings = {
        ...settings,
        configuredProviders: ['openai', 'ollama'] as const,
        embeddingConfig: {
          providerId: 'ollama' as const,
          model: 'nomic-embed-text-v2-moe',
          dimension: 768,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      }
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings: customModelSettings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      // Wait for settings to load (provider dropdown shows ollama selected)
      await waitFor(() => {
        const providerSelect = screen.getByLabelText('Provider') as HTMLSelectElement
        expect(providerSelect.value).toBe('ollama')
      })

      // The custom model should appear in the dropdown as an option
      const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
      const options = Array.from(modelSelect.options).map(o => o.text)
      expect(options.some(text => text.includes('nomic-embed-text-v2-moe'))).toBe(true)
    })

    it('selects saved custom model by default', async () => {
      const customModelSettings = {
        ...settings,
        configuredProviders: ['openai', 'ollama'] as const,
        embeddingConfig: {
          providerId: 'ollama' as const,
          model: 'my-custom-model',
          dimension: 512,
          updatedAt: '2024-01-01T00:00:00Z',
        },
      }
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings: customModelSettings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      // Wait for settings to load (provider dropdown shows ollama selected)
      await waitFor(() => {
        const providerSelect = screen.getByLabelText('Provider') as HTMLSelectElement
        expect(providerSelect.value).toBe('ollama')
      })

      const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
      expect(modelSelect.value).toBe('my-custom-model')
    })
  })

  describe('dimension mismatch warning', () => {
    it('shows warning when indexed dimension differs from selected', async () => {
      const mismatchSettings = {
        ...settings,
        indexedDimension: 768,
        embeddingConfig: {
          ...settings.embeddingConfig,
          dimension: 1536,
        },
      }
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings: mismatchSettings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByText(/mismatch/i)).toBeInTheDocument()
      })

      expect(screen.getByText(/Index: 768/)).toBeInTheDocument()
    })

    it('does not show warning when dimensions match', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Model')).toBeInTheDocument()
      })

      expect(screen.queryByText(/mismatch/i)).not.toBeInTheDocument()
    })
  })

  describe('reindex functionality', () => {
    it('shows reindex button', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByText('Reindex All')).toBeInTheDocument()
      })
    })

    it('shows confirmation dialog when reindex button is clicked', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByText('Reindex All')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Reindex All'))

      await waitFor(() => {
        expect(screen.getByText('Confirm Reindex')).toBeInTheDocument()
        expect(screen.getByText('Will regenerate')).toBeInTheDocument()
      })
    })

    it('calls reindex API when confirmed', async () => {
      ;(readApiResultOrThrow as jest.Mock)
        .mockResolvedValueOnce({ settings })
        .mockResolvedValueOnce({ ok: true })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      // Wait for settings to load (status shows "OpenAI connected")
      await waitFor(() => {
        expect(screen.getAllByText('OpenAI connected').length).toBeGreaterThan(0)
      })

      fireEvent.click(screen.getByText('Reindex All'))

      await waitFor(() => {
        expect(screen.getByText('Start')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Start'))

      await waitFor(() => {
        expect(readApiResultOrThrow).toHaveBeenCalledWith(
          '/api/vector/reindex',
          expect.objectContaining({
            method: 'POST',
          }),
          expect.any(Object)
        )
      })
    })

    it('shows success message after reindex', async () => {
      ;(readApiResultOrThrow as jest.Mock)
        .mockResolvedValueOnce({ settings })
        .mockResolvedValueOnce({ ok: true })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      // Wait for settings to load (status shows "OpenAI connected")
      await waitFor(() => {
        expect(screen.getAllByText('OpenAI connected').length).toBeGreaterThan(0)
      })

      fireEvent.click(screen.getByText('Reindex All'))

      await waitFor(() => {
        expect(screen.getByText('Start')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Start'))

      await waitFor(() => {
        expect(flash).toHaveBeenCalledWith('Started', 'success')
      })
    })
  })

  describe('provider switching', () => {
    it('shows Apply/Cancel when provider changes', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Provider')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'ollama' } })

      expect(screen.getByText('Confirm')).toBeInTheDocument()
      expect(screen.getByText('Cancel')).toBeInTheDocument()
    })

    it('resets model selection when provider changes', async () => {
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Provider')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'ollama' } })

      const modelSelect = screen.getByLabelText('Model') as HTMLSelectElement
      // Should reset to Ollama's default model
      expect(modelSelect.value).toBe('nomic-embed-text')
    })

    it('disables unconfigured providers', async () => {
      const limitedSettings = {
        ...settings,
        configuredProviders: ['openai'] as const,
      }
      ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings: limitedSettings })

      renderWithProviders(<VectorSettingsPageClient {...baseProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Provider')).toBeInTheDocument()
      })

      const ollamaOption = screen.getByRole('option', { name: /Ollama.*not configured/i }) as HTMLOptionElement
      expect(ollamaOption.disabled).toBe(true)
    })
  })
})
