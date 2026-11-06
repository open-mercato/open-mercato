/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; title: string }

const columns: ColumnDef<Row>[] = [{ accessorKey: 'title', header: 'Title' }]

const rows: Row[] = [
  { id: '1', title: 'Alpha' },
  { id: '2', title: 'Beta' },
  { id: '3', title: 'Gamma' },
]

describe('DataTable select-all checkbox', () => {
  it('shows an indeterminate state while only some page rows are selected', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <I18nProvider locale="en" dict={{}}>
            <DataTable<Row>
              columns={columns}
              data={rows}
              bulkActions={[{ id: 'delete', label: 'Delete', onExecute: () => {} }]}
            />
          </I18nProvider>
        </QueryClientProvider>,
      )

      const selectAll = () => screen.getByRole('checkbox', { name: 'Select all rows' })
      const rowCheckboxes = () => screen.getAllByRole('checkbox', { name: 'Select row' })

      expect(selectAll().getAttribute('data-state')).toBe('unchecked')

      fireEvent.click(rowCheckboxes()[0])
      expect(selectAll().getAttribute('data-state')).toBe('indeterminate')

      fireEvent.click(selectAll())
      expect(selectAll().getAttribute('data-state')).toBe('checked')
      rowCheckboxes().forEach((checkbox) => expect(checkbox.getAttribute('data-state')).toBe('checked'))

      fireEvent.click(selectAll())
      expect(selectAll().getAttribute('data-state')).toBe('unchecked')
      rowCheckboxes().forEach((checkbox) => expect(checkbox.getAttribute('data-state')).toBe('unchecked'))
    } finally {
      queryClient.clear()
    }
  })
})
