import * as catalogVisibility from '@open-mercato/shared/lib/catalog-visibility'
import { matchesScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { AssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { DefaultCustomerGroupsService, normalizeAuthoredAssortmentScope } from '../services/customerGroupsService'
import { CustomerGroupTerms } from '../data/entities'
import type { CustomerGroup, CustomerGroupMembership } from '../data/entities'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '33333333-3333-4333-8333-333333333333'
const WHOLESALE_GROUP_ID = '44444444-4444-4444-8444-444444444444'
const PREVIEW_GROUP_ID = '55555555-5555-4555-8555-555555555555'
const CATEGORY_A_ID = '66666666-6666-4666-8666-666666666666'
const TAG_B_ID = '77777777-7777-4777-8777-777777777777'
const EXCLUDED_PRODUCT_ID = '88888888-8888-4888-8888-888888888888'

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

type TermsWhere = { groupId?: string; tenantId?: string }

function createScopedEm(options: {
  groups: CustomerGroup[]
  scopesByGroupId: Record<string, AssortmentScope | null | undefined>
}) {
  const memberships = options.groups.map((group) =>
    makeMembership({ id: `m-${group.id}`, groupId: group.id }),
  )
  return {
    find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce(options.groups),
    findOne: jest.fn(async (entity: unknown, where: TermsWhere) => {
      if (entity !== CustomerGroupTerms) return null
      if (where.tenantId !== TENANT_ID || !where.groupId) return null
      if (!Object.prototype.hasOwnProperty.call(options.scopesByGroupId, where.groupId)) return null
      return { id: `terms-${where.groupId}`, groupId: where.groupId, tenantId: TENANT_ID, assortmentScope: options.scopesByGroupId[where.groupId] }
    }),
  }
}

describe('normalizeAuthoredAssortmentScope', () => {
  it('drops empty id lists and treats a scope without restrictions as unrestricted', () => {
    expect(normalizeAuthoredAssortmentScope({ categoryIds: [CATEGORY_A_ID], tagIds: [] })).toEqual({ categoryIds: [CATEGORY_A_ID] })
    expect(normalizeAuthoredAssortmentScope({ categoryIds: [], excludeTagIds: [] })).toBeNull()
    expect(normalizeAuthoredAssortmentScope({})).toBeNull()
    expect(normalizeAuthoredAssortmentScope(null)).toBeNull()
    expect(normalizeAuthoredAssortmentScope(undefined)).toBeNull()
  })
})

describe('DefaultCustomerGroupsService.resolveAssortmentScope', () => {
  it('reads the matching group\'s own terms scope', async () => {
    const scope: AssortmentScope = { categoryIds: [CATEGORY_A_ID], excludeProductIds: [EXCLUDED_PRODUCT_ID] }
    const em = createScopedEm({
      groups: [makeGroup({ id: WHOLESALE_GROUP_ID, priority: 10 })],
      scopesByGroupId: { [WHOLESALE_GROUP_ID]: scope },
    })
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: [scope], sourceGroupIds: [WHOLESALE_GROUP_ID], sourceCustomerOverrideId: null })
    expect(em.findOne).toHaveBeenCalledWith(CustomerGroupTerms, { groupId: WHOLESALE_GROUP_ID, tenantId: TENANT_ID, deletedAt: null })
  })

  it('grants both a category-only and a tag-only product across two disjoint group scopes', async () => {
    const em = createScopedEm({
      groups: [
        makeGroup({ id: WHOLESALE_GROUP_ID, code: 'wholesale', priority: 10 }),
        makeGroup({ id: PREVIEW_GROUP_ID, code: 'preview', priority: 20 }),
      ],
      scopesByGroupId: {
        [WHOLESALE_GROUP_ID]: { categoryIds: [CATEGORY_A_ID] },
        [PREVIEW_GROUP_ID]: { tagIds: [TAG_B_ID] },
      },
    })
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.sourceGroupIds).toEqual([PREVIEW_GROUP_ID, WHOLESALE_GROUP_ID])
    expect(result.scope).toEqual([{ tagIds: [TAG_B_ID] }, { categoryIds: [CATEGORY_A_ID] }])
    expect(matchesScope({ id: 'category-only', categoryIds: [CATEGORY_A_ID], tagIds: [] }, result.scope)).toBe(true)
    expect(matchesScope({ id: 'tag-only', categoryIds: [], tagIds: [TAG_B_ID] }, result.scope)).toBe(true)
    expect(matchesScope({ id: 'neither', categoryIds: ['other-category'], tagIds: ['other-tag'] }, result.scope)).toBe(false)
  })

  it('treats a terms scope made only of empty lists as unrestricted', async () => {
    const em = createScopedEm({
      groups: [makeGroup({ id: WHOLESALE_GROUP_ID, priority: 10 })],
      scopesByGroupId: { [WHOLESALE_GROUP_ID]: { categoryIds: [], tagIds: [], excludeProductIds: [] } },
    })
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.scope).toBeNull()
  })

  it('treats a terms row without a scope as unrestricted', async () => {
    const em = createScopedEm({
      groups: [makeGroup({ id: WHOLESALE_GROUP_ID, priority: 10 })],
      scopesByGroupId: { [WHOLESALE_GROUP_ID]: null },
    })
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.scope).toBeNull()
  })

  it('makes the union unrestricted when one matching group has no terms row', async () => {
    const em = createScopedEm({
      groups: [
        makeGroup({ id: WHOLESALE_GROUP_ID, priority: 10 }),
        makeGroup({ id: PREVIEW_GROUP_ID, priority: 20 }),
      ],
      scopesByGroupId: { [WHOLESALE_GROUP_ID]: { categoryIds: [CATEGORY_A_ID] } },
    })
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.scope).toBeNull()
    expect(result.sourceGroupIds).toEqual([PREVIEW_GROUP_ID, WHOLESALE_GROUP_ID])
  })

  it('does not inherit an ancestor group\'s scope', async () => {
    const PARENT_GROUP_ID = '99999999-9999-4999-8999-999999999999'
    const em = createScopedEm({
      groups: [makeGroup({ id: WHOLESALE_GROUP_ID, parentId: PARENT_GROUP_ID, priority: 10 })],
      scopesByGroupId: { [PARENT_GROUP_ID]: { categoryIds: [CATEGORY_A_ID] } },
    })
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.scope).toBeNull()
    expect(em.findOne).not.toHaveBeenCalledWith(CustomerGroupTerms, expect.objectContaining({ groupId: PARENT_GROUP_ID }))
  })

  it('unions the unrestricted scope of a single matching group without a terms row', async () => {
    const unionScopesSpy = jest.spyOn(catalogVisibility, 'unionScopes')
    const memberships = [makeMembership({ id: 'm-1', groupId: GROUP_ID })]
    const groups = [makeGroup({ id: GROUP_ID, code: 'wholesale', name: 'Wholesale', priority: 10 })]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce(groups),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: null, sourceGroupIds: [GROUP_ID], sourceCustomerOverrideId: null })
    expect(unionScopesSpy).toHaveBeenCalledWith([null])
    unionScopesSpy.mockRestore()
  })

  it('returns an empty union for a customer with zero matching groups', async () => {
    const unionScopesSpy = jest.spyOn(catalogVisibility, 'unionScopes')
    const em = {
      find: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: null, sourceGroupIds: [], sourceCustomerOverrideId: null })
    expect(unionScopesSpy).toHaveBeenCalledWith([])
    unionScopesSpy.mockRestore()
  })

  it('returns an unrestricted scope with no source groups for an anonymous customer without a default group', async () => {
    const em = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: null, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: null, sourceGroupIds: [], sourceCustomerOverrideId: null })
    expect(em.find).not.toHaveBeenCalled()
  })

  it('resolves an anonymous customer to the tenant default group as its sole source', async () => {
    const defaultGroup = makeGroup({ id: GROUP_ID, code: 'default', name: 'Default', isDefault: true })
    const em = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue(defaultGroup),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: null, tenantId: TENANT_ID })

    expect(result).toEqual({ scope: null, sourceGroupIds: [GROUP_ID], sourceCustomerOverrideId: null })
  })

  it('always returns sourceCustomerOverrideId: null regardless of group membership', async () => {
    const memberships = [makeMembership({ id: 'm-1', groupId: GROUP_ID })]
    const groups = [makeGroup({ id: GROUP_ID })]
    const em = {
      find: jest.fn().mockResolvedValueOnce(memberships).mockResolvedValueOnce(groups),
      findOne: jest.fn(),
    }
    const service = new DefaultCustomerGroupsService(em as any)

    const result = await service.resolveAssortmentScope({ customerId: CUSTOMER_ID, tenantId: TENANT_ID })

    expect(result.sourceCustomerOverrideId).toBeNull()
  })
})
