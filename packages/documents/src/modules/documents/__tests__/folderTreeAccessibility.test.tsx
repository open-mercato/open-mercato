/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import type { FolderRow } from '../backend/documents/documentsListTypes'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: () => null,
}))

import { FolderTree } from '../backend/documents/FolderTree'

const folders: FolderRow[] = [
  {
    id: 'parent-folder',
    name: 'Parent folder',
    parentFolderId: null,
    updatedAt: '2026-07-15T10:00:00.000Z',
    canEdit: true,
    visibility: 'owned',
  },
  {
    id: 'child-folder',
    name: 'Child folder',
    parentFolderId: 'parent-folder',
    updatedAt: '2026-07-15T10:00:00.000Z',
    canEdit: true,
    visibility: 'owned',
  },
]

describe('FolderTree accessibility', () => {
  it('represents folder hierarchy as nested lists and marks the selected folder', () => {
    render(
      <FolderTree
        folders={folders}
        selectedFolderId="child-folder"
        onSelect={jest.fn()}
        onCreate={jest.fn()}
        onRename={jest.fn()}
        onDelete={jest.fn()}
        canCreateFolder
      />,
    )

    const parentButton = screen.getByRole('button', { name: 'Parent folder' })
    const parentItem = parentButton.closest('li')
    expect(parentItem).not.toBeNull()
    expect(within(parentItem as HTMLLIElement).getByRole('list')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Child folder' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'documents.folders.root' }).hasAttribute('aria-current')).toBe(false)
  })
})
