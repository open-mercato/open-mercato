import { DefaultCustomerGroupsService, loadCustomerGroupAncestorChain } from '../services/customerGroupsService'
import { CustomerGroup, CustomerGroupMembership, CustomerGroupTerms } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const CHILD_ID = '33333333-3333-4333-8333-333333333333'
const PARENT_ID = '44444444-4444-4444-8444-444444444444'
const GRANDPARENT_ID = '55555555-5555-4555-8555-555555555555'
const HIGH_PRIORITY_GROUP_ID = '66666666-6666-4666-8666-666666666666'
const LOW_PRIORITY_GROUP_ID = '77777777-7777-4777-8777-777777777777'
const DEFAULT_GROUP_ID = '88888888-8888-4888-8888-888888888888'

function makeGroup(overrides: Partial<CustomerGroup>): CustomerGroup {
  return {
    id: 'group-id',
    organizationId: null,
    tenantId: TENANT_ID,
    code: 'code',
    name: 'Name',
    description: null,
    kind: 'b2c',
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
    customerId: CUSTOMER_ID,
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
    approvalPolicy: null,
    termsCurrencyCode: null,
    allowQuoteRequests: null,
    requiresPoNumber: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerGroupTerms
}

// A single fake `EntityManager` that answers `find`/`findOne` by inspecting the
// entity class and query shape, rather than a strict `mockResolvedValueOnce` call
// sequence (as `resolveGroups.test.ts` uses) — `resolveTerms` issues a
// data-dependent number of `findOne` calls (ancestor walk depth varies per test),
// so a fixed call-order stub would be fragile. Keeps the same `makeGroup`/
// `makeMembership`-style plain-object fixtures as `resolveGroups.test.ts`.
function createEm(options: {
  memberships?: CustomerGroupMembership[]
  groups?: CustomerGroup[]
  terms?: CustomerGroupTerms[]
  defaultGroup?: CustomerGroup | null
}) {
  const groups = options.groups ?? []
  const groupsById = new Map(groups.map((group) => [group.id, group]))
  const termsByGroupId = new Map((options.terms ?? []).map((terms) => [terms.groupId, terms]))

  const find = jest.fn(async (entity: unknown, where: { id?: { $in?: string[] } }) => {
    if (entity === CustomerGroupMembership) return options.memberships ?? []
    if (entity === CustomerGroup) {
      const ids: string[] = where.id?.$in ?? []
      return groups.filter((group) => ids.includes(group.id))
    }
    throw new Error(`unexpected em.find call for ${String(entity)}`)
  })

  const findOne = jest.fn(async (entity: unknown, where: { id?: string; isDefault?: boolean; groupId?: string }) => {
    if (entity === CustomerGroup) {
      if (where.isDefault) return options.defaultGroup ?? null
      return groupsById.get(where.id ?? '') ?? null
    }
    if (entity === CustomerGroupTerms) {
      return termsByGroupId.get(where.groupId ?? '') ?? null
    }
    throw new Error(`unexpected em.findOne call for ${String(entity)}`)
  })

  return { find, findOne }
}

describe('DefaultCustomerGroupsService.resolveTerms', () => {
  it('resolves a field from a grandparent when the child and parent are both unset (3-level hierarchy)', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 30, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 20, parentId: GRANDPARENT_ID }),
      makeGroup({ id: GRANDPARENT_ID, code: 'grandparent', name: 'Grandparent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: GRANDPARENT_ID, paymentTermsDays: 30 }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.paymentTermsDays).toBe(30)
    expect(result.sources.paymentTermsDays).toBe(GRANDPARENT_ID)
  })

  it("uses the child group's own value immediately, without needing to inspect ancestors", async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 10, parentId: null })]
    const priceKindId = '99999999-9999-4999-8999-999999999999'
    const terms = [makeTerms({ groupId: CHILD_ID, priceKindId })]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.priceKindId).toBe(priceKindId)
    expect(result.sources.priceKindId).toBe(CHILD_ID)
  })

  it('falls through to a lower-priority group when the highest-priority group and its ancestors are all unset', async () => {
    const memberships = [
      makeMembership({ id: 'm-high', groupId: HIGH_PRIORITY_GROUP_ID, createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      makeMembership({ id: 'm-low', groupId: LOW_PRIORITY_GROUP_ID, createdAt: new Date('2026-01-02T00:00:00.000Z') }),
    ]
    const groups = [
      makeGroup({ id: HIGH_PRIORITY_GROUP_ID, code: 'high', name: 'High', priority: 50, parentId: null }),
      makeGroup({ id: LOW_PRIORITY_GROUP_ID, code: 'low', name: 'Low', priority: 10, parentId: null }),
    ]
    const priceKindId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const terms = [makeTerms({ groupId: LOW_PRIORITY_GROUP_ID, priceKindId })]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.priceKindId).toBe(priceKindId)
    expect(result.sources.priceKindId).toBe(LOW_PRIORITY_GROUP_ID)
  })

  it('resolves to tenant defaults, every source null, when the customer has no matching group and no default group exists', async () => {
    const em = createEm({ memberships: [] })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result).toEqual({
      priceKindId: null,
      paymentTermsDays: null,
      allowPurchaseOnAccount: false,
      approvalRequiredAbove: null,
      minOrderValue: null,
      approvalPolicy: 'buyer',
      termsCurrencyCode: null,
      allowQuoteRequests: false,
      requiresPoNumber: false,
      sources: {
        priceKindId: null,
        paymentTermsDays: null,
        allowPurchaseOnAccount: null,
        approvalRequiredAbove: null,
        minOrderValue: null,
        approvalPolicy: null,
        termsCurrencyCode: null,
        allowQuoteRequests: null,
        requiresPoNumber: null,
      },
    })
    expect(em.findOne).toHaveBeenCalledTimes(1)
    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ isDefault: true, tenantId: TENANT_ID }))
  })

  it('resolves the nullable fields to tenant defaults when a matched group and every ancestor have terms rows with all-null fields', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 10, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 5, parentId: null }),
    ]
    const terms = [makeTerms({ groupId: CHILD_ID }), makeTerms({ groupId: PARENT_ID })]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.priceKindId).toBeNull()
    expect(result.paymentTermsDays).toBeNull()
    expect(result.approvalRequiredAbove).toBeNull()
    expect(result.minOrderValue).toBeNull()
    expect(result.sources.priceKindId).toBeNull()
    expect(result.sources.paymentTermsDays).toBeNull()
    expect(result.sources.approvalRequiredAbove).toBeNull()
    expect(result.sources.minOrderValue).toBeNull()
    expect(result.allowPurchaseOnAccount).toBe(false)
    expect(result.sources.allowPurchaseOnAccount).toBeNull()
  })

  it('inherits allowPurchaseOnAccount from the parent when the child row leaves it unset', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 20, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: CHILD_ID, paymentTermsDays: 14, allowPurchaseOnAccount: null }),
      makeTerms({ groupId: PARENT_ID, allowPurchaseOnAccount: true }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.paymentTermsDays).toBe(14)
    expect(result.sources.paymentTermsDays).toBe(CHILD_ID)
    expect(result.allowPurchaseOnAccount).toBe(true)
    expect(result.sources.allowPurchaseOnAccount).toBe(PARENT_ID)
  })

  it('lets an explicit false on the child override an inherited true', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 20, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: CHILD_ID, allowPurchaseOnAccount: false }),
      makeTerms({ groupId: PARENT_ID, allowPurchaseOnAccount: true }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.allowPurchaseOnAccount).toBe(false)
    expect(result.sources.allowPurchaseOnAccount).toBe(CHILD_ID)
  })

  it("resolves an anonymous customer's terms from the tenant default group's own row", async () => {
    const defaultGroup = makeGroup({ id: DEFAULT_GROUP_ID, code: 'default', name: 'Default', isDefault: true, priority: 0, parentId: null })
    const terms = [
      makeTerms({
        groupId: DEFAULT_GROUP_ID,
        allowPurchaseOnAccount: true,
        approvalRequiredAbove: '500.00',
        minOrderValue: '25.50',
      }),
    ]
    const em = createEm({ defaultGroup, groups: [defaultGroup], terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: null, tenantId: TENANT_ID })

    expect(result.allowPurchaseOnAccount).toBe(true)
    expect(result.approvalRequiredAbove).toBe(500)
    expect(result.minOrderValue).toBe(25.5)
    expect(result.sources.allowPurchaseOnAccount).toBe(DEFAULT_GROUP_ID)
    expect(result.sources.approvalRequiredAbove).toBe(DEFAULT_GROUP_ID)
    expect(result.sources.minOrderValue).toBe(DEFAULT_GROUP_ID)
  })

  it('resolves an anonymous customer straight to tenant defaults when no default group exists', async () => {
    const em = createEm({ defaultGroup: null })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: null, tenantId: TENANT_ID })

    expect(result).toEqual({
      priceKindId: null,
      paymentTermsDays: null,
      allowPurchaseOnAccount: false,
      approvalRequiredAbove: null,
      minOrderValue: null,
      approvalPolicy: 'buyer',
      termsCurrencyCode: null,
      allowQuoteRequests: false,
      requiresPoNumber: false,
      sources: {
        priceKindId: null,
        paymentTermsDays: null,
        allowPurchaseOnAccount: null,
        approvalRequiredAbove: null,
        minOrderValue: null,
        approvalPolicy: null,
        termsCurrencyCode: null,
        allowQuoteRequests: null,
        requiresPoNumber: null,
      },
    })
  })

  it('inherits approvalPolicy from the parent when the child row leaves it unset, defaulting to "buyer" with no matching group at all (D-R5-1)', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 20, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: CHILD_ID, approvalPolicy: null }),
      makeTerms({ groupId: PARENT_ID, approvalPolicy: 'both' }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.approvalPolicy).toBe('both')
    expect(result.sources.approvalPolicy).toBe(PARENT_ID)
  })

  // Step 5.1 (checkout B.5, D-R5-20/D-R5-28): `allowQuoteRequests`/`requiresPoNumber`
  // resolve through the exact same per-field inheritance as `allowPurchaseOnAccount` —
  // tenant default `false`, no base-currency-style fallback step of their own.
  it('inherits allowQuoteRequests from the parent when the child row leaves it unset (D-R5-20)', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 20, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: CHILD_ID, allowQuoteRequests: null }),
      makeTerms({ groupId: PARENT_ID, allowQuoteRequests: true }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.allowQuoteRequests).toBe(true)
    expect(result.sources.allowQuoteRequests).toBe(PARENT_ID)
  })

  it('lets an explicit false on the child override an inherited allowQuoteRequests true', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 20, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: CHILD_ID, allowQuoteRequests: false }),
      makeTerms({ groupId: PARENT_ID, allowQuoteRequests: true }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.allowQuoteRequests).toBe(false)
    expect(result.sources.allowQuoteRequests).toBe(CHILD_ID)
  })

  it('inherits requiresPoNumber from the parent when the child row leaves it unset (D-R5-28)', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 20, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: CHILD_ID, requiresPoNumber: null }),
      makeTerms({ groupId: PARENT_ID, requiresPoNumber: true }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.requiresPoNumber).toBe(true)
    expect(result.sources.requiresPoNumber).toBe(PARENT_ID)
  })

  // Step 3.1 (D-R5-4/D-R5-37): `termsCurrencyCode` resolves through the same per-field
  // inheritance as every other scalar term, PLUS a base-currency fallback when the whole
  // chain leaves it unset.
  it('inherits termsCurrencyCode from the parent when the child row leaves it unset', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 20, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: CHILD_ID, termsCurrencyCode: null }),
      makeTerms({ groupId: PARENT_ID, termsCurrencyCode: 'EUR' }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.termsCurrencyCode).toBe('EUR')
    expect(result.sources.termsCurrencyCode).toBe(PARENT_ID)
  })

  it('falls back to the organization base currency when no group sets termsCurrencyCode (D-R5-37)', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 10, parentId: null })]
    const terms = [makeTerms({ groupId: CHILD_ID })]
    const em = createEm({ memberships, groups, terms })
    const organizationId = 'cccccccc-0000-4000-8000-000000000001'
    const baseCurrencyService = {
      resolveBaseCurrency: jest.fn(async () => ({ status: 'resolved' as const, code: 'USD' })),
    }
    const service = new DefaultCustomerGroupsService(em as never, baseCurrencyService as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, organizationId })

    expect(result.termsCurrencyCode).toBe('USD')
    expect(result.sources.termsCurrencyCode).toBe('base_currency')
    expect(baseCurrencyService.resolveBaseCurrency).toHaveBeenCalledWith({ tenantId: TENANT_ID, organizationIds: [organizationId] })
  })

  it('leaves termsCurrencyCode null (fail-closed, D-R5-4) when the organization has no base currency', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 10, parentId: null })]
    const terms = [makeTerms({ groupId: CHILD_ID })]
    const em = createEm({ memberships, groups, terms })
    const organizationId = 'cccccccc-0000-4000-8000-000000000002'
    const baseCurrencyService = {
      resolveBaseCurrency: jest.fn(async () => ({ status: 'missing' as const })),
    }
    const service = new DefaultCustomerGroupsService(em as never, baseCurrencyService as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, organizationId })

    expect(result.termsCurrencyCode).toBeNull()
    expect(result.sources.termsCurrencyCode).toBeNull()
  })

  it('leaves termsCurrencyCode null when no organizationId is supplied, even with a base-currency service available', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 10, parentId: null })]
    const terms = [makeTerms({ groupId: CHILD_ID })]
    const em = createEm({ memberships, groups, terms })
    const baseCurrencyService = {
      resolveBaseCurrency: jest.fn(async () => ({ status: 'resolved' as const, code: 'USD' })),
    }
    const service = new DefaultCustomerGroupsService(em as never, baseCurrencyService as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.termsCurrencyCode).toBeNull()
    expect(baseCurrencyService.resolveBaseCurrency).not.toHaveBeenCalled()
  })

  it('does not call the base-currency fallback when a group already sets termsCurrencyCode', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 10, parentId: null })]
    const terms = [makeTerms({ groupId: CHILD_ID, termsCurrencyCode: 'PLN' })]
    const em = createEm({ memberships, groups, terms })
    const organizationId = 'cccccccc-0000-4000-8000-000000000003'
    const baseCurrencyService = {
      resolveBaseCurrency: jest.fn(async () => ({ status: 'resolved' as const, code: 'USD' })),
    }
    const service = new DefaultCustomerGroupsService(em as never, baseCurrencyService as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, organizationId })

    expect(result.termsCurrencyCode).toBe('PLN')
    expect(result.sources.termsCurrencyCode).toBe(CHILD_ID)
    expect(baseCurrencyService.resolveBaseCurrency).not.toHaveBeenCalled()
  })

  it('resolves different fields on the same object from different groups in the hierarchy independently', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 30, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 20, parentId: GRANDPARENT_ID }),
      makeGroup({ id: GRANDPARENT_ID, code: 'grandparent', name: 'Grandparent', priority: 10, parentId: null }),
    ]
    const priceKindId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const terms = [
      makeTerms({ groupId: CHILD_ID, priceKindId }),
      makeTerms({ groupId: GRANDPARENT_ID, paymentTermsDays: 45 }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.priceKindId).toBe(priceKindId)
    expect(result.sources.priceKindId).toBe(CHILD_ID)
    expect(result.paymentTermsDays).toBe(45)
    expect(result.sources.paymentTermsDays).toBe(GRANDPARENT_ID)
    // No row sets `allowPurchaseOnAccount`, so it falls through to the tenant default.
    expect(result.allowPurchaseOnAccount).toBe(false)
    expect(result.sources.allowPurchaseOnAccount).toBeNull()
  })

  it('accepts pre-resolved groupIds and skips the membership-resolution query', async () => {
    const groups = [makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 10, parentId: null })]
    const priceKindId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const terms = [makeTerms({ groupId: CHILD_ID, priceKindId })]
    const em = createEm({ groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, groupIds: [CHILD_ID] })

    expect(result.priceKindId).toBe(priceKindId)
    expect(result.sources.priceKindId).toBe(CHILD_ID)
    expect(em.find).not.toHaveBeenCalled()
  })
  it('stops the ancestor walk at a soft-deleted parent, so its surviving terms row is never inherited', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    // PARENT_ID is soft-deleted: `findOne(..., { deletedAt: null })` no longer returns
    // it (it is left out of `groups`), but its terms row was never deleted.
    const groups = [makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 10, parentId: PARENT_ID })]
    const terms = [makeTerms({ groupId: PARENT_ID, paymentTermsDays: 60, allowPurchaseOnAccount: true })]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.paymentTermsDays).toBeNull()
    expect(result.sources.paymentTermsDays).toBeNull()
    expect(result.allowPurchaseOnAccount).toBe(false)
    expect(result.sources.allowPurchaseOnAccount).toBeNull()
    expect(em.findOne).not.toHaveBeenCalledWith(CustomerGroupTerms, expect.objectContaining({ groupId: PARENT_ID }))
  })

  it('stops the ancestor walk at an inactive parent, so neither it nor its ancestors pass terms down', async () => {
    const memberships = [makeMembership({ id: 'm-child', groupId: CHILD_ID })]
    const groups = [
      makeGroup({ id: CHILD_ID, code: 'child', name: 'Child', priority: 30, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, code: 'parent', name: 'Parent', priority: 20, parentId: GRANDPARENT_ID, isActive: false }),
      makeGroup({ id: GRANDPARENT_ID, code: 'grandparent', name: 'Grandparent', priority: 10, parentId: null }),
    ]
    const terms = [
      makeTerms({ groupId: PARENT_ID, paymentTermsDays: 60 }),
      makeTerms({ groupId: GRANDPARENT_ID, minOrderValue: '500.00' }),
    ]
    const em = createEm({ memberships, groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.paymentTermsDays).toBeNull()
    expect(result.sources.paymentTermsDays).toBeNull()
    expect(result.minOrderValue).toBeNull()
    expect(result.sources.minOrderValue).toBeNull()
    expect(em.findOne).not.toHaveBeenCalledWith(CustomerGroupTerms, expect.objectContaining({ groupId: PARENT_ID }))
    expect(em.findOne).not.toHaveBeenCalledWith(CustomerGroup, expect.objectContaining({ id: GRANDPARENT_ID }))
  })

  it('ignores a caller-supplied group id that is inactive', async () => {
    const groups = [makeGroup({ id: CHILD_ID, isActive: false })]
    const terms = [makeTerms({ groupId: CHILD_ID, paymentTermsDays: 15 })]
    const em = createEm({ groups, terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, groupIds: [CHILD_ID] })

    expect(result.paymentTermsDays).toBeNull()
    expect(result.sources.paymentTermsDays).toBeNull()
  })

  it('ignores a caller-supplied group id that no longer resolves (soft-deleted)', async () => {
    const terms = [makeTerms({ groupId: CHILD_ID, paymentTermsDays: 15 })]
    const em = createEm({ groups: [], terms })
    const service = new DefaultCustomerGroupsService(em as never)

    const result = await service.resolveTerms({ customerId: CUSTOMER_ID, tenantId: TENANT_ID, groupIds: [CHILD_ID] })

    expect(result.paymentTermsDays).toBeNull()
    expect(result.sources.paymentTermsDays).toBeNull()
  })
})

describe('loadCustomerGroupAncestorChain', () => {
  it('returns self then ancestors, tenant- and deletion-scoped', async () => {
    const groups = [
      makeGroup({ id: CHILD_ID, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, parentId: GRANDPARENT_ID }),
      makeGroup({ id: GRANDPARENT_ID, parentId: null }),
    ]
    const em = createEm({ groups })

    const chain = await loadCustomerGroupAncestorChain(em as never, CHILD_ID, TENANT_ID)

    expect(chain.map((group) => group.id)).toEqual([CHILD_ID, PARENT_ID, GRANDPARENT_ID])
    expect(em.findOne).toHaveBeenCalledWith(CustomerGroup, { id: PARENT_ID, tenantId: TENANT_ID, deletedAt: null })
  })

  it('stops before a missing (soft-deleted) parent instead of including its id', async () => {
    const groups = [
      makeGroup({ id: CHILD_ID, parentId: PARENT_ID }),
      makeGroup({ id: GRANDPARENT_ID, parentId: null }),
    ]
    const em = createEm({ groups })

    const chain = await loadCustomerGroupAncestorChain(em as never, CHILD_ID, TENANT_ID)

    expect(chain.map((group) => group.id)).toEqual([CHILD_ID])
  })

  it('stops before an inactive parent instead of including it or anything above it', async () => {
    const groups = [
      makeGroup({ id: CHILD_ID, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, parentId: GRANDPARENT_ID, isActive: false }),
      makeGroup({ id: GRANDPARENT_ID, parentId: null }),
    ]
    const em = createEm({ groups })

    const chain = await loadCustomerGroupAncestorChain(em as never, CHILD_ID, TENANT_ID)

    expect(chain.map((group) => group.id)).toEqual([CHILD_ID])
  })

  it('returns an empty chain for an inactive starting group', async () => {
    const em = createEm({ groups: [makeGroup({ id: CHILD_ID, isActive: false })] })

    const chain = await loadCustomerGroupAncestorChain(em as never, CHILD_ID, TENANT_ID)

    expect(chain).toEqual([])
  })

  it('caps a cyclic parent graph at the depth limit', async () => {
    const groups = [
      makeGroup({ id: CHILD_ID, parentId: PARENT_ID }),
      makeGroup({ id: PARENT_ID, parentId: CHILD_ID }),
    ]
    const em = createEm({ groups })

    const chain = await loadCustomerGroupAncestorChain(em as never, CHILD_ID, TENANT_ID)

    expect(chain).toHaveLength(5)
  })
})
