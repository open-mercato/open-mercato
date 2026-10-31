/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const flashMock = jest.fn()
const runMutationMock = jest.fn()
const mockTranslate = (key: string) => key
const mockRouter = { push: jest.fn(), replace: jest.fn() }

jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => function MockVersionPreviewDialog({
    onRestore,
  }: {
    onRestore: (version: {
      id: string
      label: string | null
      creatorLabel: string
      createdAt: string
      contentHtml: string
    }) => void | Promise<void>
  }) {
    return (
      <button type="button" onClick={() => { void onRestore({
        id: '22222222-2222-4222-8222-222222222222',
        label: 'Checkpoint',
        creatorLabel: 'Ada',
        createdAt: '2026-07-10T12:00:00.000Z',
        contentHtml: '<p>Historical content</p>',
      }) }}>
        restore-preview
      </button>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, operation: () => unknown) => operation(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({ buildOptimisticLockHeader: () => ({}) }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: runMutationMock, retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: (...args: unknown[]) => flashMock(...args) }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label, action }: { label: string; action?: React.ReactNode }) => <div>{label}{action}</div>,
}))
jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))
jest.mock('@open-mercato/ui/primitives/empty-state', () => ({ EmptyState: ({ title }: { title: string }) => <div>{title}</div> }))
jest.mock('@open-mercato/ui/primitives/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }))
jest.mock('@open-mercato/ui/primitives/label', () => ({ Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label> }))
jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))

import { VersionHistoryPanel } from '../backend/documents/[id]/VersionHistoryPanel'
import { useFallbackContentPersistence } from '../backend/documents/[id]/useFallbackContentPersistence'

const documentId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const contentUpdatedAt = '2026-07-10T12:00:00.000Z'
const restoredUpdatedAt = '2026-07-10T12:01:00.000Z'

function versionsResponse() {
  return {
    ok: true,
    result: {
      items: [{ id: versionId, label: 'Checkpoint', creatorLabel: 'Ada', createdAt: contentUpdatedAt }],
    },
  }
}

describe('VersionHistoryPanel restore lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockResolvedValue(versionsResponse())
    apiCallOrThrowMock.mockResolvedValue({
      ok: true,
      result: { contentHtml: '<p>Historical content</p>', updatedAt: restoredUpdatedAt },
    })
    runMutationMock.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  })

  it('keeps the preview open and suppresses duplicate restores until refreshed content is installed', async () => {
    let resolveRefresh: (() => void) | undefined
    const onRestored = jest.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve }))
    render(
      <VersionHistoryPanel
        documentId={documentId}
        canRestore
        contentUpdatedAt={contentUpdatedAt}
        onRestored={onRestored}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'documents.versions.actions.preview' }))
    const restore = await screen.findByRole('button', { name: 'restore-preview' })
    fireEvent.click(restore)

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'restore-preview' })).toBeTruthy()
    expect(flashMock).not.toHaveBeenCalledWith('documents.versions.restored', 'success')

    fireEvent.click(screen.getByRole('button', { name: 'restore-preview' }))
    // One restore = the fresh content-token read plus the restore POST; the
    // duplicate click while the refresh is pending must not add a second pair.
    const restoreCalls = apiCallOrThrowMock.mock.calls.filter(([url]) => String(url).endsWith('/restore'))
    expect(restoreCalls).toHaveLength(1)
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveRefresh?.()
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.queryByRole('button', { name: 'restore-preview' })).toBeNull())
    expect(flashMock).toHaveBeenCalledWith('documents.versions.restored', 'success')
  })
})

describe('named version save barrier', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockResolvedValue(versionsResponse())
    apiCallOrThrowMock.mockResolvedValue({ ok: true })
    runMutationMock.mockImplementation(({ operation }: { operation: () => Promise<unknown> }) => operation())
  })

  it('drains a pending fallback write and the edit queued behind it before creating the immutable version', async () => {
    let completeFirst!: (value: unknown) => void
    let completeSecond!: (value: unknown) => void
    const writes: string[] = []
    apiCallMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== 'PUT') return Promise.resolve(versionsResponse())
      writes.push((JSON.parse(String(init.body)) as { contentHtml: string }).contentHtml)
      return new Promise((resolve) => {
        if (writes.length === 1) completeFirst = resolve
        else completeSecond = resolve
      })
    })
    const { result } = renderHook(() => useFallbackContentPersistence({
      documentId, initialUpdatedAt: contentUpdatedAt, enabled: true,
    }))
    const edit = (text: string) => ({ getHTML: () => `<p>${text}</p>`, getText: () => text }) as unknown as Editor
    act(() => result.current.onEditorUpdate(edit('First edit')))
    let saving!: Promise<boolean>
    act(() => { saving = result.current.saveNow() })
    await waitFor(() => expect(writes).toHaveLength(1))
    act(() => result.current.onEditorUpdate(edit('Latest edit')))
    render(<VersionHistoryPanel documentId={documentId} canRestore onBeforeSnapshot={() => result.current.saveNow()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'documents.versions.actions.snapshot' }))
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
    await act(async () => { completeFirst({ ok: true, result: { updatedAt: restoredUpdatedAt } }) })
    await waitFor(() => expect(writes).toHaveLength(2))
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
    await act(async () => {
      completeSecond({ ok: true, result: { updatedAt: restoredUpdatedAt } })
      await saving
    })
    await waitFor(() => expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1))
    expect(writes).toEqual(['<p>First edit</p>', '<p>Latest edit</p>'])
    expect(flashMock).toHaveBeenCalledWith('documents.versions.snapshot.created', 'success')
  })

  it.each([false, 'rejected'])('does not create a version or report success when saving is %s', async (outcome) => {
    const onBeforeSnapshot = jest.fn(async () => {
      if (outcome === 'rejected') throw new Error('Save failed')
      return false
    })
    render(<VersionHistoryPanel documentId={documentId} canRestore onBeforeSnapshot={onBeforeSnapshot} />)
    fireEvent.click(await screen.findByRole('button', { name: 'documents.versions.actions.snapshot' }))
    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(expect.any(String), 'error'))
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
    expect(flashMock).not.toHaveBeenCalledWith('documents.versions.snapshot.created', 'success')
  })

  it('prevents duplicate keyboard submissions while collaboration persistence is pending and rejects navigation during the wait', async () => {
    let complete!: (saved: boolean) => void
    const onBeforeSnapshot = jest.fn(() => new Promise<boolean>((resolve) => { complete = resolve }))
    const view = render(<VersionHistoryPanel documentId={documentId} canRestore onBeforeSnapshot={onBeforeSnapshot} />)
    const label = screen.getByLabelText('documents.versions.snapshot.labelPlaceholder')
    fireEvent.keyDown(label, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(label, { key: 'Enter', ctrlKey: true })
    expect(onBeforeSnapshot).toHaveBeenCalledTimes(1)
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
    view.rerender(<VersionHistoryPanel documentId="other-document" canRestore onBeforeSnapshot={onBeforeSnapshot} />)
    await act(async () => { complete(true) })
    expect(apiCallOrThrowMock).not.toHaveBeenCalled()
  })
})
