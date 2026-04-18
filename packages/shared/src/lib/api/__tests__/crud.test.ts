import type { EntityManager } from '@mikro-orm/core'
import { buildScopedWhere, extractScopeFromAuth, findOneScoped, softDelete } from '../crud'

class ExampleEntity {
  id = ''
  organizationId?: string | null
  tenantId?: string | null
  companyId?: string | null
  workspaceId?: string | null
  deletedAt?: Date | null
}

describe('buildScopedWhere', () => {
  it('adds organization, tenant, and soft-delete filters without mutating the base object', () => {
    const base = { id: 'entity-1' }

    const where = buildScopedWhere(base, {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(where).toEqual({
      id: 'entity-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      deletedAt: null,
    })
    expect(where).not.toBe(base)
    expect(base).toEqual({ id: 'entity-1' })
  })

  it('prefers organizationIds and collapses them to scalar or $in filters after trimming and sanitizing empty values', () => {
    expect(
      buildScopedWhere(
        { id: 'entity-1' },
        { organizationId: 'org-ignored', organizationIds: [' org-1 '], tenantId: 'tenant-1' }
      )
    ).toEqual({
      id: 'entity-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      deletedAt: null,
    })

    expect(
      buildScopedWhere(
        { id: 'entity-1' },
        { organizationIds: [' org-1 ', '   ', '', 'org-2  '], tenantId: 'tenant-1' }
      )
    ).toEqual({
      id: 'entity-1',
      organizationId: { $in: ['org-1', 'org-2'] },
      tenantId: 'tenant-1',
      deletedAt: null,
    })
  })

  it('fails closed when organizationIds is explicitly empty', () => {
    expect(
      buildScopedWhere(
        { id: 'entity-1' },
        { organizationIds: [], tenantId: 'tenant-1' }
      )
    ).toEqual({
      id: 'entity-1',
      organizationId: { $in: [] },
      tenantId: 'tenant-1',
      deletedAt: null,
    })

    expect(
      buildScopedWhere(
        { id: 'entity-1' },
        { organizationIds: null, tenantId: 'tenant-1' }
      )
    ).toEqual({
      id: 'entity-1',
      organizationId: { $in: [] },
      tenantId: 'tenant-1',
      deletedAt: null,
    })
  })

  it('supports custom scope fields and disabling implicit scope clauses', () => {
    expect(
      buildScopedWhere(
        { id: 'entity-1' },
        {
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          orgField: 'companyId',
          tenantField: 'workspaceId',
          softDeleteField: 'archivedAt',
        }
      )
    ).toEqual({
      id: 'entity-1',
      companyId: 'org-1',
      workspaceId: 'tenant-1',
      archivedAt: null,
    })

    expect(
      buildScopedWhere(
        { id: 'entity-1' },
        {
          organizationId: 'org-1',
          tenantId: 'tenant-1',
          orgField: null,
          tenantField: null,
          softDeleteField: null,
        }
      )
    ).toEqual({ id: 'entity-1' })
  })

  it('preserves an explicit null organization scope to keep queries fail-closed', () => {
    expect(
      buildScopedWhere(
        { id: 'entity-1' },
        { organizationId: null, tenantId: 'tenant-1' }
      )
    ).toEqual({
      id: 'entity-1',
      organizationId: null,
      tenantId: 'tenant-1',
      deletedAt: null,
    })
  })
})

describe('extractScopeFromAuth', () => {
  it('returns an empty scope when auth is missing', () => {
    expect(extractScopeFromAuth(null)).toEqual({})
    expect(extractScopeFromAuth(undefined)).toEqual({})
  })

  it('maps auth fields and normalizes missing values to null', () => {
    expect(extractScopeFromAuth({ orgId: 'org-1', tenantId: 'tenant-1' })).toEqual({
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(extractScopeFromAuth({})).toEqual({
      organizationId: null,
      tenantId: null,
    })
  })
})

describe('findOneScoped', () => {
  it('queries by id with the default organization and tenant fields when scope values are present', async () => {
    const entity = new ExampleEntity()
    entity.id = 'entity-1'
    const findOne = jest.fn(async () => entity)
    const getRepository = jest.fn(() => ({ findOne }))
    const em = { getRepository } as unknown as EntityManager

    const result = await findOneScoped(em, ExampleEntity, 'entity-1', {
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })

    expect(getRepository).toHaveBeenCalledWith(ExampleEntity)
    expect(findOne).toHaveBeenCalledWith({
      id: 'entity-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
    })
    expect(result).toBe(entity)
  })

  it('omits nullable scope values and honors custom field names', async () => {
    const findOne = jest.fn(async () => null)
    const em = {
      getRepository: jest.fn(() => ({ findOne })),
    } as unknown as EntityManager

    await findOneScoped(em, ExampleEntity, 'entity-2', {
      organizationId: null,
      tenantId: undefined,
      orgField: 'companyId',
      tenantField: 'workspaceId',
    })

    expect(findOne).toHaveBeenCalledWith({ id: 'entity-2' })

    await findOneScoped(em, ExampleEntity, 'entity-3', {
      organizationId: 'org-3',
      tenantId: 'tenant-3',
      orgField: 'companyId',
      tenantField: 'workspaceId',
    })

    expect(findOne).toHaveBeenLastCalledWith({
      id: 'entity-3',
      companyId: 'org-3',
      workspaceId: 'tenant-3',
    })
  })
})

describe('softDelete', () => {
  it('sets deletedAt and persists the updated entity', async () => {
    const entity = new ExampleEntity()
    const persistAndFlush = jest.fn(async () => undefined)
    const em = { persistAndFlush } as unknown as EntityManager
    const before = Date.now()

    await softDelete(em, entity)

    expect(entity.deletedAt).toBeInstanceOf(Date)
    expect((entity.deletedAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    expect(persistAndFlush).toHaveBeenCalledWith(entity)
  })
})
