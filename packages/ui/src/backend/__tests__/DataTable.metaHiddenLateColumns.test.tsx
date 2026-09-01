/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { DataTable, type DataTableViewApi } from '../DataTable'

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

function Harness({ columns, initialSettings, apiRef }: {
  columns: ColumnDef<Row>[]
  initialSettings?: unknown
  apiRef?: React.MutableRefObject<DataTableViewApi | null>
}) {
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
          viewApiRef={apiRef}
          {...(initialSettings
            ? ({ perspective: { tableId: 'meta-hidden-late-columns', initialState: { initialSettings } } } as never)
            : {})}
        />
      </I18nProvider>
    </QueryClientProvider>
  )
}

describe('DataTable — meta.hidden on columns that arrive after the first render', () => {
  beforeEach(() => {
    // DataTable persists the applied view to localStorage and a cookie, and jsdom shares
    // both across the cases in a file — clear them so a perspective set up by one case
    // cannot hydrate into the next one and decide its columns.
    window.localStorage.clear()
    for (const entry of document.cookie.split(';')) {
      const name = entry.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
    }
  })

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

  it('lets a stored perspective override the meta.hidden default for a column it names', async () => {
    // A saved perspective wins over the declared default — but only for the columns it
    // actually names, which is what the two cases below pin down (#5117).
    render(
      <Harness
        columns={COLUMNS_WITH_CUSTOM_FIELDS}
        initialSettings={{ columnVisibility: { cf_archived_note: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Archived note')).toBeTruthy())
  })

  it('still applies meta.hidden to a column the stored perspective does not name', async () => {
    // The regression from #5117: the pass used to be latched on "the stored view carried
    // *some* visibility", so a view that only spoke about `name` silently suppressed the
    // declared default of every other column. A view can only decide what it describes.
    render(
      <Harness
        columns={COLUMNS_WITH_CUSTOM_FIELDS}
        initialSettings={{ columnVisibility: { name: true } }}
      />,
    )

    await waitFor(() => expect(screen.getByText('Active note')).toBeTruthy())
    expect(screen.queryByText('Archived note')).toBeNull()
  })

  it('applies meta.hidden to a late column that a stored perspective could not have named', async () => {
    // The reported scenario: the view was saved before the custom-field columns resolved,
    // so it cannot carry a decision for them. They must still fall back to their declared
    // default instead of appearing mid-hydration.
    const { rerender } = render(
      <Harness columns={BASE_COLUMNS} initialSettings={{ columnVisibility: { name: true } }} />,
    )
    await waitFor(() => expect(screen.getByText('Name')).toBeTruthy())

    rerender(
      <Harness columns={COLUMNS_WITH_CUSTOM_FIELDS} initialSettings={{ columnVisibility: { name: true } }} />,
    )

    await waitFor(() => expect(screen.getByText('Active note')).toBeTruthy())
    expect(screen.queryByText('Archived note')).toBeNull()
  })

  it('describes every leaf column in the settings it hands back, including late arrivals', async () => {
    // Root cause 1 of #5117: `getCurrentSettings` copied the sparse TanStack state, so a
    // saved view stored no decision for columns that registered after the save and an
    // absent key renders visible. The serialized map must be self-describing.
    const apiRef = React.createRef<DataTableViewApi | null>() as React.MutableRefObject<DataTableViewApi | null>
    const { rerender } = render(<Harness columns={BASE_COLUMNS} apiRef={apiRef} />)
    await waitFor(() => expect(screen.getByText('Name')).toBeTruthy())

    rerender(<Harness columns={COLUMNS_WITH_CUSTOM_FIELDS} apiRef={apiRef} />)
    await waitFor(() => expect(screen.getByText('Active note')).toBeTruthy())

    await waitFor(() => {
      expect(apiRef.current?.getCurrentSettings().columnVisibility).toEqual({
        name: true,
        cf_archived_note: false,
        cf_active_note: true,
      })
    })
  })
})
