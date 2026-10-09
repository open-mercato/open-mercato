/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { InjectionPosition, type InjectionPlacement } from '@open-mercato/shared/modules/widgets/injection-position'
import { DataTable } from '../DataTable'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

const useInjectionDataWidgetsMock = jest.fn()
jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: (spotId: string) => useInjectionDataWidgetsMock(spotId),
}))

jest.mock('@open-mercato/shared/modules/widgets/injection-loader', () => ({
  getInjectionRegistryVersion: () => 0,
  subscribeToInjectionRegistryChanges: () => () => {},
  loadInjectionWidgetsForSpot: jest.fn(async () => []),
  loadInjectionDataWidgetsForSpot: jest.fn(async () => []),
}))

type Row = { id: string; reference: string; status: string; amount: string }

const ROWS: Row[] = [{ id: '1', reference: 'PAY-1', status: 'paid', amount: '10.00' }]

const COLUMNS: ColumnDef<Row>[] = [
  { id: 'reference', accessorKey: 'reference', header: 'Reference' },
  { id: 'status', accessorKey: 'status', header: 'Status' },
  { id: 'amount', accessorKey: 'amount', header: 'Amount' },
]

const TABLE_ID = 'tests.injected-placement'

function mockInjectedColumn(placement: InjectionPlacement | undefined) {
  useInjectionDataWidgetsMock.mockImplementation((spotId: string) => {
    if (spotId !== `data-table:${TABLE_ID}:columns`) return { widgets: [], isLoading: false, error: null }
    return {
      widgets: [
        {
          metadata: { id: 'tests.injected-placement.column' },
          columns: [{ id: 'gateway_status', header: 'Gateway status', accessorKey: 'status', placement }],
        },
      ],
      isLoading: false,
      error: null,
    }
  })
}

function mockNoInjectedColumns() {
  useInjectionDataWidgetsMock.mockImplementation(() => ({ widgets: [], isLoading: false, error: null }))
}

function Harness({ initialSettings }: { initialSettings?: unknown }) {
  const queryClient = React.useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
    [],
  )
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en" dict={{}}>
        <DataTable
          columns={COLUMNS as never}
          data={ROWS as never}
          extensionTableId={TABLE_ID}
          {...(initialSettings
            ? ({ perspective: { tableId: TABLE_ID, initialState: { initialSettings } } } as never)
            : {})}
        />
      </I18nProvider>
    </QueryClientProvider>
  )
}

function headerOrder(): string[] {
  return screen.getAllByRole('columnheader').map((cell) => cell.textContent?.trim() ?? '').filter(Boolean)
}

async function renderWithLateInjectedColumn(placement: InjectionPlacement | undefined, initialSettings?: unknown) {
  mockNoInjectedColumns()
  const view = render(<Harness initialSettings={initialSettings} />)
  await waitFor(() => expect(screen.getByText('Reference')).toBeTruthy())
  mockInjectedColumn(placement)
  view.rerender(<Harness initialSettings={initialSettings} />)
  await waitFor(() => expect(screen.getByText('Gateway status')).toBeTruthy())
}

describe('DataTable — placement of injected columns that arrive after the first render (#7083)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    for (const entry of document.cookie.split(';')) {
      const name = entry.split('=')[0]?.trim()
      if (name) document.cookie = `${name}=; Max-Age=0; Path=/`
    }
  })

  it('renders an After-placed column right after its anchor', async () => {
    await renderWithLateInjectedColumn({ position: InjectionPosition.After, relativeTo: 'status' })
    await waitFor(() => expect(headerOrder()).toEqual(['Reference', 'Status', 'Gateway status', 'Amount']))
  })

  it('renders a Before-placed column right before its anchor', async () => {
    await renderWithLateInjectedColumn({ position: InjectionPosition.Before, relativeTo: 'status' })
    await waitFor(() => expect(headerOrder()).toEqual(['Reference', 'Gateway status', 'Status', 'Amount']))
  })

  it('renders a First-placed column first', async () => {
    await renderWithLateInjectedColumn({ position: InjectionPosition.First })
    await waitFor(() => expect(headerOrder()).toEqual(['Gateway status', 'Reference', 'Status', 'Amount']))
  })

  it('still appends a column with the default placement', async () => {
    await renderWithLateInjectedColumn(undefined)
    await waitFor(() => expect(headerOrder()).toEqual(['Reference', 'Status', 'Amount', 'Gateway status']))
  })

  it('keeps a stored column order and slots the late column next to its anchor', async () => {
    await renderWithLateInjectedColumn(
      { position: InjectionPosition.After, relativeTo: 'status' },
      { columnOrder: ['amount', 'status', 'reference'] },
    )
    await waitFor(() => expect(headerOrder()).toEqual(['Amount', 'Status', 'Gateway status', 'Reference']))
  })
})
