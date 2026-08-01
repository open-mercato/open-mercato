import { computeDealTrend, getActiveDeals, sumActiveDeals } from '../helpers'
import type { DealSummary } from '../../../formConfig'

// Regression for issue #4667: the supported closure flows persist `win` / `loose`
// (useDealClosure, the kanban board) while the AI stage tool persists `won` / `lost`.
// These helpers used to test only for `won` / `lost` / `closed`, so a deal closed
// through the UI stayed "active" on the company dashboard.

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

describe('company dashboard helpers — deal status vocabulary (#4667)', () => {
  const deals = [CLOSED_WON_DEAL, CLOSED_LOST_DEAL, AI_CLOSED_WON_DEAL, OPEN_DEAL, TENANT_STAGE_DEAL]

  it('excludes every closed spelling from the active list', () => {
    expect(getActiveDeals(deals).map((deal) => deal.id)).toEqual(['deal-open', 'deal-tenant-stage'])
  })

  it('sums only the open deals', () => {
    expect(sumActiveDeals(deals)).toBe(1700)
  })

  it('keeps a tenant-specific stage open so it is never silently reclassified', () => {
    expect(getActiveDeals([TENANT_STAGE_DEAL])).toHaveLength(1)
    expect(sumActiveDeals([TENANT_STAGE_DEAL])).toBe(700)
  })

  it('keeps a status-less deal open', () => {
    const withoutStatus: DealSummary = { id: 'deal-no-status', title: 'No status', valueAmount: 100 }
    expect(getActiveDeals([withoutStatus])).toHaveLength(1)
  })

  it('reports no deal trend once every deal is closed', () => {
    expect(computeDealTrend([CLOSED_WON_DEAL, CLOSED_LOST_DEAL, AI_CLOSED_WON_DEAL])).toBeUndefined()
  })

  it('still reports a trend while an open deal remains', () => {
    expect(computeDealTrend([CLOSED_WON_DEAL, OPEN_DEAL])).toBeDefined()
  })
})
