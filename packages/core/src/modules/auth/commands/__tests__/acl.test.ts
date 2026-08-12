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

// The target lookup only needs the plaintext identity here; decryption itself
// is covered by the encryption suite.
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (
    em: { findOne: (entity: unknown, where: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
  ) => em.findOne(entity, where),
}))

import '@open-mercato/core/modules/auth/commands/acl'
import { Role, User } from '@open-mercato/core/modules/auth/data/entities'
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

  type TargetRow = { id: string; name?: string | null; email?: string | null; tenantId?: string | null }

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
    targetFilters: unknown[]
  }

  const targetRole: TargetRow = { id: roleId, name: 'qa-auditors', tenantId }
  const targetUser: TargetRow = {
    id: userId,
    name: 'QA Target',
    email: 'qa-target@example.com',
    tenantId,
  }

  function makeHarness(
    existing: AclRow | null,
    options: {
      failWrite?: boolean
      failInvalidate?: boolean
      failTargetLookup?: boolean
      role?: TargetRow | null
      user?: TargetRow | null
    } = {},
  ): Harness {
    const rows: AclRow[] = existing ? [existing] : []
    const removed: AclRow[] = []
    const calls = { begin: 0, commit: 0, rollback: 0, flush: 0 }
    const invalidatedTenants: string[] = []
    const invalidatedUsers: string[] = []
    const deletedTags: string[] = []
    const order: string[] = []
    const findOneFilters: unknown[] = []
    const targetFilters: unknown[] = []

    const em = {
      fork: () => em,
      findOne: async (entity: unknown, where: unknown) => {
        if (entity === Role || entity === User) {
          targetFilters.push(where)
          if (options.failTargetLookup) throw new Error('target lookup failed')
          // `undefined` means "use the default row"; an explicit `null` is the
          // out-of-scope target the lookup must not resolve.
          const row = entity === Role
            ? (options.role !== undefined ? options.role : targetRole)
            : (options.user !== undefined ? options.user : targetUser)
          return row
        }
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
        if (options.failInvalidate) throw new Error('cache adapter unavailable')
        invalidatedTenants.push(id)
        order.push('invalidateTenant')
      },
      invalidateUserCache: async (id: string) => {
        if (options.failInvalidate) throw new Error('cache adapter unavailable')
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
      targetFilters,
    }
  }

  /** Mirrors what the bus does: prepare → execute → captureAfter → buildLog. */
  async function runAndBuildLog<TInput extends RoleAclUpdateInput | UserAclUpdateInput>(
    handler: CommandHandler<TInput, AclUpdateResult>,
    input: TInput,
    harness: Harness,
  ): Promise<CommandLogMetadata> {
    const before = await handler.prepare!(input, harness.ctx)
    const result = await handler.execute(input, harness.ctx)
    const after = await handler.captureAfter!(input, result, harness.ctx)
    return (await handler.buildLog!({
      input,
      result,
      ctx: harness.ctx,
      snapshots: { before: before?.before, after },
    })) as CommandLogMetadata
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

    it('still returns a loggable result when cache invalidation fails', async () => {
      // The bus persists the action log only after `execute` resolves, so a
      // throw from cache invalidation would commit the permission change and
      // then suppress its audit entry — the exact hole these commands close.
      const harness = makeHarness(null, { failInvalidate: true })

      const result = await roleHandler().execute(roleInput, harness.ctx)

      expect(result).toEqual({ resourceId: roleId, tenantId, organizationId: 'org-1' })
      expect(harness.calls.commit).toBe(1)
      expect(harness.invalidatedTenants).toEqual([])
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
      const metadata = await runAndBuildLog(roleHandler(), roleInput, harness)

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
      // `action_logs` has no label column, so an entry that names the role only
      // by uuid stops being readable once the role is deleted.
      expect(metadata.context).toEqual({
        target: { kind: 'role', id: roleId, name: 'qa-auditors' },
        effect: 'granted',
      })
    })

    it('records no entry when the submitted ACL matches the stored one', async () => {
      // The admin forms re-submit the ACL on every save, so an unchanged grant
      // set would otherwise bury real permission changes under empty entries.
      const existing: AclRow = {
        id: 'acl-1',
        isSuperAdmin: false,
        featuresJson: ['audit_logs.view_self', 'auth.acl.manage'],
        organizationsJson: null,
        tenantId,
      }
      const harness = makeHarness(existing)

      const metadata = await runAndBuildLog(roleHandler(), roleInput, harness)

      expect(metadata).toEqual({ skipLog: true })
      // The skipped entry must not pay for the enrichment either.
      expect(harness.targetFilters).toEqual([])
    })

    it('labels a cleared grant set as revoked', async () => {
      const existing: AclRow = {
        id: 'acl-1',
        isSuperAdmin: false,
        featuresJson: ['auth.acl.manage'],
        organizationsJson: null,
        tenantId,
      }
      const harness = makeHarness(existing)

      const metadata = await runAndBuildLog(roleHandler(), { ...roleInput, features: [] }, harness)

      expect(metadata.skipLog).toBeFalsy()
      expect((metadata.context as { effect?: string }).effect).toBe('revoked')
    })

    it('still records the entry when the target lookup fails', async () => {
      // The write has already committed by the time `buildLog` runs, so a
      // failed enrichment must cost the label, never the entry.
      const harness = makeHarness(null, { failTargetLookup: true })

      const metadata = await runAndBuildLog(roleHandler(), roleInput, harness)

      expect(metadata.skipLog).toBeFalsy()
      expect(metadata.resourceId).toBe(roleId)
      expect(metadata.context).toEqual({ effect: 'granted' })
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

      const metadata = await runAndBuildLog(userHandler(), cleared, harness)

      expect(metadata.resourceKind).toBe('auth.user_acl')
      expect(metadata.resourceId).toBe(userId)
      expect(metadata.actionLabel).toBe('Change user permissions')
      expect(metadata.snapshotBefore).toEqual({
        isSuperAdmin: true,
        features: ['auth.acl.manage'],
        organizations: null,
      })
      expect(metadata.snapshotAfter).toEqual({ isSuperAdmin: false, features: [], organizations: null })
      expect(metadata.context).toEqual({
        target: { kind: 'user', id: userId, email: 'qa-target@example.com', name: 'QA Target' },
        effect: 'revoked',
      })
    })

    it('scopes the target lookup to the tenant the entry is written in', async () => {
      // `userId` comes from the request body and the row carries encrypted
      // personal data: an id from another tenant must not be decrypted under
      // this scope and stamped into this tenant's trail.
      const harness = makeHarness(null)

      await runAndBuildLog(userHandler(), userInput, harness)

      expect(harness.targetFilters).toEqual([
        { id: userId, $or: [{ tenantId }, { tenantId: null }] },
      ])
    })

    it('records the entry without a target when the user is out of scope', async () => {
      const harness = makeHarness(null, { user: null })

      const metadata = await runAndBuildLog(userHandler(), userInput, harness)

      expect(metadata.skipLog).toBeFalsy()
      expect(metadata.context).toEqual({ effect: 'granted' })
    })

    it('keeps a silently trimmed grant attempt out of the no-op guard', async () => {
      // `sanitizeTenantFeatures` drops restricted grants instead of refusing
      // them, so the attempt leaves before and after identical. Suppressing it
      // as a no-op would make the escalation attempt less visible than before.
      const existing: AclRow = {
        id: 'acl-9',
        isSuperAdmin: false,
        featuresJson: ['audit_logs.view_self'],
        organizationsJson: ['org-1'],
        tenantId,
      }
      const harness = makeHarness(existing)
      const trimmed: UserAclUpdateInput = {
        ...userInput,
        requested: { isSuperAdmin: false, features: ['audit_logs.view_self', 'directory.tenants.manage'] },
      }

      const metadata = await runAndBuildLog(userHandler(), trimmed, harness)

      expect(metadata.skipLog).toBeFalsy()
      expect(metadata.snapshotBefore).toEqual(metadata.snapshotAfter)
      expect(metadata.context).toEqual({
        target: { kind: 'user', id: userId, email: 'qa-target@example.com', name: 'QA Target' },
        sanitizedRequest: {
          isSuperAdmin: false,
          features: ['audit_logs.view_self', 'directory.tenants.manage'],
        },
      })
    })

    it('does not label an unchanged ACL with an effect', async () => {
      // The entry exists *because* nothing changed; an effect label would have
      // it assert a permission change that never happened.
      const existing: AclRow = {
        id: 'acl-9',
        isSuperAdmin: false,
        featuresJson: ['audit_logs.view_self'],
        organizationsJson: ['org-1'],
        tenantId,
      }
      const harness = makeHarness(existing)
      const trimmed: UserAclUpdateInput = {
        ...userInput,
        requested: { isSuperAdmin: true, features: ['audit_logs.view_self'] },
      }

      const metadata = await runAndBuildLog(userHandler(), trimmed, harness)

      expect((metadata.context as { effect?: string }).effect).toBeUndefined()
    })

    it('records no entry when the override is re-saved unchanged', async () => {
      const existing: AclRow = {
        id: 'acl-9',
        isSuperAdmin: false,
        featuresJson: ['audit_logs.view_self'],
        organizationsJson: ['org-1'],
        tenantId,
      }
      const harness = makeHarness(existing)

      expect(await runAndBuildLog(userHandler(), userInput, harness)).toEqual({ skipLog: true })
    })

    it('records no entry when a user without an override is saved again', async () => {
      // The most common shape by far: the user-edit page PUTs the ACL on every
      // save and almost nobody carries a per-user override, so both snapshots
      // are the empty ACL.
      const harness = makeHarness(null)
      const cleared: UserAclUpdateInput = {
        ...userInput,
        clear: true,
        features: [],
        organizations: null,
      }

      expect(await runAndBuildLog(userHandler(), cleared, harness)).toEqual({ skipLog: true })
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
