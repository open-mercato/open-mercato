const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444'

const resolveMock = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: (name: string) => resolveMock(name) }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => ({ sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID }),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => null,
}))
jest.mock('../../../lib/customerScope', () => ({
  organizationIdsFromScope: () => [ORG_ID],
  findCustomerInScope: async () => ({ organizationId: ORG_ID }),
}))

import { GET } from '../explain-terms/route'
import type { CustomerGroupsService, LegacyResolvedTerms } from '../../../services/customerGroupsService'

// A `customerGroupsService` DI override written before Release 5: `resolveTerms`
// returns none of the four Release 5 fields nor their `sources` entries.
const legacyTerms: LegacyResolvedTerms = {
  priceKindId: null,
  paymentTermsDays: 30,
  allowPurchaseOnAccount: true,
  approvalRequiredAbove: null,
  minOrderValue: null,
  sources: {
    priceKindId: null,
    paymentTermsDays: GROUP_ID,
    allowPurchaseOnAccount: GROUP_ID,
    approvalRequiredAbove: null,
    minOrderValue: null,
  },
}

const legacyOverride: CustomerGroupsService = {
  resolveGroups: async () => ({
    groupIds: [GROUP_ID],
    groups: [{ id: GROUP_ID, code: 'wholesale', name: 'Wholesale', kind: 'manual', priority: 10 }],
  }),
  resolveTerms: async () => legacyTerms,
  resolveAssortmentScope: async () => ({ scope: [], sourceGroupIds: [], sourceCustomerOverrideId: null }),
}

const group = {
  id: GROUP_ID,
  code: 'wholesale',
  name: 'Wholesale',
  isActive: true,
  parentId: null,
}

beforeEach(() => {
  resolveMock.mockImplementation((name: string) => {
    if (name === 'customerGroupsService') return legacyOverride
    if (name === 'em') return { findOne: jest.fn(async () => group) }
    throw new Error(`[internal] unexpected DI name ${name}`)
  })
})

describe('explain-terms with a pre-Release 5 customerGroupsService override', () => {
  it('serves the four Release 5 fields with their tenant defaults and provenance', async () => {
    const response = await GET(
      new Request(`http://localhost/api/customer_groups/customer-groups/explain-terms?customerId=${CUSTOMER_ID}`),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.fields.approvalPolicy).toEqual({ value: 'buyer', sourceGroupId: null, source: 'tenant_default', path: [] })
    expect(body.fields.termsCurrencyCode).toEqual({ value: null, sourceGroupId: null, source: 'tenant_default', path: [] })
    expect(body.fields.allowQuoteRequests).toEqual({ value: false, sourceGroupId: null, source: 'tenant_default', path: [] })
    expect(body.fields.requiresPoNumber).toEqual({ value: false, sourceGroupId: null, source: 'tenant_default', path: [] })
    expect(body.fields.paymentTermsDays).toEqual({
      value: 30,
      sourceGroupId: GROUP_ID,
      source: 'group',
      path: [{ id: GROUP_ID, code: 'wholesale', name: 'Wholesale' }],
    })
  })
})
