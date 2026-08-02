/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render, screen, waitFor } from '@testing-library/react'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; name: string }

const BASE_COLUMNS: ColumnDef<Row>[] = [{ accessorKey: 'name', header: 'Name' }]

// Columns that arrive on a later render, the way custom-field columns do: their
// definitions are fetched asynchronously, so they are absent from the first pass.
const LATE_COLUMNS: ColumnDef<Row>[] = [
  ...BASE_COLUMNS,
  { accessorKey: 'cf_hidden_one', header: 'Hidden One', meta: { hidden: true } },
  { accessorKey: 'cf_visible_one', header: 'Visible One' },
]

function renderTable(columns: ColumnDef<Row>[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable columns={columns} data={[{ id: '1', name: 'Row' }]} />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

describe('DataTable — meta.hidden applies to columns that arrive late', () => {
  it('hides a meta.hidden column added after the first render', async () => {
    // Regression: auto-hiding used to run once behind a boolean ref. Custom-field
    // definitions load asynchronously, so the first pass saw no `cf_*` columns at all,
    // found nothing to hide, and still raised the guard — leaving fields declared with
    // `listVisible: false` permanently visible after a hard page load.
    const { rerender } = renderTable(BASE_COLUMNS)
    await waitFor(() => expect(screen.getByText('Name')).toBeTruthy())

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable columns={LATE_COLUMNS} data={[{ id: '1', name: 'Row' }]} />
        </I18nProvider>
      </QueryClientProvider>,
    )

    // The late column opting into `meta.hidden` must not reach the header row...
    await waitFor(() => expect(screen.queryByText('Hidden One')).toBeNull())
    // ...while a late column without that flag stays visible, so the fix cannot be
    // mistaken for "late columns are dropped".
    expect(screen.queryByText('Visible One')).toBeTruthy()
  })

  it('hides a meta.hidden column that is present from the very first render', async () => {
    // Guards the original behaviour the boolean ref was written for.
    renderTable(LATE_COLUMNS)
    await waitFor(() => expect(screen.getByText('Visible One')).toBeTruthy())
    expect(screen.queryByText('Hidden One')).toBeNull()
  })
})
