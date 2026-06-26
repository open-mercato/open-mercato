/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import type { UseQueryResult } from '@tanstack/react-query'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useMessageDetailsActions } from '../useMessageDetailsActions'
import type { MessageAction, MessageDetail } from '../../types'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
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
  const detailQuery = { refetch } as unknown as UseQueryResult<MessageDetail | null, Error>
  const detail = {
    id: 'message-1',
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
    refreshDetailWithoutAutoMarkRead,
  }))

  return { ...view, refetch, refreshDetailWithoutAutoMarkRead, onDeleted }
}

describe('useMessageDetailsActions guarded writes (#3258)', () => {
  beforeEach(() => {
    mockApiCall.mockReset()
    mockFlash.mockReset()
    mockRunMutation.mockReset()
    mockRetryLastMutation.mockReset()
    mockUseGuardedMutation.mockClear()
    // Pass-through guard so the wrapped operation still runs and we can assert
    // the underlying apiCall/refetch/success behavior is preserved.
    mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
    mockApiCall.mockResolvedValue(okResult({ ok: true }))
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
    expect(mockApiCall).toHaveBeenCalledWith('/api/messages/message-1', { method: 'DELETE' })
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(mockFlash).toHaveBeenCalledWith('Message deleted.', 'success')
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
    mockApiCall.mockResolvedValue({
      ok: false,
      status: 409,
      result: {
        code: 'optimistic_lock_conflict',
        error: 'record_modified',
        currentUpdatedAt: '2026-06-19T00:00:00.000Z',
        expectedUpdatedAt: '2026-06-18T00:00:00.000Z',
      },
      response: {} as Response,
      cacheStatus: null,
    })

    const { result, onDeleted } = setup()

    await act(async () => {
      await result.current.handleDelete()
    })

    // The mutation still flows through the guard (which owns conflict
    // surfacing), and the failure is reported via flash rather than navigation.
    expect(mockRunMutation).toHaveBeenCalledTimes(1)
    expect(onDeleted).not.toHaveBeenCalled()
    expect(mockFlash).toHaveBeenCalledWith(expect.any(String), 'error')
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
