/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { CachePanel } from '../CachePanel'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

// Mock HTMLDialogElement methods for jsdom compatibility
HTMLDialogElement.prototype.showModal = jest.fn(function(this: HTMLDialogElement) {
  this.open = true
  this.setAttribute('open', '')
})
HTMLDialogElement.prototype.close = jest.fn(function(this: HTMLDialogElement) {
  this.open = false
  this.removeAttribute('open')
})

const dict = {
  'configs.cache.title': 'Cache overview',
  'configs.cache.description': 'Inspect cache',
  'configs.cache.loading': 'Loading cache statistics…',
  'configs.cache.loadError': 'Failed to load cache statistics.',
  'configs.cache.refresh': 'Refresh',
  'configs.cache.purgeAll': 'Purge all cache',
  'configs.cache.purgeSegment': 'Purge segment',
  'configs.cache.purgeSegmentSuccess': 'Purged {{segment}} ({{count}})',
  'configs.cache.purgeAllSuccess': 'All cache purged',
  'configs.cache.table.segment': 'Segment',
  'configs.cache.table.path': 'Path',
  'configs.cache.table.method': 'Method',
  'configs.cache.table.count': 'Cached keys',
  'configs.cache.table.countValue': '{{count}} keys',
  'configs.cache.table.actions': 'Actions',
  'configs.cache.table.pathUnknown': 'n/a',
  'configs.cache.generatedAt': 'Stats generated {{timestamp}}',
  'configs.cache.totalEntries': '{{count}} cached entries',
  'configs.cache.retry': 'Retry',
  'configs.cache.purgeError': 'Failed to purge cache segment.',
  'configs.cache.purgeAllError': 'Failed to purge',
  'configs.cache.purgeSegmentConfirm': 'Confirm segment purge?',
  'configs.cache.purgeAllConfirm': 'Confirm all purge?',
  'configs.cache.inactive': 'Inactive',
  'ui.dialogs.confirm.confirmText': 'Confirm',
  'ui.dialogs.confirm.cancelText': 'Cancel',
  'ui.dialog.close.ariaLabel': 'Close',
}

const statsPayload = {
  generatedAt: '2025-01-01T00:00:00.000Z',
  totalKeys: 5,
  segments: [
    {
      segment: 'users.list',
      resource: 'users',
      method: 'GET',
      path: '/api/users',
      keyCount: 3,
    },
  ],
}

describe('CachePanel', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('renders cache statistics and management actions', async () => {
    ;(readApiResultOrThrow as jest.Mock)
      .mockResolvedValueOnce(statsPayload) // stats
      .mockResolvedValueOnce({ ok: true, granted: ['configs.cache.manage'] }) // feature check

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('users.list')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Purge all cache' })).toBeInTheDocument()
  })

  it('purges a segment when user confirms', async () => {
    ;(readApiResultOrThrow as jest.Mock)
      .mockResolvedValueOnce(statsPayload)
      .mockResolvedValueOnce({ ok: true, granted: ['configs.cache.manage'] })
      .mockResolvedValueOnce({
        stats: statsPayload,
        deleted: 1,
      })

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('users.list')).toBeInTheDocument()
    })

    // Click purge segment button
    fireEvent.click(screen.getByRole('button', { name: 'Purge segment' }))

    // Wait for confirm dialog to appear (dialog title)
    await waitFor(() => {
      expect(screen.getByText('Confirm segment purge?')).toBeInTheDocument()
    })

    // Click confirm button by text (inside dialog)
    const confirmButtons = screen.getAllByText('Confirm')
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => {
      expect(flash).toHaveBeenCalledWith('Purged users.list (1)', 'success')
    })
  })

  it('shows an error notice when stats cannot be loaded', async () => {
    ;(readApiResultOrThrow as jest.Mock).mockRejectedValueOnce(new Error('boom'))

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })
  })
})
