/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { SystemStatusPanel } from '../SystemStatusPanel'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

const dict = {
  'configs.systemStatus.title': 'System status',
  'configs.systemStatus.description': 'Review system flags',
  'configs.systemStatus.loading': 'Loading status snapshot…',
  'configs.systemStatus.runtime.development': 'Development',
  'configs.systemStatus.state.enabled': 'Enabled',
  'configs.systemStatus.state.disabled': 'Disabled',
  'configs.systemStatus.state.set': 'Set',
  'configs.systemStatus.state.unset': 'Unset',
  'configs.systemStatus.state.unknown': 'Unknown',
  'configs.systemStatus.details.currentValue': 'Current value',
  'configs.systemStatus.details.defaultValue': 'Default',
  'configs.systemStatus.details.updateHint': 'Update {{key}}',
  'configs.systemStatus.details.updateDocs': 'Docs',
  'configs.systemStatus.viewDocs': 'Documentation',
  'configs.systemStatus.error': 'Failed to load system status',
  'configs.systemStatus.invalidResponse': 'Unexpected response when loading system status',
  'configs.systemStatus.category.debug': 'Debug tools',
  'configs.systemStatus.item.verbose': 'Verbose logging',
  'configs.systemStatus.item.verbose.description': 'Verbose logging description',
}

const snapshot = {
  generatedAt: '2025-01-01T00:00:00.000Z',
  runtimeMode: 'development',
  categories: [
    {
      key: 'debug',
      labelKey: 'configs.systemStatus.category.debug',
      descriptionKey: null,
      items: [
        {
          key: 'DEBUG_LOGGING',
          labelKey: 'configs.systemStatus.item.verbose',
          descriptionKey: 'configs.systemStatus.item.verbose.description',
          state: 'enabled',
          value: '1',
          defaultValue: '0',
          docUrl: null,
        },
      ],
    },
  ],
}

describe('SystemStatusPanel', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('renders snapshot categories returned from the API', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce(snapshot)
    renderWithProviders(<SystemStatusPanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('Debug tools')).toBeInTheDocument()
      expect(screen.getByText('Verbose logging')).toBeInTheDocument()
    })
  })

  it('shows a friendly error if the payload is not a snapshot', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ invalid: true })
    renderWithProviders(<SystemStatusPanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('Unexpected response when loading system status')).toBeInTheDocument()
    })
  })

  it('handles request failures', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    renderWithProviders(<SystemStatusPanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })
  })
})
