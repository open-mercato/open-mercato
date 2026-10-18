/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  DictionaryTable,
  type DictionaryTableEntry,
  type DictionaryTableTranslations,
} from '../DictionaryTable'

type MockColumn = {
  accessorKey?: string
  id?: string
  header?: React.ReactNode
}

type MockDataTableProps = {
  title?: React.ReactNode
  actions?: React.ReactNode
  columns: MockColumn[]
  data: DictionaryTableEntry[]
  embedded?: boolean
  refreshButton?: {
    label: string
    onRefresh: () => void
  }
  rowActions?: (entry: DictionaryTableEntry) => React.ReactNode
}

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({
    title,
    actions,
    columns,
    data,
    embedded,
    refreshButton,
    rowActions,
  }: MockDataTableProps) => (
    <div data-testid="data-table" data-embedded={String(Boolean(embedded))}>
      <div>{title}</div>
      {actions}
      {refreshButton ? (
        <button type="button" onClick={refreshButton.onRefresh}>
          {refreshButton.label}
        </button>
      ) : null}
      <div>
        {columns.map((column) => (
          <span key={column.accessorKey ?? column.id}>{column.header}</span>
        ))}
      </div>
      {data.map((entry) => (
        <div key={entry.id}>
          <span>{entry.value}</span>
          <span>{entry.label}</span>
          {rowActions?.(entry)}
        </div>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect: () => void }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

const translations: DictionaryTableTranslations = {
  title: 'Statuses',
  valueColumn: 'Value',
  labelColumn: 'Label',
  appearanceColumn: 'Appearance',
  addLabel: 'Add entry',
  editLabel: 'Edit',
  deleteLabel: 'Delete',
  refreshLabel: 'Refresh',
  inheritedLabel: 'Inherited',
  inheritedTooltip: 'Managed in parent organization',
  emptyLabel: 'No entries yet.',
  searchPlaceholder: 'Search entries…',
}

const entry: DictionaryTableEntry = {
  id: 'status-1',
  value: 'active',
  label: 'Active',
  color: '#22c55e',
  icon: 'circle',
}

describe('DictionaryTable responsive containment', () => {
  it('contains the embedded table in a keyboard-usable horizontal scroll region', () => {
    render(<DictionaryTable entries={[entry]} canManage translations={translations} />)

    const region = screen.getByRole('region', { name: 'Statuses' })
    expect(region).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'overflow-x-auto')
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByTestId('data-table')).toHaveAttribute('data-embedded', 'true')
  })

  it('keeps every dictionary column and action inside the scroll region', () => {
    const onCreate = jest.fn()
    const onEdit = jest.fn()
    const onDelete = jest.fn()
    const onRefresh = jest.fn()

    render(
      <DictionaryTable
        entries={[entry]}
        canManage
        onCreate={onCreate}
        onEdit={onEdit}
        onDelete={onDelete}
        onRefresh={onRefresh}
        translations={translations}
      />,
    )

    const region = screen.getByRole('region', { name: 'Statuses' })
    expect(within(region).getByText('Value')).toBeInTheDocument()
    expect(within(region).getByText('Label')).toBeInTheDocument()
    expect(within(region).getByText('Appearance')).toBeInTheDocument()
    expect(within(region).getByText('active')).toBeInTheDocument()
    expect(within(region).getByText('Active')).toBeInTheDocument()

    fireEvent.click(within(region).getByRole('button', { name: 'Add entry' }))
    fireEvent.click(within(region).getByRole('button', { name: 'Refresh' }))
    fireEvent.click(within(region).getByRole('button', { name: 'Edit' }))
    fireEvent.click(within(region).getByRole('button', { name: 'Delete' }))

    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(entry)
    expect(onDelete).toHaveBeenCalledWith(entry)
  })
})
