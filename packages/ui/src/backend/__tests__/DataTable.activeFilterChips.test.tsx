/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import { FilterBar } from '../FilterBar'
import type { FilterDef } from '../FilterOverlay'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; title: string }

const filters: FilterDef[] = [
  {
    id: 'status',
    label: 'Status',
    type: 'select',
    options: [{ value: 'open', label: 'Open' }],
  },
]

function withProviders(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  return {
    queryClient,
    tree: (
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          {node}
        </I18nProvider>
      </QueryClientProvider>
    ),
  }
}

describe('FilterBar showActiveFilterChips', () => {
  it('renders the built-in chip row by default', () => {
    const { tree, queryClient } = withProviders(
      <FilterBar filters={filters} values={{ status: 'open' }} onApply={jest.fn()} />,
    )
    render(tree)
    expect(screen.getByRole('button', { name: /Status: Open/ })).toBeTruthy()
    queryClient.clear()
  })

  it('omits the built-in chip row when showActiveFilterChips is false, keeping the Filters count', () => {
    const { tree, queryClient } = withProviders(
      <FilterBar filters={filters} values={{ status: 'open' }} onApply={jest.fn()} showActiveFilterChips={false} />,
    )
    render(tree)
    expect(screen.queryByRole('button', { name: /Status: Open/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Filters 1/ })).toBeTruthy()
    queryClient.clear()
  })
})

describe('DataTable showActiveFilterChips', () => {
  const columns: ColumnDef<Row>[] = [{ accessorKey: 'title', header: 'Title' }]

  function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>>) {
    const { tree, queryClient } = withProviders(
      <DataTable<Row>
        title="Entries"
        columns={columns}
        data={[{ id: '1', title: 'First' }]}
        filters={filters}
        filterValues={{ status: 'open' }}
        onFiltersApply={jest.fn()}
        {...props}
      />,
    )
    const result = render(tree)
    return { ...result, queryClient }
  }

  it('keeps the built-in chip row when the option is not passed', () => {
    const { queryClient } = renderTable({ activeFilterChips: <span>Host chips</span> })
    expect(screen.getByRole('button', { name: /Status: Open/ })).toBeTruthy()
    expect(screen.getByText('Host chips')).toBeTruthy()
    queryClient.clear()
  })

  it('shows only the host chip layer when showActiveFilterChips is false', () => {
    const { container, queryClient } = renderTable({
      activeFilterChips: <span>Host chips</span>,
      showActiveFilterChips: false,
    })
    expect(screen.queryByRole('button', { name: /Status: Open/ })).toBeNull()
    const slot = container.querySelector('[data-table-active-filter-chips]')
    expect(slot?.textContent).toBe('Host chips')
    queryClient.clear()
  })

  it('renders no chip slot wrapper when no host chips are passed', () => {
    const { container, queryClient } = renderTable({})
    expect(container.querySelector('[data-table-active-filter-chips]')).toBeNull()
    queryClient.clear()
  })
})

describe('DataTable footer injection slot', () => {
  it('collapses the footer slot when no widget renders into it, so no empty band sits under the last row', () => {
    const { tree, queryClient } = withProviders(
      <DataTable<Row>
        title="Entries"
        extensionTableId="test.entries"
        columns={[{ accessorKey: 'title', header: 'Title' }]}
        data={[{ id: '1', title: 'First' }]}
      />,
    )
    const { container } = render(tree)
    const footer = container.querySelector('[data-table-footer]')
    expect(footer).not.toBeNull()
    expect(footer?.childElementCount).toBe(0)
    expect(footer?.className.split(/\s+/)).toContain('empty:hidden')
    queryClient.clear()
  })
})
