/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

const apiCallMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const confirmMock = jest.fn()
const flashMock = jest.fn()
const runMutationMock = jest.fn()
const mockTranslate = (key: string) => key

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
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: confirmMock, ConfirmDialogElement: null }),
}))
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
    confirmMock.mockResolvedValue(true)
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
    expect(apiCallOrThrowMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveRefresh?.()
      await Promise.resolve()
    })

    await waitFor(() => expect(screen.queryByRole('button', { name: 'restore-preview' })).toBeNull())
    expect(flashMock).toHaveBeenCalledWith('documents.versions.restored', 'success')
  })
})
