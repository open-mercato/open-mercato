/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
}

const settings = {
  openaiConfigured: true,
  autoIndexingEnabled: true,
  autoIndexingLocked: false,
  lockReason: null,
}

describe('VectorSettingsPageClient', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('loads and displays vector settings', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ settings })

    render(<VectorSettingsPageClient {...baseProps} />)

    await waitFor(() => {
      expect(screen.getAllByText('OpenAI connected').length).toBeGreaterThan(0)
    })
    expect(screen.getByLabelText('Auto indexing')).toBeChecked()
  })

  it('rolls back toggle changes when the update fails', async () => {
    ;(readApiResultOrThrow as jest.Mock)
      .mockResolvedValueOnce({ settings })
      .mockRejectedValueOnce(new Error('nope'))

    render(<VectorSettingsPageClient {...baseProps} />)
    const checkbox = await screen.findByLabelText('Auto indexing')

    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(flash).toHaveBeenCalledWith('Failed to update settings', 'error')
    })
    expect(checkbox).toBeChecked()
  })
})
