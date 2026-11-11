/** @jest-environment jsdom */
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DealCardData } from '../components/DealCard'
import type { SortOption } from '../components/SortByPopover'
import DealsKanbanPage from '../page'

const mockApiCall = jest.fn()
let mockScopeVersion = 0
let mockOrganizationId = 'organization-1'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const translate = (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key
  return { useT: () => translate }
})
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion,
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useCurrentOrganization: () => ({ id: mockOrganizationId }),
}))
jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({ useCurrentUserId: () => 'user-1' }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  readApiResultOrThrow: async (...args: unknown[]) => (await mockApiCall(...args)).result,
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/injection/useRegisteredComponent', () => ({
  useRegisteredComponent: (_id: string, fallback: unknown) => fallback,
}))
jest.mock('../../../../../components/detail/hooks/useCurrencyDictionary', () => ({ useCurrencyDictionary: () => ({ data: null }) }))
jest.mock('../../../../../components/detail/assignableStaff', () => ({ fetchAssignableStaffMembers: async () => [] }))
jest.mock('../components/ViewTabsRow', () => ({ ViewTabsRow: () => null }))
jest.mock('../components/QuickDealDialog', () => ({ QuickDealDialog: () => null }))
jest.mock('../components/AddStageDialog', () => ({ AddStageDialog: () => null }))
jest.mock('../components/CustomizeViewDialog', () => ({ CustomizeViewDialog: () => null }))
jest.mock('../components/ActivityComposerDialog', () => ({ ActivityComposerDialog: () => null }))
jest.mock('../components/ChangeStageDialog', () => ({ ChangeStageDialog: () => null }))
jest.mock('../components/ChangeOwnerDialog', () => ({ ChangeOwnerDialog: () => null }))
jest.mock('../components/BulkActionsBar', () => ({ BulkActionsBar: () => null }))
jest.mock('../components/AddStageLane', () => ({ AddStageLane: () => null }))
jest.mock('../components/EntityFilterPopover', () => ({ EntityFilterPopover: () => null }))
jest.mock('../components/CloseDateFilterPopover', () => ({ CloseDateFilterPopover: () => null }))
jest.mock('../components/StatusFilterPopover', () => ({ StatusFilterPopover: () => null }))
jest.mock('../components/PipelineFilterPopover', () => ({ PipelineFilterPopover: () => null }))
jest.mock('../components/LaneCurrencyBreakdown', () => ({ LaneCurrencyBreakdown: () => null }))
jest.mock('../components/FilterBarRow', () => ({
  FilterBarRow: ({ leadingChips, sortNode }: { leadingChips: React.ReactNode; sortNode: React.ReactNode }) => <>{leadingChips}{sortNode}</>,
}))
jest.mock('../components/SortByPopover', () => ({
  SortByPopover: ({ value, onApply }: { value: SortOption; onApply: (value: SortOption) => void }) => (
    <select aria-label="Sort deals" value={value} onChange={(event) => onApply(event.target.value as SortOption)}>
      <option value="updated_desc">Updated</option>
      <option value="value_asc">Value ascending</option>
      <option value="value_desc">Value descending</option>
    </select>
  ),
}))
jest.mock('../components/CurrencyFilterPopover', () => ({
  CurrencyFilterPopover: ({ onApply }: { onApply: (value: string | null) => void }) => (
    <button type="button" onClick={() => onApply('EUR')}>Filter EUR</button>
  ),
}))
jest.mock('../components/Lane', () => ({
  Lane: ({ deals, isLoadingMore, onLoadMore, stage, aggregate }: {
    deals: DealCardData[]
    isLoadingMore: boolean
    onLoadMore: (stageId: string) => void
    stage: { id: string }
    aggregate: { count: number }
  }) => (
    <section aria-label="Deal lane">
      <output data-testid="deal-ids">{deals.map((deal) => deal.id).join(',')}</output>
      {deals.length < aggregate.count ? (
        <button type="button" disabled={isLoadingMore} onClick={() => onLoadMore(stage.id)}>Show more</button>
      ) : null}
    </section>
  ),
}))

type DealRecord = { id: string; title: string; value_amount: number; value_currency: string; pipeline_stage_id: string }
type ApiResult = { ok: boolean; result: { items: DealRecord[]; total: number } }

const allDeals: DealRecord[] = Array.from({ length: 60 }, (_, index) => ({
  id: `deal-${index + 1}`,
  title: `Deal ${index + 1}`,
  value_amount: index + 1,
  value_currency: 'EUR',
  pipeline_stage_id: 'stage-1',
}))

function pageResponse(url: string): ApiResult {
  const params = new URL(url, 'http://localhost').searchParams
  const sorted = params.get('sortDir') === 'asc' ? allDeals : [...allDeals].reverse()
  const page = Number(params.get('page') ?? '1')
  return { ok: true, result: { items: sorted.slice((page - 1) * 25, page * 25), total: allDeals.length } }
}

function deferredResponse() {
  let resolve: (value: ApiResult) => void = () => { throw new Error('Deferred response not initialized') }
  const promise = new Promise<ApiResult>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function visibleIds() {
  return screen.getByTestId('deal-ids').textContent?.split(',').filter(Boolean) ?? []
}

function loadMoreRequests() {
  return mockApiCall.mock.calls.map((args: unknown[]) => new URL(String(args[0]), 'http://localhost'))
    .filter((url) => url.pathname === '/api/customers/deals' && Number(url.searchParams.get('page')) > 1)
}

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const board = render(<DealsKanbanPage />, {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
  return { ...board, client }
}

async function chooseSort(value: SortOption) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort deals' }), { target: { value } })
  await waitFor(() => expect(visibleIds()).toHaveLength(25))
  await waitFor(() => expect(visibleIds()[0]).toBe(value === 'value_asc' ? 'deal-1' : 'deal-60'))
}

describe('Deals Kanban pagination', () => {
  beforeEach(() => {
    mockScopeVersion = 0
    mockOrganizationId = 'organization-1'
    mockApiCall.mockReset()
    mockApiCall.mockImplementation(async (url: string) => {
      const pathname = new URL(url, 'http://localhost').pathname
      if (pathname === '/api/customers/pipelines') return { ok: true, result: { items: [{ id: 'pipeline-1', name: 'Sales', isDefault: true }] } }
      if (pathname === '/api/customers/pipeline-stages') return { ok: true, result: { items: [{ id: 'stage-1', label: 'Qualified', order: 0, pipelineId: 'pipeline-1' }] } }
      if (pathname === '/api/customers/deals/aggregate') return { ok: true, result: {
        baseCurrencyCode: 'EUR',
        perStage: [{ stageId: 'stage-1', count: 60, openCount: 60, totalInBaseCurrency: 1830, byCurrency: [{ currency: 'EUR', total: 1830, count: 60 }] }],
      } }
      if (pathname === '/api/customers/deals') return pageResponse(url)
      return { ok: true, result: { items: [] } }
    })
  })

  afterEach(() => cleanup())

  it('restarts at page 2 after reversing sort and keeps all 60 unique deals reachable', async () => {
    renderBoard()
    await screen.findByTestId('deal-ids')
    await chooseSort('value_asc')
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(visibleIds()).toHaveLength(50))

    await chooseSort('value_desc')
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(visibleIds()).toHaveLength(50))
    expect(loadMoreRequests().at(-1)?.searchParams.get('page')).toBe('2')
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(visibleIds()).toHaveLength(60))
    expect(new Set(visibleIds())).toEqual(new Set(allDeals.map((deal) => deal.id)))
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it.each(['sort', 'search', 'scope'] as const)('ignores an old pending page after a %s change without clearing the new request loading state', async (change) => {
    const board = renderBoard()
    await screen.findByTestId('deal-ids')
    await chooseSort('value_asc')
    const previousImplementation = mockApiCall.getMockImplementation()!
    const oldRequest = deferredResponse()
    const newRequest = deferredResponse()
    let pendingCount = 0
    mockApiCall.mockImplementation((url: string) => {
      const parsed = new URL(url, 'http://localhost')
      if (parsed.pathname === '/api/customers/deals' && parsed.searchParams.get('page') === '2') {
        pendingCount += 1
        return pendingCount === 1 ? oldRequest.promise : newRequest.promise
      }
      return previousImplementation(url)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByRole('button', { name: 'Show more' })).toBeDisabled()

    if (change === 'sort') await chooseSort('value_desc')
    if (change === 'search') fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Deal' } })
    if (change === 'scope') {
      mockScopeVersion += 1
      mockOrganizationId = 'organization-2'
      board.rerender(<DealsKanbanPage />)
    }
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show more' })).toBeEnabled())
    await waitFor(() => expect(visibleIds()).toHaveLength(25))
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(pendingCount).toBe(2)
    await act(async () => { oldRequest.resolve(pageResponse('/api/customers/deals?page=2&sortDir=asc')) })
    expect(visibleIds()).toHaveLength(25)
    expect(screen.getByRole('button', { name: 'Show more' })).toBeDisabled()
    await act(async () => { newRequest.resolve(pageResponse(`/api/customers/deals?page=2&sortDir=${change === 'sort' ? 'desc' : 'asc'}`)) })
    await waitFor(() => expect(visibleIds()).toHaveLength(50))
    expect(screen.getByRole('button', { name: 'Show more' })).toBeEnabled()
    expect(loadMoreRequests().at(-1)?.searchParams.get('page')).toBe('2')
  })

  it('uses the current currency filter when requesting another page', async () => {
    renderBoard()
    await screen.findByTestId('deal-ids')
    fireEvent.click(screen.getByRole('button', { name: 'Filter EUR' }))
    await waitFor(() => expect(visibleIds()).toHaveLength(25))
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    await waitFor(() => expect(visibleIds()).toHaveLength(50))
    expect(loadMoreRequests().at(-1)?.searchParams.get('valueCurrency')).toBe('EUR')
  })
})
