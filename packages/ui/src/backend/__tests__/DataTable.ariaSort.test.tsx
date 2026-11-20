/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '../DataTable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string; city: string; note: string }

const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'city', header: 'City' },
  { accessorKey: 'note', header: 'Note', enableSorting: false },
]
const data: Row[] = [{ id: '1', name: 'Alpha', city: 'Berlin', note: 'n' }]

function renderTable(sorting: SortingState, withColumnChooser = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable<Row>
          columns={columns}
          data={data}
          sortable
          sorting={sorting}
          onSortingChange={() => {}}
          columnChooser={withColumnChooser ? { availableColumns: [] } : undefined}
        />
      </I18nProvider>
    </QueryClientProvider>,
  )
  return { ...view, queryClient }
}

function headerCell(label: string): HTMLElement {
  return screen.getByText(label).closest('th') as HTMLElement
}

describe('DataTable header aria-sort (#9550)', () => {
  it.each([false, true])('announces the sort state on header cells (column chooser: %s)', (withColumnChooser) => {
    const { queryClient, rerender } = renderTable([{ id: 'city', desc: true }], withColumnChooser)
    try {
      expect(headerCell('City').getAttribute('aria-sort')).toBe('descending')
      expect(headerCell('Name').getAttribute('aria-sort')).toBe('none')
      expect(headerCell('Note').hasAttribute('aria-sort')).toBe(false)
      expect(headerCell('City').getAttribute('role') ?? 'columnheader').toBe('columnheader')
      rerender(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable<Row>
              columns={columns}
              data={data}
              sortable
              sorting={[{ id: 'name', desc: false }]}
              onSortingChange={() => {}}
              columnChooser={withColumnChooser ? { availableColumns: [] } : undefined}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )
      expect(headerCell('Name').getAttribute('aria-sort')).toBe('ascending')
      expect(headerCell('City').getAttribute('aria-sort')).toBe('none')
    } finally {
      queryClient.clear()
    }
  })
})
