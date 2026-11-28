/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
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

type Row = { id: string; name: string }

const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]
const ROWS: Row[] = [{ id: '1', name: 'Main warehouse' }]

// Below the md breakpoint the table keeps a 640 px minimum width so columns
// stay readable. jsdom has no layout, so these pin the wrapper that has to
// absorb that width. An embedded table had no scrolling wrapper, and on a
// 320 px viewport the whole page scrolled sideways by up to 508 px on ten
// settings and form pages.
describe('DataTable horizontal scrolling', () => {
  function renderTable(embedded: boolean) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable columns={COLUMNS} data={ROWS} embedded={embedded} />
        </I18nProvider>
      </QueryClientProvider>,
    )
    const table = screen.getByRole('table')
    return { queryClient, table, wrapper: table.parentElement as HTMLElement }
  }

  it.each([
    ['embedded', true],
    ['standalone', false],
  ])('keeps the wide table inside a scrolling wrapper when %s', (_label, embedded) => {
    const { queryClient, table, wrapper } = renderTable(embedded)
    try {
      expect(table).toHaveClass('min-w-[640px]')
      expect(wrapper.className).toMatch(/(^|\s)overflow-(x-)?auto(\s|$)/)
    } finally {
      queryClient.clear()
    }
  })
})
