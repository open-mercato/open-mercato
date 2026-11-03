/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const lineChartMock = jest.fn()
const barChartMock = jest.fn()
function renderChartStub(kind: string, props: Record<string, unknown>) {
  const labels = props.categoryLabels as Record<string, string> | undefined
  const categories = props.categories as string[]
  const data = props.data as Array<Record<string, string | number>>
  const rows = data.map((point) => `${point.period}=${categories.map((category) => point[category]).join('+')}`).join(',')
  return <div data-testid="kpi-chart">{kind}|{categories.map((category) => labels?.[category] ?? category).join('/')}|{rows}</div>
}
jest.mock('@open-mercato/ui/backend/charts', () => ({
  ...jest.requireActual('@open-mercato/ui/backend/charts'),
  LineChart: (props: Record<string, unknown>) => { lineChartMock(props); return renderChartStub('line', props) },
  BarChart: (props: Record<string, unknown>) => { barChartMock(props); return renderChartStub('bars', props) },
}))

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { DealsKpiStrip } from '../DealsKpiStrip'

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
type ApiResult = Awaited<ReturnType<typeof apiCall>>

const validSummary = {
  baseCurrencyCode: 'USD',
  convertedAll: true,
  missingRateCurrencies: [],
  pipelineValue: {
    value: 1000,
    delta: { value: 0, direction: 'unchanged' },
    stages: [],
    series: [{ period: '2026-05', value: 100 }, { period: '2026-06', value: 900 }],
  },
  activeDeals: {
    value: 0,
    delta: { value: 0, direction: 'unchanged' },
    ownersCount: 0,
    needAttention: 0,
    owners: [],
    ownersOverflow: 0,
    series: [{ period: '2026-05', count: 1 }, { period: '2026-06', count: 4 }],
  },
  wonThisQuarter: { value: 0, delta: { value: 0, direction: 'unchanged' }, dealsClosed: 0, avgDeal: 0, series: [] },
  winRate: { value: 0, deltaPp: 0, direction: 'unchanged', previousValue: 0, series: [{ period: '2026-05', rate: 0.5 }, { period: '2026-06', rate: 0 }] },
}

// The KPI values are Intl-formatted, so the locale is pinned explicitly (#5105) instead of
// inheriting the runner's default — DealsKpiStrip formats through the app locale, which
// `renderWithProviders` supplies via I18nProvider.
const EN = 'en-US'

const dict = {
  'customers.deals.list.kpi.error': "Couldn't load deal metrics",
  'customers.deals.list.kpi.retry': 'Retry',
  'customers.deals.list.kpi.pipelineValue': 'Pipeline value',
  'customers.deals.list.kpi.activeDeals': 'Active deals',
  'customers.deals.list.kpi.wonThisQuarter': 'Won',
  'customers.deals.list.kpi.range.3m': '3M',
  'customers.deals.list.kpi.range.6m': '6M',
  'customers.deals.list.kpi.range.12m': '12M',
  'customers.deals.list.kpi.rangeLabel': 'Period',
  'customers.deals.list.kpi.chartTypeLabel': 'Chart type',
  'customers.deals.list.kpi.chartLine': 'Line',
  'customers.deals.list.kpi.chartBars': 'Bars',
  'customers.deals.list.kpi.winRate': 'Win rate',
  'customers.deals.list.kpi.frag.needAttention.other': '{count} need attention',
  'customers.deals.list.kpi.avgDealLabel': 'Avg deal',
  'customers.deals.list.kpi.otherStages': '{count} other stages',
  'customers.deals.list.kpi.frag.deals.other': '{count} deals',
  'customers.deals.list.kpi.unassignedStage': 'Unassigned',
  'customers.deals.list.kpi.chart.pipeline': 'Pipeline inflow by month',
  'customers.deals.list.kpi.chart.active': 'New deals by month',
  'customers.deals.list.kpi.chart.won': 'Won value by month',
  'customers.deals.list.kpi.chart.winRate': 'Win rate by month',
  'customers.deals.list.kpi.chartEmpty': 'No data for this period',
  'customers.deals.list.kpi.metricTabs': 'Deal metrics',
}

function renderStrip(locale = EN, props: Partial<React.ComponentProps<typeof DealsKpiStrip>> = {}) {
  return renderWithProviders(
    <DealsKpiStrip ownerNames={{}} stageDictionary={{}} pipelineCount={0} {...props} />,
    { locale, dict },
  )
}

describe('DealsKpiStrip', () => {
  beforeEach(() => {
    mockedApiCall.mockReset()
    lineChartMock.mockClear()
    barChartMock.mockClear()
    window.localStorage.clear()
  })

  it('starts folded to the metric row and opens the chart on the active metric click', async () => {
    mockedApiCall.mockResolvedValue({ ok: true, result: validSummary, cacheStatus: null } as unknown as ApiResult)
    const { container } = renderStrip()
    const pipelineTab = await screen.findByRole('tab', { name: /Pipeline value/ })
    expect(screen.getAllByRole('tab')).toHaveLength(4)
    expect(pipelineTab).toHaveAttribute('aria-selected', 'true')
    expect(pipelineTab).toHaveAttribute('aria-expanded', 'false')
    expect(pipelineTab).toHaveTextContent('1K')
    expect(screen.queryByTestId('kpi-chart')).not.toBeInTheDocument()

    fireEvent.click(pipelineTab)
    expect(pipelineTab).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('kpi-chart')).toHaveTextContent('line|Pipeline inflow by month|May=100,Jun=900')
    expect(lineChartMock.mock.calls.at(-1)?.[0]).toMatchObject({ animate: false, bare: true, accessibilityLayer: false, areaOpacity: 0.12, colors: ['var(--chart-indigo)'] })
    expect(mockedApiCall).toHaveBeenCalledWith('/api/customers/deals/summary?range=6m')
    expect(container.textContent).not.toContain('·')
    expect(screen.queryByRole('button', { name: /need attention/ })).not.toBeInTheDocument()

    fireEvent.click(pipelineTab)
    expect(screen.queryByTestId('kpi-chart')).not.toBeInTheDocument()
  })

  it('switches the chart and the context row with the selected tab', async () => {
    mockedApiCall.mockResolvedValue({ ok: true, result: validSummary, cacheStatus: null } as unknown as ApiResult)
    renderStrip()
    const winRateTab = await screen.findByRole('tab', { name: /Win rate/ })
    fireEvent.click(winRateTab)
    expect(winRateTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('kpi-chart')).toHaveTextContent('line|Win rate by month|May=50,Jun=0')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', winRateTab.id)

    fireEvent.click(screen.getByRole('tab', { name: /Active deals/ }))
    expect(screen.getByTestId('kpi-chart')).toHaveTextContent('bars|New deals by month|May=1,Jun=4')
  })

  it('lets the user switch between line and bars per metric and refetches for the chosen period', async () => {
    mockedApiCall.mockResolvedValue({ ok: true, result: validSummary, cacheStatus: null } as unknown as ApiResult)
    renderStrip()
    fireEvent.click(await screen.findByRole('tab', { name: /Pipeline value/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Bars' }))
    expect(screen.getByTestId('kpi-chart')).toHaveTextContent('bars|Pipeline inflow by month|')
    fireEvent.click(screen.getByRole('tab', { name: /Win rate/ }))
    expect(screen.getByTestId('kpi-chart')).toHaveTextContent('line|Win rate by month|')

    fireEvent.click(screen.getByRole('radio', { name: '12M' }))
    await screen.findByRole('tab', { name: /Pipeline value/ })
    expect(mockedApiCall).toHaveBeenLastCalledWith('/api/customers/deals/summary?range=12m')
  })

  it('shows the period control while the strip is folded', async () => {
    mockedApiCall.mockResolvedValue({ ok: true, result: { ...validSummary, range: '6m' }, cacheStatus: null } as unknown as ApiResult)
    renderStrip()
    const pipelineTab = await screen.findByRole('tab', { name: /Pipeline value/ })
    expect(pipelineTab).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('radiogroup', { name: 'Period' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '6M' })).toBeChecked()
    expect(screen.queryByRole('radio', { name: 'Bars' })).not.toBeInTheDocument()
    expect(screen.getByRole('tablist').contains(screen.getByRole('radiogroup', { name: 'Period' }))).toBe(false)
  })

  it('passes the loading state to the chart while a new period is fetched', async () => {
    mockedApiCall.mockResolvedValueOnce({ ok: true, result: { ...validSummary, range: '6m' }, cacheStatus: null } as unknown as ApiResult)
    renderStrip()
    fireEvent.click(await screen.findByRole('tab', { name: /Pipeline value/ }))
    expect(lineChartMock.mock.calls.at(-1)?.[0]).toMatchObject({ loading: false })

    let resolveRefetch: (value: ApiResult) => void = () => undefined
    mockedApiCall.mockReturnValueOnce(new Promise<ApiResult>((resolve) => { resolveRefetch = resolve }))
    fireEvent.click(screen.getByRole('radio', { name: '12M' }))
    await waitFor(() => expect(lineChartMock.mock.calls.at(-1)?.[0]).toMatchObject({ loading: true }))
    expect(screen.getByRole('radio', { name: '12M' })).toBeChecked()

    await act(async () => {
      resolveRefetch({ ok: true, result: { ...validSummary, range: '12m' }, cacheStatus: null } as unknown as ApiResult)
    })
    expect(lineChartMock.mock.calls.at(-1)?.[0]).toMatchObject({ loading: false })
    expect(screen.getByRole('radio', { name: '12M' })).toBeChecked()
  })

  it('selects the period of the numbers on screen after a failed refetch and retries the requested one', async () => {
    mockedApiCall.mockResolvedValueOnce({ ok: true, result: { ...validSummary, range: '6m' }, cacheStatus: null } as unknown as ApiResult)
    renderStrip()
    await screen.findByRole('tab', { name: /Pipeline value/ })

    mockedApiCall.mockResolvedValueOnce({ ok: false, result: null, cacheStatus: null } as unknown as ApiResult)
    fireEvent.click(screen.getByRole('radio', { name: '12M' }))
    expect(await screen.findByText("Couldn't load deal metrics")).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '6M' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '12M' })).not.toBeChecked()

    mockedApiCall.mockResolvedValueOnce({ ok: true, result: { ...validSummary, range: '12m' }, cacheStatus: null } as unknown as ApiResult)
    fireEvent.click(screen.getByRole('radio', { name: '12M' }))
    await waitFor(() => expect(screen.queryByText("Couldn't load deal metrics")).not.toBeInTheDocument())
    expect(mockedApiCall).toHaveBeenLastCalledWith('/api/customers/deals/summary?range=12m')
    expect(screen.getByRole('radio', { name: '12M' })).toBeChecked()
  })

  it('formats the KPI values in the app locale rather than the runtime default', async () => {
    mockedApiCall.mockResolvedValue({ ok: true, result: validSummary, cacheStatus: null } as unknown as ApiResult)
    renderStrip('pl-PL')
    expect(await screen.findByText(/1 tys\./)).toBeInTheDocument()
  })

  it('turns the attention count into the filter action and names pipeline-only stages', async () => {
    const onNeedsAttentionClick = jest.fn()
    mockedApiCall.mockResolvedValue({
      ok: true,
      cacheStatus: null,
      result: {
        ...validSummary,
        pipelineValue: { ...validSummary.pipelineValue, stages: [{ stage: 'discovery_call', count: 2, value: 500 }, { stage: null, count: 1, value: 100 }] },
        activeDeals: { ...validSummary.activeDeals, value: 3, needAttention: 2, ownersCount: 1, owners: [{ id: 'u1', count: 3 }] },
      },
    } as unknown as ApiResult)
    renderStrip(EN, { onNeedsAttentionClick, ownerNames: { u1: 'Jane Doe' } })
    fireEvent.click(await screen.findByRole('tab', { name: /Pipeline value/ }))
    expect(screen.getByText('Discovery call')).toBeInTheDocument()
    expect(screen.getByText('500 USD')).toBeInTheDocument()
    expect(screen.getByText('2 deals')).toBeInTheDocument()
    expect(screen.getAllByText('Unassigned')).toHaveLength(1)

    fireEvent.click(screen.getByRole('tab', { name: /Active deals/ }))
    fireEvent.click(screen.getByRole('button', { name: '2 need attention' }))
    expect(onNeedsAttentionClick).toHaveBeenCalledTimes(1)
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('tolerates a summary without the monthly series', async () => {
    const { pipelineValue, activeDeals, wonThisQuarter } = validSummary
    mockedApiCall.mockResolvedValue({
      ok: true,
      cacheStatus: null,
      result: {
        ...validSummary,
        pipelineValue: { ...pipelineValue, series: undefined },
        activeDeals: { ...activeDeals, series: undefined },
        wonThisQuarter: { ...wonThisQuarter, series: undefined },
      },
    } as unknown as ApiResult)
    renderStrip()
    fireEvent.click(await screen.findByRole('tab', { name: /Pipeline value/ }))
    expect(screen.getByTestId('kpi-chart')).toHaveTextContent('line|Pipeline inflow by month|')
  })

  it('shows the error state (never crashes the page) when the summary response is non-conforming', async () => {
    mockedApiCall.mockResolvedValue({ ok: true, result: { unexpected: true }, cacheStatus: null } as unknown as ApiResult)
    renderStrip()
    expect(await screen.findByText("Couldn't load deal metrics")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
