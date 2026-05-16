/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const pipelineId = '44444444-4444-4444-8444-444444444444'
const dealId = '55555555-5555-4555-8555-555555555555'

const executeMock = jest.fn()
const getRatesMock = jest.fn()
const findMatchingEntityIdsBySearchTokensAcrossSourcesMock = jest.fn()
const fetchStuckDealIdsMock = jest.fn()

const em = {
  getConnection: () => ({ execute: executeMock }),
}

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'em') return em
    if (name === 'exchangeRateService') return { getRates: getRatesMock }
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
    executeMock
      .mockResolvedValueOnce([{ code: 'USD' }])
      .mockResolvedValueOnce([])
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

    const aggregateCall = executeMock.mock.calls[1]
    const sql = String(aggregateCall[0])
    const values = aggregateCall[1] as string[]

    expect(sql).toContain('pipeline_id = ?')
    expect(sql).toContain('id IN (?)')
    expect(sql).not.toContain('CURRENT_DATE')
    expect(values).toContain(pipelineId)
    expect(values).toContain(dealId)
  })

  it('falls back to title and description ILIKE search when token lookup has no matches', async () => {
    findMatchingEntityIdsBySearchTokensAcrossSourcesMock.mockResolvedValueOnce([])

    const response = await GET(
      new Request(`http://localhost/api/customers/deals/aggregate?pipelineId=${pipelineId}&search=Acme`),
    )

    expect(response.status).toBe(200)

    const aggregateCall = executeMock.mock.calls[1]
    const sql = String(aggregateCall[0])
    const values = aggregateCall[1] as string[]

    expect(sql).toContain('title ILIKE ?')
    expect(sql).toContain('description ILIKE ?')
    expect(values).toContain('%Acme%')
  })
})
