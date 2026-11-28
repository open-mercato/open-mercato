/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useMessageDetails } from '../useMessageDetails'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: () => false }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: (_headers: Record<string, string>, run: () => unknown) => run(),
}))

const mockApiCall = jest.mocked(apiCall)
const messageIds = ['route-message', 'expanded-reply']
const readUrls = messageIds.flatMap((id) => [`/api/messages/${id}`, `/api/messages/${id}/attachments`])

function emitMessageDeleted(messageId: string) {
  window.dispatchEvent(new CustomEvent('om:event', {
    detail: { id: 'messages.message.deleted', payload: { messageId } },
  }))
}

function response(result: unknown, status = 200) {
  return { ok: status === 200, status, result, response: {} as Response, cacheStatus: null }
}

async function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: React.PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  mockApiCall.mockImplementation(async (url) => {
    if (String(url).endsWith('/attachments')) return response({ attachments: [] })
    return response({
      id: String(url).split('/').pop(),
      typeDefinition: {},
      thread: messageIds.map((id) => ({ id })),
    })
  })
  const view = renderHook(() => {
    const page = useMessageDetails('route-message')
    const reply = useMessageDetails('expanded-reply', page.deletion)
    return { page, reply }
  }, { wrapper })

  await waitFor(() => {
    expect(view.result.current.page.detail?.id).toBe('route-message')
    expect(view.result.current.reply.detail?.id).toBe('expanded-reply')
    expect(view.result.current.page.attachments).toEqual([])
    expect(view.result.current.reply.attachments).toEqual([])
  })
  mockApiCall.mockClear()
  return { ...view, queryClient }
}

beforeEach(() => {
  mockApiCall.mockReset()
  mockPush.mockClear()
  jest.mocked(flash).mockClear()
})

it.each([
  ['message', '/api/messages/expanded-reply', 'Message deleted.'],
  ['conversation', '/api/messages/route-message/conversation', 'Conversation deleted.'],
])('pauses message and attachment reads until navigation after deleting a %s', async (kind, deleteUrl, successMessage) => {
  const { result } = await setup()
  mockApiCall.mockImplementation(async (_url, init) => {
    if (init?.method !== 'DELETE') return response({ error: 'Access denied' }, 403)
    emitMessageDeleted('expanded-reply')
    if (kind === 'conversation') emitMessageDeleted('route-message')
    await result.current.page.refetchDetail()
    await result.current.reply.refreshDetailWithoutAutoMarkRead()
    return response({ ok: true })
  })

  await act(async () => {
    if (kind === 'conversation') await result.current.page.deleteConversation()
    else await result.current.reply.handleDelete()
    emitMessageDeleted('expanded-reply')
    window.dispatchEvent(new CustomEvent('om:event', { detail: { id: 'om:bridge:reconnected' } }))
  })

  expect(mockApiCall.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([[deleteUrl, 'DELETE']])
  expect(flash).toHaveBeenCalledWith(successMessage, 'success')
  expect(mockPush).toHaveBeenCalledWith('/backend/messages')
})

it('cancels an active refetch and resumes detail and attachment reads if deletion fails', async () => {
  const { result, queryClient } = await setup()
  const successfulRead = mockApiCall.getMockImplementation()!
  const signals: AbortSignal[] = []
  mockApiCall.mockImplementation(async (url, init) => {
    if (init?.method === 'DELETE') return response({ error: 'Delete failed' }, 409)
    const signal = init?.signal
    if (signals.length < 2 && signal) {
      signals.push(signal)
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    return successfulRead(url, init)
  })

  await act(async () => {
    void queryClient.invalidateQueries({ queryKey: ['messages', 'detail', 'route-message', 'attachments'] })
    const manualRefresh = result.current.reply.refreshDetailWithoutAutoMarkRead()
    await result.current.page.deleteConversation()
    await expect(manualRefresh).resolves.toMatchObject({ id: 'expanded-reply' })
  })

  expect(signals.map((signal) => signal.aborted)).toEqual([true, true])
  expect(mockPush).not.toHaveBeenCalled()
  expect(flash).toHaveBeenCalledWith('Delete failed', 'error')
  await waitFor(() => expect(mockApiCall.mock.calls.filter(([, init]) => init?.method !== 'DELETE')
    .map(([url]) => url)).toEqual(expect.arrayContaining(readUrls)))
})
