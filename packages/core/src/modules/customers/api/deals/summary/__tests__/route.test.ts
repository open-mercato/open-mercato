/** @jest-environment node */

import {
  computeDelta,
  convertSumsToBase,
  getPreviousQuarterWindow,
  getQuarterWindow,
  getTrailingMonths,
} from '../../../../lib/dealsMetrics'

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const ownerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ownerB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const overdueDealId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const stuckDealId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const executeMock = jest.fn()
const getRatesMock = jest.fn()
const ratesForOrganization = jest.fn((_organizationId: string) => new Map())
const storedRatesMock = jest.fn(async (params: { requests: Array<{ organizationId: string }> }) =>
  new Map(params.requests.map(({ organizationId }) => [organizationId, ratesForOrganization(organizationId)])),
)
const resolveBaseCurrencyMock = jest.fn()
const fetchStuckDealIdsMock = jest.fn()
const getAuthFromRequestMock = jest.fn()

const em = {
  getConnection: () => ({ execute: executeMock }),
}

let exchangeRateServiceStub: Record<string, unknown> = {}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'exchangeRateService') return exchangeRateServiceStub
    if (name === 'baseCurrencyService') return { resolveBaseCurrency: resolveBaseCurrencyMock }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(async () => ({
    tenantId,
    filterIds: [organizationId],
  })),
}))

jest.mock('../../../../lib/stuckDeals', () => ({
  fetchStuckDealIds: (...args: unknown[]) => fetchStuckDealIdsMock(...args),
}))

import { GET } from '../route'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

const resolveScopeMock = resolveOrganizationScopeForRequest as jest.Mock
const usdOrganizationId = '44444444-4444-4444-8444-444444444444'
const eurOrganizationId = '55555555-5555-4555-8555-555555555555'

type Json = Record<string, unknown>

function rate(value: string): { rate: string } {
  return { rate: value }
}

describe('dealsMetrics pure helpers', () => {
  it('computes quarter windows in UTC and handles the year boundary', () => {
    // 2026-02-15 → Q1 (Jan–Mar) UTC.
    const q1 = getQuarterWindow(new Date('2026-02-15T12:00:00Z'))
    expect(q1.start.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(q1.end.toISOString()).toBe('2026-04-01T00:00:00.000Z')

    const prevOfQ1 = getPreviousQuarterWindow(new Date('2026-02-15T12:00:00Z'))
    expect(prevOfQ1.start.toISOString()).toBe('2025-10-01T00:00:00.000Z')
    expect(prevOfQ1.end.toISOString()).toBe('2026-01-01T00:00:00.000Z')

    // 2026-04-01T00:30 is in Q2 in UTC even if a negative-offset local zone would call it Q1.
    const q2 = getQuarterWindow(new Date('2026-04-01T00:30:00Z'))
    expect(q2.start.toISOString()).toBe('2026-04-01T00:00:00.000Z')
    expect(q2.end.toISOString()).toBe('2026-07-01T00:00:00.000Z')
  })

  it('builds trailing-month buckets oldest → newest with YYYY-MM labels', () => {
    const months = getTrailingMonths(new Date('2026-02-15T00:00:00Z'), 6)
    expect(months.map((m) => m.label)).toEqual([
      '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
    ])
    expect(months[0].start.toISOString()).toBe('2025-09-01T00:00:00.000Z')
  })

  it('computes delta edge cases without artificial zero-baseline growth', () => {
    expect(computeDelta(50, 0)).toEqual({ value: 0, direction: 'unchanged' })
    expect(computeDelta(0, 0)).toEqual({ value: 0, direction: 'unchanged' })
    expect(computeDelta(150, 100)).toEqual({ value: 50, direction: 'up' })
    expect(computeDelta(80, 100)).toEqual({ value: -20, direction: 'down' })
    expect(computeDelta(100, 100)).toEqual({ value: 0, direction: 'unchanged' })
  })

  it('converts per-currency sums to base, flagging missing rates and the no-base case', () => {
    const rates = new Map([
      ['EUR/USD', { rates: [rate('1.10')], fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', requestedDate: new Date(), actualDate: new Date() }],
    ]) as never
    const converted = convertSumsToBase(
      [
        { currency: 'USD', total: 1000 },
        { currency: 'EUR', total: 100 },
        { currency: 'GBP', total: 50 },
      ],
      'USD',
      rates,
    )
    // 1000 (base) + 100*1.10 (converted) ; GBP missing → excluded + flagged.
    expect(converted.total).toBe(1110)
    expect(converted.convertedAll).toBe(false)
    expect(converted.missingRateCurrencies).toEqual(['GBP'])

    const noBase = convertSumsToBase([{ currency: 'USD', total: 10 }], null, new Map() as never)
    expect(noBase.total).toBe(0)
    expect(noBase.convertedAll).toBe(false)
    expect(noBase.missingRateCurrencies).toEqual(['USD'])
  })
})

describe('customers deals summary route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getAuthFromRequestMock.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })
    exchangeRateServiceStub = { getRates: getRatesMock, getStoredRatesForOrganizations: storedRatesMock }
    ratesForOrganization.mockReturnValue(new Map())
    resolveBaseCurrencyMock.mockResolvedValue({ status: 'resolved', code: 'USD' })
    fetchStuckDealIdsMock.mockResolvedValue([])
    jest.useFakeTimers()
    // Fix "today" inside Q1 2026 so quarter bucketing is deterministic.
    jest.setSystemTime(new Date('2026-02-15T12:00:00Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns 401 when auth lacks a tenant', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: userId, tenantId: null, orgId: null })
    const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
    expect(response.status).toBe(401)
    expect(executeMock).not.toHaveBeenCalled()
  })

  // A null `orgId` is how an all-organizations selection reaches this route (the super-admin
  // org cookie override clears it), not a sign of a broken session. Answering 401 sent
  // `apiFetch` into a session-refresh loop that reloaded the deals page forever.
  it('does not treat an all-organizations selection as an auth failure', async () => {
    getAuthFromRequestMock.mockResolvedValueOnce({ sub: userId, tenantId, orgId: null })
    executeMock.mockResolvedValue([])
    const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
    expect(response.status).toBe(200)
  })

  it('computes KPI values, deltas, UTC quarter bucketing, multi-currency conversion and need-attention union', async () => {
    // Base currency = USD; EUR rate present, GBP rate missing.
    ratesForOrganization.mockReturnValue(
      new Map([
        ['EUR/USD', { rates: [rate('1.20')], fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', requestedDate: new Date(), actualDate: new Date() }],
      ]),
    )
    fetchStuckDealIdsMock.mockResolvedValue([stuckDealId, overdueDealId])

    executeMock
      // 1) open pipeline rows (stage/currency/total/count/owner)
      .mockResolvedValueOnce([
        { organization_id: organizationId, stage: 'qualification', currency: 'USD', total: '1000', count: '2', owner_user_id: ownerA },
        { organization_id: organizationId, stage: 'qualification', currency: 'EUR', total: '100', count: '1', owner_user_id: ownerB },
        { organization_id: organizationId, stage: 'proposal', currency: 'GBP', total: '50', count: '1', owner_user_id: ownerA },
      ])
      // 2) inflow rows (open value created current vs previous quarter)
      .mockResolvedValueOnce([
        { organization_id: organizationId, currency: 'USD', current_total: '600', current_count: '2', previous_total: '300', previous_count: '1' },
      ])
      // 3) won rows (updated_at current vs previous quarter)
      .mockResolvedValueOnce([
        { organization_id: organizationId, currency: 'USD', current_total: '800', current_count: '2', previous_total: '400', previous_count: '1' },
      ])
      // 4) win/loss counts (current/previous quarter)
      .mockResolvedValueOnce([
        { current_won: '3', current_lost: '1', previous_won: '1', previous_lost: '1' },
      ])
      // 5) win-rate series (trailing months)
      .mockResolvedValueOnce([
        { period: '2026-02', won: '3', lost: '1' },
        { period: '2026-01', won: '1', lost: '3' },
      ])
      // 6) overdue open deal ids
      .mockResolvedValueOnce([{ id: overdueDealId }])
      // 7) open-status intersection for the stuck ids (both seeded ids resolve as open here)
      .mockResolvedValueOnce([{ id: stuckDealId }, { id: overdueDealId }])

    const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Json & {
      pipelineValue: Json & { stages: Json[]; delta: Json }
      activeDeals: Json & { owners: Json[] }
      wonThisQuarter: Json
      winRate: Json & { series: Json[] }
    }

    expect(body.baseCurrencyCode).toBe('USD')
    // GBP had no rate → not fully converted, GBP disclosed.
    expect(body.convertedAll).toBe(false)
    expect(body.missingRateCurrencies).toEqual(['GBP'])

    // Pipeline value: 1000 USD + 100*1.20 EUR = 1120 (GBP excluded).
    expect(body.pipelineValue.value).toBe(1120)
    // Inflow delta: 600 vs 300 → +100% up.
    expect(body.pipelineValue.delta).toEqual({ value: 100, direction: 'up' })
    // Per-stage breakdown (qualification = 1000 + 120; proposal = GBP excluded → 0).
    const stages = body.pipelineValue.stages as Array<{ stage: string | null; count: number; value: number }>
    const qualification = stages.find((s) => s.stage === 'qualification')
    const proposal = stages.find((s) => s.stage === 'proposal')
    expect(qualification).toEqual({ stage: 'qualification', count: 3, value: 1120 })
    expect(proposal).toEqual({ stage: 'proposal', count: 1, value: 0 })

    // Active deals: total open count = 2 + 1 + 1 = 4; distinct owners = 2.
    expect(body.activeDeals.value).toBe(4)
    expect(body.activeDeals.ownersCount).toBe(2)
    // Need attention = overdue {overdueDealId} ∪ (stuck ∩ open) {stuckDealId, overdueDealId} = 2.
    expect(body.activeDeals.needAttention).toBe(2)
    expect(body.activeDeals.delta).toEqual({ value: 100, direction: 'up' })
    // Owners ranked by open-deal count: ownerA (3) before ownerB (1).
    const owners = body.activeDeals.owners as Array<{ id: string; count: number }>
    expect(owners[0]).toEqual({ id: ownerA, count: 3 })
    expect(owners[1]).toEqual({ id: ownerB, count: 1 })
    expect(body.activeDeals.ownersOverflow).toBe(0)

    // Won this quarter: 800 USD; dealsClosed = 2; avg = 400; delta 800 vs 400 = +100%.
    expect(body.wonThisQuarter.value).toBe(800)
    expect(body.wonThisQuarter.dealsClosed).toBe(2)
    expect(body.wonThisQuarter.avgDeal).toBe(400)
    expect(body.wonThisQuarter.delta).toEqual({ value: 100, direction: 'up' })

    // Win rate: current 3/(3+1)=75%; previous 1/(1+1)=50%; deltaPp = +25 up.
    expect(body.winRate.value).toBe(75)
    expect(body.winRate.previousValue).toBe(50)
    expect(body.winRate.deltaPp).toBe(25)
    expect(body.winRate.direction).toBe('up')
    // Series: 6 trailing months ending 2026-02, missing months filled with 0.
    const series = body.winRate.series as Array<{ period: string; rate: number }>
    expect(series).toHaveLength(6)
    expect(series.map((p) => p.period)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'])
    expect(series[series.length - 1]).toEqual({ period: '2026-02', rate: 0.75 })
    expect(series.find((p) => p.period === '2026-01')).toEqual({ period: '2026-01', rate: 0.25 })
    expect(series.find((p) => p.period === '2025-11')).toEqual({ period: '2025-11', rate: 0 })

    // Quarter window params were passed to the inflow query (current quarter start/end, UTC).
    const inflowCall = executeMock.mock.calls[1]
    const inflowValues = inflowCall[1] as string[]
    expect(inflowValues).toContain('2026-01-01T00:00:00.000Z')
    expect(inflowValues).toContain('2026-04-01T00:00:00.000Z')
    // Previous quarter start present too.
    expect(inflowValues).toContain('2025-10-01T00:00:00.000Z')
  })

  it('falls back to the dominant currency total when no base currency is configured', async () => {
    resolveBaseCurrencyMock.mockResolvedValueOnce({ status: 'missing' })
    executeMock
      // 1) open pipeline rows: USD dominant, EUR smaller
      .mockResolvedValueOnce([
        { organization_id: organizationId, stage: 'qualification', currency: 'USD', total: '900', count: '3', owner_user_id: ownerA },
        { organization_id: organizationId, stage: 'qualification', currency: 'EUR', total: '100', count: '1', owner_user_id: ownerB },
      ])
      // 2) inflow
      .mockResolvedValueOnce([])
      // 3) won
      .mockResolvedValueOnce([])
      // 4) win/loss
      .mockResolvedValueOnce([{ current_won: '0', current_lost: '0', previous_won: '0', previous_lost: '0' }])
      // 5) series
      .mockResolvedValueOnce([])
      // 6) overdue
      .mockResolvedValueOnce([])

    const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as Json & { pipelineValue: Json }

    expect(body.baseCurrencyCode).toBeNull()
    expect(body.convertedAll).toBe(false)
    // Dominant currency total (USD 900, larger than EUR 100).
    expect((body.pipelineValue as { value: number }).value).toBe(900)
    // getRates not consulted without a base currency.
    expect(storedRatesMock).not.toHaveBeenCalled()
    // Win rate degrades to 0 with no closed deals.
    expect((body.winRate as { value: number }).value).toBe(0)
    expect((body.winRate as { direction: string }).direction).toBe('unchanged')
  })

  it('excludes terminal (non-open) stuck deals from need-attention via the open-status intersection', async () => {
    // fetchStuckDealIds does not filter status, so it can return won/lost/closed deals. The route
    // intersects them with the open (OPEN_STATUSES) set: only still-open stuck deals must count.
    const openStuckId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    fetchStuckDealIdsMock.mockResolvedValue([openStuckId, stuckDealId])

    executeMock
      // 1) open pipeline rows
      .mockResolvedValueOnce([
        { organization_id: organizationId, stage: 'qualification', currency: 'USD', total: '500', count: '1', owner_user_id: ownerA },
      ])
      // 2) inflow
      .mockResolvedValueOnce([])
      // 3) won
      .mockResolvedValueOnce([])
      // 4) win/loss
      .mockResolvedValueOnce([{ current_won: '0', current_lost: '0', previous_won: '0', previous_lost: '0' }])
      // 5) series
      .mockResolvedValueOnce([])
      // 6) overdue (none)
      .mockResolvedValueOnce([])
      // 7) open-status intersection: only `openStuckId` is still open; `stuckDealId` is terminal → excluded
      .mockResolvedValueOnce([{ id: openStuckId }])

    const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { activeDeals: { needAttention: number } }
    // Only the open stuck deal counts; the terminal stuck deal is filtered out by the intersection.
    expect(body.activeDeals.needAttention).toBe(1)
  })

  describe('across several organizations (#8243)', () => {
    function mockEmptyTail() {
      executeMock
        .mockResolvedValueOnce([{ current_won: '0', current_lost: '0', previous_won: '0', previous_lost: '0' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
    }

    function eurRate(value: string) {
      return { rates: [rate(value)], fromCurrencyCode: 'EUR', toCurrencyCode: 'USD', requestedDate: new Date(), actualDate: new Date() }
    }

    it('reports no base currency when the organizations in scope disagree, whatever their order', async () => {
      const baseByOrganization: Record<string, string> = { [usdOrganizationId]: 'USD', [eurOrganizationId]: 'EUR' }
      resolveBaseCurrencyMock.mockImplementation(async ({ organizationIds }: { organizationIds: string[] }) => {
        const codes = new Set(organizationIds.map((id) => baseByOrganization[id]))
        return codes.size === 1 ? { status: 'resolved', code: [...codes][0] } : { status: 'ambiguous' }
      })

      for (const filterIds of [[usdOrganizationId, eurOrganizationId], [eurOrganizationId, usdOrganizationId]]) {
        resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds })
        executeMock
          .mockResolvedValueOnce([
            { organization_id: usdOrganizationId, stage: 'qualification', currency: 'USD', total: '1000', count: '1', owner_user_id: ownerA },
            { organization_id: eurOrganizationId, stage: 'qualification', currency: 'EUR', total: '1000', count: '1', owner_user_id: ownerB },
          ])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
        mockEmptyTail()

        const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
        const body = (await response.json()) as { baseCurrencyCode: string | null; convertedAll: boolean; missingRateCurrencies: string[] }

        expect(body.baseCurrencyCode).toBeNull()
        expect(body.convertedAll).toBe(false)
        expect([...body.missingRateCurrencies].sort()).toEqual(['EUR', 'USD'])
      }
      expect(storedRatesMock).not.toHaveBeenCalled()
    })

    it('converts each organization\'s deals with the rates entered in that organization', async () => {
      resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: [usdOrganizationId, eurOrganizationId] })
      ratesForOrganization.mockImplementation((organizationId) =>
        new Map([['EUR/USD', eurRate(organizationId === usdOrganizationId ? '1.10' : '1.20')]]),
      )
      executeMock
        .mockResolvedValueOnce([
          { organization_id: usdOrganizationId, stage: 'qualification', currency: 'EUR', total: '100', count: '1', owner_user_id: ownerA },
          { organization_id: eurOrganizationId, stage: 'qualification', currency: 'EUR', total: '100', count: '1', owner_user_id: ownerB },
          { organization_id: eurOrganizationId, stage: 'qualification', currency: 'USD', total: '50', count: '1', owner_user_id: ownerB },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
      mockEmptyTail()

      const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
      const body = (await response.json()) as { baseCurrencyCode: string | null; convertedAll: boolean; pipelineValue: { value: number } }

      expect(resolveBaseCurrencyMock).toHaveBeenCalledWith({
        tenantId,
        organizationIds: [usdOrganizationId, eurOrganizationId],
      })
      expect(body.baseCurrencyCode).toBe('USD')
      expect(body.convertedAll).toBe(true)
      expect(body.pipelineValue.value).toBe(280)
      expect(storedRatesMock).toHaveBeenCalledTimes(1)
      expect(getRatesMock).not.toHaveBeenCalled()
      const [batch] = storedRatesMock.mock.calls[0] as unknown as [{ tenantId: string; requests: Array<{ organizationId: string; pairs: unknown[] }> }]
      expect(batch.tenantId).toBe(tenantId)
      expect([...batch.requests].sort((a, b) => a.organizationId.localeCompare(b.organizationId))).toEqual([
        { organizationId: usdOrganizationId, pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }] },
        { organizationId: eurOrganizationId, pairs: [{ fromCurrencyCode: 'EUR', toCurrencyCode: 'USD' }] },
      ])
    })

    it('discloses a currency as missing when only another organization has a rate for it', async () => {
      resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: [usdOrganizationId, eurOrganizationId] })
      ratesForOrganization.mockImplementation((organizationId) =>
        organizationId === usdOrganizationId ? new Map([['EUR/USD', eurRate('1.10')]]) : new Map(),
      )
      executeMock
        .mockResolvedValueOnce([
          { organization_id: usdOrganizationId, stage: 'qualification', currency: 'USD', total: '1000', count: '1', owner_user_id: ownerA },
          { organization_id: eurOrganizationId, stage: 'qualification', currency: 'EUR', total: '1000', count: '1', owner_user_id: ownerB },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
      mockEmptyTail()

      const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
      const body = (await response.json()) as { convertedAll: boolean; missingRateCurrencies: string[]; pipelineValue: { value: number } }

      expect(body.convertedAll).toBe(false)
      expect(body.missingRateCurrencies).toEqual(['EUR'])
      expect(body.pipelineValue.value).toBe(1000)
    })

    it('looks up missing rates for every organization in one batched call instead of one per organization', async () => {
      const organizationIds = [usdOrganizationId, eurOrganizationId, organizationId]
      resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: organizationIds })
      executeMock
        .mockResolvedValueOnce(organizationIds.map((id) => (
          { organization_id: id, stage: 'qualification', currency: 'EUR', total: '100', count: '1', owner_user_id: ownerA }
        )))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
      mockEmptyTail()

      const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
      const body = (await response.json()) as { convertedAll: boolean; missingRateCurrencies: string[]; pipelineValue: { value: number } }

      expect(storedRatesMock).toHaveBeenCalledTimes(1)
      expect(getRatesMock).not.toHaveBeenCalled()
      const [batch] = storedRatesMock.mock.calls[0] as unknown as [{ requests: Array<{ organizationId: string }>; maxDaysBack: number }]
      expect(batch.requests.map((entry) => entry.organizationId).sort()).toEqual([...organizationIds].sort())
      expect(batch.maxDaysBack).toBe(60)
      expect(body.convertedAll).toBe(false)
      expect(body.missingRateCurrencies).toEqual(['EUR'])
      expect(body.pipelineValue.value).toBe(0)
    })

    it('falls back to per-organization getRates when an overriding exchange-rate service has no batched lookup', async () => {
      exchangeRateServiceStub = { getRates: getRatesMock }
      resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: [usdOrganizationId, eurOrganizationId] })
      getRatesMock.mockImplementation(async ({ scope }: { scope: { organizationId: string } }) =>
        new Map([['EUR/USD', eurRate(scope.organizationId === usdOrganizationId ? '1.10' : '1.20')]]),
      )
      executeMock
        .mockResolvedValueOnce([
          { organization_id: usdOrganizationId, stage: 'qualification', currency: 'EUR', total: '100', count: '1', owner_user_id: ownerA },
          { organization_id: eurOrganizationId, stage: 'qualification', currency: 'EUR', total: '100', count: '1', owner_user_id: ownerB },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
      mockEmptyTail()

      const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
      const body = (await response.json()) as { convertedAll: boolean; pipelineValue: { value: number } }

      expect(body.convertedAll).toBe(true)
      expect(body.pipelineValue.value).toBe(230)
      expect(getRatesMock.mock.calls.map(([params]) => params.scope.organizationId).sort())
        .toEqual([usdOrganizationId, eurOrganizationId].sort())
    })

    it('rounds once after combining organization subtotals for pipeline, won and deltas', async () => {
      resolveScopeMock.mockResolvedValueOnce({ tenantId, filterIds: [usdOrganizationId, eurOrganizationId] })
      executeMock
        .mockResolvedValueOnce([
          { organization_id: usdOrganizationId, stage: 'qualification', currency: 'USD', total: '0.40', count: '1', owner_user_id: ownerA },
          { organization_id: eurOrganizationId, stage: 'qualification', currency: 'USD', total: '0.40', count: '1', owner_user_id: ownerB },
        ])
        .mockResolvedValueOnce([
          { organization_id: usdOrganizationId, currency: 'USD', current_total: '0.40', current_count: '1', previous_total: '1.30', previous_count: '1' },
          { organization_id: eurOrganizationId, currency: 'USD', current_total: '0.40', current_count: '1', previous_total: '1.30', previous_count: '1' },
        ])
        .mockResolvedValueOnce([
          { organization_id: usdOrganizationId, currency: 'USD', current_total: '0.40', current_count: '1', previous_total: '1.30', previous_count: '1' },
          { organization_id: eurOrganizationId, currency: 'USD', current_total: '0.40', current_count: '1', previous_total: '1.30', previous_count: '1' },
        ])
      mockEmptyTail()

      const response = await GET(new Request('http://localhost/api/customers/deals/summary'))
      const body = (await response.json()) as {
        pipelineValue: { value: number; delta: { value: number; direction: string }; stages: Array<{ value: number }> }
        wonThisQuarter: { value: number; delta: { value: number; direction: string } }
      }

      expect(body.pipelineValue.value).toBe(1)
      expect(body.pipelineValue.stages[0]?.value).toBe(1)
      expect(body.pipelineValue.delta).toEqual({ value: -67, direction: 'down' })
      expect(body.wonThisQuarter.value).toBe(1)
      expect(body.wonThisQuarter.delta).toEqual({ value: -67, direction: 'down' })
    })
  })
})
