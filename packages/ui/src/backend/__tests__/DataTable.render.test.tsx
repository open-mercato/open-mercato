/** @jest-environment jsdom */
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { DataTable } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
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

  it('renders no expand toggle when expansion props are absent (back-compat)', () => {
    const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable columns={columns} data={[{ id: '1', name: 'Ada' }]} />
          </I18nProvider>
        </QueryClientProvider>,
      )
      expect(screen.queryByRole('button', { name: /expand row/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /collapse row/i })).toBeNull()
    } finally {
      queryClient.clear()
    }
  })

  it('shows an expand toggle and reveals sub-rows when expansion is enabled', () => {
    type TreeRow = { id: string; name: string; children?: TreeRow[] }
    const columns: ColumnDef<TreeRow>[] = [{ accessorKey: 'name', header: 'Name' }]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable<TreeRow>
              columns={columns}
              data={[{ id: 'parent', name: 'Parent', children: [{ id: 'child', name: 'Child' }] }]}
              getSubRows={(row) => row.children}
              expandable={(row) => Boolean(row.children?.length)}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )

      // Child hidden until expanded.
      expect(screen.queryByText('Child')).toBeNull()
      const toggle = screen.getByRole('button', { name: /expand row/i })
      fireEvent.click(toggle)
      expect(screen.getByText('Child')).toBeInTheDocument()
      // Toggle flips to collapse affordance.
      expect(screen.getByRole('button', { name: /collapse row/i })).toBeInTheDocument()
    } finally {
      queryClient.clear()
    }
  })

  it('uses controlled expanded state and reports changes for lazy loading', () => {
    type TreeRow = { id: string; name: string; children?: TreeRow[] }
    const columns: ColumnDef<TreeRow>[] = [{ accessorKey: 'name', header: 'Name' }]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    const onExpandedChange = jest.fn()
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable<TreeRow>
              columns={columns}
              data={[{ id: 'parent', name: 'Parent' }]}
              getSubRows={(row) => row.children}
              expandable={() => true}
              expanded={{}}
              onExpandedChange={onExpandedChange}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )
      // A row with no loaded children still shows a toggle (lazy-load affordance).
      fireEvent.click(screen.getByRole('button', { name: /expand row/i }))
      expect(onExpandedChange).toHaveBeenCalled()
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
})
