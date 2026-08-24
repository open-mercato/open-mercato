/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ data, columns, actions, rowActions }: {
    data: Array<Record<string, unknown>>
    columns: Array<{ id?: string; accessorKey?: string; cell?: (input: { row: { original: unknown } }) => React.ReactNode }>
    actions?: React.ReactNode
    rowActions?: (row: unknown) => React.ReactNode
  }) => (
    <div>
      <div data-testid="table-actions">{actions}</div>
      {data.map((row, rowIndex) => (
        <div key={rowIndex} data-testid={`row-${rowIndex}`}>
          {columns.map((column, columnIndex) => (
            <span key={columnIndex}>{column.cell ? column.cell({ row: { original: row } }) : null}</span>
          ))}
          {rowActions ? rowActions(row) : null}
        </div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect: () => void }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" data-action-id={item.id} onClick={item.onSelect}>{item.label}</button>
      ))}
    </div>
  ),
}))

import { DocumentsTable } from '../backend/documents/DocumentsTable'
import type { DocumentRow } from '../backend/documents/documentsListTypes'

const baseCapabilities = {
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

function makeRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Quarterly SOP',
    folderId: null,
    folderName: null,
    ownerLabel: 'Owner',
    sharedWithCount: 0,
    updatedAt: '2026-07-17T10:00:00.000Z',
    archivedAt: null,
    isFavorite: false,
    capabilities: { ...baseCapabilities },
    ...overrides,
  }
}

function renderTable(rows: DocumentRow[], overrides: Partial<React.ComponentProps<typeof DocumentsTable>> = {}) {
  const handlers = {
    onSearchChange: jest.fn(),
    onPageChange: jest.fn(),
    onPageSizeChange: jest.fn(),
    onRefresh: jest.fn(),
    onCreate: jest.fn(),
    onNewFromTemplate: jest.fn(),
    onShare: jest.fn(),
    onMove: jest.fn(),
    onDelete: jest.fn(),
    onArchivedFilterChange: jest.fn(),
    onFavoritesOnlyChange: jest.fn(),
    onToggleFavorite: jest.fn(),
    onDuplicate: jest.fn(),
    onArchiveToggle: jest.fn(),
  }
  render(
    <DocumentsTable
      title="Documents"
      rows={rows}
      isLoading={false}
      isCreating={false}
      search=""
      page={1}
      pageSize={25}
      total={rows.length}
      totalPages={1}
      totalIsCapped={false}
      hasTemplates={false}
      canCreateDocument
      canInstantiateTemplate={false}
      canManageTemplates={false}
      archivedFilter="exclude"
      favoritesOnly={false}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe('M9 documents table', () => {
  it('renders an accessible star toggle that reports the favorite state and fires the handler', () => {
    const handlers = renderTable([makeRow({ isFavorite: true })])
    const star = screen.getByRole('button', { name: 'documents.actions.unfavorite' })
    expect(star.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(star)
    expect(handlers.onToggleFavorite).toHaveBeenCalledTimes(1)
  })

  it('shows the archived badge only for archived rows', () => {
    renderTable([
      makeRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', archivedAt: '2026-07-16T10:00:00.000Z', title: 'Archived SOP' }),
      makeRow({ title: 'Active SOP' }),
    ])
    expect(screen.getAllByText('documents.list.archivedBadge')).toHaveLength(1)
  })

  it('exposes duplicate and state-dependent archive row actions with stable ids', () => {
    const handlers = renderTable([
      makeRow(),
      makeRow({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', archivedAt: '2026-07-16T10:00:00.000Z' }),
    ])
    const duplicateButtons = screen.getAllByText('documents.actions.duplicate')
    expect(duplicateButtons).toHaveLength(2)
    expect(duplicateButtons[0]?.getAttribute('data-action-id')).toBe('duplicate')
    const archiveButton = screen.getByText('documents.actions.archive')
    const unarchiveButton = screen.getByText('documents.actions.unarchive')
    expect(archiveButton.getAttribute('data-action-id')).toBe('archive')
    expect(unarchiveButton.getAttribute('data-action-id')).toBe('unarchive')
    fireEvent.click(archiveButton)
    expect(handlers.onArchiveToggle).toHaveBeenCalledTimes(1)
    fireEvent.click(duplicateButtons[0]!)
    expect(handlers.onDuplicate).toHaveBeenCalledTimes(1)
  })

  it('hides archive actions without canArchive and duplicate without canDuplicate', () => {
    renderTable(
      [makeRow({ capabilities: { ...baseCapabilities, canArchive: false, canDuplicate: false } })],
      { canCreateDocument: false },
    )
    expect(screen.queryByText('documents.actions.archive')).toBeNull()
    expect(screen.queryByText('documents.actions.duplicate')).toBeNull()
  })

  it('renders the favorites filter as a pressed toggle and the archived select', () => {
    const handlers = renderTable([makeRow()], { favoritesOnly: true })
    const favoritesFilter = screen.getByRole('button', { name: 'documents.list.filters.favorites' })
    expect(favoritesFilter.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(favoritesFilter)
    expect(handlers.onFavoritesOnlyChange).toHaveBeenCalledWith(false)
  })
})
