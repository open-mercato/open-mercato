/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { dismissRecordConflict, getRecordConflictForTest } from '@open-mercato/ui/backend/conflicts'
import { OPTIMISTIC_LOCK_CONFLICT_CODE, OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { DeleteEmailDialog, useCanDeleteInboxEmail, type DeletableInboxEmail } from '../DeleteEmailDialog'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const scopedHeaders: Array<Record<string, string>> = []
const surfacedConflicts = jest.fn()
const runContexts: Array<Record<string, unknown>> = []
const retryLastMutationMock = jest.fn(async () => true)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (headers: Record<string, string>, operation: () => Promise<unknown>) => {
    scopedHeaders.push(headers)
    return operation()
  },
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
// Mirrors the real hook: a thrown 409 lands on the shared record-conflict bar, then rethrows.
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => {
  const { surfaceRecordConflict } = jest.requireActual('@open-mercato/ui/backend/conflicts')
  return {
    useGuardedMutation: () => ({
      runMutation: async <T,>({ operation, context }: { operation: () => Promise<T>; context: Record<string, unknown> }): Promise<T> => {
        runContexts.push(context)
        try {
          return await operation()
        } catch (error) {
          if (surfaceRecordConflict(error, (_key: string, fallback?: string) => fallback ?? _key)) surfacedConflicts()
          throw error
        }
      },
      retryLastMutation: retryLastMutationMock,
    }),
  }
})

const flashMock = flash as jest.Mock
const EMAIL: DeletableInboxEmail = { id: 'email-1', subject: 'Offer 42', updatedAt: '2026-11-08T10:00:00.000Z' }

function httpError(status: number, message: string, body: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { status, ...body })
}

function renderDialog(email: DeletableInboxEmail | null = EMAIL) {
  const onClose = jest.fn()
  const onDeleted = jest.fn()
  renderWithProviders(<DeleteEmailDialog email={email} onClose={onClose} onDeleted={onDeleted} />)
  return { onClose, onDeleted }
}

beforeEach(() => {
  jest.clearAllMocks()
  scopedHeaders.length = 0
  runContexts.length = 0
  dismissRecordConflict()
})

describe('DeleteEmailDialog', () => {
  it('deletes on Cmd/Ctrl+Enter with the optimistic-lock header and retryLastMutation, then closes and reports success', async () => {
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true } })
    const { onClose, onDeleted } = renderDialog()
    expect(screen.getByText(/"Offer 42"/)).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrowMock).toHaveBeenCalledWith(
      '/api/inbox_ops/emails/email-1',
      { method: 'DELETE', headers: { 'x-om-forbidden-redirect': '0' } },
      { errorMessage: 'Failed to delete email' },
    )
    expect(scopedHeaders).toEqual([{ [OPTIMISTIC_LOCK_HEADER_NAME]: EMAIL.updatedAt }])
    expect(runContexts).toEqual([{ retryLastMutation: retryLastMutationMock }])
    expect(flashMock).toHaveBeenCalledWith('Email deleted', 'success')
  })

  it('sends no lock header when the page did not receive the email version', async () => {
    apiCallOrThrowMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true } })
    const { onDeleted } = renderDialog({ id: 'email-2', subject: 'Offer', updatedAt: null })
    fireEvent.click(screen.getByRole('button', { name: 'Delete email' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(scopedHeaders).toEqual([{}])
  })

  it('cancels with Escape without any request', async () => {
    const { onClose, onDeleted } = renderDialog()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('shows a 409 conflict once on the conflict bar, adds no flash and stays open', async () => {
    apiCallOrThrowMock.mockRejectedValue(httpError(409, 'record_modified', {
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      error: 'record_modified',
      currentUpdatedAt: '2026-11-08T10:05:00.000Z',
      expectedUpdatedAt: EMAIL.updatedAt,
    }))
    const { onClose, onDeleted } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Delete email' }))

    await waitFor(() => expect(getRecordConflictForTest()).not.toBeNull())
    expect(surfacedConflicts).toHaveBeenCalledTimes(1)
    expect(flashMock).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it.each([
    [403, 'Forbidden'],
    [500, 'Failed to delete email'],
  ])('keeps the dialog open with the route message on %s', async (status, message) => {
    apiCallOrThrowMock.mockRejectedValue(httpError(status, message))
    const { onClose, onDeleted } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Delete email' }))

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(message, 'error'))
    expect(getRecordConflictForTest()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete email' })).toBeTruthy()
  })

  it('renders nothing while closed', () => {
    renderDialog(null)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('useCanDeleteInboxEmail', () => {
  function Probe() {
    return <span>{useCanDeleteInboxEmail() ? 'allowed' : 'denied'}</span>
  }

  it('asks the feature check for inbox_ops.proposals.manage and honours wildcard grants', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { ok: true, granted: ['inbox_ops.*'] } })
    renderWithProviders(<Probe />)
    expect(screen.getByText('denied')).toBeTruthy()
    expect(await screen.findByText('allowed')).toBeTruthy()
    const [url, init] = apiCallMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/auth/feature-check')
    expect(JSON.parse(String(init.body))).toEqual({ features: ['inbox_ops.proposals.manage'] })
  })

  it('stays denied when the feature is not granted or the check fails', async () => {
    apiCallMock.mockResolvedValueOnce({ ok: true, status: 200, result: { ok: true, granted: ['inbox_ops.proposals.view'] } })
    renderWithProviders(<Probe />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getByText('denied')).toBeTruthy()

    apiCallMock.mockRejectedValueOnce(new Error('offline'))
    renderWithProviders(<Probe />)
    await act(async () => { await Promise.resolve() })
    expect(screen.getAllByText('denied')).toHaveLength(2)
  })
})
