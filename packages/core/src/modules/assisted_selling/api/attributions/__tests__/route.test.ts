/** @jest-environment node */
// Step 5.4 — route-level coverage for `GET /api/assisted_selling/attributions`: the
// tenant/organization scoping (S9's own precedent, one module boundary over) and the
// query-param -> `where` mapping. The subscriber that actually populates this table has its
// own unit coverage in `lib/__tests__/attribution.test.ts`.

jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

const mockFindWithDecryption = jest.fn(async (..._args: unknown[]): Promise<Array<Record<string, unknown>>> => [])
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { GET } from '../route'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

function makeRequest(query = ''): Request {
  return new Request(`https://merchant.example/api/assisted_selling/attributions${query}`)
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    organizationId: ORG_ID,
    cartId: 'cart-1',
    cartLineId: 'line-1',
    salesOrderId: 'order-1',
    salesOrderLineId: 'order-line-1',
    salesQuoteId: null,
    salesQuoteLineId: null,
    actorType: 'buyer',
    actorId: null,
    threadId: null,
    proposalId: null,
    lineNetAmount: '10.0000',
    lineGrossAmount: '12.0000',
    currencyCode: 'USD',
    convertedAt: new Date('2026-10-20T00:00:00.000Z'),
    createdAt: new Date('2026-10-20T00:00:01.000Z'),
    ...overrides,
  }
}

describe('GET /api/assisted_selling/attributions', () => {
  let findAndCount: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockFindWithDecryption.mockImplementation(async () => [])
    findAndCount = jest.fn(async () => [[makeRow()], 1])
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: TENANT_ID, orgId: ORG_ID })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({ filterIds: null, allowedIds: null })
    ;(createRequestContainer as jest.Mock).mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => ({ findAndCount }) }
        throw new Error(`Unknown dependency: ${name}`)
      },
    })
  })

  it('answers 401 when unauthenticated', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)

    const response = await GET(makeRequest())

    expect(response.status).toBe(401)
    expect(findAndCount).not.toHaveBeenCalled()
  })

  it('scopes the query to the caller\'s organizations', async () => {
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({ filterIds: ['org-1', 'org-2'], allowedIds: null })

    await GET(makeRequest())

    const [, where] = findAndCount.mock.calls[0]
    expect(where).toMatchObject({ tenantId: TENANT_ID, organizationId: { $in: ['org-1', 'org-2'] } })
  })

  it('maps salesOrderId/salesQuoteId/proposalId/convertedAt range filters onto the where clause', async () => {
    const orderId = '11111111-1111-4111-8111-111111111111'
    const proposalId = '22222222-2222-4222-8222-222222222222'
    await GET(makeRequest(`?salesOrderId=${orderId}&proposalId=${proposalId}&convertedFrom=2026-01-01&convertedTo=2026-02-01`))

    const [, where] = findAndCount.mock.calls[0]
    expect(where).toMatchObject({
      salesOrderId: orderId,
      proposalId,
      convertedAt: { $gte: new Date('2026-01-01'), $lte: new Date('2026-02-01') },
    })
  })

  it('returns a paged, serialized list', async () => {
    const response = await GET(makeRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items).toEqual([
      expect.objectContaining({ id: 'row-1', salesOrderId: 'order-1', actorType: 'buyer', currencyCode: 'USD' }),
    ])
  })

  it('short-circuits with an empty page when the caller has no organizations at all', async () => {
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: TENANT_ID, orgId: null })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({ filterIds: [], allowedIds: null })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(body).toEqual({ items: [], total: 0, page: 1, pageSize: 25 })
    expect(findAndCount).not.toHaveBeenCalled()
  })
  it('resolves document numbers, product and actor names instead of leaving only raw ids', async () => {
    findAndCount.mockResolvedValue([
      [makeRow({ actorType: 'rep', actorId: 'rep-1', salesOrderId: 'order-1', salesOrderLineId: 'order-line-1' })],
      1,
    ])
    mockFindWithDecryption.mockImplementation(async (_em, entity) => {
      const name = (entity as { name: string }).name
      if (name === 'SalesOrder') return [{ id: 'order-1', orderNumber: 'ORDER-20261030-00002' }]
      if (name === 'SalesOrderLine') return [{ id: 'order-line-1', name: 'QA R5 Widget' }]
      if (name === 'User') return [{ id: 'rep-1', name: 'Anna Rep', email: 'anna@example.com' }]
      return []
    })

    const response = await GET(makeRequest())
    const body = await response.json()

    expect(body.items[0]).toMatchObject({
      orderNumber: 'ORDER-20261030-00002',
      quoteNumber: null,
      lineName: 'QA R5 Widget',
      actorName: 'Anna Rep',
    })
  })
})
