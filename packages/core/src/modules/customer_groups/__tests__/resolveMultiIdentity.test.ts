import * as catalogVisibility from '@open-mercato/shared/lib/catalog-visibility'
import { DefaultCustomerGroupsService, resolveEffectiveCustomerIds } from '../services/customerGroupsService'
import { CustomerGroup, CustomerGroupMembership, CustomerGroupTerms } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const PERSON_ID = '22222222-2222-4222-8222-222222222222'
const COMPANY_ID = '33333333-3333-4333-8333-333333333333'
const PERSON_GROUP_ID = '44444444-4444-4444-8444-444444444444'
const COMPANY_GROUP_ID = '55555555-5555-4555-8555-555555555555'
const SHARED_GROUP_ID = '66666666-6666-4666-8666-666666666666'
const DEFAULT_GROUP_ID = '77777777-7777-4777-8777-777777777777'
const PERSON_PRICE_KIND_ID = '88888888-8888-4888-8888-888888888888'
const COMPANY_PRICE_KIND_ID = '99999999-9999-4999-8999-999999999999'

function makeGroup(overrides: Partial<CustomerGroup>): CustomerGroup {
  return {
    id: 'group-id',
    organizationId: null,
    tenantId: TENANT_ID,
    code: 'code',
    name: 'Name',
    description: null,
    kind: 'b2b',
    parentId: null,
    priority: 0,
    isDefault: false,
    isActive: true,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerGroup
}

function makeMembership(overrides: Partial<CustomerGroupMembership>): CustomerGroupMembership {
  return {
    id: 'membership-id',
    organizationId: null,
    tenantId: TENANT_ID,
    groupId: 'group-id',
    customerId: PERSON_ID,
    source: 'manual',
    validFrom: null,
    validUntil: null,
    assignedByUserId: null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerGroupMembership
}

function makeTerms(overrides: Partial<CustomerGroupTerms> & { groupId: string }): CustomerGroupTerms {
  return {
    id: 'terms-id',
    organizationId: null,
    tenantId: TENANT_ID,
    priceKindId: null,
    paymentTermsDays: null,
    allowPurchaseOnAccount: null,
    defaultCreditLimit: null,
    creditCurrencyCode: null,
    approvalRequiredAbove: null,
    minOrderValue: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerGroupTerms
}

type MembershipWhere = { customerId?: string | { $in?: string[] } }
type GroupWhere = { id?: { $in?: string[] } }

function createEm(options: {
  memberships?: CustomerGroupMembership[]
  groups?: CustomerGroup[]
  terms?: CustomerGroupTerms[]
  defaultGroup?: CustomerGroup | null
}) {
  const groups = options.groups ?? []
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const termsByGroupId = new Map((options.terms ?? []).map((terms) => [terms.groupId, terms]))

  const find = jest.fn(async (entity: unknown, where: MembershipWhere & GroupWhere) => {
    if (entity === CustomerGroupMembership) {
      const filter = where.customerId
      const ids = typeof filter === 'string' ? [filter] : filter?.$in ?? []
      return (options.memberships ?? []).filter((membership) => ids.includes(membership.customerId))
    }
    if (entity === CustomerGroup) {
      const ids: string[] = where.id?.$in ?? []
      return groups.filter((group) => ids.includes(group.id) && group.isActive)
    }
    throw new Error(`unexpected em.find call for ${String(entity)}`)
  })

  const findOne = jest.fn(async (entity: unknown, where: { id?: string; isDefault?: boolean; groupId?: string }) => {
    if (entity === CustomerGroup) {
      if (where.isDefault) return options.defaultGroup ?? null
      return groupsById.get(where.id ?? '') ?? null
    }
    if (entity === CustomerGroupTerms) return termsByGroupId.get(where.groupId ?? '') ?? null
    throw new Error(`unexpected em.findOne call for ${String(entity)}`)
  })

  return { find, findOne }
}

describe('resolveEffectiveCustomerIds', () => {
  it('prefers distinct non-empty customerIds over customerId', () => {
    expect(resolveEffectiveCustomerIds({ customerId: COMPANY_ID, customerIds: [PERSON_ID, COMPANY_ID, PERSON_ID] }))
      .toEqual([PERSON_ID, COMPANY_ID])
  })

  it('falls back to customerId when customerIds is empty or absent', () => {
    expect(resolveEffectiveCustomerIds({ customerId: PERSON_ID, customerIds: [] })).toEqual([PERSON_ID])
    expect(resolveEffectiveCustomerIds({ customerId: PERSON_ID })).toEqual([PERSON_ID])
  })

  it('returns no ids for an anonymous buyer', () => {
    expect(resolveEffectiveCustomerIds({ customerId: null })).toEqual([])
    expect(resolveEffectiveCustomerIds({ customerId: null, customerIds: [] })).toEqual([])
  })
})

describe('DefaultCustomerGroupsService multi-identity resolution', () => {
  it('unions the memberships of the person and the company', async () => {
    const em = createEm({
      memberships: [
        makeMembership({ id: 'm-person', groupId: PERSON_GROUP_ID, customerId: PERSON_ID }),
        makeMembership({ id: 'm-company', groupId: COMPANY_GROUP_ID, customerId: COMPANY_ID }),
      ],
      groups: [
        makeGroup({ id: PERSON_GROUP_ID, code: 'person', priority: 10 }),
        makeGroup({ id: COMPANY_GROUP_ID, code: 'company', priority: 20 }),
      ],
    })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveGroups({ customerId: PERSON_ID, customerIds: [PERSON_ID, COMPANY_ID], tenantId: TENANT_ID })

    expect(result.groupIds).toEqual([COMPANY_GROUP_ID, PERSON_GROUP_ID])
    expect(em.find).toHaveBeenCalledWith(
      CustomerGroupMembership,
      expect.objectContaining({ tenantId: TENANT_ID, customerId: { $in: [PERSON_ID, COMPANY_ID] } }),
    )
  })

  it("orders the person's membership before the company's on equal priority, even when the company's is newer", async () => {
    const em = createEm({
      memberships: [
        makeMembership({ id: 'm-company', groupId: COMPANY_GROUP_ID, customerId: COMPANY_ID, createdAt: new Date('2026-06-01T00:00:00.000Z') }),
        makeMembership({ id: 'm-person', groupId: PERSON_GROUP_ID, customerId: PERSON_ID, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      ],
      groups: [
        makeGroup({ id: COMPANY_GROUP_ID, code: 'company', priority: 10 }),
        makeGroup({ id: PERSON_GROUP_ID, code: 'person', priority: 10 }),
      ],
    })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveGroups({ customerId: PERSON_ID, customerIds: [PERSON_ID, COMPANY_ID], tenantId: TENANT_ID })

    expect(result.groupIds).toEqual([PERSON_GROUP_ID, COMPANY_GROUP_ID])
  })

  it('dedupes a group reached through both ids and ranks it by its best membership', async () => {
    const em = createEm({
      memberships: [
        makeMembership({ id: 'm-company-shared', groupId: SHARED_GROUP_ID, customerId: COMPANY_ID, createdAt: new Date('2026-06-01T00:00:00.000Z') }),
        makeMembership({ id: 'm-company-only', groupId: COMPANY_GROUP_ID, customerId: COMPANY_ID, createdAt: new Date('2026-07-01T00:00:00.000Z') }),
        makeMembership({ id: 'm-person-shared', groupId: SHARED_GROUP_ID, customerId: PERSON_ID, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      ],
      groups: [
        makeGroup({ id: SHARED_GROUP_ID, code: 'shared', priority: 10 }),
        makeGroup({ id: COMPANY_GROUP_ID, code: 'company', priority: 10 }),
      ],
    })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveGroups({ customerId: PERSON_ID, customerIds: [PERSON_ID, COMPANY_ID], tenantId: TENANT_ID })

    expect(result.groupIds).toEqual([SHARED_GROUP_ID, COMPANY_GROUP_ID])
    expect(result.groups.map((group) => group.id)).toEqual([SHARED_GROUP_ID, COMPANY_GROUP_ID])
  })

  it('applies the default group only when neither id has an effective membership', async () => {
    const defaultGroup = makeGroup({ id: DEFAULT_GROUP_ID, code: 'default', isDefault: true })
    const em = createEm({
      memberships: [
        makeMembership({ id: 'm-expired', groupId: PERSON_GROUP_ID, customerId: PERSON_ID, validUntil: new Date('2026-01-01T00:00:00.000Z') }),
        makeMembership({ id: 'm-inactive', groupId: COMPANY_GROUP_ID, customerId: COMPANY_ID }),
      ],
      groups: [
        makeGroup({ id: PERSON_GROUP_ID, code: 'person', priority: 10 }),
        makeGroup({ id: COMPANY_GROUP_ID, code: 'company', priority: 20, isActive: false }),
      ],
      defaultGroup,
    })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveGroups({
      customerId: PERSON_ID,
      customerIds: [PERSON_ID, COMPANY_ID],
      tenantId: TENANT_ID,
      at: new Date('2026-06-01T00:00:00.000Z'),
    })

    expect(result.groupIds).toEqual([DEFAULT_GROUP_ID])
  })

  it('does not apply the default group when only the company has an effective membership', async () => {
    const em = createEm({
      memberships: [makeMembership({ id: 'm-company', groupId: COMPANY_GROUP_ID, customerId: COMPANY_ID })],
      groups: [makeGroup({ id: COMPANY_GROUP_ID, code: 'company', priority: 20 })],
      defaultGroup: makeGroup({ id: DEFAULT_GROUP_ID, code: 'default', isDefault: true }),
    })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveGroups({ customerId: PERSON_ID, customerIds: [PERSON_ID, COMPANY_ID], tenantId: TENANT_ID })

    expect(result.groupIds).toEqual([COMPANY_GROUP_ID])
    expect(em.findOne).not.toHaveBeenCalled()
  })

  it('keeps the legacy single customerId query shape unchanged', async () => {
    const em = createEm({
      memberships: [makeMembership({ id: 'm-person', groupId: PERSON_GROUP_ID, customerId: PERSON_ID })],
      groups: [makeGroup({ id: PERSON_GROUP_ID, code: 'person', priority: 10 })],
    })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveGroups({ customerId: PERSON_ID, tenantId: TENANT_ID })

    expect(result.groupIds).toEqual([PERSON_GROUP_ID])
    expect(em.find).toHaveBeenCalledWith(
      CustomerGroupMembership,
      { tenantId: TENANT_ID, customerId: PERSON_ID, deletedAt: null },
    )
  })

  it('treats an anonymous buyer with empty customerIds as anonymous', async () => {
    const em = createEm({ defaultGroup: makeGroup({ id: DEFAULT_GROUP_ID, code: 'default', isDefault: true }) })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveGroups({ customerId: null, customerIds: [], tenantId: TENANT_ID })

    expect(result.groupIds).toEqual([DEFAULT_GROUP_ID])
    expect(em.find).not.toHaveBeenCalled()
  })

  it('resolves terms over the multi-id group union with per-field sources', async () => {
    const em = createEm({
      memberships: [
        makeMembership({ id: 'm-person', groupId: PERSON_GROUP_ID, customerId: PERSON_ID }),
        makeMembership({ id: 'm-company', groupId: COMPANY_GROUP_ID, customerId: COMPANY_ID }),
      ],
      groups: [
        makeGroup({ id: PERSON_GROUP_ID, code: 'person', priority: 10 }),
        makeGroup({ id: COMPANY_GROUP_ID, code: 'company', priority: 10 }),
      ],
      terms: [
        makeTerms({ groupId: PERSON_GROUP_ID, priceKindId: PERSON_PRICE_KIND_ID }),
        makeTerms({ groupId: COMPANY_GROUP_ID, priceKindId: COMPANY_PRICE_KIND_ID, paymentTermsDays: 30 }),
      ],
    })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: PERSON_ID, customerIds: [PERSON_ID, COMPANY_ID], tenantId: TENANT_ID })

    expect(result.priceKindId).toBe(PERSON_PRICE_KIND_ID)
    expect(result.sources.priceKindId).toBe(PERSON_GROUP_ID)
    expect(result.paymentTermsDays).toBe(30)
    expect(result.sources.paymentTermsDays).toBe(COMPANY_GROUP_ID)
  })

  it('lists every contributing group of both ids as assortment sources', async () => {
    const unionScopesSpy = jest.spyOn(catalogVisibility, 'unionScopes')
    const em = createEm({
      memberships: [
        makeMembership({ id: 'm-person', groupId: PERSON_GROUP_ID, customerId: PERSON_ID }),
        makeMembership({ id: 'm-company', groupId: COMPANY_GROUP_ID, customerId: COMPANY_ID }),
        makeMembership({ id: 'm-company-shared', groupId: SHARED_GROUP_ID, customerId: COMPANY_ID }),
        makeMembership({ id: 'm-person-shared', groupId: SHARED_GROUP_ID, customerId: PERSON_ID }),
      ],
      groups: [
        makeGroup({ id: PERSON_GROUP_ID, code: 'person', priority: 10 }),
        makeGroup({ id: COMPANY_GROUP_ID, code: 'company', priority: 30 }),
        makeGroup({ id: SHARED_GROUP_ID, code: 'shared', priority: 20 }),
      ],
    })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveAssortmentScope({
      customerId: PERSON_ID,
      customerIds: [PERSON_ID, COMPANY_ID],
      tenantId: TENANT_ID,
    })

    expect(result.sourceGroupIds).toEqual([COMPANY_GROUP_ID, SHARED_GROUP_ID, PERSON_GROUP_ID])
    expect(result.sourceCustomerOverrideId).toBeNull()
    expect(unionScopesSpy).toHaveBeenCalledWith([null, null, null])
    unionScopesSpy.mockRestore()
  })
})
