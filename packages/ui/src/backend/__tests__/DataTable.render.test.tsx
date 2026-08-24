/** @jest-environment jsdom */
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { fireEvent, render, screen } from '@testing-library/react'

// Mock next/navigation for SSR compatibility of client components
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string }

describe('DataTable SSR render', () => {
  it('uses a page heading for top-level tables and a section heading when embedded', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable columns={columns} data={[]} title="People" />
          </I18nProvider>
        </QueryClientProvider>,
      )

      expect(screen.getByRole('heading', { level: 1, name: 'People' })).toBeInTheDocument()

      rerender(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable columns={columns} data={[]} title="People" embedded />
          </I18nProvider>
        </QueryClientProvider>,
      )

      expect(screen.getByRole('heading', { level: 2, name: 'People' })).toBeInTheDocument()
    } finally {
      queryClient.clear()
    }
  })

  it('renders built-in FilterBar when search/filters provided', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const html = renderToString(
        React.createElement(
          QueryClientProvider as any,
          { client: queryClient },
          React.createElement(
            I18nProvider as any,
            { locale: 'en', dict: {} },
            React.createElement(DataTable as any, {
              columns,
              data: [],
              title: 'Test',
              searchValue: 'abc',
              onSearchChange: () => {},
              filters: [{ id: 'created_at', label: 'Created', type: 'dateRange' }],
              filterValues: {},
              onFiltersApply: () => {},
            }),
          ),
        )
      )
      expect(html).toContain('Filters')
      expect(html).toContain('Name')
    } finally {
      queryClient.clear()
    }
  })

  it('keeps rows-per-page controls on one line', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const html = renderToString(
        React.createElement(
          QueryClientProvider as any,
          { client: queryClient },
          React.createElement(
            I18nProvider as any,
            { locale: 'en', dict: {} },
            React.createElement(DataTable as any, {
              columns,
              data: [{ id: '1', name: 'Ada' }],
              pagination: {
                page: 1,
                pageSize: 20,
                total: 1,
                totalPages: 1,
                onPageChange: () => {},
                onPageSizeChange: () => {},
                pageSizeOptions: [10, 20, 50],
              },
            }),
          ),
        )
      )
      expect(html).toContain('whitespace-nowrap')
      expect(html).toContain('per page')
    } finally {
      queryClient.clear()
    }
  })

  it('keeps provided row order in manual sorting mode and reports sorting changes', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const onSortingChange = jest.fn()
    try {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable
              columns={columns}
              data={[
                { id: '2', name: 'Zed' },
                { id: '1', name: 'Ada' },
              ]}
              sortable
              manualSorting
              sorting={[]}
              onSortingChange={onSortingChange}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )

      const beforeText = container.textContent ?? ''
      expect(beforeText.indexOf('Zed')).toBeGreaterThanOrEqual(0)
      expect(beforeText.indexOf('Zed')).toBeLessThan(beforeText.indexOf('Ada'))

      fireEvent.click(screen.getByRole('button', { name: /name/i }))

      expect(onSortingChange).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ id: 'name' })]),
      )
      const afterText = container.textContent ?? ''
      expect(afterText.indexOf('Zed')).toBeLessThan(afterText.indexOf('Ada'))
    } finally {
      queryClient.clear()
    }
  })

  it('forwards the click event to onRowClick, and skips it when clicking the actions cell', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    let capturedRowTagName: string | null = null
    const onRowClick = jest.fn((_row: Row, event: React.MouseEvent<HTMLTableRowElement>) => {
      capturedRowTagName = event.currentTarget.tagName
    })
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable
              columns={columns}
              data={[{ id: '1', name: 'Ada' }]}
              onRowClick={onRowClick}
              rowActions={() => <button type="button">Edit</button>}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )

      fireEvent.click(screen.getByText('Ada'))
      expect(onRowClick).toHaveBeenCalledTimes(1)
      const [row, event] = onRowClick.mock.calls[0]
      expect(row).toEqual({ id: '1', name: 'Ada' })
      expect(event.type).toBe('click')
      expect(capturedRowTagName).toBe('TR')

      fireEvent.click(screen.getByText('Edit'))
      expect(onRowClick).toHaveBeenCalledTimes(1)
    } finally {
      queryClient.clear()
    }
  })
})
