/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string }

const columns: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]

const rows: Row[] = [
  { id: '2', name: 'Zed' },
  { id: '1', name: 'Ada' },
  { id: '3', name: 'Mia' },
]

function renderTable(props: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable columns={columns} data={rows} {...(props as any)} />
      </I18nProvider>
    </QueryClientProvider>,
  )
  return { ...result, queryClient }
}

/**
 * TanStack Table v9 moved the v8 hook and row-model factories behind the
 * `@tanstack/react-table/legacy` entry point. DataTable consumes that shim, so
 * these cover the two v8 behaviours whose wiring the shim owns — the sorted row
 * model and the row-selection feature — rather than re-testing the library.
 */
describe('DataTable on the TanStack Table v9 legacy shim', () => {
  it('sorts rows client-side through the legacy sorted row model', () => {
    const { container, queryClient } = renderTable({ sortable: true })
    try {
      const initial = container.textContent ?? ''
      expect(initial.indexOf('Zed')).toBeLessThan(initial.indexOf('Ada'))

      fireEvent.click(screen.getByRole('button', { name: /name/i }))

      const sorted = container.textContent ?? ''
      expect(sorted.indexOf('Ada')).toBeLessThan(sorted.indexOf('Mia'))
      expect(sorted.indexOf('Mia')).toBeLessThan(sorted.indexOf('Zed'))
    } finally {
      queryClient.clear()
    }
  })

  it('passes the selected originals to a bulk action through the legacy row-selection feature', async () => {
    const onExecute = jest.fn().mockResolvedValue(undefined)
    const { queryClient } = renderTable({
      bulkActions: [{ id: 'archive', label: 'Archive', onExecute }],
    })
    try {
      const checkboxes = screen.getAllByRole('checkbox')
      // The first checkbox is the header select-all; the rest are per row.
      expect(checkboxes.length).toBe(rows.length + 1)

      fireEvent.click(checkboxes[1])
      fireEvent.click(await screen.findByRole('button', { name: /archive/i }))

      await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1))
      expect(onExecute.mock.calls[0][0]).toEqual([rows[0]])
    } finally {
      queryClient.clear()
    }
  })
})
