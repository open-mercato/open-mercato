/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const pipelineId = '44444444-4444-4444-8444-444444444444'
const dealId = '55555555-5555-4555-8555-555555555555'

const executeMock = jest.fn()
const getRatesMock = jest.fn()
const resolveBaseCurrencyMock = jest.fn()
const findMatchingEntityIdsBySearchTokensAcrossSourcesMock = jest.fn()
const fetchStuckDealIdsMock = jest.fn()

const em = {
  getConnection: () => ({ execute: executeMock }),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'exchangeRateService') return { getRates: getRatesMock }
    if (name === 'baseCurrencyService') return { resolveBaseCurrency: resolveBaseCurrencyMock }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(async () => ({
    sub: userId,
    tenantId,
    orgId: organizationId,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => container),
}))

jest.mock('../../../utils', () => ({
  findMatchingEntityIdsBySearchTokensAcrossSources: (
    ...args: unknown[]
  ) => findMatchingEntityIdsBySearchTokensAcrossSourcesMock(...args),
}))

jest.mock('../../../../lib/stuckDeals', () => ({
  fetchStuckDealIds: (...args: unknown[]) => fetchStuckDealIdsMock(...args),
}))

import { GET } from '../route'

describe('customers deals aggregate route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    executeMock.mockResolvedValueOnce([])
    resolveBaseCurrencyMock.mockResolvedValue({ status: 'resolved', code: 'USD' })
    getRatesMock.mockResolvedValue(new Map())
    findMatchingEntityIdsBySearchTokensAcrossSourcesMock.mockResolvedValue([dealId])
    fetchStuckDealIdsMock.mockResolvedValue([])
  })

  it('applies search-token matches to aggregate counts and does not coerce false booleans to true', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&search=Acme&isStuck=false&isOverdue=false`,
      ),
    )

    expect(response.status).toBe(200)
    expect(fetchStuckDealIdsMock).not.toHaveBeenCalled()

    const aggregateCall = executeMock.mock.calls[0]
    const sql = String(aggregateCall[0])
    const values = aggregateCall[1] as string[]

    expect(sql).toContain('pipeline_id = ?')
    expect(sql).toContain('id IN (?)')
    expect(sql).not.toContain('CURRENT_DATE')
    expect(values).toContain(pipelineId)
    expect(values).toContain(dealId)
  })

  it('collapses to zero rows when token lookup has no matches and encryption is enabled (default)', async () => {
    // `customers:customer_deal.title` and `.description` are encrypted at rest, so
    // the ILIKE fallback would silently match nothing on the ciphertext. The route
    // collapses to a sentinel-id restriction instead — keeps the response shape
    // consistent and prevents misleading partial totals.
    findMatchingEntityIdsBySearchTokensAcrossSourcesMock.mockResolvedValueOnce([])

    const response = await GET(
      new Request(`http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&search=Acme`),
    )

    expect(response.status).toBe(200)

    const aggregateCall = executeMock.mock.calls[0]
    const sql = String(aggregateCall[0])
    const values = aggregateCall[1] as string[]

    expect(sql).not.toContain('title ILIKE')
    expect(sql).not.toContain('description ILIKE')
    // Sentinel UUID forces the WHERE clause to match zero rows.
    expect(values).toContain('00000000-0000-0000-0000-000000000000')
  })

  it('falls back to title and description ILIKE search when encryption is disabled', async () => {
    findMatchingEntityIdsBySearchTokensAcrossSourcesMock.mockResolvedValueOnce([])
    const prev = process.env.TENANT_DATA_ENCRYPTION
    process.env.TENANT_DATA_ENCRYPTION = 'false'
    try {
      const response = await GET(
        new Request(`http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&search=Acme`),
      )

      expect(response.status).toBe(200)

      const aggregateCall = executeMock.mock.calls[0]
      const sql = String(aggregateCall[0])
      const values = aggregateCall[1] as string[]

      expect(sql).toContain('title ILIKE ?')
      expect(sql).toContain('description ILIKE ?')
      expect(values).toContain('%Acme%')
    } finally {
      if (prev === undefined) delete process.env.TENANT_DATA_ENCRYPTION
      else process.env.TENANT_DATA_ENCRYPTION = prev
    }
  })

  it('expands won/lost synonyms so kanban and list won filters agree on stored spellings', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&status=won`,
      ),
    )
    expect(response.status).toBe(200)
    const aggregateCall = executeMock.mock.calls[0]
    const sql = String(aggregateCall[0])
    const values = aggregateCall[1] as string[]
    expect(sql).toContain('status IN')
    // won expands to win + won so both spellings are matched in one query
    expect(values).toContain('win')
    expect(values).toContain('won')
  })

  it('keeps aggregate and list status semantics aligned for win alias', async () => {
    findMatchingEntityIdsBySearchTokensAcrossSourcesMock.mockResolvedValue([dealId])
    const response = await GET(
      new Request(
        `http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&status=win&status=lost`,
      ),
    )
    expect(response.status).toBe(200)
    const aggregateCall = executeMock.mock.calls[0]
    const values = aggregateCall[1] as string[]
    // win -> win,won and lost -> loose,lost, so all four spellings appear
    expect(values).toEqual(expect.arrayContaining(['win', 'won', 'loose', 'lost']))
  })

  it('is case-insensitive for won/lost and passes through unknown values', async () => {
    executeMock.mockResolvedValueOnce([])
    findMatchingEntityIdsBySearchTokensAcrossSourcesMock.mockResolvedValue([dealId])
    const upperResponse = await GET(
      new Request(`http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&status=WON`),
    )
    expect(upperResponse.status).toBe(200)
    const upperValues = (executeMock.mock.calls[0][1] as string[])
    expect(upperValues).toEqual(expect.arrayContaining(['win', 'won']))

    executeMock.mockResolvedValueOnce([])
    const unknownResponse = await GET(
      new Request(`http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&status=renegotiating`),
    )
    expect(unknownResponse.status).toBe(200)
    const unknownValues = (executeMock.mock.calls[1][1] as string[])
    expect(unknownValues).toContain('renegotiating')
  })

  it('lets a caller-supplied status filter win over the isOverdue open-status injection', async () => {
    const response = await GET(
      new Request(
        `http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&status=won&isOverdue=true`,
      ),
    )
    expect(response.status).toBe(200)
    const aggregateCall = executeMock.mock.calls[0]
    const sql = String(aggregateCall[0])
    expect(sql).toContain('expected_close_at < CURRENT_DATE')
    expect(sql).not.toContain("AND status = 'open'")
    const values = aggregateCall[1] as string[]
    expect(values).toEqual(expect.arrayContaining(['win', 'won']))
  })
})
