import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceRoleTenantAccess } from '@open-mercato/core/modules/auth/lib/roleTenantGuard'

const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const roleId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const makeFindOne = (role: object | null) => jest.fn().mockResolvedValue(role)

function makeCtx({
  isSuperAdmin = false,
  tenantId = tenantA as string | null,
  role = { id: roleId, tenantId: tenantA } as object | null,
}: {
  isSuperAdmin?: boolean
  tenantId?: string | null
  role?: object | null
} = {}) {
  const findOne = makeFindOne(role)
  const em = { findOne } as unknown as EntityManager
  const rbacService = { loadAcl: jest.fn().mockResolvedValue({ isSuperAdmin }) }
  return {
    ctx: {
      auth: { sub: 'user-1', tenantId, isSuperAdmin },
      container: {
        resolve: (name: string) => {
          if (name === 'em') return em
          if (name === 'rbacService') return rbacService
          throw new Error(`Unexpected service: ${name}`)
        },
      },
    },
    findOne,
  }
}

describe('enforceRoleTenantAccess — update mode', () => {
  describe('null-null tenant bypass (CWE-284 fix)', () => {
    it('rejects a non-superadmin with no tenant (null) attempting to update a global/system role (tenantId null)', async () => {
      const { ctx } = makeCtx({ tenantId: null, role: { id: roleId, tenantId: null } })

      await expect(
        enforceRoleTenantAccess('update', { id: roleId }, ctx),
      ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })
    })

    it('rejects a non-superadmin with a blank tenant string attempting to update a global role', async () => {
      const { ctx } = makeCtx({ tenantId: '   ', role: { id: roleId, tenantId: null } })

      await expect(
        enforceRoleTenantAccess('update', { id: roleId }, ctx),
      ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })
    })
  })

  describe('cross-tenant isolation', () => {
    it('rejects a non-superadmin updating a role owned by a different tenant', async () => {
      const { ctx } = makeCtx({ tenantId: tenantA, role: { id: roleId, tenantId: tenantB } })

      await expect(
        enforceRoleTenantAccess('update', { id: roleId }, ctx),
      ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })
    })

    it('allows a non-superadmin to update their own tenant role', async () => {
      const { ctx } = makeCtx({ tenantId: tenantA, role: { id: roleId, tenantId: tenantA } })

      await expect(
        enforceRoleTenantAccess('update', { id: roleId }, ctx),
      ).resolves.toEqual({ id: roleId })
    })
  })

  describe('superadmin bypass', () => {
    it('allows a superadmin with null tenantId to update a global/system role', async () => {
      const { ctx } = makeCtx({ isSuperAdmin: true, tenantId: null, role: { id: roleId, tenantId: null } })

      await expect(
        enforceRoleTenantAccess('update', { id: roleId }, ctx),
      ).resolves.toEqual({ id: roleId })
    })

    it('allows a superadmin to update a role in any tenant', async () => {
      const { ctx } = makeCtx({ isSuperAdmin: true, tenantId: tenantA, role: { id: roleId, tenantId: tenantB } })

      await expect(
        enforceRoleTenantAccess('update', { id: roleId }, ctx),
      ).resolves.toEqual({ id: roleId })
    })
  })

  describe('guard short-circuits', () => {
    it('returns input unchanged when no roleId is provided', async () => {
      const { ctx } = makeCtx()
      const input = { name: 'some-role' }

      await expect(enforceRoleTenantAccess('update', input, ctx)).resolves.toBe(input)
    })

    it('returns input unchanged when the role does not exist in the database', async () => {
      const { ctx } = makeCtx({ role: null })
      const input = { id: roleId }

      await expect(enforceRoleTenantAccess('update', input, ctx)).resolves.toBe(input)
    })

    it('throws 403 when auth context is missing', async () => {
      const ctx = {
        auth: null,
        container: { resolve: () => ({}) },
      }

      await expect(
        enforceRoleTenantAccess('update', { id: roleId }, ctx as never),
      ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 403 })
    })
  })
})

describe('enforceRoleTenantAccess — create mode', () => {
  it('passes tenantId through enforceTenantSelection for a non-superadmin creating in their own tenant', async () => {
    const { ctx } = makeCtx({ tenantId: tenantA })

    const result = await enforceRoleTenantAccess('create', { name: 'new-role', tenantId: tenantA }, ctx)

    expect(result).toMatchObject({ name: 'new-role', tenantId: tenantA })
  })

  it('rejects a non-superadmin trying to create a role in a different tenant', async () => {
    const { ctx } = makeCtx({ tenantId: tenantA })

    await expect(
      enforceRoleTenantAccess('create', { name: 'new-role', tenantId: tenantB }, ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 403 })
  })
})

describe('enforceRoleTenantAccess — delete mode', () => {
  it('rejects a non-superadmin deleting a role in another tenant', async () => {
    const { ctx } = makeCtx({ tenantId: tenantA, role: { id: roleId, tenantId: tenantB } })

    await expect(
      enforceRoleTenantAccess('delete', { body: { id: roleId } }, ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })
  })

  it('rejects a non-superadmin deleting a role when actor has no tenant', async () => {
    const { ctx } = makeCtx({ tenantId: null, role: { id: roleId, tenantId: tenantA } })

    await expect(
      enforceRoleTenantAccess('delete', { body: { id: roleId } }, ctx),
    ).rejects.toMatchObject<Partial<CrudHttpError>>({ status: 404 })
  })

  it('allows a non-superadmin to delete their own tenant role', async () => {
    const { ctx } = makeCtx({ tenantId: tenantA, role: { id: roleId, tenantId: tenantA } })
    const input = { body: { id: roleId } }

    await expect(enforceRoleTenantAccess('delete', input, ctx)).resolves.toBe(input)
  })

  it('allows a superadmin to delete a role in any tenant', async () => {
    const { ctx } = makeCtx({ isSuperAdmin: true, tenantId: tenantA, role: { id: roleId, tenantId: tenantB } })
    const input = { body: { id: roleId } }

    await expect(enforceRoleTenantAccess('delete', input, ctx)).resolves.toBe(input)
  })

  it('returns input unchanged when the role does not exist', async () => {
    const { ctx } = makeCtx({ tenantId: tenantA, role: null })
    const input = { body: { id: roleId } }

    await expect(enforceRoleTenantAccess('delete', input, ctx)).resolves.toBe(input)
  })

  it('returns input unchanged when no role id is provided in body or query', async () => {
    const { ctx } = makeCtx()
    const input = { body: {}, query: {} }

    await expect(enforceRoleTenantAccess('delete', input, ctx)).resolves.toBe(input)
  })

  it('extracts the role id from query.id when body.id is absent', async () => {
    const { ctx, findOne } = makeCtx({ tenantId: tenantA, role: { id: roleId, tenantId: tenantA } })
    const input = { body: {}, query: { id: roleId } }

    await expect(enforceRoleTenantAccess('delete', input, ctx)).resolves.toBe(input)
    expect(findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: roleId }),
      expect.anything(),
    )
  })
})
