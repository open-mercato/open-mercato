/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'
import { useDocumentCollaboration } from '../backend/documents/[id]/useDocumentCollaboration'

type MockProviderConfiguration = {
  document: { clientID: number }
  token: () => Promise<string>
}

type MockProvider = {
  configuration: MockProviderConfiguration & {
    websocketProvider: {
      status: string
      webSocket: { close: jest.Mock }
      connect: jest.Mock<Promise<void>, []>
      disconnect: jest.Mock
    }
  }
  awareness: {
    getStates: () => Map<number, unknown>
    on: jest.Mock
  }
  document: { clientID: number }
  on: jest.Mock
  emit: (event: string, payload?: unknown) => void
  destroy: jest.Mock
}

const mockProviderInstances: MockProvider[] = []
const mockApiCall = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key === 'documents.users.unknown' ? 'Unknown user' : key,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))

jest.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: jest.fn().mockImplementation((configuration: MockProviderConfiguration) => {
    const handlers = new Map<string, Array<(payload?: unknown) => void>>()
    const websocketProvider = {
      status: 'connected',
      webSocket: { close: jest.fn() },
      connect: jest.fn(async () => {
        await configuration.token()
      }),
      disconnect: jest.fn(),
    }
    const provider: MockProvider = {
      configuration: { ...configuration, websocketProvider },
      awareness: {
        getStates: () => new Map(),
        on: jest.fn(),
      },
      document: configuration.document,
      on: jest.fn((event: string, handler: (payload?: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler])
      }),
      emit: (event, payload) => {
        for (const handler of handlers.get(event) ?? []) handler(payload)
      },
      destroy: jest.fn(),
    }
    mockProviderInstances.push(provider)
    return provider
  }),
}))

function tokenForPath(path: string) {
  const documentId = path.split('/')[3] ?? ''
  return {
    ok: true,
    status: 200,
    result: {
      token: `token-${documentId}`,
      url: 'ws://localhost:4101',
      documentId,
      tier: 'editor',
      expiresInSec: 60,
      canEdit: true,
      readOnly: false,
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Test editor',
        color: '#123456',
      },
    },
  }
}

describe('document collaboration client lifecycle', () => {
  beforeEach(() => {
    mockProviderInstances.length = 0
    mockApiCall.mockReset()
    mockApiCall.mockImplementation(async (path: string) => tokenForPath(path))
  })

  it('keeps one provider across share/comment rerenders and tears down only on document change or unmount', async () => {
    const firstDocumentId = '22222222-2222-4222-8222-222222222222'
    const secondDocumentId = '33333333-3333-4333-8333-333333333333'
    const { result, rerender, unmount } = renderHook(
      ({ documentId, interaction }: { documentId: string; interaction: number }) => {
        void interaction
        return useDocumentCollaboration(documentId)
      },
      { initialProps: { documentId: firstDocumentId, interaction: 0 } },
    )

    await waitFor(() => expect(result.current.mode).toBe('collab'))
    expect(mockProviderInstances).toHaveLength(1)

    rerender({ documentId: firstDocumentId, interaction: 1 })
    rerender({ documentId: firstDocumentId, interaction: 2 })
    expect(mockProviderInstances).toHaveLength(1)
    expect(mockProviderInstances[0]?.destroy).not.toHaveBeenCalled()

    rerender({ documentId: secondDocumentId, interaction: 3 })
    await waitFor(() => expect(mockProviderInstances).toHaveLength(2))
    expect(mockProviderInstances[0]?.destroy).toHaveBeenCalledTimes(1)

    unmount()
    expect(mockProviderInstances[1]?.destroy).toHaveBeenCalledTimes(1)
  })

  it('uses editable fallback when collaboration is intentionally unconfigured', async () => {
    const documentId = '22222222-2222-4222-8222-222222222222'
    mockApiCall.mockImplementation(async (path: string) => ({
      ...tokenForPath(path),
      result: { ...tokenForPath(path).result, token: '', url: null },
    }))

    const { result } = renderHook(() => useDocumentCollaboration(documentId))

    await waitFor(() => expect(result.current).toEqual({ mode: 'fallback', readOnly: false }))
    expect(mockProviderInstances).toHaveLength(0)
  })

  it('keeps an intentionally unconfigured collaboration response read-only when the fresh token denies edits', async () => {
    const documentId = '22222222-2222-4222-8222-222222222222'
    mockApiCall.mockImplementation(async (path: string) => ({
      ...tokenForPath(path),
      result: {
        ...tokenForPath(path).result,
        token: '',
        url: null,
        canEdit: false,
        readOnly: true,
      },
    }))

    const { result } = renderHook(() => useDocumentCollaboration(documentId))

    await waitFor(() => expect(result.current).toEqual({ mode: 'fallback', readOnly: true }))
    expect(mockProviderInstances).toHaveLength(0)
  })

  it('uses read-only fallback after a definitive token authorization rejection', async () => {
    const documentId = '22222222-2222-4222-8222-222222222222'
    mockApiCall.mockResolvedValue({ ok: false, status: 403, result: { error: 'forbidden' } })

    const { result } = renderHook(() => useDocumentCollaboration(documentId))

    await waitFor(() => expect(result.current).toEqual({ mode: 'fallback', readOnly: true }))
    expect(mockProviderInstances).toHaveLength(0)
  })

  it('renews the token after a server-driven room close and reconnects on return to the page', async () => {
    const documentId = '22222222-2222-4222-8222-222222222222'
    const { result, unmount } = renderHook(() => useDocumentCollaboration(documentId))
    await waitFor(() => expect(result.current.mode).toBe('collab'))
    const provider = mockProviderInstances[0]
    expect(provider).toBeDefined()

    act(() => provider?.emit('close'))
    expect(provider?.configuration.websocketProvider.webSocket.close).toHaveBeenCalledTimes(1)

    if (provider) provider.configuration.websocketProvider.status = 'disconnected'
    act(() => provider?.emit('disconnect'))
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    expect(provider?.configuration.websocketProvider.connect).toHaveBeenCalledTimes(1)

    act(() => window.dispatchEvent(new Event('pageshow')))
    expect(provider?.configuration.websocketProvider.connect).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(3))

    unmount()
    act(() => window.dispatchEvent(new Event('pageshow')))
    expect(provider?.configuration.websocketProvider.connect).toHaveBeenCalledTimes(2)
  })

  it('discards the local document and starts a fresh session when the room was reset for replaced content', async () => {
    // Regression for #5361: after a version restore the sidecar reloads the
    // room from the restored content and closes every socket. Reconnecting
    // with the same Y.Doc synced the pre-restore state straight back into the
    // fresh room and silently undid the restore for everyone.
    const documentId = '22222222-2222-4222-8222-222222222222'
    const { result, unmount } = renderHook(() => useDocumentCollaboration(documentId))
    await waitFor(() => expect(result.current.mode).toBe('collab'))
    const stale = mockProviderInstances[0]
    expect(stale).toBeDefined()
    act(() => stale?.emit('synced'))

    act(() => stale?.emit('close', { event: { code: 1000, reason: 'documents:content-reset' } }))
    expect(stale?.configuration.websocketProvider.disconnect).toHaveBeenCalledTimes(1)
    expect(stale?.configuration.websocketProvider.webSocket.close).not.toHaveBeenCalled()

    if (stale) stale.configuration.websocketProvider.status = 'disconnected'
    act(() => stale?.emit('disconnect'))
    expect(stale?.configuration.websocketProvider.connect).not.toHaveBeenCalled()

    await waitFor(() => expect(mockProviderInstances).toHaveLength(2))
    expect(stale?.destroy).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(result.current.mode).toBe('collab'))
    expect(result.current.mode === 'collab' && result.current.resources.provider).toBe(mockProviderInstances[1])
    expect(mockProviderInstances[1]?.document).not.toBe(stale?.document)

    unmount()
  })

  it('keeps the same session on an ordinary server-driven room close', async () => {
    const documentId = '22222222-2222-4222-8222-222222222222'
    const { result, unmount } = renderHook(() => useDocumentCollaboration(documentId))
    await waitFor(() => expect(result.current.mode).toBe('collab'))
    const provider = mockProviderInstances[0]

    act(() => provider?.emit('close', { event: { code: 1000, reason: 'Reset Connection' } }))
    expect(provider?.configuration.websocketProvider.webSocket.close).toHaveBeenCalledTimes(1)
    expect(provider?.configuration.websocketProvider.disconnect).not.toHaveBeenCalled()
    expect(mockProviderInstances).toHaveLength(1)

    unmount()
  })

  it('retries a temporary sidecar auth rejection after the token endpoint succeeded', async () => {
    const documentId = '22222222-2222-4222-8222-222222222222'
    const { result, unmount } = renderHook(() => useDocumentCollaboration(documentId))
    await waitFor(() => expect(result.current.mode).toBe('collab'))
    const provider = mockProviderInstances[0]
    expect(provider).toBeDefined()

    act(() => provider?.emit('synced'))
    act(() => provider?.emit('authenticationFailed', { reason: 'room is draining' }))
    await waitFor(() => {
      expect(provider?.configuration.websocketProvider.webSocket.close).toHaveBeenCalledTimes(1)
    })
    expect(result.current.mode).toBe('collab')

    if (provider) provider.configuration.websocketProvider.status = 'disconnected'
    act(() => provider?.emit('disconnect'))
    await waitFor(() => expect(mockApiCall).toHaveBeenCalledTimes(2))
    expect(provider?.configuration.websocketProvider.connect).toHaveBeenCalledTimes(1)
    expect(result.current.mode).toBe('collab')

    unmount()
  })
})
