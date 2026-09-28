const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444'
const CHILD_GROUP_ID = '55555555-5555-4555-8555-555555555555'
const PARENT_GROUP_ID = '66666666-6666-4666-8666-666666666666'

const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: (...args: unknown[]) => reportErrorMock(...args) }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import { GET } from '../route'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerGroup, CustomerGroupMembership, CustomerGroupTerms } from '../../../../data/entities'
import { DefaultCustomerGroupsService } from '../../../../services/customerGroupsService'

const mockAuth = getAuthFromRequest as jest.MockedFunction<typeof getAuthFromRequest>
const mockContainer = createRequestContainer as jest.MockedFunction<typeof createRequestContainer>

function request(customerId?: string) {
  const url = customerId
    ? `http://localhost/api/customer-groups/explain-terms?customerId=${customerId}`
    : 'http://localhost/api/customer-groups/explain-terms'
  return new Request(url)
}

const childGroup: Partial<CustomerGroup> = {
  id: CHILD_GROUP_ID,
  tenantId: TENANT_ID,
  code: 'retail',
  name: 'Retail',
  parentId: PARENT_GROUP_ID,
  deletedAt: null,
}

const parentGroup: Partial<CustomerGroup> = {
  id: PARENT_GROUP_ID,
  tenantId: TENANT_ID,
  code: 'wholesale',
  name: 'Wholesale',
  parentId: null,
  deletedAt: null,
}

function resolvedTermsFixture(overrides: {
  priceKindId?: string | null
  paymentTermsDays?: number | null
  allowPurchaseOnAccount?: boolean
  approvalRequiredAbove?: number | null
  minOrderValue?: number | null
  sources?: Partial<Record<
    'priceKindId' | 'paymentTermsDays' | 'allowPurchaseOnAccount' | 'approvalRequiredAbove' | 'minOrderValue',
    string | null
  >>
}) {
  return {
    priceKindId: overrides.priceKindId ?? null,
    paymentTermsDays: overrides.paymentTermsDays ?? null,
    allowPurchaseOnAccount: overrides.allowPurchaseOnAccount ?? false,
    approvalRequiredAbove: overrides.approvalRequiredAbove ?? null,
    minOrderValue: overrides.minOrderValue ?? null,
    sources: {
      priceKindId: null,
      paymentTermsDays: null,
      allowPurchaseOnAccount: null,
      approvalRequiredAbove: null,
      minOrderValue: null,
      ...overrides.sources,
    },
  }
}

function setupContainer({
  findOne,
  resolveGroups,
  resolveTerms,
}: {
  findOne: jest.Mock
  resolveGroups: jest.Mock
  resolveTerms: jest.Mock
}) {
  mockContainer.mockResolvedValue({
    resolve: (name: string) => {
      if (name === 'em') return { findOne }
      if (name === 'customerGroupsService') return { resolveGroups, resolveTerms }
      throw new Error(`unexpected resolve: ${name}`)
    },
  } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID } as never)
})

describe('GET /api/customer-groups/explain-terms', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValueOnce(null as never)
    const res = await GET(request(CUSTOMER_ID))
    expect(res.status).toBe(401)
  })

  it('returns 400 when tenant context is missing', async () => {
    mockAuth.mockResolvedValueOnce({ sub: USER_ID, tenantId: null, orgId: ORG_ID } as never)
    const res = await GET(request(CUSTOMER_ID))
    expect(res.status).toBe(400)
  })

  it('returns 400 when customerId is missing or not a uuid', async () => {
    const res = await GET(request())
    expect(res.status).toBe(400)

    const res2 = await GET(request('not-a-uuid'))
    expect(res2.status).toBe(400)
  })

  it('labels a field as "tenant default" (sourceGroupId null) with an empty path', async () => {
    const findOne = jest.fn(async () => null)
    const resolveGroups = jest.fn().mockResolvedValue({ groupIds: [], groups: [] })
    const resolveTerms = jest.fn().mockResolvedValue(resolvedTermsFixture({}))
    setupContainer({ findOne, resolveGroups, resolveTerms })

    const res = await GET(request(CUSTOMER_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.groups).toEqual([])
    expect(body.fields.priceKindId).toEqual({ value: null, sourceGroupId: null, path: [] })
    expect(resolveTerms).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, groupIds: [] }),
    )
  })

  it('reconstructs a single-group path when the field is set on the customer\'s own matching group', async () => {
    const findOne = jest.fn(async (_entity: unknown, where: { id: string }) =>
      where.id === CHILD_GROUP_ID ? childGroup : null,
    )
    const resolveGroups = jest.fn().mockResolvedValue({
      groupIds: [CHILD_GROUP_ID],
      groups: [{ id: CHILD_GROUP_ID, code: 'retail', name: 'Retail', kind: 'standard', priority: 10 }],
    })
    const resolveTerms = jest.fn().mockResolvedValue(
      resolvedTermsFixture({
        priceKindId: 'pk-1',
        sources: { priceKindId: CHILD_GROUP_ID },
      }),
    )
    setupContainer({ findOne, resolveGroups, resolveTerms })

    const res = await GET(request(CUSTOMER_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.groups).toEqual([{ id: CHILD_GROUP_ID, code: 'retail', name: 'Retail' }])
    expect(body.fields.priceKindId).toEqual({
      value: 'pk-1',
      sourceGroupId: CHILD_GROUP_ID,
      path: [{ id: CHILD_GROUP_ID, code: 'retail', name: 'Retail' }],
    })
  })

  it('reconstructs a child -> parent ancestor path when a field is inherited', async () => {
    const findOne = jest.fn(async (_entity: unknown, where: { id: string }) => {
      if (where.id === CHILD_GROUP_ID) return childGroup
      if (where.id === PARENT_GROUP_ID) return parentGroup
      return null
    })
    const resolveGroups = jest.fn().mockResolvedValue({
      groupIds: [CHILD_GROUP_ID],
      groups: [{ id: CHILD_GROUP_ID, code: 'retail', name: 'Retail', kind: 'standard', priority: 10 }],
    })
    const resolveTerms = jest.fn().mockResolvedValue(
      resolvedTermsFixture({
        paymentTermsDays: 45,
        sources: { paymentTermsDays: PARENT_GROUP_ID },
      }),
    )
    setupContainer({ findOne, resolveGroups, resolveTerms })

    const res = await GET(request(CUSTOMER_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fields.paymentTermsDays).toEqual({
      value: 45,
      sourceGroupId: PARENT_GROUP_ID,
      path: [
        { id: CHILD_GROUP_ID, code: 'retail', name: 'Retail' },
        { id: PARENT_GROUP_ID, code: 'wholesale', name: 'Wholesale' },
      ],
    })
  })

  it('picks the higher-priority chain\'s path when a field is inherited from a shared ancestor', async () => {
    const SIBLING_GROUP_ID = '77777777-7777-4777-8777-777777777777'
    const siblingGroup: Partial<CustomerGroup> = {
      id: SIBLING_GROUP_ID,
      tenantId: TENANT_ID,
      code: 'partner',
      name: 'Partner',
      parentId: PARENT_GROUP_ID,
      deletedAt: null,
    }
    const findOne = jest.fn(async (_entity: unknown, where: { id: string }) => {
      if (where.id === CHILD_GROUP_ID) return childGroup
      if (where.id === SIBLING_GROUP_ID) return siblingGroup
      if (where.id === PARENT_GROUP_ID) return parentGroup
      return null
    })
    // CHILD_GROUP_ID (priority 10) outranks SIBLING_GROUP_ID (priority 5); both share
    // PARENT_GROUP_ID as their parent. `resolveTerms` would have walked CHILD's chain
    // first and found the field on PARENT — the reconstructed path must follow CHILD's
    // chain, not SIBLING's, even though PARENT_GROUP_ID appears in both.
    const resolveGroups = jest.fn().mockResolvedValue({
      groupIds: [CHILD_GROUP_ID, SIBLING_GROUP_ID],
      groups: [
        { id: CHILD_GROUP_ID, code: 'retail', name: 'Retail', kind: 'standard', priority: 10 },
        { id: SIBLING_GROUP_ID, code: 'partner', name: 'Partner', kind: 'standard', priority: 5 },
      ],
    })
    const resolveTerms = jest.fn().mockResolvedValue(
      resolvedTermsFixture({
        minOrderValue: 100,
        sources: { minOrderValue: PARENT_GROUP_ID },
      }),
    )
    setupContainer({ findOne, resolveGroups, resolveTerms })

    const res = await GET(request(CUSTOMER_ID))
    const body = await res.json()
    expect(body.fields.minOrderValue.path).toEqual([
      { id: CHILD_GROUP_ID, code: 'retail', name: 'Retail' },
      { id: PARENT_GROUP_ID, code: 'wholesale', name: 'Wholesale' },
    ])
  })
  it('stops the explained path at a soft-deleted parent, agreeing with the real resolveTerms', async () => {
    // PARENT_GROUP_ID is soft-deleted (a `deletedAt: null` lookup misses it) while its
    // terms row survives. The route and the real service must both treat the chain as
    // ending at CHILD, so the field falls back to the tenant default with no path.
    const findOne = jest.fn(async (entity: unknown, where: { id?: string; groupId?: string }) => {
      if (entity === CustomerGroup) return where.id === CHILD_GROUP_ID ? childGroup : null
      if (entity === CustomerGroupTerms) {
        return where.groupId === PARENT_GROUP_ID
          ? { id: 'terms-parent', groupId: PARENT_GROUP_ID, tenantId: TENANT_ID, paymentTermsDays: 90, allowPurchaseOnAccount: true }
          : null
      }
      return null
    })
    const find = jest.fn(async (entity: unknown) => {
      if (entity === CustomerGroupMembership) {
        return [{ id: 'm-1', groupId: CHILD_GROUP_ID, customerId: CUSTOMER_ID, validFrom: null, validUntil: null, createdAt: new Date('2026-01-01T00:00:00.000Z') }]
      }
      if (entity === CustomerGroup) return [{ ...childGroup, priority: 10, kind: 'b2b', isActive: true }]
      return []
    })
    const em = { find, findOne }
    const service = new DefaultCustomerGroupsService(em as never)
    mockContainer.mockResolvedValue({
      resolve: (name: string) => {
        if (name === 'em') return em
        if (name === 'customerGroupsService') return service
        throw new Error(`unexpected resolve: ${name}`)
      },
    } as never)

    const res = await GET(request(CUSTOMER_ID))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fields.paymentTermsDays).toEqual({ value: null, sourceGroupId: null, path: [] })
    expect(body.fields.allowPurchaseOnAccount).toEqual({ value: false, sourceGroupId: null, path: [] })
  })

  it('returns 500 and reports the error when resolution fails unexpectedly', async () => {
    {
      const failure = new Error('db down')
      setupContainer({
        findOne: jest.fn(),
        resolveGroups: jest.fn().mockRejectedValue(failure),
        resolveTerms: jest.fn(),
      })

      const res = await GET(request(CUSTOMER_ID))

      expect(res.status).toBe(500)
      expect(reportErrorMock).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ module: 'customer_groups', code: 'customer_groups.terms_explain_failed' }),
      )
    }
  })
})
