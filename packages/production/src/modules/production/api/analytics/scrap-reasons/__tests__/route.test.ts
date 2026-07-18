/**
 * Route-level tenant/org scoping test (task 6.1 DoD). Asserts both the
 * `ProductionReport` aggregation query and the `DictionaryEntry` label
 * lookup receive tenantId/organizationId filters.
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

describe('GET /api/production/analytics/scrap-reasons scoping', () => {
  let findMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    findMock = jest.fn()
    findMock.mockImplementation(async (Entity: { name: string }) => {
      if (Entity.name === 'ProductionReport') {
        return [
          { scrapReasonEntryId: 'reason-1', qtyScrap: '3' },
          { scrapReasonEntryId: null, qtyScrap: '2' },
        ]
      }
      return [{ id: 'reason-1', label: 'Material defect' }]
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

  it('scopes both the report aggregation query and the dictionary-entry label lookup', async () => {
    const req = new NextRequest('http://localhost/api/production/analytics/scrap-reasons')
    const res = await GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(findMock).toHaveBeenCalledTimes(2)
    const [, reportWhere] = findMock.mock.calls[0]
    expect(reportWhere.tenantId).toBe(TENANT_ID)
    expect(reportWhere.organizationId).toEqual({ $in: [ORG_ID] })

    const [, entryWhere] = findMock.mock.calls[1]
    expect(entryWhere.tenantId).toBe(TENANT_ID)
    expect(entryWhere.organizationId).toEqual({ $in: [ORG_ID] })
    expect(entryWhere.id).toEqual({ $in: ['reason-1'] })

    const unspecified = body.items.find((item: { scrapReasonEntryId: string }) => item.scrapReasonEntryId === 'unspecified')
    expect(unspecified.qtyScrap).toBe(2)
    const labeled = body.items.find((item: { scrapReasonEntryId: string }) => item.scrapReasonEntryId === 'reason-1')
    expect(labeled.label).toBe('Material defect')
  })
})
