/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { CachePanel } from '../CachePanel'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

const runMutationMock = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...(args as [{ operation: () => Promise<unknown> }])),
    retryLastMutation: jest.fn(),
  }),
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

function mockManageEnabled() {
  ;(readApiResultOrThrow as jest.Mock)
    .mockResolvedValueOnce(statsPayload) // stats
    .mockResolvedValueOnce({ ok: true, granted: ['configs.cache.manage'] }) // feature check
}

async function confirmDialog() {
  const confirmButtons = screen.getAllByText('Confirm')
  fireEvent.click(confirmButtons[confirmButtons.length - 1])
}

describe('CachePanel', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  })

  it('renders cache statistics and management actions', async () => {
    mockManageEnabled()

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('users.list')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Purge all cache' })).toBeInTheDocument()
  })

  // `ok: false` is a synthetic shape that isolates the raw-`granted` fallback branch.
  // The real /api/auth/feature-check returns ok:true for a `*`/`configs.*` holder, but the
  // fallback must still be wildcard-aware so the manage controls are never hidden by an exact check.
  it.each(['configs.cache.manage', 'configs.*', '*'])(
    'keeps manage controls visible for the wildcard-equivalent grant %s on the fallback path',
    async (grant) => {
      ;(readApiResultOrThrow as jest.Mock)
        .mockResolvedValueOnce(statsPayload) // stats
        .mockResolvedValueOnce({ ok: false, granted: [grant] }) // feature check fallback path

      renderWithProviders(<CachePanel />, { dict })

      await waitFor(() => {
        expect(screen.getByText('users.list')).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Purge all cache' })).toBeInTheDocument()
      })
    },
  )

  it('hides manage controls when only an unrelated grant is present on the fallback path', async () => {
    ;(readApiResultOrThrow as jest.Mock)
      .mockResolvedValueOnce(statsPayload) // stats
      .mockResolvedValueOnce({ ok: false, granted: ['unrelated_module.*'] }) // feature check fallback path

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('users.list')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(readApiResultOrThrow).toHaveBeenCalledTimes(2)
    })
    await act(async () => {})

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Purge all cache' })).not.toBeInTheDocument()
  })

  it('purges a segment when user confirms', async () => {
    mockManageEnabled()
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({
      stats: statsPayload,
      deleted: 1,
    })

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('users.list')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Purge segment' }))

    await waitFor(() => {
      expect(screen.getByText('Confirm segment purge?')).toBeInTheDocument()
    })

    await confirmDialog()

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

    // The retry control is a non-submit action and MUST declare type="button".
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('type', 'button')
  })

  it('routes the purge-all write through the guarded mutation runner', async () => {
    mockManageEnabled()
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ stats: statsPayload })

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('users.list')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Purge all cache' }))

    await waitFor(() => {
      expect(screen.getByText('Confirm all purge?')).toBeInTheDocument()
    })

    await confirmDialog()

    await waitFor(() => {
      expect(runMutationMock).toHaveBeenCalledTimes(1)
    })
    expect(runMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resourceKind: 'configs.cache',
          retryLastMutation: expect.any(Function),
        }),
        mutationPayload: { action: 'purgeAll' },
      }),
    )
  })

  it('routes the purge-segment write through the guarded mutation runner', async () => {
    mockManageEnabled()
    ;(readApiResultOrThrow as jest.Mock).mockResolvedValueOnce({ stats: statsPayload, deleted: 1 })

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('users.list')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Purge segment' }))

    await waitFor(() => {
      expect(screen.getByText('Confirm segment purge?')).toBeInTheDocument()
    })

    await confirmDialog()

    await waitFor(() => {
      expect(runMutationMock).toHaveBeenCalledTimes(1)
    })
    expect(runMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          resourceKind: 'configs.cache',
          retryLastMutation: expect.any(Function),
        }),
        mutationPayload: { action: 'purgeSegment', segment: 'users.list' },
      }),
    )
  })

  it('declares explicit type="button" on the non-submit action buttons', async () => {
    mockManageEnabled()

    renderWithProviders(<CachePanel />, { dict })

    await waitFor(() => {
      expect(screen.getByText('users.list')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: 'Purge all cache' })).toHaveAttribute('type', 'button')
    expect(screen.getByRole('button', { name: 'Purge segment' })).toHaveAttribute('type', 'button')
  })
})
