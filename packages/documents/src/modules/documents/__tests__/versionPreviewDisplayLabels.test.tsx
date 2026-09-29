/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

// The mock must forward `className`: the preview shares the live canvas'
// typography class so tables keep their grid lines, and a mock that drops the
// prop makes that fix untestable.
jest.mock('@tiptap/react', () => ({
  EditorContent: ({ className }: { className?: string }) => (
    <div data-testid="version-content" className={className} />
  ),
  useEditor: () => ({ commands: { setContent: jest.fn() } }),
}))

jest.mock('../lib/editorConfig', () => ({
  getDocumentEditorExtensions: () => [],
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label, action }: { label: string; action?: React.ReactNode }) => <div>{label}{action}</div>,
}))

const translations: Record<string, string> = {
  'documents.actions.cancel': 'Cancel',
  'documents.actions.close': 'Close',
  'documents.actions.retry': 'Retry',
  'documents.links.restrictedRecord': 'Restricted record',
  'documents.users.unknown': 'Unknown user',
  'documents.versions.actions.restore': 'Restore',
  'documents.versions.preview.error': 'Failed to load version preview.',
  'documents.versions.preview.loading': 'Loading version preview…',
  'documents.versions.preview.title': 'Version preview',
  'documents.versions.restore.confirmBody': 'The document will be reset to this version.',
  'documents.versions.restore.confirmTitle': 'Restore this version?',
  'ui.dialog.close.ariaLabel': 'Close',
}

const translateMock = (key: string, params?: Record<string, unknown> | string) => {
  if (key === 'documents.versions.preview.description') {
    const values = typeof params === 'object' && params ? params : {}
    return `Created by ${String(values.creator ?? '')}`
  }
  return translations[key] ?? (typeof params === 'string' ? params : key)
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => translateMock,
}))

import {
  normalizeVersionPreview,
  VersionPreviewDialog,
} from '../backend/documents/[id]/VersionPreviewDialog'
import { DOCUMENT_EDITOR_CONTENT_CLASS } from '../backend/documents/[id]/editorTypes'

const documentId = '11111111-1111-4111-8111-111111111111'
const versionId = '22222222-2222-4222-8222-222222222222'
const exposedId = '01890f47-e2ab-7cc0-98c9-a72f8b123456'

function legacyPreviewPayload() {
  return {
    id: versionId,
    label: `Review checkpoint ${exposedId}`,
    creatorLabel: `User ${exposedId}`,
    createdAt: '2026-07-10T12:00:00.000Z',
    contentHtml: '<p>Historical content</p>',
  }
}

describe('VersionPreviewDialog display labels', () => {
  beforeEach(() => {
    apiCallMock.mockReset().mockResolvedValue({ ok: true, result: legacyPreviewPayload() })
  })

  it('normalizes raw legacy API values before they reach render state', () => {
    expect(normalizeVersionPreview(legacyPreviewPayload(), 'Unknown user')).toEqual({
      id: versionId,
      label: null,
      creatorLabel: 'Unknown user',
      createdAt: '2026-07-10T12:00:00.000Z',
      contentHtml: '<p>Historical content</p>',
    })
  })

  it('renders a localized neutral visible and accessible title without the legacy UUID', async () => {
    render(<VersionPreviewDialog
      documentId={documentId}
      versionId={versionId}
      canRestore={false}
      isRestoring={false}
      onOpenChange={jest.fn()}
      onRestore={jest.fn()}
    />)

    await screen.findByText('Created by Unknown user')
    const dialog = screen.getByRole('dialog', { name: 'Version preview' })
    expect(within(dialog).getByRole('heading', { name: 'Version preview' })).toBeTruthy()
    expect(within(dialog).getByText('Created by Unknown user')).toBeTruthy()
    expect(document.body.textContent).not.toContain(exposedId)
  })

  it('renders the preview with the shared document editor typography', async () => {
    render(<VersionPreviewDialog
      documentId={documentId}
      versionId={versionId}
      canRestore={false}
      isRestoring={false}
      onOpenChange={jest.fn()}
      onRestore={jest.fn()}
    />)

    const content = await screen.findByTestId('version-content')
    const applied = content.className.split(/\s+/).filter(Boolean)
    // Without the shared class the preview loses table grid lines, heading
    // rhythm and list indentation that the live canvas renders.
    for (const token of DOCUMENT_EDITOR_CONTENT_CLASS.split(/\s+/).filter(Boolean)) {
      expect(applied).toContain(token)
    }
    expect(applied).toEqual(
      expect.arrayContaining(['rounded-md', 'border', 'border-border', 'bg-card', 'p-4']),
    )
  })

  it('retries a failed preview request in place', async () => {
    apiCallMock.mockReset().mockResolvedValue({ ok: false, status: 503, result: null })

    render(<VersionPreviewDialog
      documentId={documentId}
      versionId={versionId}
      canRestore={false}
      isRestoring={false}
      onOpenChange={jest.fn()}
      onRestore={jest.fn()}
    />)

    const retry = await screen.findByRole('button', { name: 'Retry' })
    apiCallMock.mockResolvedValue({ ok: true, result: legacyPreviewPayload() })
    fireEvent.click(retry)
    await screen.findByText('Created by Unknown user')
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })

  it('does not restore again from the keyboard while a restore is pending', async () => {
    const onRestore = jest.fn()
    render(<VersionPreviewDialog
      documentId={documentId}
      versionId={versionId}
      canRestore
      isRestoring
      onOpenChange={jest.fn()}
      onRestore={onRestore}
    />)

    await screen.findByText('Created by Unknown user')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true })

    expect(onRestore).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Restore' })).toHaveProperty('disabled', true)
  })

  it('keeps restore confirmation inside the accessible version-preview dialog', async () => {
    const onRestore = jest.fn()
    render(<VersionPreviewDialog
      documentId={documentId}
      versionId={versionId}
      canRestore
      isRestoring={false}
      onOpenChange={jest.fn()}
      onRestore={onRestore}
    />)

    await screen.findByText('Created by Unknown user')
    const previewDialog = screen.getByRole('dialog', { name: 'Version preview' })
    fireEvent.click(within(previewDialog).getByRole('button', { name: 'Restore' }))

    const confirmationDialog = screen.getByRole('dialog', { name: 'Restore this version?' })
    expect(confirmationDialog).toBe(previewDialog)
    expect(within(confirmationDialog).getByText('The document will be reset to this version.')).toBeTruthy()
    expect(onRestore).not.toHaveBeenCalled()
    const cancel = within(confirmationDialog).getByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))

    fireEvent.click(within(confirmationDialog).getByRole('button', { name: 'Restore' }))
    expect(onRestore).toHaveBeenCalledTimes(1)
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: versionId }))
  })
})
