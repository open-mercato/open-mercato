/** @jest-environment jsdom */

import { act, renderHook } from '@testing-library/react'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const flashMock = jest.fn()
const mockTranslate = (key: string) => key

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

import { useShareDialog } from '../backend/documents/components/useShareDialog'

const documentId = '11111111-1111-4111-8111-111111111111'
const principalId = '22222222-2222-4222-8222-222222222222'
const share = {
  id: '33333333-3333-4333-8333-333333333333',
  principalType: 'user' as const,
  principalId,
  principalLabel: 'Ada Lovelace',
  principalSecondary: 'ada@example.com',
  resolved: true,
  permission: 'viewer' as const,
  updatedAt: '2026-07-10T10:00:00.000Z',
}

describe('useShareDialog mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } })
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  })

  it('synchronously ignores a repeated add while the first request is in flight', async () => {
    let resolveAdd: ((value: unknown) => void) | undefined
    apiCallOrThrowMock.mockImplementation(() => new Promise((resolve) => { resolveAdd = resolve }))
    const { result } = renderHook(() => useShareDialog({ documentId, open: true, canManage: true }))

    await act(async () => { await Promise.resolve() })
    act(() => { result.current.setPrincipalId(principalId) })

    let first: Promise<void> | undefined
    let repeated: Promise<void> | undefined
    act(() => {
      first = result.current.addShare()
      repeated = result.current.addShare()
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(result.current.isSubmitting).toBe(true)

    await act(async () => {
      resolveAdd?.({ ok: true, result: {} })
      await Promise.all([first, repeated])
    })

    expect(runMutationMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith('documents.share.dialog.success.add', 'success')
    expect(result.current.isSubmitting).toBe(false)
  })

  it('synchronously ignores repeated and competing mutations for the same share', async () => {
    let resolveUpdate: ((value: unknown) => void) | undefined
    apiCallOrThrowMock.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve }))
    const { result } = renderHook(() => useShareDialog({ documentId, open: true, canManage: true }))

    await act(async () => { await Promise.resolve() })

    let first: Promise<void> | undefined
    let repeated: Promise<void> | undefined
    let competing: Promise<void> | undefined
    act(() => {
      first = result.current.changePermission(share, 'editor')
      repeated = result.current.changePermission(share, 'editor')
      competing = result.current.removeShare(share)
    })

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(runMutationMock).toHaveBeenCalledTimes(1)
    expect(result.current.pendingShareIds.has(share.id)).toBe(true)

    await act(async () => {
      resolveUpdate?.({ ok: true, result: {} })
      await Promise.all([first, repeated, competing])
    })

    expect(result.current.pendingShareIds.has(share.id)).toBe(false)
  })

  it('keeps the newest share list when loads resolve out of order', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    apiCallMock.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve) }))
    const { result } = renderHook(() => useShareDialog({ documentId, open: true, canManage: true }))

    let newerLoad: Promise<void> | undefined
    act(() => { newerLoad = result.current.reload() })
    expect(apiCallMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolvers[1]?.({
        ok: true,
        result: { items: [{ ...share, id: '44444444-4444-4444-8444-444444444444', principalLabel: 'New value' }] },
      })
      await newerLoad
    })
    expect(result.current.shares.map((row) => row.principalLabel)).toEqual(['New value'])

    await act(async () => {
      resolvers[0]?.({ ok: true, result: { items: [{ ...share, principalLabel: 'Stale value' }] } })
      await Promise.resolve()
    })

    expect(result.current.shares.map((row) => row.principalLabel)).toEqual(['New value'])
    expect(result.current.isLoading).toBe(false)
  })

  it('does not let an older document mutation replace the active document shares', async () => {
    const nextDocumentId = '55555555-5555-4555-8555-555555555555'
    let resolveUpdate: ((value: unknown) => void) | undefined
    apiCallOrThrowMock.mockImplementation(() => new Promise((resolve) => { resolveUpdate = resolve }))
    apiCallMock.mockImplementation((path: string) => Promise.resolve({
      ok: true,
      result: {
        items: [{
          ...share,
          id: path.includes(nextDocumentId)
            ? '66666666-6666-4666-8666-666666666666'
            : share.id,
          principalLabel: path.includes(nextDocumentId) ? 'Document B' : 'Document A',
        }],
      },
    }))
    const { result, rerender } = renderHook(
      ({ activeDocumentId }) => useShareDialog({ documentId: activeDocumentId, open: true, canManage: true }),
      { initialProps: { activeDocumentId: documentId } },
    )

    await act(async () => { await Promise.resolve() })
    let mutation: Promise<void> | undefined
    act(() => { mutation = result.current.changePermission(share, 'editor') })

    rerender({ activeDocumentId: nextDocumentId })
    await act(async () => { await Promise.resolve() })
    expect(result.current.shares.map((row) => row.principalLabel)).toEqual(['Document B'])

    await act(async () => {
      resolveUpdate?.({ ok: true, result: {} })
      await mutation
    })

    expect(apiCallMock).toHaveBeenCalledTimes(2)
    expect(result.current.shares.map((row) => row.principalLabel)).toEqual(['Document B'])
  })
})
