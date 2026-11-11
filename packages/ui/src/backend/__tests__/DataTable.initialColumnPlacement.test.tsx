/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { InjectionPosition, type InjectionPlacement } from '@open-mercato/shared/modules/widgets/injection-position'

jest.mock(
  require.resolve('scheduler', { paths: [require.resolve('react-dom')] }),
  () => jest.requireActual('scheduler/unstable_mock'),
)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), refresh: jest.fn() }),
}))

const useInjectionDataWidgetsMock = jest.fn()
jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: (spotId: string) => useInjectionDataWidgetsMock(spotId),
}))

jest.mock('../injection/InjectionSpot', () => ({
  ...jest.requireActual<typeof import('../injection/InjectionSpot')>('../injection/InjectionSpot'),
  InjectionSpot: () => null,
}))

const { act, screen } = jest.requireActual<typeof import('@testing-library/react')>('@testing-library/react')
const { createRoot } = jest.requireActual<typeof import('react-dom/client')>('react-dom/client')
const { DataTable } = jest.requireActual<typeof import('../DataTable')>('../DataTable')
const scheduler = jest.requireActual<{
  unstable_flushAllWithoutAsserting: () => void
  unstable_flushUntilNextPaint: () => void
}>('scheduler/unstable_mock')

type Row = { id: string; reference: string; status: string; amount: string }

const ROWS: Row[] = [{ id: '1', reference: 'PAY-1', status: 'paid', amount: '10.00' }]
const COLUMNS: ColumnDef<Row>[] = [
  { id: 'reference', accessorKey: 'reference', header: 'Reference' },
  { id: 'status', accessorKey: 'status', header: 'Status' },
  { id: 'amount', accessorKey: 'amount', header: 'Amount' },
]

type PlacementCase = {
  name: string
  placement: InjectionPlacement
  initialSettings?: { columnOrder: string[] }
  expectedHeaders: string[]
}

const PLACEMENT_CASES: PlacementCase[] = [
  {
    name: 'a first-placed injected column',
    placement: { position: InjectionPosition.First },
    expectedHeaders: ['Gateway status', 'Reference', 'Status', 'Amount'],
  },
  {
    name: 'an anchored injected column within a saved order',
    placement: { position: InjectionPosition.After, relativeTo: 'status' },
    initialSettings: { columnOrder: ['amount', 'status', 'reference'] },
    expectedHeaders: ['Amount', 'Status', 'Gateway status', 'Reference'],
  },
]

describe('DataTable initial column placement', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it.each(PLACEMENT_CASES)('places $name before the first visible paint', async ({ placement, initialSettings, expectedHeaders }) => {
    let columnsReady = false
    useInjectionDataWidgetsMock.mockImplementation((spotId: string) => ({
      widgets: spotId.endsWith(':columns') && columnsReady
        ? [{
          metadata: { id: 'tests.initial-placement.column' },
          columns: [{ id: 'gateway_status', header: 'Gateway status', accessorKey: 'status', placement }],
        }]
        : [],
      isLoading: spotId.endsWith(':columns') && !columnsReady,
      error: null,
    }))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const renderElement = () => (
      <QueryClientProvider client={queryClient}>
        <I18nProvider locale="en" dict={{}}>
          <DataTable
            columns={COLUMNS}
            data={ROWS}
            extensionTableId="tests.initial-placement"
            {...(initialSettings
              ? { perspective: { tableId: 'tests.initial-placement', initialState: { initialSettings } } }
              : {})}
          />
        </I18nProvider>
      </QueryClientProvider>
    )
    const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
    testGlobal.IS_REACT_ACT_ENVIRONMENT = false
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      root.render(renderElement())
      await Promise.resolve()
      scheduler.unstable_flushAllWithoutAsserting()
      expect(screen.getByText('Loading data...')).toBeInTheDocument()
      expect(screen.queryAllByRole('columnheader')).toHaveLength(0)

      columnsReady = true
      root.render(renderElement())
      await Promise.resolve()
      scheduler.unstable_flushUntilNextPaint()

      expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(expectedHeaders)
    } finally {
      testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
      act(() => root.unmount())
      container.remove()
      queryClient.clear()
    }
  })
})
