/**
 * @jest-environment jsdom
 */
import { screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CompanyKpiBar } from '../CompanyKpiBar'
import type { CompanyOverview, DealSummary } from '../../formConfig'

// Regression for issue #4667: a deal closed through useDealClosure persists
// `status: 'win'`, but this bar tested for `won` / `lost` / `closed`. Every closed deal
// therefore stayed in ACTIVE DEALS and the LTV fallback read 0 for a tenant that closes
// deals entirely through the supported UI. The assertions below read the tile values
// because KpiCard only renders `comparisonLabel` alongside a trend.

const CLOSED_WON_DEAL: DealSummary = {
  id: 'deal-won',
  title: 'Closed through useDealClosure',
  status: 'win',
  closureOutcome: 'won',
  valueAmount: 4000,
  valueCurrency: 'PLN',
  createdAt: '2026-01-10T10:00:00.000Z',
}

const CLOSED_LOST_DEAL: DealSummary = {
  id: 'deal-lost',
  title: 'Lost through useDealClosure',
  status: 'loose',
  closureOutcome: 'lost',
  valueAmount: 2500,
  valueCurrency: 'PLN',
  createdAt: '2026-01-11T10:00:00.000Z',
}

const AI_CLOSED_WON_DEAL: DealSummary = {
  id: 'deal-ai-won',
  title: 'Closed through customers.update_deal_stage',
  status: 'won',
  valueAmount: 900,
  valueCurrency: 'PLN',
  createdAt: '2026-01-09T10:00:00.000Z',
}

const OPEN_DEAL: DealSummary = {
  id: 'deal-open',
  title: 'Still negotiating',
  status: 'negotiations',
  valueAmount: 1000,
  valueCurrency: 'PLN',
  createdAt: '2026-01-12T10:00:00.000Z',
}

const TENANT_STAGE_DEAL: DealSummary = {
  id: 'deal-tenant-stage',
  title: 'Awaiting legal sign-off',
  status: 'awaiting_legal_signoff',
  valueAmount: 700,
  valueCurrency: 'PLN',
  createdAt: '2026-01-13T10:00:00.000Z',
}

function buildOverview(deals: DealSummary[]): CompanyOverview {
  return {
    company: { id: 'company-1', displayName: 'Acme Corp' },
    profile: null,
    customFields: {},
    tags: [],
    comments: [],
    activities: [],
    interactions: [],
    deals,
    todos: [],
    people: [],
  }
}

function tile(title: string): HTMLElement {
  const card = screen.getByText(title).closest('div.rounded-lg')
  if (!card) throw new Error(`[internal] KPI tile "${title}" is not rendered`)
  return card as HTMLElement
}

const ACTIVE_DEALS = 'ACTIVE DEALS'
const LTV = 'CUSTOMER VALUE (LTV)'

describe('CompanyKpiBar — deal status vocabulary (#4667)', () => {
  it('keeps a win deal out of the active total and counts it as won', () => {
    renderWithProviders(<CompanyKpiBar data={buildOverview([CLOSED_WON_DEAL, OPEN_DEAL])} />)

    expect(within(tile(ACTIVE_DEALS)).getByText('PLN 1,000')).toBeInTheDocument()
    expect(within(tile(ACTIVE_DEALS)).getByText('1 pipeline')).toBeInTheDocument()
    expect(within(tile(LTV)).getByText('PLN 4,000')).toBeInTheDocument()
  })

  it('also recognises the won spelling the AI stage tool persists', () => {
    renderWithProviders(<CompanyKpiBar data={buildOverview([AI_CLOSED_WON_DEAL, OPEN_DEAL])} />)

    expect(within(tile(ACTIVE_DEALS)).getByText('PLN 1,000')).toBeInTheDocument()
    expect(within(tile(LTV)).getByText('PLN 900')).toBeInTheDocument()
  })

  it('leaves the LTV tile empty while every deal is still open', () => {
    renderWithProviders(<CompanyKpiBar data={buildOverview([OPEN_DEAL, TENANT_STAGE_DEAL])} />)

    expect(within(tile(ACTIVE_DEALS)).getByText('PLN 1,700')).toBeInTheDocument()
    expect(within(tile(ACTIVE_DEALS)).getByText('2 pipelines')).toBeInTheDocument()
    expect(within(tile(LTV)).getByText('--')).toBeInTheDocument()
  })

  it('reports an empty active total when both deals were closed through the UI', () => {
    renderWithProviders(<CompanyKpiBar data={buildOverview([CLOSED_WON_DEAL, CLOSED_LOST_DEAL])} />)

    expect(within(tile(ACTIVE_DEALS)).getByText('PLN 0')).toBeInTheDocument()
    expect(within(tile(LTV)).getByText('PLN 4,000')).toBeInTheDocument()
  })
})
