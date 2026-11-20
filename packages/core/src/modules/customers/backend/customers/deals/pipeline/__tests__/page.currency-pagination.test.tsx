/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Lane } from '../components/Lane'
import DealsKanbanPage from '../page'

type LaneProps = React.ComponentProps<typeof Lane>

const mockLane = jest.fn((_props: LaneProps) => undefined)
const mockReadApiResultOrThrow = jest.fn()
const mockApiCall = jest.fn()

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: () => null,
  MeasuringStrategy: { BeforeDragging: 'BeforeDragging' },
  useSensor: jest.fn(),
  useSensors: jest.fn(),
}))
jest.mock('@dnd-kit/sortable', () => ({ sortableKeyboardCoordinates: jest.fn() }))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PageBody: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useCurrentOrganization: () => ({ id: 'organization-1' }),
}))
jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({ useCurrentUserId: () => null }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useRegisteredComponent', () => ({
  useRegisteredComponent: (_id: string, component: React.ComponentType) => component,
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  buildCrudExportUrl: jest.fn(),
  deleteCrud: jest.fn(),
}))
jest.mock('@open-mercato/ui/backend/utils/bulkDelete', () => ({
  runBulkDelete: jest.fn(),
  groupBulkDeleteFailures: jest.fn(),
}))
jest.mock('../../../../../components/detail/hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({ data: undefined }),
}))
jest.mock('../../../../../components/detail/assignableStaff', () => ({
  fetchAssignableStaffMembers: async () => [],
}))
jest.mock('../components/Lane', () => ({
  Lane: (props: LaneProps) => {
    mockLane(props)
    return (
      <section aria-label={props.stage.label}>
        <span>{props.deals.length} loaded deals</span>
        <button type="button" onClick={() => props.onLoadMore?.(props.stage.id)}>Load next page</button>
      </section>
    )
  },
}))
jest.mock('../components/CurrencyFilterPopover', () => ({
  CurrencyFilterPopover: ({ onApply }: { onApply: (currency: string | null) => void }) => (
    <button type="button" onClick={() => onApply('USD')}>Filter USD</button>
  ),
}))
jest.mock('../components/LaneCurrencyBreakdown', () => ({ LaneCurrencyBreakdown: () => null }))
jest.mock('../components/ViewTabsRow', () => ({ ViewTabsRow: () => null }))
jest.mock('../components/AddStageLane', () => ({ AddStageLane: () => null }))
jest.mock('../components/QuickDealDialog', () => ({ QuickDealDialog: () => null }))
jest.mock('../components/AddStageDialog', () => ({ AddStageDialog: () => null }))
jest.mock('../components/StatusFilterPopover', () => ({ StatusFilterPopover: () => null }))
jest.mock('../components/PipelineFilterPopover', () => ({ PipelineFilterPopover: () => null }))
jest.mock('../components/SortByPopover', () => ({ SortByPopover: () => null }))
jest.mock('../components/EntityFilterPopover', () => ({ EntityFilterPopover: () => null }))
jest.mock('../components/CloseDateFilterPopover', () => ({ CloseDateFilterPopover: () => null }))
jest.mock('../components/CustomizeViewDialog', () => ({ CustomizeViewDialog: () => null }))
jest.mock('../components/ActivityComposerDialog', () => ({ ActivityComposerDialog: () => null }))
jest.mock('../components/BulkActionsBar', () => ({ BulkActionsBar: () => null }))
jest.mock('../components/ChangeStageDialog', () => ({ ChangeStageDialog: () => null }))
jest.mock('../components/ChangeOwnerDialog', () => ({ ChangeOwnerDialog: () => null }))

function makeDeals(count: number, currency: string) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${currency}-${index}`,
    title: `${currency} deal ${index}`,
    pipeline_stage_id: 'stage-1',
    value_amount: 100,
    value_currency: currency,
  }))
}

function mountBoard(matchingCount: number) {
  const usdDeals = makeDeals(matchingCount, 'USD')
  const allDeals = [...usdDeals, ...makeDeals(2, 'EUR')]
  const aggregate = {
    baseCurrencyCode: 'USD',
    perStage: [{
      stageId: 'stage-1',
      count: allDeals.length,
      openCount: allDeals.length,
      totalInBaseCurrency: allDeals.length * 100,
      byCurrency: [
        { currency: 'USD', count: matchingCount, total: matchingCount * 100 },
        { currency: 'EUR', count: 2, total: 200 },
      ],
    }],
  }
  const listDeals = (url: URL) => {
    const filteredDeals = url.searchParams.get('valueCurrency') === 'USD' ? usdDeals : allDeals
    const page = Number(url.searchParams.get('page'))
    return { items: filteredDeals.slice((page - 1) * 25, page * 25), total: filteredDeals.length }
  }
  mockReadApiResultOrThrow.mockImplementation(async (path: string) => {
    const url = new URL(path, 'http://localhost')
    if (url.pathname === '/api/customers/pipelines') {
      return { items: [{ id: 'pipeline-1', name: 'Sales', isDefault: true }] }
    }
    if (url.pathname === '/api/customers/pipeline-stages') {
      return { items: [{ id: 'stage-1', label: 'Prospecting', order: 0, pipelineId: 'pipeline-1' }] }
    }
    if (url.pathname === '/api/customers/deals/aggregate') return aggregate
    if (url.pathname === '/api/customers/deals') return listDeals(url)
    throw new Error(`Unexpected request: ${path}`)
  })
  mockApiCall.mockImplementation(async (path: string) => {
    const url = new URL(path, 'http://localhost')
    if (url.pathname === '/api/customers/companies') return { ok: true, result: { items: [] } }
    if (url.pathname === '/api/customers/deals/aggregate') return { ok: true, result: aggregate }
    if (url.pathname === '/api/customers/deals') return { ok: true, result: listDeals(url) }
    throw new Error(`Unexpected request: ${path}`)
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DealsKanbanPage />
    </QueryClientProvider>,
  )
  return { ...view, queryClient, aggregate }
}

function latestLaneProps(): LaneProps {
  const latestCall = mockLane.mock.calls.at(-1)
  if (!latestCall) throw new Error('Lane has not rendered')
  return latestCall[0]
}

describe('DealsKanbanPage filtered lane pagination', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
  })

  it.each([0, 1, 26, 50])('passes the filtered total with %i USD matches and preserves the mixed-currency aggregate', async (matchingCount) => {
    const { queryClient, aggregate, unmount } = mountBoard(matchingCount)
    await screen.findByRole('button', { name: 'Filter USD' })
    fireEvent.click(screen.getByRole('button', { name: 'Filter USD' }))

    await waitFor(() => {
      expect(latestLaneProps().paginationTotal).toBe(matchingCount)
      expect(latestLaneProps().deals).toHaveLength(Math.min(matchingCount, 25))
    })
    expect(latestLaneProps().aggregate).toMatchObject({
      count: aggregate.perStage[0].count,
      byCurrency: aggregate.perStage[0].byCurrency,
    })
    expect(latestLaneProps().aggregate?.byCurrency.map((row) => row.currency)).toEqual(['USD', 'EUR'])
    expect(mockReadApiResultOrThrow.mock.calls.some(([path]) => {
      const url = new URL(path as string, 'http://localhost')
      return url.pathname === '/api/customers/deals' && url.searchParams.get('valueCurrency') === 'USD'
    })).toBe(true)
    unmount()
    queryClient.clear()
  })

  it('keeps the selected currency on subsequent pages and retains the filtered pagination total', async () => {
    const { queryClient, unmount } = mountBoard(26)
    fireEvent.click(await screen.findByRole('button', { name: 'Filter USD' }))
    await waitFor(() => {
      expect(latestLaneProps().paginationTotal).toBe(26)
      expect(latestLaneProps().deals).toHaveLength(25)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Load next page' }))

    await waitFor(() => expect(latestLaneProps().deals).toHaveLength(26))
    const pageRequest = mockApiCall.mock.calls.find(([path]) => String(path).startsWith('/api/customers/deals?'))
    expect(pageRequest).toBeDefined()
    const url = new URL(String(pageRequest?.[0]), 'http://localhost')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      page: '2',
      pageSize: '25',
      valueCurrency: 'USD',
      pipelineId: 'pipeline-1',
      pipelineStageId: 'stage-1',
    })
    expect(latestLaneProps().paginationTotal).toBe(26)
    expect(latestLaneProps().aggregate?.count).toBe(28)
    unmount()
    queryClient.clear()
  })
})
