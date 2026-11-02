/**
 * @jest-environment jsdom
 *
 * Regression test for issue #3681.
 *
 * A stale-tab delete answered 409 and raised the conflict banner, but the confirmation dialog
 * stayed open. The detail query then refreshed `updatedAt` in the background (a window-focus
 * refetch, or any later refresh), so a second click on the same "Delete" button sent the fresh
 * version and deleted a message the user had never seen. A conflict must close the dialog, so
 * deleting again is a deliberate new action taken after the newer version is on screen.
 */

import { act, renderHook } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { dismissRecordConflict, getRecordConflictForTest } from '@open-mercato/ui/backend/conflicts'
import { useMessageDetailsActions } from '../useMessageDetailsActions'
import type { MessageDetail } from '../../types'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => unknown) => run()),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: jest.fn(() => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  })),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const translate = ((key: string, fallback?: string) => fallback ?? key) as never

const STALE = '2026-06-18T00:00:00.000Z'
const FRESH = '2026-06-19T00:00:00.000Z'

function conflictResponse() {
  return {
    ok: false,
    status: 409,
    result: {
      code: 'optimistic_lock_conflict',
      error: 'record_modified',
      currentUpdatedAt: FRESH,
      expectedUpdatedAt: STALE,
    },
    response: {} as Response,
    cacheStatus: null,
  }
}

function renderActions() {
  const onDeleted = jest.fn()
  const detailQuery = { refetch: jest.fn().mockResolvedValue(null) } as unknown as UseQueryResult<MessageDetail | null, Error>
  const view = renderHook(
    ({ detail }: { detail: MessageDetail }) =>
      useMessageDetailsActions({
        id: 'message-1',
        t: translate,
        detail,
        detailQuery,
        attachments: [],
        isArchived: false,
        onDeleted,
        onMarkedUnread: jest.fn(),
        refreshDetailWithoutAutoMarkRead: jest.fn().mockResolvedValue(null),
        suppressAutoMarkRead: jest.fn(),
      }),
    { initialProps: { detail: { id: 'message-1', isRead: true, actionTaken: null, updatedAt: STALE } as MessageDetail } },
  )
  return { ...view, onDeleted }
}

describe('useMessageDetailsActions delete after a 409 conflict (issue #3681)', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    ;(withScopedApiRequestHeaders as jest.Mock).mockClear()
    dismissRecordConflict()
  })

  it('closes the delete confirmation when the delete hits an optimistic-lock conflict', async () => {
    mockApiCall.mockResolvedValueOnce(conflictResponse())
    const { result, onDeleted } = renderActions()

    act(() => result.current.setDeleteConfirmationOpen(true))
    await act(async () => {
      await result.current.handleDelete()
    })

    expect(getRecordConflictForTest()).not.toBeNull()
    expect(onDeleted).not.toHaveBeenCalled()
    expect(result.current.deleteConfirmationOpen).toBe(false)
  })

  it('does not leave a confirmed delete armed for the refreshed version', async () => {
    mockApiCall.mockResolvedValueOnce(conflictResponse())
    const { result, rerender, onDeleted } = renderActions()

    act(() => result.current.setDeleteConfirmationOpen(true))
    await act(async () => {
      await result.current.handleDelete()
    })
    rerender({ detail: { id: 'message-1', isRead: true, actionTaken: null, updatedAt: FRESH } as MessageDetail })

    expect(result.current.deleteConfirmationOpen).toBe(false)
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('keeps the dialog open for a non-conflict failure so the user can retry', async () => {
    mockApiCall.mockResolvedValueOnce({ ok: false, status: 500, result: { error: 'Boom' }, response: {} as Response, cacheStatus: null })
    const { result } = renderActions()

    act(() => result.current.setDeleteConfirmationOpen(true))
    await act(async () => {
      await result.current.handleDelete()
    })

    expect(result.current.deleteConfirmationOpen).toBe(true)
  })
})
