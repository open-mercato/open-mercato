/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  apiCall,
  apiCallOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useMessageDetailsActions } from '../useMessageDetailsActions'
import type { MessageAction, MessageDetail } from '../../types'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(async (_headers: Record<string, string>, run: () => Promise<unknown>) => run()),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const mockRunMutation = jest.fn()
const mockRetryLastMutation = jest.fn()

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: jest.fn(() => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
  })),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>
const mockApiCallOrThrow = apiCallOrThrow as jest.MockedFunction<typeof apiCallOrThrow>
const mockWithScopedApiRequestHeaders = withScopedApiRequestHeaders as jest.MockedFunction<typeof withScopedApiRequestHeaders>
const mockFlash = flash as jest.MockedFunction<typeof flash>
const mockUseGuardedMutation = useGuardedMutation as jest.MockedFunction<typeof useGuardedMutation>

const translate = ((key: string, fallback?: string) => fallback ?? key) as never

function okResult<T>(result: T) {
  return { ok: true, status: 200, result, response: {} as Response, cacheStatus: null }
}

function setup(detailOverrides: Partial<MessageDetail> = {}) {
  const refetch = jest.fn().mockResolvedValue(null)
  const refreshDetailWithoutAutoMarkRead = jest.fn().mockResolvedValue(null)
  const onDeleted = jest.fn()
  const onMarkedUnread = jest.fn()
  const suppressAutoMarkRead = jest.fn()
  const detailQuery = { refetch } as unknown as UseQueryResult<MessageDetail | null, Error>
  const detail = {
    id: 'message-1',
    updatedAt: '2026-06-18T00:00:00.000Z',
    isRead: false,
    actionTaken: null,
    ...detailOverrides,
  } as MessageDetail

  const view = renderHook(() => useMessageDetailsActions({
    id: 'message-1',
    t: translate,
    detail,
    detailQuery,
    attachments: [],
    isArchived: false,
    onDeleted,
    onMarkedUnread,
    refreshDetailWithoutAutoMarkRead,
    suppressAutoMarkRead,
  }))

  return { ...view, refetch, refreshDetailWithoutAutoMarkRead, onDeleted, onMarkedUnread, suppressAutoMarkRead }
}

describe('useMessageDetailsActions guarded writes (#3258)', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockApiCallOrThrow.mockReset()
    mockWithScopedApiRequestHeaders.mockClear()
    mockFlash.mockReset()
    mockRunMutation.mockReset()
    mockRetryLastMutation.mockReset()
    mockUseGuardedMutation.mockClear()
    // Pass-through guard so the wrapped operation still runs and we can assert
    // the underlying apiCall/refetch/success behavior is preserved.
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    mockApiCall.mockResolvedValue(okResult({ ok: true }))
    mockApiCallOrThrow.mockResolvedValue(okResult({ ok: true }))
  })

  it('routes message read toggle through runMutation and refetches', async () => {
    const { result, refetch } = setup({ isRead: false })

    await act(async () => {
      await result.current.toggleRead()
    })

    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        resourceKind: 'message',
        messageId: 'message-1',
        retryLastMutation: mockRetryLastMutation,
      }),
    }))
    expect(mockApiCall).toHaveBeenCalledWith('/api/messages/message-1/read', { method: 'PUT' })
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('routes message archive toggle through runMutation', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.toggleArchive()
    })

    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    expect(mockApiCall).toHaveBeenCalledWith('/api/messages/message-1/archive', { method: 'PUT' })
  })

  it('routes message delete through runMutation and preserves success navigation', async () => {
    const { result, onDeleted } = setup()

    await act(async () => {
      await result.current.handleDelete()
    })

    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ resourceKind: 'message', action: 'delete' }),
    }))
    expect(mockWithScopedApiRequestHeaders).toHaveBeenCalledWith(
      { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-06-18T00:00:00.000Z' },
      expect.any(Function),
    )
    expect(mockApiCallOrThrow).toHaveBeenCalledWith(
      '/api/messages/message-1',
      { method: 'DELETE' },
      { errorMessage: 'Failed to delete message.' },
    )
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(mockFlash).toHaveBeenCalledWith('Message deleted.', 'success')
  })

  it('keeps the page-load message version for delete when detail data refetches in the background', async () => {
    const refetch = jest.fn().mockResolvedValue(null)
    const detailQuery = { refetch } as unknown as UseQueryResult<MessageDetail | null, Error>
    const onDeleted = jest.fn()
    const onMarkedUnread = jest.fn()
    const refreshDetailWithoutAutoMarkRead = jest.fn().mockResolvedValue(null)
    const suppressAutoMarkRead = jest.fn()

    const view = renderHook(
      ({ updatedAt }: { updatedAt: string }) => useMessageDetailsActions({
        id: 'message-1',
        t: translate,
        detail: {
          id: 'message-1',
          updatedAt,
          isRead: false,
          actionTaken: null,
        } as MessageDetail,
        detailQuery,
        attachments: [],
        isArchived: false,
        onDeleted,
        onMarkedUnread,
        refreshDetailWithoutAutoMarkRead,
        suppressAutoMarkRead,
      }),
      { initialProps: { updatedAt: '2026-06-18T00:00:00.000Z' } },
    )

    view.rerender({ updatedAt: '2026-06-19T00:00:00.000Z' })

    await act(async () => {
      await view.result.current.handleDelete()
    })

    expect(mockWithScopedApiRequestHeaders).toHaveBeenCalledWith(
      { [OPTIMISTIC_LOCK_HEADER_NAME]: '2026-06-18T00:00:00.000Z' },
      expect.any(Function),
    )
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })

  it('routes conversation archive through runMutation with a conversation resource kind', async () => {
    const { result } = setup()

    await act(async () => {
      await result.current.archiveConversation()
    })

    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ resourceKind: 'conversation', action: 'archiveConversation' }),
    }))
    expect(mockApiCall).toHaveBeenCalledWith('/api/messages/message-1/conversation/archive', { method: 'PUT' })
  })

  it('routes conversation delete through runMutation and preserves navigation', async () => {
    const { result, onDeleted } = setup()

    await act(async () => {
      await result.current.deleteConversation()
    })

    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ resourceKind: 'conversation', action: 'deleteConversation' }),
    }))
    expect(mockApiCall).toHaveBeenCalledWith('/api/messages/message-1/conversation', { method: 'DELETE' })
    expect(onDeleted).toHaveBeenCalledTimes(1)
  })

  it('routes message action execution through runMutation and refetches', async () => {
    mockApiCall.mockResolvedValue(okResult({ ok: true, result: {} }))
    const { result, refetch } = setup()
    const action: MessageAction = { id: 'approve', label: 'Approve' }

    await act(async () => {
      await result.current.handleExecuteAction(action)
    })

    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ resourceKind: 'message', action: 'execute-action' }),
    }))
    expect(mockApiCall).toHaveBeenCalledWith(
      '/api/messages/message-1/actions/approve',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('surfaces failures through the guarded path (conflict / error)', async () => {
    const conflict = Object.assign(new Error('record_modified'), {
      status: 409,
      code: 'optimistic_lock_conflict',
      error: 'record_modified',
      currentUpdatedAt: '2026-06-19T00:00:00.000Z',
      expectedUpdatedAt: '2026-06-18T00:00:00.000Z',
    })
    mockApiCallOrThrow.mockRejectedValue(conflict)

    const { result, onDeleted } = setup()

    act(() => {
      result.current.setDeleteConfirmationOpen(true)
    })

    await act(async () => {
      await result.current.handleDelete()
    })

    // The mutation still flows through the guard (which owns conflict
    // surfacing), and the dialog is closed so the stale delete cannot be retried.
    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    expect(onDeleted).not.toHaveBeenCalled()
    expect(result.current.deleteConfirmationOpen).toBe(false)
    expect(mockFlash).not.toHaveBeenCalled()
  })

  it('maps sender archive failures to a domain-specific flash message', async () => {
    mockApiCall.mockResolvedValue({
      ok: false,
      status: 403,
      result: {
        code: 'messages_sender_archive_unsupported',
        error: 'Access denied',
      },
      response: {} as Response,
      cacheStatus: null,
    })

    const { result } = setup()

    await act(async () => {
      await result.current.toggleArchive()
    })

    expect(mockFlash).toHaveBeenCalledWith('You cannot archive messages you sent.', 'error')
  })
})

describe('useMessageDetailsActions mark-unread redirect (#3576)', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockApiCallOrThrow.mockReset()
    mockWithScopedApiRequestHeaders.mockClear()
    mockFlash.mockReset()
    mockRunMutation.mockReset()
    mockRetryLastMutation.mockReset()
    mockUseGuardedMutation.mockClear()
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    mockApiCall.mockResolvedValue(okResult({ ok: true }))
    mockApiCallOrThrow.mockResolvedValue(okResult({ ok: true }))
  })

  it('navigates back to the inbox after marking a read message unread', async () => {
    const { result, onMarkedUnread, refreshDetailWithoutAutoMarkRead, refetch, suppressAutoMarkRead } = setup({ isRead: true })

    await act(async () => {
      await result.current.toggleRead()
    })

    expect(mockApiCall).toHaveBeenCalledWith('/api/messages/message-1/read', { method: 'DELETE' })
    expect(refreshDetailWithoutAutoMarkRead).toHaveBeenCalledTimes(1)
    expect(refetch).not.toHaveBeenCalled()
    expect(onMarkedUnread).toHaveBeenCalledTimes(1)
    // Suppress auto-mark-read so a late SSE-driven detail refetch cannot silently re-mark it read.
    expect(suppressAutoMarkRead).toHaveBeenCalledTimes(1)
  })

  it('does not navigate when marking an unread message read', async () => {
    const { result, onMarkedUnread, refetch, suppressAutoMarkRead } = setup({ isRead: false })

    await act(async () => {
      await result.current.toggleRead()
    })

    expect(mockApiCall).toHaveBeenCalledWith('/api/messages/message-1/read', { method: 'PUT' })
    expect(refetch).toHaveBeenCalledTimes(1)
    expect(onMarkedUnread).not.toHaveBeenCalled()
    expect(suppressAutoMarkRead).not.toHaveBeenCalled()
  })

  it('navigates back to the inbox after marking a conversation unread', async () => {
    const { result, onMarkedUnread, refreshDetailWithoutAutoMarkRead, refetch, suppressAutoMarkRead } = setup()

    await act(async () => {
      await result.current.markConversationUnread()
    })

    expect(mockApiCall).toHaveBeenCalledWith('/api/messages/message-1/conversation/read', { method: 'DELETE' })
    expect(mockFlash).toHaveBeenCalledWith('Conversation marked unread.', 'success')
    expect(onMarkedUnread).toHaveBeenCalledTimes(1)
    // Navigation supersedes the in-place refresh, so the detail is never re-fetched.
    expect(refreshDetailWithoutAutoMarkRead).not.toHaveBeenCalled()
    expect(refetch).not.toHaveBeenCalled()
    // Suppress auto-mark-read so a late SSE-driven detail refetch cannot silently re-mark it read.
    expect(suppressAutoMarkRead).toHaveBeenCalledTimes(1)
  })

  it('does not navigate when the mark-unread request fails', async () => {
    mockApiCall.mockResolvedValue({
      ok: false,
      status: 500,
      result: { error: 'boom' },
      response: {} as Response,
      cacheStatus: null,
    })
    const { result, onMarkedUnread } = setup({ isRead: true })

    await act(async () => {
      await result.current.toggleRead()
    })

    expect(onMarkedUnread).not.toHaveBeenCalled()
    expect(mockFlash).toHaveBeenCalledWith(expect.any(String), 'error')
  })
})
