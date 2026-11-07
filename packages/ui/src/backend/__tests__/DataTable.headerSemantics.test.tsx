/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef, SortingState } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { fireEvent, render, screen, within } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string; email: string }

const COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
]
const ROWS: Row[] = [
  { id: '1', name: 'Mia Johnson', email: 'mia@example.com' },
  { id: '2', name: 'Arjun Patel', email: 'arjun@example.com' },
]

// A table with a column chooser makes its headers draggable for reordering.
// The drag handle used to be the header cell itself, with dnd-kit's
// `role="button"` and `tabIndex` spread onto the <th>. That replaced the column
// header role, so assistive technology saw a row of buttons and data cells had
// no header, and it added a Tab stop per column that did nothing, because only
// a pointer sensor is registered.
describe('DataTable column header semantics', () => {
  function renderTable(options: { reorderable: boolean; sorting?: SortingState }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    function Harness() {
      const [sorting, setSorting] = React.useState<SortingState>(options.sorting ?? [])
      return (
        <DataTable
          columns={COLUMNS}
          data={ROWS}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          columnChooser={options.reorderable ? { availableColumns: [] } : undefined}
        />
      )
    }
    const result = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <Harness />
        </I18nProvider>
      </QueryClientProvider>,
    )
    return { ...result, queryClient }
  }

  const headerNamed = (name: string) => screen.getByRole('columnheader', { name: new RegExp(`^${name}`) })

  for (const reorderable of [true, false]) {
    const kind = reorderable ? 'reorderable' : 'fixed'

    it(`exposes ${kind} headers as column headers`, () => {
      const { queryClient } = renderTable({ reorderable })
      try {
        for (const name of ['Name', 'Email']) {
          const header = headerNamed(name)
          expect(header.tagName).toBe('TH')
          expect(header).not.toHaveAttribute('role')
          expect(header).not.toHaveAttribute('tabindex')
          expect(header).not.toHaveAttribute('aria-roledescription')
          expect(header).not.toHaveAttribute('aria-pressed')
        }
      } finally {
        queryClient.clear()
      }
    })

    it(`keeps the sort control of ${kind} headers as the only button named after the column`, () => {
      const { queryClient } = renderTable({ reorderable })
      try {
        expect(screen.getAllByRole('button', { name: 'Name' })).toHaveLength(1)
        expect(within(headerNamed('Name')).getByRole('button', { name: 'Name' })).toBeInTheDocument()
      } finally {
        queryClient.clear()
      }
    })

    it(`reports the sort direction on ${kind} headers`, () => {
      const { queryClient } = renderTable({ reorderable })
      try {
        expect(headerNamed('Name')).not.toHaveAttribute('aria-sort')
        expect(headerNamed('Email')).not.toHaveAttribute('aria-sort')

        fireEvent.click(within(headerNamed('Name')).getByRole('button', { name: 'Name' }))
        expect(headerNamed('Name')).toHaveAttribute('aria-sort', 'ascending')
        expect(headerNamed('Email')).not.toHaveAttribute('aria-sort')

        fireEvent.click(within(headerNamed('Name')).getByRole('button', { name: 'Name' }))
        expect(headerNamed('Name')).toHaveAttribute('aria-sort', 'descending')
      } finally {
        queryClient.clear()
      }
    })
  }

  it('reports an initial sort on the matching header only', () => {
    const { queryClient } = renderTable({ reorderable: true, sorting: [{ id: 'email', desc: true }] })
    try {
      expect(headerNamed('Email')).toHaveAttribute('aria-sort', 'descending')
      expect(headerNamed('Name')).not.toHaveAttribute('aria-sort')
    } finally {
      queryClient.clear()
    }
  })

  it('keeps reorderable headers draggable with a pointer', () => {
    const { queryClient } = renderTable({ reorderable: true })
    try {
      expect(headerNamed('Name').style.cursor).toBe('grab')
    } finally {
      queryClient.clear()
    }
  })
})
