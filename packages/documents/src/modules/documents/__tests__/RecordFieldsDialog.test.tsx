/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

const apiCallMock = jest.fn()
const insertSnapshotMock = jest.fn(() => true)
const mockTranslate = (key: string) => key

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  ErrorMessage: ({ label, action }: { label: string; action?: React.ReactNode }) => <div>{label}{action}</div>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/primitives/checkbox-field', () => ({
  CheckboxField: ({
    label,
    description,
    checked,
    onCheckedChange,
  }: {
    label: string
    description?: React.ReactNode
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <label>
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      {label}
      <span>{description}</span>
    </label>
  ),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children, onKeyDown }: { children: React.ReactNode; onKeyDown?: React.KeyboardEventHandler }) => (
    <div role="dialog" onKeyDown={onKeyDown}>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

jest.mock('@open-mercato/ui/primitives/empty-state', () => ({
  EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))

jest.mock('../lib/recordFieldInsertion', () => ({
  insertRecordFieldSnapshot: (...args: unknown[]) => insertSnapshotMock(...args),
}))

import { RecordFieldsDialog } from '../backend/documents/[id]/RecordFieldsDialog'

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111'
const LINK_ID = '22222222-2222-4222-8222-222222222222'

const editor = {
  isDestroyed: false,
  isEditable: true,
} as unknown as Editor

function accessibleResponse() {
  return {
    ok: true,
    result: {
      items: [{
        id: LINK_ID,
        entityType: 'customer-company',
        label: 'Acme',
        href: '/backend/customers/companies/33333333-3333-4333-8333-333333333333',
        canOpen: true,
        source: 'related-panel',
        updatedAt: '2026-07-12T12:00:00.000Z',
        values: { name: 'Acme', email: 'hello@example.test', phone: null },
      }],
    },
  }
}

describe('RecordFieldsDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    apiCallMock.mockResolvedValue(accessibleResponse())
  })

  it('refreshes current values, requires an explicit subset, and submits with Ctrl+Enter', async () => {
    const onOpenChange = jest.fn()
    render(
      <RecordFieldsDialog
        documentId={DOCUMENT_ID}
        linkId={LINK_ID}
        editor={editor}
        canInsert
        onOpenChange={onOpenChange}
      />,
    )

    await screen.findByLabelText('documents.entityFields.name')
    expect(apiCallMock).toHaveBeenCalledWith(
      `/api/documents/${DOCUMENT_ID}/links`,
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    )
    expect(screen.getByText('documents.relatedRecords.fields.snapshotDisclosure')).toBeTruthy()
    expect((screen.getByRole('button', {
      name: 'documents.relatedRecords.fields.insertSelected',
    }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByLabelText('documents.entityFields.name'))
    fireEvent.click(screen.getByLabelText('documents.entityFields.email'))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', ctrlKey: true })

    expect(insertSnapshotMock).toHaveBeenCalledWith(editor, [
      { field: 'name', label: 'documents.entityFields.name', value: 'Acme' },
      { field: 'email', label: 'documents.entityFields.email', value: 'hello@example.test' },
    ])
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes on Escape and never loads or renders while the editor is not editable', async () => {
    const onOpenChange = jest.fn()
    const { rerender } = render(
      <RecordFieldsDialog
        documentId={DOCUMENT_ID}
        linkId={LINK_ID}
        editor={editor}
        canInsert
        onOpenChange={onOpenChange}
      />,
    )
    await screen.findByRole('dialog')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)

    jest.clearAllMocks()
    rerender(
      <RecordFieldsDialog
        documentId={DOCUMENT_ID}
        linkId={LINK_ID}
        editor={editor}
        canInsert={false}
        onOpenChange={onOpenChange}
      />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows no fields and cannot insert when refreshed access is restricted', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: {
        items: [{
          id: LINK_ID,
          entityType: 'customer-company',
          label: 'Restricted record',
          href: null,
          canOpen: false,
          source: 'related-panel',
          updatedAt: '2026-07-12T12:00:00.000Z',
          values: { name: 'Must not render' },
        }],
      },
    })
    render(
      <RecordFieldsDialog
        documentId={DOCUMENT_ID}
        linkId={LINK_ID}
        editor={editor}
        canInsert
        onOpenChange={jest.fn()}
      />,
    )

    await screen.findByText('documents.relatedRecords.fields.empty')
    expect(screen.queryByText('Must not render')).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter', metaKey: true })
    expect(insertSnapshotMock).not.toHaveBeenCalled()
  })

  it('retries a failed field refresh and recovers without closing the dialog', async () => {
    apiCallMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce(accessibleResponse())

    render(
      <RecordFieldsDialog
        documentId={DOCUMENT_ID}
        linkId={LINK_ID}
        editor={editor}
        canInsert
        onOpenChange={jest.fn()}
      />,
    )

    await screen.findByText('documents.relatedRecords.error.load')
    fireEvent.click(screen.getByRole('button', { name: 'documents.actions.retry' }))

    await screen.findByLabelText('documents.entityFields.name')
    expect(apiCallMock).toHaveBeenCalledTimes(2)
  })
})
