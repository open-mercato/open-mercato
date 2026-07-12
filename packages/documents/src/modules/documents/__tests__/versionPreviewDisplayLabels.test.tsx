/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen, within } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@tiptap/react', () => ({
  EditorContent: () => <div data-testid="version-content" />,
  useEditor: () => ({ commands: { setContent: jest.fn() } }),
}))

jest.mock('../lib/editorConfig', () => ({
  getDocumentEditorExtensions: () => [],
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label }: { label: string }) => <div>{label}</div>,
}))

const translations: Record<string, string> = {
  'documents.actions.close': 'Close',
  'documents.links.restrictedRecord': 'Restricted record',
  'documents.users.unknown': 'Unknown user',
  'documents.versions.actions.restore': 'Restore',
  'documents.versions.preview.error': 'Failed to load version preview.',
  'documents.versions.preview.loading': 'Loading version preview…',
  'documents.versions.preview.title': 'Version preview',
  'ui.dialog.close.ariaLabel': 'Close',
}

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, params?: Record<string, unknown> | string) => {
    if (key === 'documents.versions.preview.description') {
      const values = typeof params === 'object' && params ? params : {}
      return `Created by ${String(values.creator ?? '')}`
    }
    return translations[key] ?? (typeof params === 'string' ? params : key)
  },
}))

import {
  normalizeVersionPreview,
  VersionPreviewDialog,
} from '../backend/documents/[id]/VersionPreviewDialog'

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
})
