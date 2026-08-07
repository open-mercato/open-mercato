jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    auth: {
      user: 'auth:user',
      role: 'auth:role',
      role_acl: 'auth:role_acl',
      user_acl: 'auth:user_acl',
    },
  },
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

import '@open-mercato/core/modules/auth/commands/acl'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type {
  CommandHandler,
  CommandLogMetadata,
  CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  AclUpdateResult,
  RoleAclUpdateInput,
  UserAclUpdateInput,
} from '@open-mercato/core/modules/auth/commands/acl'

/**
 * The two ACL PUT routes wrote permissions straight to the ORM and never
 * reached the command bus, so a permission change left no action-log entry.
 * These commands close that gap, and are deliberately log-only: the undo/redo
 * endpoints are gated on `audit_logs.undo_*`, not on `auth.acl.manage`, so an
 * undoable ACL command would let a caller revert someone else's permission
 * change without holding the feature that authorizes editing permissions.
 */
describe('auth ACL audit commands', () => {
  const roleId = '11111111-1111-4111-8111-111111111111'
  const userId = '22222222-2222-4222-8222-222222222222'
  const tenantId = '33333333-3333-4333-8333-333333333333'

  type AclRow = {
    id?: string
    isSuperAdmin: boolean
    featuresJson?: string[] | null
    organizationsJson?: string[] | null
    tenantId?: string
    updatedAt?: Date | null
  }

  type Harness = {
    ctx: CommandRuntimeContext
    rows: AclRow[]
    removed: AclRow[]
    calls: { begin: number; commit: number; rollback: number; flush: number }
    invalidatedTenants: string[]
    invalidatedUsers: string[]
    deletedTags: string[]
    order: string[]
    findOneFilters: unknown[]
  }

  function makeHarness(existing: AclRow | null, options: { failWrite?: boolean } = {}): Harness {
    const rows: AclRow[] = existing ? [existing] : []
    const removed: AclRow[] = []
    const calls = { begin: 0, commit: 0, rollback: 0, flush: 0 }
    const invalidatedTenants: string[] = []
    const invalidatedUsers: string[] = []
    const deletedTags: string[] = []
    const order: string[] = []
    const findOneFilters: unknown[] = []

    const em = {
      fork: () => em,
      findOne: async (_entity: unknown, where: unknown) => {
        findOneFilters.push(where)
        return rows[0] ?? null
      },
      create: (_entity: unknown, data: AclRow) => {
        const row: AclRow = { id: 'created-acl', isSuperAdmin: false, ...data }
        rows.push(row)
        return row
      },
      getReference: (_entity: unknown, id: string) => ({ id }),
      persist: () => undefined,
      remove: (row: AclRow) => {
        removed.push(row)
        const at = rows.indexOf(row)
        if (at >= 0) rows.splice(at, 1)
      },
      begin: async () => {
        calls.begin += 1
      },
      commit: async () => {
        calls.commit += 1
        order.push('commit')
      },
      rollback: async () => {
        calls.rollback += 1
      },
      flush: async () => {
        calls.flush += 1
        if (options.failWrite) throw new Error('db failure during ACL write')
      },
    } as unknown as EntityManager

    const rbacService = {
      invalidateTenantCache: async (id: string) => {
        invalidatedTenants.push(id)
        order.push('invalidateTenant')
      },
      invalidateUserCache: async (id: string) => {
        invalidatedUsers.push(id)
        order.push('invalidateUser')
      },
    }

    const cache = {
      deleteByTags: async (tags: string[]) => {
        deletedTags.push(...tags)
        order.push('deleteByTags')
      },
    }

    const container = {
      resolve: (token: string) => {
        if (token === 'em') return em
        if (token === 'rbacService') return rbacService
        if (token === 'cache') return cache
        throw new Error(`Unexpected dependency: ${token}`)
      },
    }

    return {
      ctx: {
        container: container as unknown as CommandRuntimeContext['container'],
        auth: { sub: 'admin-1', tenantId, orgId: 'org-1' } as never,
        organizationScope: null,
        selectedOrganizationId: 'org-1',
        organizationIds: ['org-1'],
        request: undefined as never,
      },
      rows,
      removed,
      calls,
      invalidatedTenants,
      invalidatedUsers,
      deletedTags,
      order,
      findOneFilters,
    }
  }

  function roleHandler(): CommandHandler<RoleAclUpdateInput, AclUpdateResult> {
    return commandRegistry.get('auth.role-acl.update') as CommandHandler<RoleAclUpdateInput, AclUpdateResult>
  }

  function userHandler(): CommandHandler<UserAclUpdateInput, AclUpdateResult> {
    return commandRegistry.get('auth.user-acl.update') as CommandHandler<UserAclUpdateInput, AclUpdateResult>
  }

  const roleInput: RoleAclUpdateInput = {
    roleId,
    tenantId,
    isSuperAdmin: false,
    features: ['auth.acl.manage', 'audit_logs.view_self'],
    organizations: null,
  }

  const userInput: UserAclUpdateInput = {
    userId,
    tenantId,
    isSuperAdmin: false,
    features: ['audit_logs.view_self'],
    organizations: ['org-1'],
    clear: false,
  }

  describe('auth.role-acl.update', () => {
    it('creates the role ACL row when none exists', async () => {
      const harness = makeHarness(null)
      const result = await roleHandler().execute(roleInput, harness.ctx)

      expect(harness.rows).toHaveLength(1)
      expect(harness.rows[0]).toMatchObject({
        isSuperAdmin: false,
        featuresJson: ['auth.acl.manage', 'audit_logs.view_self'],
        organizationsJson: null,
        tenantId,
      })
      expect(result).toEqual({ resourceId: roleId, tenantId, organizationId: 'org-1' })
    })

    it('scopes every ACL lookup by role and tenant', async () => {
      const harness = makeHarness(null)
      await roleHandler().prepare!(roleInput, harness.ctx)
      const result = await roleHandler().execute(roleInput, harness.ctx)
      await roleHandler().captureAfter!(roleInput, result, harness.ctx)

      // prepare + execute + captureAfter each look the row up; a handler that
      // dropped the tenant predicate could cross tenants unnoticed.
      expect(harness.findOneFilters).toHaveLength(3)
      for (const filter of harness.findOneFilters) {
        expect(filter).toEqual({ role: roleId, tenantId })
      }
    })

    it('updates an existing role ACL row in place', async () => {
      const existing: AclRow = { id: 'acl-1', isSuperAdmin: true, featuresJson: ['stale.feature'], tenantId }
      const harness = makeHarness(existing)

      await roleHandler().execute(roleInput, harness.ctx)

      expect(harness.rows).toHaveLength(1)
      expect(existing.isSuperAdmin).toBe(false)
      expect(existing.featuresJson).toEqual(['auth.acl.manage', 'audit_logs.view_self'])
    })

    it('does not stamp the actor organization onto a foreign-tenant entry', async () => {
      // A super admin may edit a role in another tenant. `ActionLogService`
      // filters `organization_id` with strict equality on top of the tenant
      // predicate, so pairing tenant B with the actor's tenant-A organization
      // would produce a row no reader can match.
      const foreignTenantId = '44444444-4444-4444-8444-444444444444'
      const harness = makeHarness(null)

      const result = await roleHandler().execute(
        { ...roleInput, tenantId: foreignTenantId },
        harness.ctx,
      )

      expect(result.tenantId).toBe(foreignTenantId)
      expect(result.organizationId).toBeNull()
    })

    it('commits the write in a transaction and invalidates caches only afterwards', async () => {
      const harness = makeHarness(null)
      await roleHandler().execute(roleInput, harness.ctx)

      expect(harness.calls.begin).toBe(1)
      expect(harness.calls.commit).toBe(1)
      expect(harness.calls.rollback).toBe(0)
      expect(harness.invalidatedTenants).toEqual([tenantId])
      expect(harness.deletedTags).toEqual([`rbac:tenant:${tenantId}`])
      // Cache invalidation must follow the commit, never run inside the flush.
      expect(harness.order).toEqual(['commit', 'invalidateTenant', 'deleteByTags'])
    })

    it('rolls back and leaves caches untouched when the write fails', async () => {
      const harness = makeHarness(null, { failWrite: true })

      await expect(roleHandler().execute(roleInput, harness.ctx)).rejects.toThrow('db failure during ACL write')

      expect(harness.calls.rollback).toBe(1)
      expect(harness.calls.commit).toBe(0)
      expect(harness.invalidatedTenants).toEqual([])
      expect(harness.deletedTags).toEqual([])
    })

    it('builds an audit entry scoped to the role ACL resource', async () => {
      const harness = makeHarness(null)
      const before = await roleHandler().prepare!(roleInput, harness.ctx)
      const result = await roleHandler().execute(roleInput, harness.ctx)
      const after = await roleHandler().captureAfter!(roleInput, result, harness.ctx)

      const metadata = (await roleHandler().buildLog!({
        input: roleInput,
        result,
        ctx: harness.ctx,
        snapshots: { before: before?.before, after },
      })) as CommandLogMetadata

      expect(metadata.resourceKind).toBe('auth.role_acl')
      expect(metadata.resourceId).toBe(roleId)
      expect(metadata.tenantId).toBe(tenantId)
      expect(metadata.organizationId).toBe('org-1')
      expect(metadata.actionLabel).toBe('Change role permissions')
      expect(metadata.snapshotBefore).toEqual({ isSuperAdmin: false, features: [], organizations: null })
      expect(metadata.snapshotAfter).toEqual({
        isSuperAdmin: false,
        features: ['audit_logs.view_self', 'auth.acl.manage'],
        organizations: null,
      })
    })

    it('normalizes grant order so a re-ordered feature list is not a change', async () => {
      // Grants are sets, but `features_json` keeps the client's insertion order.
      // The bus derives `changes` with an order-sensitive deep equality check,
      // so unsorted snapshots would report a features change on every re-save.
      const existing: AclRow = {
        id: 'acl-1',
        isSuperAdmin: false,
        featuresJson: ['audit_logs.view_self', 'auth.acl.manage'],
        organizationsJson: ['org-b', 'org-a'],
        tenantId,
      }
      const harness = makeHarness(existing)
      const reordered: RoleAclUpdateInput = {
        ...roleInput,
        features: ['auth.acl.manage', 'audit_logs.view_self'],
        organizations: ['org-a', 'org-b'],
      }

      const before = await roleHandler().prepare!(reordered, harness.ctx)
      const result = await roleHandler().execute(reordered, harness.ctx)
      const after = await roleHandler().captureAfter!(reordered, result, harness.ctx)

      expect(after).toEqual(before?.before)
    })
  })

  describe('auth.user-acl.update', () => {
    it('creates the user ACL override when none exists', async () => {
      const harness = makeHarness(null)
      const result = await userHandler().execute(userInput, harness.ctx)

      expect(harness.rows).toHaveLength(1)
      expect(harness.rows[0]).toMatchObject({
        isSuperAdmin: false,
        featuresJson: ['audit_logs.view_self'],
        organizationsJson: ['org-1'],
      })
      expect(result).toEqual({ resourceId: userId, tenantId, organizationId: 'org-1' })
    })

    it('scopes every ACL lookup by user and tenant', async () => {
      const harness = makeHarness(null)
      await userHandler().prepare!(userInput, harness.ctx)
      const result = await userHandler().execute(userInput, harness.ctx)
      await userHandler().captureAfter!(userInput, result, harness.ctx)

      expect(harness.findOneFilters).toHaveLength(3)
      for (const filter of harness.findOneFilters) {
        expect(filter).toEqual({ user: userId, tenantId })
      }
    })

    it('records an unknown post-state rather than echoing the request when the re-read misses', async () => {
      const harness = makeHarness(null)
      const result = await userHandler().execute(userInput, harness.ctx)
      // Drop the row behind the command's back: the write committed, so a
      // missing row means the re-read is wrong, not that the state is empty.
      harness.rows.length = 0

      expect(await userHandler().captureAfter!(userInput, result, harness.ctx)).toBeNull()
    })

    it('removes the override row on the clear path', async () => {
      const existing: AclRow = { id: 'acl-9', isSuperAdmin: true, featuresJson: ['auth.acl.manage'], tenantId }
      const harness = makeHarness(existing)

      await userHandler().execute({ ...userInput, clear: true, isSuperAdmin: false, features: [] }, harness.ctx)

      expect(harness.removed).toEqual([existing])
      expect(harness.rows).toHaveLength(0)
      expect(harness.calls.commit).toBe(1)
    })

    it('reports the cleared state as the after-snapshot', async () => {
      const existing: AclRow = { id: 'acl-9', isSuperAdmin: true, featuresJson: ['auth.acl.manage'], tenantId }
      const harness = makeHarness(existing)
      const cleared: UserAclUpdateInput = { ...userInput, clear: true, isSuperAdmin: false, features: [] }

      const before = await userHandler().prepare!(cleared, harness.ctx)
      const result = await userHandler().execute(cleared, harness.ctx)
      const after = await userHandler().captureAfter!(cleared, result, harness.ctx)

      const metadata = (await userHandler().buildLog!({
        input: cleared,
        result,
        ctx: harness.ctx,
        snapshots: { before: before?.before, after },
      })) as CommandLogMetadata

      expect(metadata.resourceKind).toBe('auth.user_acl')
      expect(metadata.resourceId).toBe(userId)
      expect(metadata.actionLabel).toBe('Change user permissions')
      expect(metadata.snapshotBefore).toEqual({
        isSuperAdmin: true,
        features: ['auth.acl.manage'],
        organizations: null,
      })
      expect(metadata.snapshotAfter).toEqual({ isSuperAdmin: false, features: [], organizations: null })
    })

    it('invalidates the per-user RBAC caches after the commit', async () => {
      const harness = makeHarness(null)
      await userHandler().execute(userInput, harness.ctx)

      expect(harness.invalidatedUsers).toEqual([userId])
      expect(harness.deletedTags).toEqual([`rbac:user:${userId}`])
      expect(harness.order).toEqual(['commit', 'invalidateUser', 'deleteByTags'])
    })
  })

  describe('undo policy', () => {
    it.each([
      ['auth.role-acl.update'],
      ['auth.user-acl.update'],
    ])('%s is log-only, so the bus mints no undo token', (commandId) => {
      const handler = commandRegistry.get(commandId) as CommandHandler
      expect(handler).toBeDefined()
      expect(handler.isUndoable).toBe(false)
      expect(handler.undo).toBeUndefined()
      expect(handler.redo).toBeUndefined()
      // Still fully audited — the entry carries before/after, just no undo verb.
      expect(handler.buildLog).toBeDefined()
    })
  })
})
