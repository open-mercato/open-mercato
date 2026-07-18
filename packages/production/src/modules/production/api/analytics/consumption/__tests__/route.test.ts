/**
 * Route-level tenant/org scoping test (task 6.1 DoD). Asserts the
 * `ProductionOrder`, `ProductionOrderMaterial`, and `ProductionOrderOperation`
 * queries all receive tenantId/organizationId filters, and that the
 * standard-quantity scaling (review finding R1: qtyRequired * (1 +
 * scrapFactor) * consumedUnits) is correctly wired end-to-end from the
 * operation rows through to the response.
 */

import { NextRequest } from 'next/server'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { GET } from '../route'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

describe('GET /api/production/analytics/consumption scoping', () => {
  let findMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    findMock = jest.fn()
    findMock.mockImplementation(async (Entity: { name: string }) => {
      if (Entity.name === 'ProductionOrder') {
        return [{ id: 'order-1', number: 1 }]
      }
      return []
    })
    const em = { fork: jest.fn().mockReturnThis(), find: findMock }
    const container = { resolve: jest.fn().mockReturnValue(em) }
    ;(createRequestContainer as jest.Mock).mockResolvedValue(container)
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: ORG_ID,
      filterIds: [ORG_ID],
    })
  })

  it('scopes the order, material, and operation queries by tenantId/organizationId', async () => {
    const req = new NextRequest('http://localhost/api/production/analytics/consumption')
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(findMock).toHaveBeenCalledTimes(3)

    const [, orderWhere] = findMock.mock.calls[0]
    expect(orderWhere.tenantId).toBe(TENANT_ID)
    expect(orderWhere.organizationId).toEqual({ $in: [ORG_ID] })

    const [, materialWhere] = findMock.mock.calls[1]
    expect(materialWhere.tenantId).toBe(TENANT_ID)
    expect(materialWhere.organizationId).toEqual({ $in: [ORG_ID] })
    expect(materialWhere.orderId).toEqual({ $in: ['order-1'] })

    const [, operationWhere] = findMock.mock.calls[2]
    expect(operationWhere.tenantId).toBe(TENANT_ID)
    expect(operationWhere.organizationId).toEqual({ $in: [ORG_ID] })
    expect(operationWhere.orderId).toEqual({ $in: ['order-1'] })
  })

  it('skips the material and operation queries entirely when no orders match the scope (no cross-tenant leakage via empty $in)', async () => {
    findMock.mockImplementation(async () => [])
    const req = new NextRequest('http://localhost/api/production/analytics/consumption')
    await GET(req)
    expect(findMock).toHaveBeenCalledTimes(1)
  })

  it('scales standardQty by (1 + scrapFactor) * consumedUnits using the operation-pinned cumulative qtyGood+qtyScrap (end-to-end wiring, review R1)', async () => {
    findMock.mockImplementation(async (Entity: { name: string }) => {
      if (Entity.name === 'ProductionOrder') return [{ id: 'order-1', number: 1 }]
      if (Entity.name === 'ProductionOrderMaterial') {
        return [
          {
            orderId: 'order-1',
            componentProductId: 'component-1',
            componentVariantId: null,
            operationSequence: 1,
            qtyRequired: '2',
            scrapFactor: '0.5',
            qtyIssued: '15',
          },
        ]
      }
      if (Entity.name === 'ProductionOrderOperation') {
        return [{ orderId: 'order-1', sequence: 1, isReportingPoint: true, qtyGood: '3', qtyScrap: '1' }]
      }
      return []
    })

    const req = new NextRequest('http://localhost/api/production/analytics/consumption')
    const res = await GET(req)
    const body = await res.json()

    // consumedUnits = 3 + 1 = 4; standard = 2 * 1.5 * 4 = 12; actual = 15 => variance = 3
    expect(body.lines).toHaveLength(1)
    expect(body.lines[0].standardQty).toBe(12)
    expect(body.lines[0].actualQty).toBe(15)
    expect(body.lines[0].varianceQty).toBe(3)
  })
})
