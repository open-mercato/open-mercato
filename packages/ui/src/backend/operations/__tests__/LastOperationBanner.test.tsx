/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { LastOperationBanner } from '../LastOperationBanner'
import { apiCall } from '../../utils/apiCall'
import { flash } from '../../FlashMessages'
import { markUndoSuccess, dismissOperation, useLastOperation } from '../store'

jest.setTimeout(20000)

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../store', () => ({
  useLastOperation: jest.fn(),
  markUndoSuccess: jest.fn(),
  dismissOperation: jest.fn(),
  operationStackConstants: {
    LAST_OPERATION_TTL_MS: 60_000,
    LAST_OPERATION_AUTO_DISMISS_MS: 10_000,
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: jest.fn(),
  }),
}))

const mockOperation = {
  actionLabel: 'audit_logs.actions.create',
  commandId: 'users.create',
  undoToken: 'token-123',
}

const createMockResponse = (status: number): Response => ({ status } as Response)

const dict = {
  'audit_logs.banner.last_operation': 'Last operation',
  'audit_logs.banner.undo': 'Undo',
  'audit_logs.actions.undoing': 'Undoing…',
  'audit_logs.banner.undo_success': 'Undo completed',
  'audit_logs.banner.undo_error': 'Undo failed',
  'audit_logs.actions.create': 'Created user',
}

describe('LastOperationBanner', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(useLastOperation as jest.Mock).mockReturnValue(mockOperation)
  })

  it('renders nothing when there is no operation', () => {
    ;(useLastOperation as jest.Mock).mockReturnValue(null)
    const { container } = renderWithProviders(<LastOperationBanner />, { dict })
    expect(container).toBeEmptyDOMElement()
  })

  it('shows translated label and handles successful undo', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      result: {},
      response: createMockResponse(200),
    })

    renderWithProviders(<LastOperationBanner />, { dict })

    expect(screen.getByText('Last operation')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /undo/i }))

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith('/api/audit_logs/audit-logs/actions/undo', expect.objectContaining({
        method: 'POST',
      }))
    })
    expect(markUndoSuccess).toHaveBeenCalledWith(['token-123'])
    expect(flash).toHaveBeenCalledWith('Undo completed', 'success')
  })

  it('iterates bulkUndoTokens in reverse and reports completed tokens to the store on full success', async () => {
    ;(useLastOperation as jest.Mock).mockReturnValue({
      ...mockOperation,
      undoToken: 'bulk:abc',
      bulkUndoTokens: ['tk-1', 'tk-2', 'tk-3'],
      bulkCount: 3,
    })
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      result: {},
      response: createMockResponse(200),
    })

    renderWithProviders(<LastOperationBanner />, { dict })
    fireEvent.click(screen.getByRole('button', { name: /undo/i }))

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledTimes(3)
    })
    const tokenBodies = (apiCall as jest.Mock).mock.calls.map((call) => JSON.parse(call[1].body))
    expect(tokenBodies.map((body: { undoToken: string }) => body.undoToken)).toEqual(['tk-3', 'tk-2', 'tk-1'])
    expect(markUndoSuccess).toHaveBeenCalledWith(['tk-1', 'tk-2', 'tk-3'])
  })

  it('on partial bulk failure flashes the error and reports only the completed tokens', async () => {
    ;(useLastOperation as jest.Mock).mockReturnValue({
      ...mockOperation,
      undoToken: 'bulk:abc',
      bulkUndoTokens: ['tk-1', 'tk-2', 'tk-3'],
      bulkCount: 3,
    })
    ;(apiCall as jest.Mock)
      .mockResolvedValueOnce({ ok: true, status: 200, result: {}, response: createMockResponse(200) })
      .mockResolvedValueOnce({ ok: false, status: 500, result: { error: 'boom' }, response: createMockResponse(500) })

    renderWithProviders(<LastOperationBanner />, { dict })
    fireEvent.click(screen.getByRole('button', { name: /undo/i }))

    await waitFor(() => {
      expect(flash).toHaveBeenCalledWith('boom', 'error')
    })
    expect(markUndoSuccess).toHaveBeenCalledWith(['tk-3'])
  })

  it('auto-dismisses the banner after the configured timeout when no undo is in flight', () => {
    jest.useFakeTimers()
    try {
      renderWithProviders(<LastOperationBanner />, { dict })
      expect(dismissOperation).not.toHaveBeenCalled()
      jest.advanceTimersByTime(9_999)
      expect(dismissOperation).not.toHaveBeenCalled()
      jest.advanceTimersByTime(1)
      expect(dismissOperation).toHaveBeenCalledTimes(1)
      expect(dismissOperation).toHaveBeenCalledWith('token-123')
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not auto-dismiss while an undo request is in flight', async () => {
    jest.useFakeTimers()
    try {
      let resolveCall: ((value: unknown) => void) | null = null
      ;(apiCall as jest.Mock).mockImplementation(() => new Promise((resolve) => { resolveCall = resolve }))

      renderWithProviders(<LastOperationBanner />, { dict })
      fireEvent.click(screen.getByRole('button', { name: /undo/i }))

      jest.advanceTimersByTime(10_000)
      expect(dismissOperation).not.toHaveBeenCalled()

      resolveCall?.({ ok: true, status: 200, result: {}, response: createMockResponse(200) })
      await Promise.resolve()
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not fire a spurious dismiss after a successful undo removes the operation', async () => {
    jest.useFakeTimers()
    try {
      let resolveCall: ((value: unknown) => void) | null = null
      ;(apiCall as jest.Mock).mockImplementation(() => new Promise((resolve) => { resolveCall = resolve }))

      const { rerender } = renderWithProviders(<LastOperationBanner />, { dict })
      fireEvent.click(screen.getByRole('button', { name: /undo/i }))

      resolveCall?.({ ok: true, status: 200, result: {}, response: createMockResponse(200) })
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()

      ;(useLastOperation as jest.Mock).mockReturnValue(null)
      rerender(<LastOperationBanner />)

      jest.advanceTimersByTime(10_000)
      expect(dismissOperation).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })

  it('clears the auto-dismiss timer when the operation is replaced before timeout fires', () => {
    jest.useFakeTimers()
    try {
      const { rerender } = renderWithProviders(<LastOperationBanner />, { dict })
      jest.advanceTimersByTime(2_000)

      ;(useLastOperation as jest.Mock).mockReturnValue({ ...mockOperation, undoToken: 'token-456' })
      rerender(<LastOperationBanner />)

      jest.advanceTimersByTime(9_999)
      expect(dismissOperation).not.toHaveBeenCalled()
      jest.advanceTimersByTime(1)
      expect(dismissOperation).toHaveBeenCalledTimes(1)
      expect(dismissOperation).toHaveBeenCalledWith('token-456')
    } finally {
      jest.useRealTimers()
    }
  })

  it('surfaces undo errors from the API', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      result: { error: 'failed' },
      response: createMockResponse(500),
    })

    renderWithProviders(<LastOperationBanner />, { dict })
    fireEvent.click(screen.getByRole('button', { name: /undo/i }))

    await waitFor(() => {
      expect(flash).toHaveBeenCalledWith('failed', 'error')
    })
    expect(markUndoSuccess).not.toHaveBeenCalled()
  })
})
