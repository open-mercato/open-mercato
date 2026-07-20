/** @jest-environment jsdom */

import * as React from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const routerPushMock = jest.fn()
const translate = (key: string) => key

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockDocumentEditorIsland() { return null },
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPushMock }) }))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn(async () => false) }),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => translate }))
jest.mock('@open-mercato/ui/primitives/link-button', () => ({ LinkButton: () => null }))

jest.mock('../backend/documents/[id]/CommentsRail', () => ({ CommentsRail: () => null }))
jest.mock('../backend/documents/[id]/ExportMenu', () => ({ ExportMenu: () => null }))
jest.mock('../backend/documents/[id]/RelatedRecordsPanel', () => ({ RelatedRecordsPanel: () => null }))
jest.mock('../backend/documents/[id]/DocumentNavigator', () => ({ DocumentNavigator: () => null }))
jest.mock('../backend/documents/[id]/VersionHistoryPanel', () => ({ VersionHistoryPanel: () => null }))
jest.mock('../backend/documents/[id]/DocumentEditorErrorBoundary', () => ({
  DocumentEditorErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('../backend/documents/components/ShareDialog', () => ({ ShareDialog: () => null }))

import { DocumentPageClient } from '../backend/documents/[id]/DocumentPageClient'
import { useDocumentsList } from '../backend/documents/useDocumentsList'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const UPDATED_AT = '2026-07-15T08:00:00.000Z'

const CAPABILITIES = {
  canView: true,
  canComment: true,
  canEdit: true,
  canShare: true,
  canDelete: true,
  canCreate: true,
  canManageTemplates: false,
  canArchive: true,
  canDuplicate: true,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe('document duplicate single-flight', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  })

  describe('detail page action', () => {
    beforeEach(() => {
      apiCallMock.mockImplementation(async (path: string) => {
        if (path === `/api/documents/${DOCUMENT_ID}`) {
          return {
            ok: true,
            status: 200,
            result: {
              id: DOCUMENT_ID,
              title: 'Quarterly report',
              updatedAt: UPDATED_AT,
              archivedAt: null,
              capabilities: CAPABILITIES,
            },
          }
        }
        if (path === `/api/documents/${DOCUMENT_ID}/content`) {
          return { ok: true, status: 200, result: { contentHtml: '<p>Body</p>', updatedAt: UPDATED_AT } }
        }
        throw new Error(`Unexpected API call: ${path}`)
      })
    })

    it('issues one duplicate request when the action is activated repeatedly', async () => {
      const pending = deferred<unknown>()
      apiCallOrThrowMock.mockImplementation(() => pending.promise)
      render(<DocumentPageClient documentId={DOCUMENT_ID} />)

      const button = await screen.findByRole('button', { name: /documents\.actions\.duplicate/ })
      await act(async () => {
        button.click()
        button.click()
      })

      expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        `/api/documents/${DOCUMENT_ID}/duplicate`,
        expect.objectContaining({ method: 'POST' }),
      )
      expect((button as HTMLButtonElement).disabled).toBe(true)

      await act(async () => {
        pending.resolve({ ok: true, result: { id: 'copy-one' } })
        await pending.promise
      })

      expect(routerPushMock).toHaveBeenCalledTimes(1)
      expect(routerPushMock).toHaveBeenCalledWith('/backend/documents/copy-one')
    })

    it('re-enables the action after a failed duplicate', async () => {
      apiCallOrThrowMock.mockRejectedValueOnce(new Error('Duplicate failed'))
      render(<DocumentPageClient documentId={DOCUMENT_ID} />)

      const button = await screen.findByRole('button', { name: /documents\.actions\.duplicate/ })
      await act(async () => { button.click() })

      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))

      apiCallOrThrowMock.mockResolvedValueOnce({ ok: true, result: { id: 'copy-two' } })
      await act(async () => { button.click() })

      expect(apiCallOrThrowMock).toHaveBeenCalledTimes(2)
      expect(routerPushMock).toHaveBeenCalledWith('/backend/documents/copy-two')
    })
  })

  describe('list row action', () => {
    beforeEach(() => {
      apiCallMock.mockImplementation(async (path: string) => {
        if (path === '/api/documents/folders') return { ok: true, result: { items: [] } }
        if (path.startsWith('/api/documents?')) {
          return { ok: true, result: { items: [], collectionCapabilities: { canCreateDocument: true } } }
        }
        if (path.startsWith('/api/documents/templates?')) return { ok: true, result: { items: [] } }
        throw new Error(`Unexpected API call: ${path}`)
      })
    })

    it('issues one duplicate request per row while the first is in flight', async () => {
      const pending = deferred<unknown>()
      apiCallOrThrowMock.mockImplementation(() => pending.promise)
      const { result } = renderHook(() => useDocumentsList())
      await waitFor(() => expect(result.current.collectionCapabilities.canCreateDocument).toBe(true))

      const row = { id: DOCUMENT_ID, updatedAt: UPDATED_AT } as Parameters<typeof result.current.duplicateDocument>[0]
      let first: Promise<void> | undefined
      let repeated: Promise<void> | undefined
      act(() => {
        first = result.current.duplicateDocument(row)
        repeated = result.current.duplicateDocument(row)
      })

      expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)

      await act(async () => {
        pending.resolve({ ok: true, result: { id: 'copy-three' } })
        await Promise.all([first, repeated])
      })

      expect(routerPushMock).toHaveBeenCalledTimes(1)
      expect(routerPushMock).toHaveBeenCalledWith('/backend/documents/copy-three')
    })

    it('releases the row guard after the duplicate settles', async () => {
      apiCallOrThrowMock.mockResolvedValue({ ok: true, result: { id: 'copy-four' } })
      const { result } = renderHook(() => useDocumentsList())
      await waitFor(() => expect(result.current.collectionCapabilities.canCreateDocument).toBe(true))

      const row = { id: DOCUMENT_ID, updatedAt: UPDATED_AT } as Parameters<typeof result.current.duplicateDocument>[0]
      await act(async () => { await result.current.duplicateDocument(row) })
      await act(async () => { await result.current.duplicateDocument(row) })

      expect(apiCallOrThrowMock).toHaveBeenCalledTimes(2)
    })
  })
})
