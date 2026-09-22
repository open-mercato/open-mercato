/** @jest-environment jsdom */

import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocumentRow, FolderRow } from '../backend/documents/documentsListTypes'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => {
  const ReactRuntime = require('react') as typeof React
  const component = (tag: string, role?: string) => ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    ReactRuntime.createElement(tag, { ...props, role }, children)
  )
  return {
    Dialog: ({ children }: { children: React.ReactNode }) => ReactRuntime.createElement('div', null, children),
    DialogContent: component('div', 'dialog'),
    DialogDescription: component('p'),
    DialogFooter: component('div'),
    DialogHeader: component('div'),
    DialogTitle: component('h2'),
  }
})

jest.mock('@open-mercato/ui/primitives/select', () => {
  const ReactRuntime = require('react') as typeof React
  type SelectProps = {
    children: React.ReactNode
    value?: string
    onValueChange?: (value: string) => void
    disabled?: boolean
  }
  return {
    Select: ({ children, value, onValueChange, disabled }: SelectProps) => ReactRuntime.createElement(
      'select',
      { value, disabled, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onValueChange?.(event.target.value) },
      children,
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => ReactRuntime.createElement(ReactRuntime.Fragment, null, children),
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => ReactRuntime.createElement('option', { value }, children),
  }
})

import { FolderDialog } from '../backend/documents/FolderDialog'
import { MoveDocumentDialog } from '../backend/documents/MoveDocumentDialog'

const folder: FolderRow = {
  id: 'folder-one',
  name: 'Folder one',
  parentFolderId: null,
  updatedAt: '2026-07-14T10:00:00.000Z',
  canEdit: true,
  visibility: 'owned',
}

const document: DocumentRow = {
  id: 'document-one',
  title: 'Document one',
  folderId: null,
  folderName: null,
  ownerLabel: 'Owner',
  sharedWithCount: 0,
  updatedAt: '2026-07-14T10:00:00.000Z',
  capabilities: {
    canView: true,
    canComment: true,
    canEdit: true,
    canShare: true,
    canDelete: true,
    canCreate: true,
    canManageTemplates: false,
  },
}

describe('documents list dialogs', () => {
  it('keeps the folder dialog open after failure and blocks duplicate close or submit while pending', async () => {
    let resolveSubmit: ((value: boolean) => void) | null = null
    const onSubmit = jest.fn(() => new Promise<boolean>((resolve) => { resolveSubmit = resolve }))
    const onOpenChange = jest.fn()
    render(<FolderDialog
      state={{ mode: 'create', parentFolderId: null }}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New folder' } })
    fireEvent.click(screen.getByRole('button', { name: 'documents.folders.actions.create' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'documents.folders.actions.create' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalled()

    await act(async () => resolveSubmit?.(false))
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(false))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes the folder dialog only after a successful save', async () => {
    const onOpenChange = jest.fn()
    render(<FolderDialog
      state={{ mode: 'create', parentFolderId: null }}
      onOpenChange={onOpenChange}
      onSubmit={async () => true}
    />)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New folder' } })
    fireEvent.click(screen.getByRole('button', { name: 'documents.folders.actions.create' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('keeps the move dialog open on failure and closes it on the next successful attempt', async () => {
    const onOpenChange = jest.fn()
    const onMove = jest.fn<Promise<boolean>, [DocumentRow, string | null]>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    render(<MoveDocumentDialog
      document={document}
      folders={[folder]}
      open
      onOpenChange={onOpenChange}
      onMove={onMove}
    />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: folder.id } })
    fireEvent.click(screen.getByRole('button', { name: 'documents.folders.actions.moveDocument' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1))
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'documents.folders.actions.moveDocument' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(2))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
