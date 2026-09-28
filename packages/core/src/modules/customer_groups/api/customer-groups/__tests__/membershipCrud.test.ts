jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: unknown) => ({ opts })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
const emitMock = jest.fn(async () => {})
jest.mock('../../../events', () => ({
  emitCustomerGroupsEvent: (...args: unknown[]) => emitMock(...(args as [])),
}))

import type { CrudCtx, CrudFactoryOptions } from '@open-mercato/shared/lib/crud/factory'
import { customerGroupMembershipCrud } from '../memberships/crud'
import { CustomerGroup, CustomerGroupMembership } from '../../../data/entities'

type RawInput = Record<string, unknown>
type MembershipCrudOptions = CrudFactoryOptions<RawInput, RawInput, Record<string, unknown>>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_GROUP_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444'
const MEMBERSHIP_ID = '55555555-5555-4555-8555-555555555555'

const opts = (customerGroupMembershipCrud as unknown as { opts: MembershipCrudOptions }).opts

function makeMembership(overrides: Partial<CustomerGroupMembership> = {}): CustomerGroupMembership {
  return {
    id: MEMBERSHIP_ID,
    organizationId: null,
    tenantId: TENANT_ID,
    groupId: GROUP_ID,
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

function createFakeEm(options: { liveGroupIds?: string[]; membership?: CustomerGroupMembership | null } = {}) {
  const liveGroupIds = new Set(options.liveGroupIds ?? [GROUP_ID])
  const em = {
    count: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === CustomerGroup) return liveGroupIds.has(String(where.id)) ? 1 : 0
      return 0
    }),
    findOne: jest.fn(async () => options.membership ?? null),
    fork: () => em,
  }
  return em
}

function createCtx(em: unknown): CrudCtx {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { tenantId: TENANT_ID, sub: 'user-1', orgId: null },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds: null,
  } as unknown as CrudCtx
}

beforeEach(() => {
  emitMock.mockClear()
})

describe('customer group membership CRUD route', () => {
  it('rejects a group that is not live in the caller tenant with a 400', async () => {
    const em = createFakeEm({ liveGroupIds: [] })

    await expect(
      opts.hooks!.beforeCreate!({ groupId: GROUP_ID, customerId: CUSTOMER_ID }, createCtx(em)),
    ).rejects.toMatchObject({ status: 400, body: { error: 'The selected customer group does not exist.' } })
    expect(em.count).toHaveBeenCalledWith(CustomerGroup, { id: GROUP_ID, tenantId: TENANT_ID, deletedAt: null })
  })

  it('accepts a live group of the caller tenant', async () => {
    const em = createFakeEm()

    await expect(
      opts.hooks!.beforeCreate!({ groupId: GROUP_ID, customerId: CUSTOMER_ID }, createCtx(em)),
    ).resolves.toBeUndefined()
  })

  it('rejects moving a membership to a group that is not live in the tenant', async () => {
    const em = createFakeEm({ liveGroupIds: [GROUP_ID], membership: makeMembership() })

    await expect(
      opts.hooks!.beforeUpdate!({ id: MEMBERSHIP_ID, groupId: OTHER_GROUP_ID }, createCtx(em)),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('emits customer_groups.membership.added after create', async () => {
    await opts.hooks!.afterCreate!(makeMembership(), { ...createCtx(createFakeEm()), input: {} })

    expect(emitMock).toHaveBeenCalledWith(
      'customer_groups.membership.added',
      { id: MEMBERSHIP_ID, tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: CUSTOMER_ID },
      { persistent: true, tenantId: TENANT_ID, organizationId: null },
    )
  })

  it('emits customer_groups.membership.removed after delete with the removed row ids', async () => {
    const em = createFakeEm({ membership: makeMembership({ deletedAt: new Date() }) })

    await opts.hooks!.afterDelete!(MEMBERSHIP_ID, createCtx(em))

    expect(em.findOne).toHaveBeenCalledWith(CustomerGroupMembership, { id: MEMBERSHIP_ID, tenantId: TENANT_ID })
    expect(emitMock).toHaveBeenCalledWith(
      'customer_groups.membership.removed',
      { id: MEMBERSHIP_ID, tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: CUSTOMER_ID },
      { persistent: true, tenantId: TENANT_ID, organizationId: null },
    )
  })
})
