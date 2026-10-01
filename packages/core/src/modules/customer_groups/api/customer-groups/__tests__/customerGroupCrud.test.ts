jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: unknown) => ({ opts })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))
const emitMock = jest.fn(async (..._args: unknown[]) => {})
const invalidateCrudCacheMock = jest.fn(async (..._args: unknown[]) => {})
jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/crud/cache'),
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...args),
}))
jest.mock('../../../events', () => ({
  ...jest.requireActual('../../../events'),
  emitCustomerGroupsEvent: (...args: unknown[]) => emitMock(...args),
}))

import type { CrudCtx, CrudFactoryOptions } from '@open-mercato/shared/lib/crud/factory'
import { customerGroupCrud, findParentAssignmentIssue, toCustomerGroupUniqueConflict, type CustomerGroupNode } from '../crud'
import { CustomerGroup, CustomerGroupMembership, CustomerGroupTerms } from '../../../data/entities'
import { eventsConfig } from '../../../events'

type RawInput = Record<string, unknown>
type GroupCrudOptions = CrudFactoryOptions<RawInput, RawInput, Record<string, unknown>>

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '22222222-2222-4222-8222-222222222222'
const PARENT_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ID = '44444444-4444-4444-8444-444444444444'

const opts = (customerGroupCrud as unknown as { opts: GroupCrudOptions }).opts

type FakeEmConfig = {
  counts?: (entity: unknown, where: Record<string, unknown>) => number
  groups?: CustomerGroupNode[]
  memberships?: Array<Partial<CustomerGroupMembership>>
  nativeUpdateError?: (where: Record<string, unknown>) => unknown
  flushError?: unknown
  transactionError?: unknown
  execute?: (sql: string, params: unknown[]) => unknown[]
}

const DEFAULT_UNIQUE_VIOLATION = Object.assign(new Error('duplicate key value violates unique constraint'), {
  code: '23505',
  constraint: 'customer_groups_tenant_default_unique',
})

function createFakeEm(config: FakeEmConfig = {}) {
  const calls: string[] = []
  const em = {
    count: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      calls.push('count')
      return config.counts ? config.counts(entity, where) : 0
    }),
    find: jest.fn(async (entity: unknown) => {
      calls.push('find')
      if (entity === CustomerGroupMembership) return config.memberships ?? []
      return config.groups ?? []
    }),
    findOne: jest.fn(async () => null),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      calls.push(`nativeUpdate:${where.id && typeof where.id === 'string' ? 'self' : 'others'}`)
      const error = config.nativeUpdateError?.(where)
      if (error) throw error
      return 1
    }),
    flush: jest.fn(async () => {
      calls.push('flush')
      if (config.flushError) throw config.flushError
    }),
    transactional: jest.fn(async (callback: (tem: unknown) => Promise<unknown>): Promise<unknown> => {
      const result = await callback(em)
      if (config.transactionError) throw config.transactionError
      return result
    }),
    fork: (): unknown => em,
    getConnection: () => ({
      execute: jest.fn(async (sql: string, params: unknown[]) => {
        calls.push('execute')
        return config.execute ? config.execute(sql, params) : []
      }),
    }),
  }
  return { em, calls }
}

function createCtx(em: unknown, organizationIds: string[] | null = null): CrudCtx {
  return {
    container: { resolve: (name: string) => (name === 'em' ? em : undefined) },
    auth: { tenantId: TENANT_ID, sub: 'user-1', orgId: null },
    organizationScope: null,
    selectedOrganizationId: null,
    organizationIds,
  } as unknown as CrudCtx
}

function makeGroup(overrides: Partial<CustomerGroup> = {}): CustomerGroup {
  return {
    id: GROUP_ID,
    organizationId: null,
    tenantId: TENANT_ID,
    code: 'retail',
    name: 'Retail',
    description: null,
    kind: 'b2c',
    parentId: null,
    priority: 10,
    isDefault: false,
    isActive: true,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as CustomerGroup
}

const validCreateInput = { code: 'wholesale', name: 'Wholesale', kind: 'b2b', priority: 20 }

describe('customer group CRUD route', () => {
  it('declares events whose composed ids match the declared customer_groups.group.* events', () => {
    expect(opts.events).toMatchObject({ module: 'customer_groups', entity: 'group' })
    const declared = new Set(eventsConfig.events.map((event) => event.id))
    for (const action of ['created', 'updated', 'deleted']) {
      expect(declared.has(`${opts.events!.module}.${opts.events!.entity}.${action}`)).toBe(true)
    }
  })

  describe('create', () => {
    it('does not touch the tenant default before the write (beforeCreate is read-only)', async () => {
      const { em } = createFakeEm()
      await opts.hooks!.beforeCreate!({ ...validCreateInput, isDefault: true }, createCtx(em))

      expect(em.nativeUpdate).not.toHaveBeenCalled()
    })

    it('rejects a duplicate code with a 409 before writing', async () => {
      const { em } = createFakeEm({ counts: (_entity, where) => (where.code ? 1 : 0) })

      await expect(opts.hooks!.beforeCreate!(validCreateInput, createCtx(em))).rejects.toMatchObject({
        status: 409,
        body: { error: 'A customer group with this code already exists.' },
      })
    })

    it('rejects a duplicate live priority with a 409 before writing', async () => {
      const { em } = createFakeEm({ counts: (_entity, where) => (where.priority !== undefined ? 1 : 0) })

      await expect(opts.hooks!.beforeCreate!(validCreateInput, createCtx(em))).rejects.toMatchObject({
        status: 409,
        body: { error: 'Another customer group already uses this priority.' },
      })
    })

    it('scopes the uniqueness checks to live rows of the caller tenant', async () => {
      const { em } = createFakeEm()
      await opts.hooks!.beforeCreate!(validCreateInput, createCtx(em))

      expect(em.count).toHaveBeenCalledWith(CustomerGroup, { tenantId: TENANT_ID, code: 'wholesale', deletedAt: null })
      expect(em.count).toHaveBeenCalledWith(CustomerGroup, { tenantId: TENANT_ID, priority: 20, deletedAt: null })
    })

    it('rejects a parent that is not a live group of the tenant with a 400', async () => {
      const { em } = createFakeEm({ groups: [] })

      await expect(
        opts.hooks!.beforeCreate!({ ...validCreateInput, parentId: PARENT_ID }, createCtx(em)),
      ).rejects.toMatchObject({ status: 400, body: { error: 'The selected parent group does not exist.' } })
      expect(em.find).toHaveBeenCalledWith(CustomerGroup, { tenantId: TENANT_ID, deletedAt: null })
    })

    it('skips the checks for input that will fail schema validation', async () => {
      const { em } = createFakeEm()
      await opts.hooks!.beforeCreate!({ code: 'Bad Code!' }, createCtx(em))

      expect(em.count).not.toHaveBeenCalled()
    })

    it('always inserts the row as non-default', () => {
      const { em } = createFakeEm()
      const data = opts.create!.mapToEntity({ ...validCreateInput, isDefault: true }, createCtx(em))

      expect(data.isDefault).toBe(false)
      expect(data.tenantId).toBe(TENANT_ID)
    })

    it('promotes the created group after the insert: clears the old default first, then sets the new one', async () => {
      const { em, calls } = createFakeEm()
      const created = makeGroup()
      const ctx = { ...createCtx(em), input: { ...validCreateInput, isDefault: true } }

      await opts.hooks!.afterCreate!(created, ctx)

      expect(em.transactional).toHaveBeenCalledTimes(1)
      expect(calls).toEqual(['find', 'nativeUpdate:others', 'nativeUpdate:self'])
      expect(em.nativeUpdate).toHaveBeenNthCalledWith(
        1,
        CustomerGroup,
        { tenantId: TENANT_ID, isDefault: true, deletedAt: null, id: { $ne: GROUP_ID } },
        { isDefault: false, updatedAt: expect.any(Date) },
      )
      expect(em.nativeUpdate).toHaveBeenNthCalledWith(
        2,
        CustomerGroup,
        { id: GROUP_ID, tenantId: TENANT_ID, deletedAt: null },
        { isDefault: true, updatedAt: expect.any(Date) },
      )
      expect(created.isDefault).toBe(true)
    })

    it('keeps the committed create when every default promotion loses a concurrent race', async () => {
      const { em } = createFakeEm({
        nativeUpdateError: (where) => (typeof where.id === 'string' ? DEFAULT_UNIQUE_VIOLATION : null),
      })
      const created = makeGroup()
      emitMock.mockClear()

      await expect(
        opts.hooks!.afterCreate!(created, { ...createCtx(em), input: { ...validCreateInput, isDefault: true } }),
      ).resolves.toBeUndefined()
      expect(em.transactional).toHaveBeenCalledTimes(3)
      expect(created.isDefault).toBe(false)
      expect(emitMock).not.toHaveBeenCalled()
      expect(opts.create!.response!(created)).toEqual({ id: GROUP_ID, isDefault: false })
    })

    it('reports the applied default in the create response', () => {
      expect(opts.create!.response!(makeGroup({ isDefault: true }))).toEqual({ id: GROUP_ID, isDefault: true })
    })

    it('rethrows an unrelated promotion failure unchanged', async () => {
      const failure = new Error('connection lost')
      const { em } = createFakeEm({ nativeUpdateError: () => failure })

      await expect(
        opts.hooks!.afterCreate!(makeGroup(), { ...createCtx(em), input: { ...validCreateInput, isDefault: true } }),
      ).rejects.toBe(failure)
    })

    it('announces the previous default group whose flag the promotion cleared', async () => {
      const { em } = createFakeEm({ groups: [{ id: OTHER_ID }] })
      emitMock.mockClear()

      await opts.hooks!.afterCreate!(makeGroup(), { ...createCtx(em), input: { ...validCreateInput, isDefault: true } })

      expect(emitMock).toHaveBeenCalledTimes(1)
      expect(emitMock).toHaveBeenCalledWith(
        'customer_groups.group.updated',
        { id: OTHER_ID, organizationId: null, tenantId: TENANT_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: null },
      )
    })

    it('does not touch defaults when the created group is not a default', async () => {
      const { em } = createFakeEm()
      await opts.hooks!.afterCreate!(makeGroup(), { ...createCtx(em), input: validCreateInput })

      expect(em.nativeUpdate).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('leaves isDefault / isActive untouched on a partial update', async () => {
      const { em } = createFakeEm()
      const group = makeGroup({ isDefault: true, isActive: false })

      await opts.update!.applyToEntity(group, { id: GROUP_ID, name: 'Renamed' }, createCtx(em))

      expect(group.name).toBe('Renamed')
      expect(group.isDefault).toBe(true)
      expect(group.isActive).toBe(false)
      expect(em.nativeUpdate).not.toHaveBeenCalled()
    })

    it('clears other defaults inside the write (after validation, before mutating the entity)', async () => {
      const { em, calls } = createFakeEm()
      const group = makeGroup()

      await opts.update!.applyToEntity(group, { id: GROUP_ID, isDefault: true, code: 'retail-2' }, createCtx(em))

      expect(calls).toEqual(['count', 'find', 'nativeUpdate:others', 'nativeUpdate:self', 'flush'])
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        CustomerGroup,
        { tenantId: TENANT_ID, isDefault: true, deletedAt: null, id: { $ne: GROUP_ID } },
        { isDefault: false, updatedAt: expect.any(Date) },
      )
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        CustomerGroup,
        { id: GROUP_ID, tenantId: TENANT_ID, deletedAt: null },
        { isDefault: true },
      )
      expect(group.isDefault).toBe(true)
      expect(group.code).toBe('retail-2')
    })

    it('announces the cleared previous default only after the update committed', async () => {
      const { em } = createFakeEm({ groups: [{ id: OTHER_ID }] })
      const group = makeGroup()
      const ctx = createCtx(em)
      emitMock.mockClear()

      await opts.update!.applyToEntity(group, { id: GROUP_ID, isDefault: true }, ctx)
      expect(emitMock).not.toHaveBeenCalled()

      await opts.hooks!.afterUpdate!(group, { ...ctx, input: { id: GROUP_ID, isDefault: true } })
      expect(emitMock).toHaveBeenCalledTimes(1)
      expect(emitMock).toHaveBeenCalledWith(
        'customer_groups.group.updated',
        { id: OTHER_ID, organizationId: null, tenantId: TENANT_ID },
        { persistent: true, tenantId: TENANT_ID, organizationId: null },
      )

      emitMock.mockClear()
      await opts.hooks!.afterUpdate!(group, { ...ctx, input: { id: GROUP_ID, isDefault: true } })
      expect(emitMock).not.toHaveBeenCalled()
    })

    it('maps a concurrent default promotion on update to a 409 and leaves the entity untouched', async () => {
      const { em } = createFakeEm({
        nativeUpdateError: (where) => (typeof where.id === 'string' ? DEFAULT_UNIQUE_VIOLATION : null),
      })
      const group = makeGroup()

      await expect(
        opts.update!.applyToEntity(group, { id: GROUP_ID, isDefault: true, name: 'Renamed' }, createCtx(em)),
      ).rejects.toMatchObject({ status: 409 })
      expect(group.isDefault).toBe(false)
      expect(group.name).toBe('Retail')
    })

    it('does not clear the tenant default when the update is rejected', async () => {
      const { em } = createFakeEm({ counts: (_entity, where) => (where.code ? 1 : 0) })
      const group = makeGroup()

      await expect(
        opts.update!.applyToEntity(group, { id: GROUP_ID, isDefault: true, code: 'taken' }, createCtx(em)),
      ).rejects.toMatchObject({ status: 409 })
      expect(em.nativeUpdate).not.toHaveBeenCalled()
      expect(group.isDefault).toBe(false)
      expect(group.code).toBe('retail')
    })

    it('does not clear the tenant default when the input is invalid', async () => {
      const { em } = createFakeEm()

      await expect(
        opts.update!.applyToEntity(makeGroup(), { id: GROUP_ID, isDefault: true, code: 'Bad Code!' }, createCtx(em)),
      ).rejects.toThrow()
      expect(em.nativeUpdate).not.toHaveBeenCalled()
    })

    it('excludes the group itself from the uniqueness checks and skips unchanged fields', async () => {
      const { em } = createFakeEm()

      await opts.update!.applyToEntity(
        makeGroup(),
        { id: GROUP_ID, code: 'retail', priority: 30 },
        createCtx(em),
      )

      expect(em.count).toHaveBeenCalledTimes(1)
      expect(em.count).toHaveBeenCalledWith(CustomerGroup, {
        tenantId: TENANT_ID,
        priority: 30,
        deletedAt: null,
        id: { $ne: GROUP_ID },
      })
    })

    it('flushes inside the update and maps a concurrent code or priority collision to a 409', async () => {
      for (const [constraint, message] of [
        ['customer_groups_tenant_code_unique', 'A customer group with this code already exists.'],
        ['customer_groups_tenant_priority_unique', 'Another customer group already uses this priority.'],
      ]) {
        const flushError = Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint,
        })
        const { em } = createFakeEm({ flushError })

        await expect(
          opts.update!.applyToEntity(makeGroup(), { id: GROUP_ID, code: 'retail-2', priority: 30 }, createCtx(em)),
        ).rejects.toMatchObject({ status: 409, body: { error: message } })
      }
    })

    it('rethrows an unrelated flush failure unchanged', async () => {
      const failure = new Error('connection lost')
      const { em } = createFakeEm({ flushError: failure })

      await expect(
        opts.update!.applyToEntity(makeGroup(), { id: GROUP_ID, name: 'Renamed' }, createCtx(em)),
      ).rejects.toBe(failure)
    })

    it('rejects making a group its own parent with a 400', async () => {
      const { em } = createFakeEm({ groups: [{ id: GROUP_ID, parentId: null }] })

      await expect(
        opts.update!.applyToEntity(makeGroup(), { id: GROUP_ID, parentId: GROUP_ID }, createCtx(em)),
      ).rejects.toMatchObject({ status: 400, body: { error: 'A group cannot be its own parent.' } })
    })

    it('rejects re-parenting under a descendant with a 400', async () => {
      const { em } = createFakeEm({
        groups: [
          { id: GROUP_ID, parentId: null },
          { id: OTHER_ID, parentId: GROUP_ID },
        ],
      })

      await expect(
        opts.update!.applyToEntity(makeGroup(), { id: GROUP_ID, parentId: OTHER_ID }, createCtx(em)),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('delete', () => {
    beforeEach(() => {
      emitMock.mockClear()
      invalidateCrudCacheMock.mockClear()
    })

    it('retires terms and memberships in one transaction and flushes the membership cache once', async () => {
      const memberships = [
        { id: 'm-1', tenantId: TENANT_ID, organizationId: 'org-1', groupId: GROUP_ID, customerId: 'c-1' },
        { id: 'm-2', tenantId: TENANT_ID, organizationId: 'org-2', groupId: GROUP_ID, customerId: 'c-2' },
        { id: 'm-3', tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: 'c-3' },
      ]
      const { em } = createFakeEm({ memberships })
      const ctx = createCtx(em)

      await opts.hooks!.afterDelete!(GROUP_ID, ctx)

      expect(em.transactional).toHaveBeenCalledTimes(1)
      expect(invalidateCrudCacheMock).toHaveBeenCalledTimes(1)
      expect(invalidateCrudCacheMock).toHaveBeenCalledWith(
        ctx.container,
        'customer.group.membership',
        { id: null, tenantId: TENANT_ID, organizationId: null },
        TENANT_ID,
        'deleted',
      )
      expect(emitMock).toHaveBeenCalledTimes(3)
    })

    it('reverts the group delete and emits nothing when the cascade fails', async () => {
      const failure = new Error('connection lost')
      const { em } = createFakeEm({
        memberships: [{ id: 'm-1', tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: 'c-1' }],
        transactionError: failure,
      })

      await expect(opts.hooks!.afterDelete!(GROUP_ID, createCtx(em))).rejects.toBe(failure)

      expect(em.nativeUpdate).toHaveBeenLastCalledWith(
        CustomerGroup,
        { id: GROUP_ID, tenantId: TENANT_ID, deletedAt: { $ne: null } },
        { deletedAt: null },
      )
      expect(emitMock).not.toHaveBeenCalled()
      expect(invalidateCrudCacheMock).not.toHaveBeenCalled()
    })

    it('soft-deletes the live memberships of the deleted group and emits membership.removed for each', async () => {
      const CUSTOMER_A = '55555555-5555-4555-8555-555555555555'
      const CUSTOMER_B = '66666666-6666-4666-8666-666666666666'
      const memberships = [
        { id: 'm-1', tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: CUSTOMER_A },
        { id: 'm-2', tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: CUSTOMER_B },
      ]
      const { em } = createFakeEm({ memberships })

      await opts.hooks!.afterDelete!(GROUP_ID, createCtx(em))

      expect(em.find).toHaveBeenCalledWith(CustomerGroupMembership, {
        tenantId: TENANT_ID,
        groupId: GROUP_ID,
        deletedAt: null,
      })
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        CustomerGroupMembership,
        { tenantId: TENANT_ID, groupId: GROUP_ID, deletedAt: null, id: { $in: ['m-1', 'm-2'] } },
        { deletedAt: expect.any(Date), updatedAt: expect.any(Date) },
      )
      expect(emitMock).toHaveBeenCalledTimes(2)
      for (const membership of memberships) {
        expect(emitMock).toHaveBeenCalledWith(
          'customer_groups.membership.removed',
          {
            id: membership.id,
            tenantId: TENANT_ID,
            organizationId: null,
            groupId: GROUP_ID,
            customerId: membership.customerId,
          },
          { persistent: true, tenantId: TENANT_ID, organizationId: null },
        )
      }
    })

    it('writes and emits nothing for memberships when the deleted group had none', async () => {
      const { em } = createFakeEm({ memberships: [] })

      await opts.hooks!.afterDelete!(GROUP_ID, createCtx(em))

      expect(em.nativeUpdate).not.toHaveBeenCalledWith(CustomerGroupMembership, expect.anything(), expect.anything())
      expect(emitMock).not.toHaveBeenCalled()
    })

    describe('caller restricted to some organizations', () => {
      const ORG_A = '77777777-7777-4777-8777-777777777777'

      function outsideScopeCount(total: number) {
        return (sql: string) => {
          if (sql.includes('to_regclass')) return [{ present: true }]
          return [{ total: String(total) }]
        }
      }

      it('lets an unrestricted caller delete without querying customer scope', async () => {
        const { em, calls } = createFakeEm()

        await expect(opts.hooks!.beforeDelete!(GROUP_ID, createCtx(em, null))).resolves.toBeUndefined()

        expect(calls).not.toContain('execute')
      })

      it('refuses the delete with a 409 when the group has members outside the caller organizations', async () => {
        const { em } = createFakeEm({ execute: outsideScopeCount(1) })

        await expect(opts.hooks!.beforeDelete!(GROUP_ID, createCtx(em, [ORG_A]))).rejects.toMatchObject({
          status: 409,
          body: {
            error: 'This group has members in organizations you cannot access, so you cannot delete it.',
          },
        })
      })

      it('counts only live memberships of the group whose customer is outside the caller organizations', async () => {
        const executed: Array<{ sql: string; params: unknown[] }> = []
        const { em } = createFakeEm({
          execute: (sql, params) => {
            executed.push({ sql, params })
            return outsideScopeCount(0)(sql)
          },
        })

        await expect(opts.hooks!.beforeDelete!(GROUP_ID, createCtx(em, [ORG_A]))).resolves.toBeUndefined()

        const countQuery = executed.find((entry) => entry.sql.includes('customer_group_memberships'))
        expect(countQuery?.sql).toContain('m.deleted_at is null')
        expect(countQuery?.sql).toContain('not exists')
        expect(countQuery?.params).toEqual([TENANT_ID, GROUP_ID, ORG_A])
      })

      it('refuses any member for a caller who sees no organization', async () => {
        const { em } = createFakeEm({ execute: () => [{ total: '2' }] })

        await expect(opts.hooks!.beforeDelete!(GROUP_ID, createCtx(em, []))).rejects.toMatchObject({ status: 409 })
      })

      it('re-checks inside the cascade and reverts the group delete when an out-of-scope member appeared', async () => {
        const memberships = [{ id: 'm-1', tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: 'c-1' }]
        const { em } = createFakeEm({ memberships, execute: outsideScopeCount(1) })

        await expect(opts.hooks!.afterDelete!(GROUP_ID, createCtx(em, [ORG_A]))).rejects.toMatchObject({ status: 409 })

        expect(em.nativeUpdate).not.toHaveBeenCalledWith(CustomerGroupMembership, expect.anything(), expect.anything())
        expect(em.nativeUpdate).toHaveBeenLastCalledWith(
          CustomerGroup,
          { id: GROUP_ID, tenantId: TENANT_ID, deletedAt: { $ne: null } },
          { deletedAt: null },
        )
        expect(emitMock).not.toHaveBeenCalled()
      })

      it('retires the memberships when every member is inside the caller organizations', async () => {
        const memberships = [{ id: 'm-1', tenantId: TENANT_ID, organizationId: null, groupId: GROUP_ID, customerId: 'c-1' }]
        const { em } = createFakeEm({ memberships, execute: outsideScopeCount(0) })

        await opts.hooks!.afterDelete!(GROUP_ID, createCtx(em, [ORG_A]))

        expect(emitMock).toHaveBeenCalledTimes(1)
      })
    })

    it('soft-deletes the deleted group terms, scoped to the caller tenant', async () => {
      const { em } = createFakeEm()

      await opts.hooks!.afterDelete!(GROUP_ID, createCtx(em))

      expect(em.nativeUpdate).toHaveBeenCalledWith(
        CustomerGroupTerms,
        { tenantId: TENANT_ID, groupId: GROUP_ID, deletedAt: null },
        { deletedAt: expect.any(Date), updatedAt: expect.any(Date) },
      )
    })
  })
})

describe('toCustomerGroupUniqueConflict', () => {
  const translate = (_key: string, fallback?: string) => fallback ?? _key

  it('maps the default-group index to the default conflict and leaves other errors alone', () => {
    expect(toCustomerGroupUniqueConflict(DEFAULT_UNIQUE_VIOLATION, translate)).toMatchObject({ status: 409 })
    const other = new Error('boom')
    expect(toCustomerGroupUniqueConflict(other, translate)).toBe(other)
  })
})

describe('findParentAssignmentIssue', () => {
  const chain = (length: number): CustomerGroupNode[] =>
    Array.from({ length }, (_, index) => ({ id: `g${index}`, parentId: index === 0 ? null : `g${index - 1}` }))

  it('accepts a live parent within the depth cap', () => {
    expect(findParentAssignmentIssue(chain(4), null, 'g3')).toBeNull()
  })

  it('rejects a parent that would put a new group past depth 5', () => {
    expect(findParentAssignmentIssue(chain(5), null, 'g4')).toBe('tooDeep')
  })

  it('counts the moved group subtree against the cap', () => {
    const groups: CustomerGroupNode[] = [
      ...chain(3),
      { id: 'moved', parentId: null },
      { id: 'child', parentId: 'moved' },
      { id: 'grandchild', parentId: 'child' },
    ]
    expect(findParentAssignmentIssue(groups, 'moved', 'g1')).toBeNull()
    expect(findParentAssignmentIssue(groups, 'moved', 'g2')).toBe('tooDeep')
  })

  it('rejects a missing parent, the group itself, and a descendant', () => {
    const groups: CustomerGroupNode[] = [
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ]
    expect(findParentAssignmentIssue(groups, 'a', 'missing')).toBe('notFound')
    expect(findParentAssignmentIssue(groups, 'a', 'a')).toBe('self')
    expect(findParentAssignmentIssue(groups, 'a', 'b')).toBe('cycle')
  })

  it('does not count a soft-deleted ancestor toward the depth cap', () => {
    const fourLiveLevels = (rootParentId: string | null): CustomerGroupNode[] => [
      { id: 'g1', parentId: rootParentId },
      { id: 'g2', parentId: 'g1' },
      { id: 'g3', parentId: 'g2' },
      { id: 'g4', parentId: 'g3' },
    ]
    expect(findParentAssignmentIssue(fourLiveLevels('deleted-root'), null, 'g4')).toBeNull()
    expect(findParentAssignmentIssue([{ id: 'g0', parentId: null }, ...fourLiveLevels('g0')], null, 'g4')).toBe('tooDeep')
  })

  it('still detects a cycle through live groups when the chain also reaches a deleted ancestor', () => {
    const groups: CustomerGroupNode[] = [
      { id: 'a', parentId: 'deleted-root' },
      { id: 'b', parentId: 'a' },
    ]
    expect(findParentAssignmentIssue(groups, 'a', 'b')).toBe('cycle')
  })

  it('terminates on an already-corrupt cyclic graph', () => {
    const groups: CustomerGroupNode[] = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]
    expect(findParentAssignmentIssue(groups, null, 'x')).toBe('cycle')
  })
})
