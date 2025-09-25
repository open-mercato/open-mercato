import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { DataTable } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'

type Row = { id: string; name: string }

describe('DataTable SSR render', () => {
  it('renders built-in FilterBar when search/filters provided', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    const html = renderToString(
      React.createElement(DataTable as any, {
        columns,
        data: [],
        title: 'Test',
        searchValue: 'abc',
        onSearchChange: () => {},
        filters: [{ id: 'created_at', label: 'Created', type: 'dateRange' }],
        filterValues: {},
        onFiltersApply: () => {},
      })
    )
    expect(html).toContain('Filters')
    expect(html).toContain('Name')
  })
})

