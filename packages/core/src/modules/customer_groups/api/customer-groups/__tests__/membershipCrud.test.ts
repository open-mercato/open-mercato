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
import { customerGroupMembershipCrud, actorUserIdFromContext, membershipUpdateEvents } from '../memberships/crud'
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

function createFakeEm(
  options: {
    liveGroupIds?: string[]
    membership?: CustomerGroupMembership | null
    visibleCustomerIds?: string[]
  } = {},
) {
  const liveGroupIds = new Set(options.liveGroupIds ?? [GROUP_ID])
  const visibleCustomerIds = new Set(options.visibleCustomerIds ?? [CUSTOMER_ID])
  const execute = jest.fn(async (_sql: string, params: string[]) => (visibleCustomerIds.has(params[0]) ? [{ exists: 1 }] : []))
  const em = {
    getConnection: () => ({ execute }),
    execute,
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

  describe('update events', () => {
    const OTHER_CUSTOMER_ID = '99999999-9999-4999-8999-999999999999'

    async function runUpdate(entity: CustomerGroupMembership, input: RawInput) {
      const ctx = createCtx(createFakeEm())
      await opts.update!.applyToEntity(entity, { id: MEMBERSHIP_ID, ...input }, ctx)
      await opts.hooks!.afterUpdate!(entity, { ...ctx, input: { id: MEMBERSHIP_ID, ...input } })
    }

    it('emits removed for the old group and added for the new one when a membership moves group', async () => {
      await runUpdate(makeMembership(), { groupId: OTHER_GROUP_ID })

      expect(emitMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
        'customer_groups.membership.removed',
        'customer_groups.membership.added',
      ])
      expect(emitMock).toHaveBeenNthCalledWith(
        1,
        'customer_groups.membership.removed',
        { id: MEMBERSHIP_ID, tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: CUSTOMER_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: null },
      )
      expect(emitMock).toHaveBeenNthCalledWith(
        2,
        'customer_groups.membership.added',
        { id: MEMBERSHIP_ID, tenantId: TENANT_ID, organizationId: null, groupId: OTHER_GROUP_ID, customerId: CUSTOMER_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: null },
      )
    })

    it('emits removed for the old customer and added for the new one when a membership moves customer', async () => {
      await runUpdate(makeMembership(), { customerId: OTHER_CUSTOMER_ID })

      expect(emitMock).toHaveBeenCalledTimes(2)
      expect(emitMock).toHaveBeenCalledWith(
        'customer_groups.membership.removed',
        expect.objectContaining({ customerId: CUSTOMER_ID, groupId: GROUP_ID }),
        expect.anything(),
      )
      expect(emitMock).toHaveBeenCalledWith(
        'customer_groups.membership.added',
        expect.objectContaining({ customerId: OTHER_CUSTOMER_ID, groupId: GROUP_ID }),
        expect.anything(),
      )
    })

    it('emits added when a renewal makes an expired membership valid again', async () => {
      await runUpdate(makeMembership({ validUntil: new Date('2020-01-01T00:00:00.000Z') }), { validUntil: null })

      expect(emitMock).toHaveBeenCalledTimes(1)
      expect(emitMock).toHaveBeenCalledWith(
        'customer_groups.membership.added',
        { id: MEMBERSHIP_ID, tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: CUSTOMER_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: null },
      )
    })

    it('emits added when a not-yet-started membership is moved to start now', async () => {
      await runUpdate(makeMembership({ validFrom: new Date('2999-01-01T00:00:00.000Z') }), { validFrom: null })

      expect(emitMock).toHaveBeenCalledTimes(1)
      expect(emitMock).toHaveBeenCalledWith('customer_groups.membership.added', expect.anything(), expect.anything())
    })

    it('emits nothing when an already-valid membership only changes notes or its window', async () => {
      await runUpdate(makeMembership(), { notes: 'VIP', validUntil: '2999-01-01T00:00:00.000Z' })

      expect(emitMock).not.toHaveBeenCalled()
    })

    it('emits nothing when a renewal still leaves the membership expired', async () => {
      await runUpdate(makeMembership({ validUntil: new Date('2020-01-01T00:00:00.000Z') }), {
        validUntil: '2021-01-01T00:00:00.000Z',
      })

      expect(emitMock).not.toHaveBeenCalled()
    })
  })

  describe('assigned_by_user_id attribution', () => {
    const ACTOR_ID = '66666666-6666-4666-8666-666666666666'
    const SPOOFED_ID = '77777777-7777-4777-8777-777777777777'

    function ctxWithAuth(auth: Record<string, unknown>): CrudCtx {
      return { ...createCtx(createFakeEm()), auth: { tenantId: TENANT_ID, orgId: null, ...auth } } as unknown as CrudCtx
    }

    it('records the session user on create and ignores a body-supplied value', () => {
      const data = opts.create!.mapToEntity(
        { groupId: GROUP_ID, customerId: CUSTOMER_ID, assignedByUserId: SPOOFED_ID },
        ctxWithAuth({ sub: ACTOR_ID }),
      ) as Record<string, unknown>

      expect(data.assignedByUserId).toBe(ACTOR_ID)
    })

    it('records null for an API-key caller', () => {
      expect(actorUserIdFromContext(ctxWithAuth({ sub: 'api_key:abc', isApiKey: true }))).toBeNull()
    })

    it('keeps the original attribution when an update only renews the validity window', () => {
      const entity = makeMembership({ assignedByUserId: ACTOR_ID })

      opts.update!.applyToEntity(
        entity,
        { id: MEMBERSHIP_ID, validUntil: null, assignedByUserId: SPOOFED_ID },
        ctxWithAuth({ sub: SPOOFED_ID }),
      )

      expect(entity.assignedByUserId).toBe(ACTOR_ID)
    })

    it('re-attributes the membership to the session user when it moves to another group', () => {
      const entity = makeMembership({ assignedByUserId: ACTOR_ID })
      const mover = '88888888-8888-4888-8888-888888888888'

      opts.update!.applyToEntity(entity, { id: MEMBERSHIP_ID, groupId: OTHER_GROUP_ID }, ctxWithAuth({ sub: mover }))

      expect(entity.groupId).toBe(OTHER_GROUP_ID)
      expect(entity.assignedByUserId).toBe(mover)
    })
  })
  describe('customer organization scope', () => {
    const ORG_A = '99999999-9999-4999-8999-999999999999'

    function scopedCtx(em: unknown, organizationIds: string[] | null): CrudCtx {
      return { ...createCtx(em), organizationIds } as unknown as CrudCtx
    }

    it('rejects creating a membership for a customer outside the caller organizations', async () => {
      const em = createFakeEm({ visibleCustomerIds: [] })

      await expect(
        opts.hooks!.beforeCreate!({ groupId: GROUP_ID, customerId: CUSTOMER_ID }, scopedCtx(em, [ORG_A])),
      ).rejects.toMatchObject({ status: 400, body: { error: 'The selected customer does not exist.' } })
      const [sql, params] = em.execute.mock.calls[0]
      expect(sql).toContain('from customer_entities where id = ? and tenant_id = ? and deleted_at is null')
      expect(sql).toContain('organization_id in (?)')
      expect(params).toEqual([CUSTOMER_ID, TENANT_ID, ORG_A])
    })

    it('does not filter by organization for an unrestricted caller', async () => {
      const em = createFakeEm()

      await opts.hooks!.beforeCreate!({ groupId: GROUP_ID, customerId: CUSTOMER_ID }, scopedCtx(em, null))

      const [sql, params] = em.execute.mock.calls[0]
      expect(sql).not.toContain('organization_id')
      expect(params).toEqual([CUSTOMER_ID, TENANT_ID])
    })

    it('treats a caller with no visible organization as seeing no customer', async () => {
      const em = createFakeEm()

      await expect(
        opts.hooks!.beforeCreate!({ groupId: GROUP_ID, customerId: CUSTOMER_ID }, scopedCtx(em, [])),
      ).rejects.toMatchObject({ status: 400 })
      expect(em.execute).not.toHaveBeenCalled()
    })

    it('returns 404 when updating a membership whose customer is outside the caller organizations', async () => {
      const em = createFakeEm({ membership: makeMembership(), visibleCustomerIds: [] })

      await expect(
        opts.hooks!.beforeUpdate!({ id: MEMBERSHIP_ID, validUntil: null }, scopedCtx(em, [ORG_A])),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('rejects moving a membership onto a customer outside the caller organizations', async () => {
      const otherCustomer = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      const em = createFakeEm({ membership: makeMembership(), visibleCustomerIds: [CUSTOMER_ID] })

      await expect(
        opts.hooks!.beforeUpdate!({ id: MEMBERSHIP_ID, customerId: otherCustomer }, scopedCtx(em, [ORG_A])),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('returns 404 when deleting a membership whose customer is outside the caller organizations', async () => {
      const em = createFakeEm({ membership: makeMembership(), visibleCustomerIds: [] })

      await expect(opts.hooks!.beforeDelete!(MEMBERSHIP_ID, scopedCtx(em, [ORG_A]))).rejects.toMatchObject({
        status: 404,
      })
    })

    it('returns 404 when listing the memberships of a customer outside the caller organizations', async () => {
      const em = createFakeEm({ visibleCustomerIds: [] })

      await expect(
        opts.hooks!.beforeList!({ page: 1, pageSize: 50, customerId: CUSTOMER_ID }, scopedCtx(em, [ORG_A])),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('lists without a customer filter without a scope lookup', async () => {
      const em = createFakeEm()

      await opts.hooks!.beforeList!({ page: 1, pageSize: 50 }, scopedCtx(em, [ORG_A]))

      expect(em.execute).not.toHaveBeenCalled()
    })
  })
  describe('hook validation matches the persisted payload', () => {
    const ORG_A = '99999999-9999-4999-8999-999999999999'

    it('still runs the scope check on create when the body carries an invalid assignedByUserId', async () => {
      const em = createFakeEm({ visibleCustomerIds: [] })
      const ctx = { ...createCtx(em), organizationIds: [ORG_A] } as unknown as CrudCtx

      await expect(
        opts.hooks!.beforeCreate!({ groupId: GROUP_ID, customerId: CUSTOMER_ID, assignedByUserId: 'not-a-uuid' }, ctx),
      ).rejects.toMatchObject({ status: 400 })
      expect(em.execute).toHaveBeenCalled()
    })

    it('still runs the scope check on update when the body carries an invalid assignedByUserId', async () => {
      const em = createFakeEm({ membership: makeMembership(), visibleCustomerIds: [] })
      const ctx = { ...createCtx(em), organizationIds: [ORG_A] } as unknown as CrudCtx

      await expect(
        opts.hooks!.beforeUpdate!({ id: MEMBERSHIP_ID, notes: 'x', assignedByUserId: 'not-a-uuid' }, ctx),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('checks an existing membership against its customer including soft-deleted customer rows', async () => {
      const em = createFakeEm({ membership: makeMembership() })

      await opts.hooks!.beforeDelete!(MEMBERSHIP_ID, createCtx(em))

      const [sql] = em.execute.mock.calls[0]
      expect(sql).not.toContain('deleted_at')
    })
  })

  describe('membershipUpdateEvents', () => {
    const at = new Date('2026-06-01T00:00:00.000Z')
    const target = { id: MEMBERSHIP_ID, tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: CUSTOMER_ID }

    it('emits membership.removed when an update ends a valid membership', () => {
      const events = membershipUpdateEvents(
        { groupId: GROUP_ID, customerId: CUSTOMER_ID, validAtUpdate: true },
        { ...target, validFrom: null, validUntil: new Date('2026-05-01T00:00:00.000Z') },
        at,
      )

      expect(events.map((event) => event.eventId)).toEqual(['customer_groups.membership.removed'])
    })

    it('emits nothing for an edit that keeps a valid membership valid', () => {
      const events = membershipUpdateEvents(
        { groupId: GROUP_ID, customerId: CUSTOMER_ID, validAtUpdate: true },
        { ...target, validFrom: null, validUntil: null },
        at,
      )

      expect(events).toEqual([])
    })
  })
})
