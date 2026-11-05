/** @jest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const routerPushMock = jest.fn()
const translateMock = (key: string) => key

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: runMutationMock,
    retryLastMutation: jest.fn(async () => false),
  }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: jest.fn(() => ({})) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translateMock }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPushMock }) }))

import { useDocumentsList } from '../backend/documents/useDocumentsList'

describe('useDocumentsList document creation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockImplementation(async (path: string) => {
      if (path === '/api/documents/folders') return { ok: true, result: { items: [] } }
      if (path.startsWith('/api/documents?')) {
        return {
          ok: true,
          result: {
            items: [],
            collectionCapabilities: { canCreateDocument: true },
          },
        }
      }
      if (path.startsWith('/api/documents/templates?')) return { ok: true, result: { items: [] } }
      throw new Error(`Unexpected API call: ${path}`)
    })
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  })

  it('keeps repeated creates blocked through the pending navigation', async () => {
    let resolveCreate: ((value: unknown) => void) | undefined
    apiCallOrThrowMock.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve }))
    const { result } = renderHook(() => useDocumentsList())

    await waitFor(() => expect(result.current.collectionCapabilities.canCreateDocument).toBe(true))

    let first: Promise<void> | undefined
    let repeated: Promise<void> | undefined
    act(() => {
      first = result.current.createDocument()
      repeated = result.current.createDocument()
    })

    expect(runMutationMock).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(result.current.isCreating).toBe(true)

    await act(async () => {
      resolveCreate?.({ ok: true, result: { id: 'document-one' } })
      await Promise.all([first, repeated])
    })

    expect(routerPushMock).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledWith('/backend/documents/document-one')
    expect(result.current.isCreating).toBe(true)

    await act(async () => result.current.createDocument())

    expect(runMutationMock).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
    expect(routerPushMock).toHaveBeenCalledTimes(1)
  })

  it('releases the create guard after a failed request', async () => {
    apiCallOrThrowMock
      .mockRejectedValueOnce(new Error('Create failed'))
      .mockResolvedValueOnce({ ok: true, result: { id: 'document-two' } })
    const { result } = renderHook(() => useDocumentsList())

    await waitFor(() => expect(result.current.collectionCapabilities.canCreateDocument).toBe(true))
    await act(async () => result.current.createDocument())

    expect(result.current.isCreating).toBe(false)

    await act(async () => result.current.createDocument())

    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(2)
    expect(routerPushMock).toHaveBeenCalledWith('/backend/documents/document-two')
  })
})
