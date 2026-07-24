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

  it('renders a full-width detail row beneath an expanded row via rowDetail', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
      { accessorKey: 'id', header: 'Id' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable
              columns={columns}
              data={[{ id: '1', name: 'Ada' }, { id: '2', name: 'Zed' }]}
              rowDetail={{
                isExpanded: (row) => row.id === '1',
                render: (row) => <div>Detail for {row.name}</div>,
              }}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )
      const detailRow = container.querySelector('tr[data-row-detail="1"]')
      expect(detailRow).not.toBeNull()
      expect(detailRow?.textContent).toContain('Detail for Ada')
      // Only the expanded row gets a detail sub-row.
      expect(container.querySelector('tr[data-row-detail="2"]')).toBeNull()
      expect(container.textContent).not.toContain('Detail for Zed')
      // Detail cell spans every column (2 data columns, no bulk/actions column).
      const detailCell = detailRow?.querySelector('td')
      expect(detailCell?.getAttribute('colspan')).toBe('2')
    } finally {
      queryClient.clear()
    }
  })

  it('toggles the detail row when host expansion state changes (accordion)', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    function Harness() {
      const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
      return (
        <>
          <button onClick={() => setExpanded(new Set(['1']))}>expand-1</button>
          <button onClick={() => setExpanded(new Set())}>collapse-all</button>
          <DataTable
            columns={columns}
            data={[{ id: '1', name: 'Ada' }, { id: '2', name: 'Zed' }]}
            rowDetail={{
              isExpanded: (row) => expanded.has(row.id),
              render: (row) => <div>Detail for {row.name}</div>,
            }}
          />
        </>
      )
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <Harness />
          </I18nProvider>
        </QueryClientProvider>,
      )
      // Collapsed initially — no detail sub-row.
      expect(container.querySelector('tr[data-row-detail]')).toBeNull()
      // Expanding row 1 reveals exactly its detail.
      fireEvent.click(screen.getByText('expand-1'))
      expect(container.querySelector('tr[data-row-detail="1"]')).not.toBeNull()
      expect(container.querySelector('tr[data-row-detail="2"]')).toBeNull()
      expect(container.textContent).toContain('Detail for Ada')
      // Collapsing removes the detail sub-row again.
      fireEvent.click(screen.getByText('collapse-all'))
      expect(container.querySelector('tr[data-row-detail]')).toBeNull()
      expect(container.textContent).not.toContain('Detail for Ada')
    } finally {
      queryClient.clear()
    }
  })

  it('renders a built-in chevron toggle column that calls onToggle and reflects isExpanded', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    const onToggle = jest.fn()
    function Harness() {
      const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
      return (
        <DataTable
          columns={columns}
          data={[{ id: '1', name: 'Ada' }, { id: '2', name: 'Zed' }]}
          rowDetail={{
            toggleColumn: true,
            isExpanded: (row) => expanded.has(row.id),
            onToggle: (row) => { onToggle(row.id); setExpanded((prev) => { const n = new Set(prev); if (n.has(row.id)) n.delete(row.id); else n.add(row.id); return n }) },
            render: (row) => <div>Detail for {row.name}</div>,
          }}
        />
      )
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <Harness />
          </I18nProvider>
        </QueryClientProvider>,
      )
      // One chevron per data row, all collapsed → all labelled "Expand row".
      const chevrons = screen.getAllByRole('button', { name: 'Expand row' })
      expect(chevrons).toHaveLength(2)
      expect(container.querySelector('tr[data-row-detail]')).toBeNull()

      // Click row 1's chevron → onToggle fires and its detail appears.
      fireEvent.click(chevrons[0])
      expect(onToggle).toHaveBeenCalledWith('1')
      expect(container.querySelector('tr[data-row-detail="1"]')).not.toBeNull()
      // That row's chevron now reads "Collapse row"; the other stays "Expand row".
      expect(screen.getByRole('button', { name: 'Collapse row' })).toBeTruthy()
      expect(screen.getAllByRole('button', { name: 'Expand row' })).toHaveLength(1)
    } finally {
      queryClient.clear()
    }
  })

  it('renders custom toggle-column content when toggleColumn is a function', () => {
    const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
    const onToggle = jest.fn()
    function Harness() {
      const [expanded, setExpanded] = React.useState<Set<string>>(new Set())
      return (
        <DataTable
          columns={columns}
          data={[{ id: '1', name: 'Ada' }]}
          rowDetail={{
            isExpanded: (row) => expanded.has(row.id),
            onToggle: (row) => { onToggle(row.id); setExpanded(new Set([row.id])) },
            toggleColumn: ({ row, expanded, toggle }) => (
              <button onClick={toggle}>{expanded ? 'Hide' : `Show ${row.name}`}</button>
            ),
            render: (row) => <div>Detail for {row.name}</div>,
          }}
        />
      )
    }
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <Harness />
          </I18nProvider>
        </QueryClientProvider>,
      )
      // No built-in chevron; custom content is used instead.
      expect(screen.queryByRole('button', { name: /expand row|collapse row/i })).toBeNull()
      const custom = screen.getByRole('button', { name: 'Show Ada' })
      expect(container.querySelector('tr[data-row-detail]')).toBeNull()
      // The provided `toggle` helper delegates to onToggle and expands the row.
      fireEvent.click(custom)
      expect(onToggle).toHaveBeenCalledWith('1')
      expect(container.querySelector('tr[data-row-detail="1"]')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy()
    } finally {
      queryClient.clear()
    }
  })

  it('renders no chevron toggle column when toggleColumn is unset', () => {
    const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable
              columns={columns}
              data={[{ id: '1', name: 'Ada' }]}
              rowDetail={{ isExpanded: () => false, render: () => <div>x</div> }}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )
      expect(screen.queryByRole('button', { name: /expand row|collapse row/i })).toBeNull()
    } finally {
      queryClient.clear()
    }
  })

  it('renders no detail row when rowDetail is unset or every row is collapsed', () => {
    const columns: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Name' },
    ]
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      const { container, rerender } = render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable columns={columns} data={[{ id: '1', name: 'Ada' }]} />
          </I18nProvider>
        </QueryClientProvider>,
      )
      expect(container.querySelector('tr[data-row-detail]')).toBeNull()

      rerender(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable
              columns={columns}
              data={[{ id: '1', name: 'Ada' }]}
              rowDetail={{ isExpanded: () => false, render: () => <div>never</div> }}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )
      expect(container.querySelector('tr[data-row-detail]')).toBeNull()
      expect(container.textContent).not.toContain('never')
    } finally {
      queryClient.clear()
    }
  })
})
