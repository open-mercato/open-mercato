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
})
