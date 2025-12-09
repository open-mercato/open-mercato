/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../../../../tests/helpers/renderWithProviders'
import { LastOperationBanner } from '../LastOperationBanner'
import { apiCall } from '../../utils/apiCall'
import { flash } from '../../FlashMessages'
import { markUndoSuccess, useLastOperation } from '../store'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../store', () => ({
  useLastOperation: jest.fn(),
  markUndoSuccess: jest.fn(),
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
  beforeAll(() => {
    // JSDOM’s location.reload is non-writable in some environments; redefine on a clone
    const orig = window.location
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).location
    Object.defineProperty(window, 'location', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { ...orig, reload: jest.fn() },
    })
  })

  beforeEach(() => {
    jest.resetAllMocks()
    ;(useLastOperation as jest.Mock).mockReturnValue(mockOperation)
  })

  afterAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).location
    // fallback: JSDOM will recreate location on next access; nothing else needed
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
    expect(markUndoSuccess).toHaveBeenCalledWith('token-123')
    expect(flash).toHaveBeenCalledWith('Undo completed', 'success')
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
