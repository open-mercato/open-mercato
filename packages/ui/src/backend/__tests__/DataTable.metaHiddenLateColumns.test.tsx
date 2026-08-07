/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { ColumnDef } from '@tanstack/react-table'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '../DataTable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

type Row = { id: string; name: string }

const ROWS: Row[] = [{ id: '1', name: 'Row one' }]

const BASE_COLUMNS: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name' },
]

const COLUMNS_WITH_CUSTOM_FIELDS: ColumnDef<Row>[] = [
  ...BASE_COLUMNS,
  { accessorKey: 'cf_archived_note', header: 'Archived note', meta: { hidden: true } },
  { accessorKey: 'cf_active_note', header: 'Active note' },
]

function Harness({ columns, initialSettings }: { columns: ColumnDef<Row>[]; initialSettings?: unknown }) {
  const queryClient = React.useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
    [],
  )
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable
          columns={columns as never}
          data={ROWS as never}
          {...(initialSettings
            ? ({ perspective: { tableId: 'meta-hidden-late-columns', initialState: { initialSettings } } } as never)
            : {})}
        />
      </I18nProvider>
    </QueryClientProvider>
  )
}

describe('DataTable — meta.hidden on columns that arrive after the first render', () => {
  it('hides a meta.hidden column that only appears on a later render', async () => {
    // The regression: the auto-hide pass used to be latched by a single boolean ref, so it
    // ran on the first render — when no `cf_*` column existed yet — found nothing to hide,
    // and never ran again. Custom fields declared `listVisible: false` stayed visible for
    // the whole session after a hard page load, while a client-side navigation (definitions
    // already in the query cache) rendered them correctly.
    const { rerender } = render(<Harness columns={BASE_COLUMNS} />)
    await waitFor(() => expect(screen.getByText('Name')).toBeTruthy())

    rerender(<Harness columns={COLUMNS_WITH_CUSTOM_FIELDS} />)

    await waitFor(() => expect(screen.queryByText('Archived note')).toBeNull())
  })

  it('leaves a late column without meta.hidden visible', async () => {
    // Pins the other half of the contract, so the fix can never degrade into
    // "columns that arrive late are dropped".
    const { rerender } = render(<Harness columns={BASE_COLUMNS} />)
    await waitFor(() => expect(screen.getByText('Name')).toBeTruthy())

    rerender(<Harness columns={COLUMNS_WITH_CUSTOM_FIELDS} />)

    await waitFor(() => expect(screen.getByText('Active note')).toBeTruthy())
  })

  it('hides a meta.hidden column that is present from the very first render', async () => {
    // The behaviour the original latch was written for, which must survive the fix.
    render(<Harness columns={COLUMNS_WITH_CUSTOM_FIELDS} />)

    await waitFor(() => expect(screen.getByText('Active note')).toBeTruthy())
    expect(screen.queryByText('Archived note')).toBeNull()
  })

  it('lets a stored perspective override the meta.hidden defaults', async () => {
    // A saved perspective seeds columnVisibility at mount and wins outright.
    render(
      <Harness
        columns={COLUMNS_WITH_CUSTOM_FIELDS}
        initialSettings={{ columnVisibility: { cf_archived_note: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Archived note')).toBeTruthy())
  })
})
