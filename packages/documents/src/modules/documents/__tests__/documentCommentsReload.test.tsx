/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()
const runMutationMock = jest.fn()
const retryLastMutationMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: runMutationMock,
    retryLastMutation: retryLastMutationMock,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string) => key === 'documents.users.unknown' ? 'Unknown user' : key
  return { useT: () => translate }
})

import { useDocumentComments } from '../backend/documents/[id]/useDocumentComments'

function comment(id: string, documentId: string) {
  return {
    id,
    documentId,
    parentCommentId: null,
    authorUserId: `author-${id}`,
    body: id,
    mentions: [],
    anchor: null,
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    canResolve: false,
    replies: [],
  }
}

function pagePayload(documentId: string, page: number, totalPages: number) {
  return {
    items: [comment(`${documentId}-page-${page}`, documentId)],
    userLabels: {},
    totalPages,
  }
}

async function flushPromises(iterations = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) await Promise.resolve()
}

describe('document comments reload', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    runMutationMock.mockReset()
    retryLastMutationMock.mockReset()
  })

  it('loads page one first, then fetches remaining pages concurrently in chronological order', async () => {
    const documentId = 'document-one'
    let resolveFirstPage: ((value: unknown) => void) | null = null
    apiCallMock.mockImplementation((path: string) => {
      const page = Number(new URL(path, 'http://localhost').searchParams.get('page'))
      if (page === 1) return new Promise((resolve) => { resolveFirstPage = resolve })
      return Promise.resolve({ ok: true, status: 200, result: pagePayload(documentId, page, 3) })
    })

    const { result } = renderHook(() => useDocumentComments({
      documentId,
      editor: null,
      canComment: true,
      canShare: true,
    }))

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    expect(apiCallMock.mock.calls[0]?.[0]).toContain('page=1')

    await act(async () => {
      resolveFirstPage?.({ ok: true, status: 200, result: pagePayload(documentId, 1, 3) })
      await flushPromises()
    })

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(apiCallMock).toHaveBeenCalledTimes(3)
    expect(apiCallMock.mock.calls.slice(1).map(([path]) => path)).toEqual([
      expect.stringContaining('page=2'),
      expect.stringContaining('page=3'),
    ])
    expect(result.current.comments.map((entry) => entry.id)).toEqual([
      `${documentId}-page-3`,
      `${documentId}-page-2`,
      `${documentId}-page-1`,
    ])
  })

  it('aborts and ignores an obsolete document request', async () => {
    const firstDocumentId = 'document-one'
    const secondDocumentId = 'document-two'
    let resolveFirstDocument: ((value: unknown) => void) | null = null
    apiCallMock.mockImplementation((path: string) => {
      if (path.includes(firstDocumentId)) {
        return new Promise((resolve) => { resolveFirstDocument = resolve })
      }
      return Promise.resolve({ ok: true, status: 200, result: pagePayload(secondDocumentId, 1, 1) })
    })

    const { result, rerender } = renderHook(
      ({ documentId }: { documentId: string }) => useDocumentComments({
        documentId,
        editor: null,
        canComment: true,
        canShare: true,
      }),
      { initialProps: { documentId: firstDocumentId } },
    )

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    const firstSignal = (apiCallMock.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)?.signal
    rerender({ documentId: secondDocumentId })

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.comments.map((entry) => entry.documentId)).toEqual([secondDocumentId])
    expect(firstSignal?.aborted).toBe(true)

    await act(async () => {
      resolveFirstDocument?.({ ok: true, status: 200, result: pagePayload(firstDocumentId, 1, 1) })
      await flushPromises()
    })
    expect(result.current.comments.map((entry) => entry.documentId)).toEqual([secondDocumentId])
  })

  it('cancels an open grant-access prompt when the document context changes', async () => {
    const firstDocumentId = 'document-one'
    const secondDocumentId = 'document-two'
    apiCallMock.mockImplementation((path: string) => {
      if (path.endsWith('/comments/access-check')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: {
            withoutAccessUsers: [{ userId: 'mentioned-user', label: 'Mentioned user', secondary: null }],
          },
        })
      }
      const documentId = path.includes(secondDocumentId) ? secondDocumentId : firstDocumentId
      return Promise.resolve({ ok: true, status: 200, result: pagePayload(documentId, 1, 1) })
    })

    const { result, rerender } = renderHook(
      ({ documentId }: { documentId: string }) => useDocumentComments({
        documentId,
        editor: null,
        canComment: true,
        canShare: true,
      }),
      { initialProps: { documentId: firstDocumentId } },
    )

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    act(() => {
      result.current.setBody('Hello @Mentioned user')
      result.current.setPendingMentions([{ userId: 'mentioned-user', name: 'Mentioned user' }])
    })

    let submitPromise: Promise<void> | undefined
    act(() => { submitPromise = result.current.submit() })
    await waitFor(() => expect(result.current.grantAccessNames).toEqual(['Mentioned user']))

    rerender({ documentId: secondDocumentId })
    await act(async () => { await submitPromise })

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    expect(result.current.comments.map((entry) => entry.documentId)).toEqual([secondDocumentId])
    expect(result.current.grantAccessNames).toBeNull()
    expect(result.current.isSubmitting).toBe(false)
    expect(runMutationMock).not.toHaveBeenCalled()
  })

  it('cancels an open grant-access prompt when the comments rail unmounts', async () => {
    const documentId = 'document-one'
    apiCallMock.mockImplementation((path: string) => {
      if (path.endsWith('/comments/access-check')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: {
            withoutAccessUsers: [{ userId: 'mentioned-user', label: 'Mentioned user', secondary: null }],
          },
        })
      }
      return Promise.resolve({ ok: true, status: 200, result: pagePayload(documentId, 1, 1) })
    })

    const { result, unmount } = renderHook(() => useDocumentComments({
      documentId,
      editor: null,
      canComment: true,
      canShare: true,
    }))

    await waitFor(() => expect(result.current.state.status).toBe('ready'))
    act(() => {
      result.current.setBody('Hello @Mentioned user')
      result.current.setPendingMentions([{ userId: 'mentioned-user', name: 'Mentioned user' }])
    })

    let submitPromise: Promise<void> | undefined
    act(() => { submitPromise = result.current.submit() })
    await waitFor(() => expect(result.current.grantAccessNames).toEqual(['Mentioned user']))

    unmount()
    await act(async () => { await submitPromise })

    expect(runMutationMock).not.toHaveBeenCalled()
  })
})
