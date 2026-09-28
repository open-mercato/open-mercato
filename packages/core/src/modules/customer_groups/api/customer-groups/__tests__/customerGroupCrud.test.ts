jest.mock('@open-mercato/shared/lib/crud/factory', () => ({
  makeCrudRoute: jest.fn((opts: unknown) => ({ opts })),
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import type { CrudCtx, CrudFactoryOptions } from '@open-mercato/shared/lib/crud/factory'
import { customerGroupCrud, findParentAssignmentIssue, type CustomerGroupNode } from '../crud'
import { CustomerGroup, CustomerGroupTerms } from '../../../data/entities'
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
}

function createFakeEm(config: FakeEmConfig = {}) {
  const calls: string[] = []
  const em = {
    count: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      calls.push('count')
      return config.counts ? config.counts(entity, where) : 0
    }),
    find: jest.fn(async () => {
      calls.push('find')
      return config.groups ?? []
    }),
    findOne: jest.fn(async () => null),
    nativeUpdate: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      calls.push(`nativeUpdate:${where.id && typeof where.id === 'string' ? 'self' : 'others'}`)
      return 1
    }),
    transactional: jest.fn(async (callback: (tem: unknown) => Promise<unknown>): Promise<unknown> => callback(em)),
    fork: (): unknown => em,
  }
  return { em, calls }
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
      expect(calls).toEqual(['nativeUpdate:others', 'nativeUpdate:self'])
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

      expect(calls).toEqual(['count', 'nativeUpdate:others'])
      expect(em.nativeUpdate).toHaveBeenCalledWith(
        CustomerGroup,
        { tenantId: TENANT_ID, isDefault: true, deletedAt: null, id: { $ne: GROUP_ID } },
        { isDefault: false, updatedAt: expect.any(Date) },
      )
      expect(group.isDefault).toBe(true)
      expect(group.code).toBe('retail-2')
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

  it('terminates on an already-corrupt cyclic graph', () => {
    const groups: CustomerGroupNode[] = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]
    expect(findParentAssignmentIssue(groups, null, 'x')).toBe('cycle')
  })
})
