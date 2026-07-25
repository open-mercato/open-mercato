/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { DealsKpiStrip } from '../DealsKpiStrip'

const mockedApiCall = apiCall as jest.MockedFunction<typeof apiCall>
type ApiResult = Awaited<ReturnType<typeof apiCall>>

const validSummary = {
  baseCurrencyCode: 'USD',
  convertedAll: true,
  missingRateCurrencies: [],
  pipelineValue: { value: 1000, delta: { value: 0, direction: 'unchanged' }, stages: [] },
  activeDeals: { value: 0, delta: { value: 0, direction: 'unchanged' }, ownersCount: 0, needAttention: 0, owners: [], ownersOverflow: 0 },
  wonThisQuarter: { value: 0, delta: { value: 0, direction: 'unchanged' }, dealsClosed: 0, avgDeal: 0 },
  winRate: { value: 0, deltaPp: 0, direction: 'unchanged', previousValue: 0, series: [] },
}

function renderStrip() {
  return renderWithProviders(
    <DealsKpiStrip ownerNames={{}} stageDictionary={{}} pipelineCount={0} />,
    {
      dict: {
        'customers.deals.list.kpi.error': "Couldn't load deal metrics",
        'customers.deals.list.kpi.retry': 'Retry',
      },
    },
  )
}

describe('DealsKpiStrip — resilience to summary response shape', () => {
  beforeEach(() => {
    mockedApiCall.mockReset()
  })

  it('renders the KPI values when the summary response conforms', async () => {
    mockedApiCall.mockResolvedValue({ ok: true, result: validSummary, cacheStatus: null } as unknown as ApiResult)
    renderStrip()
    expect(await screen.findByText('1K')).toBeInTheDocument()
    expect(screen.queryByText("Couldn't load deal metrics")).not.toBeInTheDocument()
  })

  it('shows the error state (never crashes the page) when the summary response is non-conforming', async () => {
    // Mirrors TC-AI-AGENT-DEAL-ANALYZER: a broad `**/api/customers/deals**` mock returns a
    // list-shaped payload for /summary. The strip must surface the error card, not throw on
    // `data.pipelineValue.value` and unmount the whole deals page.
    mockedApiCall.mockResolvedValue({ ok: true, result: { items: [], total: 0, totalPages: 0 }, cacheStatus: null } as unknown as ApiResult)
    renderStrip()
    const errorMessages = await screen.findAllByText("Couldn't load deal metrics")
    expect(errorMessages).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
