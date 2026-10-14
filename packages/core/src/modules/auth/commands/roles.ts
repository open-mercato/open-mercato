import type { CommandHandler, CommandReplayAuthorizationArgs, CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError, forbidden } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { Role, RoleAcl, UserRole } from '@open-mercato/core/modules/auth/data/entities'
import { E } from '#generated/entities.ids.generated'
import {
  loadCustomFieldSnapshot,
  buildCustomFieldResetMap,
  diffCustomFieldChanges,
} from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { resolveRedoSnapshot } from '@open-mercato/shared/lib/commands/redo'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveIsSuperAdmin, normalizeTenantId } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import {
  assertActorCanAccessRoleTarget,
  assertActorCanGrantAcl,
  assertActorCanModifySuperAdminRoleTarget,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  assertReplaySnapshotMatches,
  extractStoredReplayInput,
  lockReplayAuthorizationState,
  rerunReplayTransactionGuardAfterLocks,
  requireCurrentReplayFeature,
  requireCurrentReplaySuperAdmin,
  requireTransactionalReplayEntityManager,
} from '@open-mercato/core/modules/auth/lib/commandReplay'
import { lockRoleWriterAuthorizationState } from '@open-mercato/core/modules/auth/lib/authorizationStateLocks'

type SerializedRole = {
  name: string
  tenantId: string
  custom?: Record<string, unknown>
}

type RoleAclSnapshot = {
  id: string | null
  tenantId: string
  features: string[] | null
  isSuperAdmin: boolean
  organizations: string[] | null
}

type RoleUndoSnapshot = {
  id: string
  name: string
  tenantId: string
  acls: RoleAclSnapshot[]
  custom?: Record<string, unknown>
}

type RoleSnapshots = {
  view: SerializedRole
  undo: RoleUndoSnapshot
}

const ROLE_REDO_LOG = Symbol('auth.roles.redoLog')

type RoleReplayRuntimeContext = CommandRuntimeContext & {
  [ROLE_REDO_LOG]?: CommandUndoLogEntry
}

function withRoleRedoLog(ctx: CommandRuntimeContext, logEntry: CommandUndoLogEntry): RoleReplayRuntimeContext {
  return { ...ctx, [ROLE_REDO_LOG]: logEntry }
}

function resolveCommandEm(ctx: CommandRuntimeContext, forkWhenUnbound = false): EntityManager {
  if (ctx.transactionalEm) return ctx.transactionalEm
  const em = ctx.container.resolve('em') as EntityManager
  return forkWhenUnbound ? em.fork() : em
}

function resolveActorTenantScope(ctx: CommandRuntimeContext): string | null {
  if (ctx.systemActor === true) return null
  const auth = ctx.auth
  if (!auth) return null
  if ((auth as { isSuperAdmin?: boolean }).isSuperAdmin === true) return null
  return normalizeTenantId(auth.tenantId ?? null) ?? null
}

function assertRoleTenantInScope(actorTenantScope: string | null, targetTenantId: unknown): void {
  if (!actorTenantScope) return
  const targetTenant = normalizeTenantId(targetTenantId) ?? null
  if (!targetTenant || targetTenant !== actorTenantScope) {
    throw new CrudHttpError(404, { error: 'Role not found' })
  }
}

const RESERVED_ROLE_NAMES = new Set(['superadmin', 'admin'])

function isReservedRoleName(name: string | undefined | null): boolean {
  if (typeof name !== 'string') return false
  const normalized = name.trim().toLowerCase()
  return normalized.length > 0 && RESERVED_ROLE_NAMES.has(normalized)
}

function assertRoleNameAllowed(name: string | undefined | null) {
  if (isReservedRoleName(name)) {
    throw new CrudHttpError(400, { error: 'Role name is reserved' })
  }
}

type ResolvedActorScope = { isSuperAdmin: boolean; actorTenantId: string | null }

async function resolveActorScope(ctx: { auth: { tenantId?: string | null; sub?: string | null; orgId?: string | null; isSuperAdmin?: boolean } | null; container: { resolve<T = unknown>(name: string): T } }): Promise<ResolvedActorScope> {
  const isSuperAdmin = await resolveIsSuperAdmin(ctx)
  const actorTenantId = normalizeTenantId(ctx.auth?.tenantId ?? null) ?? null
  return { isSuperAdmin, actorTenantId }
}

function buildScopedRoleFilter(roleId: string, scope: ResolvedActorScope): FilterQuery<Role> {
  const filter: FilterQuery<Role> = { id: roleId, deletedAt: null }
  if (!scope.isSuperAdmin) {
    ;(filter as Record<string, unknown>).tenantId = scope.actorTenantId
  }
  return filter
}

const createSchema = z.object({
  name: z.string().min(2).max(100),
  tenantId: z.string().uuid().optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100).optional(),
  tenantId: z.string().uuid().optional(),
})

export const roleCrudEvents: CrudEventsConfig = {
  module: 'auth',
  entity: 'role',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const roleCrudIndexer: CrudIndexerConfig = {
  entityType: E.auth.role,
  buildUpsertPayload: (ctx) => ({
    entityType: E.auth.role,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
  }),
  buildDeletePayload: (ctx) => ({
    entityType: E.auth.role,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
  }),
}

const createRoleCommand: CommandHandler<Record<string, unknown>, Role> = {
  id: 'auth.roles.create',
  atomicReplay: true,
  stabilizeReplay: stabilizeRoleReplay,
  authorizeReplay: (params) => authorizeRoleReplay('create', params),
  async execute(rawInput, ctx) {
    const rawBody = rawInput && typeof rawInput === 'object' ? rawInput as Record<string, unknown> : {}
    if ('tenantId' in rawBody && rawBody.tenantId === null) {
      throw new CrudHttpError(400, { error: 'tenantId cannot be null — global roles are not supported' })
    }
    const { parsed, custom } = parseWithCustomFields(createSchema, rawInput)
    assertRoleNameAllowed(parsed.name)
    const scope = await resolveActorScope(ctx)
    const requestedTenantId = parsed.tenantId ?? null
    if (!scope.isSuperAdmin && requestedTenantId && requestedTenantId !== scope.actorTenantId) {
      throw new CrudHttpError(403, { error: 'Not authorized to target this tenant.' })
    }
    const resolvedTenantId = scope.isSuperAdmin
      ? (requestedTenantId ?? scope.actorTenantId)
      : scope.actorTenantId
    if (!resolvedTenantId) {
      throw new CrudHttpError(400, { error: 'tenantId is required — global roles are not supported' })
    }
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const role = await de.createOrmEntity({
      entity: Role,
      data: {
        name: parsed.name,
        tenantId: resolvedTenantId,
      },
    })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.auth.role,
      recordId: String(role.id),
      organizationId: null,
      tenantId: resolvedTenantId,
      values: custom,
    })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: role,
      identifiers: {
        id: String(role.id),
        organizationId: null,
        tenantId: resolvedTenantId,
      },
      events: roleCrudEvents,
      indexer: roleCrudIndexer,
    })

    return role
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveCommandEm(ctx, true)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.auth.role,
      recordId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
    })
    return serializeRole(result, custom)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = resolveCommandEm(ctx, true)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.auth.role,
      recordId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
    })
    const snapshot = captureRoleSnapshots(result, [], custom)
    return {
      actionLabel: translate('auth.audit.roles.create', 'Create role'),
      resourceKind: 'auth.role',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      snapshotAfter: snapshot.view,
      payload: {
        undo: {
          after: snapshot.undo,
        },
      },
    }
  },
  undo: async ({ input, logEntry, ctx }) => {
    const undo = extractUndoPayload<RoleUndoPayload>(logEntry)?.after
    if (!undo) return
    const em = resolveCommandEm(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    await withAtomicFlush(em, [async () => {
      await authorizeRoleReplayAtMutation('create', {
        operation: 'undo',
        input,
        ctx,
        logEntry,
      })
      await lockRoleWriterAuthorizationState(em, [undo.id])
      await em.nativeDelete(RoleAcl, { role: undo.id as unknown as Role })
      if (undo.custom && Object.keys(undo.custom).length) {
        const reset = buildCustomFieldResetMap(undefined, undo.custom)
        if (Object.keys(reset).length) {
          await setCustomFieldsIfAny({
            dataEngine: de,
            entityId: E.auth.role,
            recordId: undo.id,
            organizationId: null,
            tenantId: undo.tenantId ?? null,
            values: reset,
            notify: false,
          })
        }
      }
      await de.deleteOrmEntity({
        entity: Role,
        where: { id: undo.id, deletedAt: null } as FilterQuery<Role>,
        soft: false,
      })
    }], { transaction: true, label: 'auth.roles.create.undo' })
  },
  redo: async ({ input, logEntry, ctx }) => {
    const after = resolveRedoSnapshot<RoleUndoSnapshot>(logEntry)
    if (!after) throw new CrudHttpError(400, { error: '[internal] redo snapshot unavailable for role create' })
    const em = resolveCommandEm(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let role: Role | null = null
    await withAtomicFlush(em, [async () => {
      await authorizeRoleReplayAtMutation('create', {
        operation: 'redo',
        input,
        ctx,
        logEntry,
      })
      role = await findOneWithDecryption(em, Role, { id: after.id }, {}, { tenantId: null, organizationId: null })
      if (role) {
        role.deletedAt = null
        role.name = after.name
        role.tenantId = after.tenantId
        await em.flush()
      } else {
        role = await de.createOrmEntity({
          entity: Role,
          data: {
            id: after.id,
            name: after.name,
            tenantId: after.tenantId,
          },
        })
      }
      await restoreRoleAcls(em, after.id, after.acls)
      if (after.custom && Object.keys(after.custom).length) {
        const reset = buildCustomFieldResetMap(after.custom, undefined)
        if (Object.keys(reset).length) {
          await setCustomFieldsIfAny({
            dataEngine: de,
            entityId: E.auth.role,
            recordId: after.id,
            organizationId: null,
            tenantId: after.tenantId ?? null,
            values: reset,
            notify: false,
          })
        }
      }
    }], { transaction: true, label: 'auth.roles.create.redo' })
    if (!role) throw new CrudHttpError(400, { error: '[internal] redo failed to restore role row' })
    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: role,
      identifiers: {
        id: after.id,
        organizationId: null,
        tenantId: after.tenantId ?? null,
      },
      events: roleCrudEvents,
      indexer: roleCrudIndexer,
    })
    return role
  },
}

const updateRoleCommand: CommandHandler<Record<string, unknown>, Role> = {
  id: 'auth.roles.update',
  atomicReplay: true,
  stabilizeReplay: stabilizeRoleReplay,
  authorizeReplay: (params) => authorizeRoleReplay('update', params),
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(updateSchema, rawInput)
    const em = resolveCommandEm(ctx)
    const scope = await resolveActorScope(ctx)
    const existing = await findOneWithDecryption(em, Role, buildScopedRoleFilter(parsed.id, scope), {}, { tenantId: scope.actorTenantId, organizationId: null })
    if (!existing) throw new CrudHttpError(404, { error: 'Role not found' })
    assertRoleTenantInScope(resolveActorTenantScope(ctx), existing.tenantId)
    const acls = await loadRoleAclSnapshots(em, parsed.id)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.auth.role,
      recordId: parsed.id,
      tenantId: existing.tenantId ? String(existing.tenantId) : null,
    })
    return { before: captureRoleSnapshots(existing, acls, custom) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(updateSchema, rawInput)
    const em = resolveCommandEm(ctx)
    const scope = await resolveActorScope(ctx)
    const current = await findOneWithDecryption(em, Role, buildScopedRoleFilter(parsed.id, scope), {}, { tenantId: scope.actorTenantId, organizationId: null })
    if (!current) throw new CrudHttpError(404, { error: 'Role not found' })
    const actorTenantScope = resolveActorTenantScope(ctx)
    assertRoleTenantInScope(actorTenantScope, current.tenantId)
    if (parsed.name !== undefined) {
      const nextName = parsed.name
      if (nextName !== current.name) assertRoleNameAllowed(nextName)
      if (nextName !== current.name) {
        const assignments = await em.count(UserRole, { role: current, deletedAt: null })
        if (assignments > 0) {
          throw new CrudHttpError(400, { error: 'Role name cannot be changed while users are assigned' })
        }
      }
    }
    const wantsTenantChange = parsed.tenantId !== undefined && parsed.tenantId !== current.tenantId
    if (wantsTenantChange) {
      if (!scope.isSuperAdmin) {
        throw new CrudHttpError(403, { error: 'Not authorized to target this tenant.' })
      }
      const assignments = await em.count(UserRole, { role: current, deletedAt: null })
      if (assignments > 0) {
        throw new CrudHttpError(400, { error: 'Role cannot be moved to another tenant while users are assigned' })
      }
    }
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const redoLogEntry = (ctx as RoleReplayRuntimeContext)[ROLE_REDO_LOG]
    let role: Role | null = null
    await withAtomicFlush(em, [async () => {
      if (redoLogEntry) {
        await authorizeRoleReplayAtMutation('update', {
          operation: 'redo',
          input: rawInput,
          ctx,
          logEntry: redoLogEntry,
        })
      }
      await lockRoleWriterAuthorizationState(em, [parsed.id])
      if (wantsTenantChange) {
        await em.nativeDelete(RoleAcl, { role: parsed.id as unknown as Role })
      }
      role = await de.updateOrmEntity({
        entity: Role,
        where: buildScopedRoleFilter(parsed.id, scope),
        apply: (entity) => {
          if (parsed.name !== undefined) entity.name = parsed.name
          if (parsed.tenantId !== undefined && scope.isSuperAdmin) entity.tenantId = parsed.tenantId
        },
      })
      if (!role) throw new CrudHttpError(404, { error: 'Role not found' })

      await setCustomFieldsIfAny({
        dataEngine: de,
        entityId: E.auth.role,
        recordId: String(role.id),
        organizationId: null,
        tenantId: role.tenantId ? String(role.tenantId) : null,
        values: custom,
      })
    }], {
      transaction: true,
      label: redoLogEntry ? 'auth.roles.update.redo' : 'auth.roles.update',
    })
    const updatedRole = role as Role | null
    if (!updatedRole) throw new CrudHttpError(404, { error: 'Role not found' })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updatedRole,
      identifiers: {
        id: String(updatedRole.id),
        organizationId: null,
        tenantId: updatedRole.tenantId ? String(updatedRole.tenantId) : null,
      },
      events: roleCrudEvents,
      indexer: roleCrudIndexer,
    })

    return updatedRole
  },
  captureAfter: async (_input, result, ctx) => {
    const em = resolveCommandEm(ctx, true)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.auth.role,
      recordId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
    })
    return serializeRole(result, custom)
  },
  buildLog: async ({ result, snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeSnapshots = snapshots.before as RoleSnapshots | undefined
    const before = beforeSnapshots?.view
    const beforeUndo = beforeSnapshots?.undo ?? null
    const em = resolveCommandEm(ctx, true)
    const afterAcls = await loadRoleAclSnapshots(em, String(result.id))
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.auth.role,
      recordId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
    })
    const afterSnapshots = captureRoleSnapshots(result, afterAcls, custom)
    const after = afterSnapshots.view
    const changes = buildChanges(before ?? null, after as Record<string, unknown>, ['name', 'tenantId'])
    const customDiff = diffCustomFieldChanges(before?.custom, custom)
    for (const [key, diff] of Object.entries(customDiff)) {
      changes[`cf_${key}`] = diff
    }
    return {
      actionLabel: translate('auth.audit.roles.update', 'Update role'),
      resourceKind: 'auth.role',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      changes,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: {
        undo: {
          before: beforeUndo,
          after: afterSnapshots.undo,
        },
      },
    }
  },
  undo: async ({ input, logEntry, ctx }) => {
    const undo = extractUndoPayload<RoleUndoPayload>(logEntry)
    const before = undo?.before
    const after = undo?.after
    if (!before) return
    const storedReplayInput = extractStoredReplayInput(logEntry.commandPayload, logEntry)
    const replayInput = Object.keys(storedReplayInput).length
      ? storedReplayInput
      : deriveRoleUpdateReplayInput(before, after ?? null)
    const em = resolveCommandEm(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let updated: Role | null = null
    await withAtomicFlush(em, [async () => {
      await authorizeRoleReplayAtMutation('update', {
        operation: 'undo',
        input,
        ctx,
        logEntry,
      })
      updated = await de.updateOrmEntity({
        entity: Role,
        where: { id: before.id, deletedAt: null } as FilterQuery<Role>,
        apply: (entity) => {
          if ('name' in replayInput) entity.name = before.name
          if ('tenantId' in replayInput) entity.tenantId = before.tenantId
        },
      })
      const restoresAcls = 'tenantId' in replayInput && after?.tenantId !== before.tenantId
      if (updated && restoresAcls) {
        await restoreRoleAcls(em, before.id, before.acls)
      }
      const reset = buildCustomFieldResetMap(before.custom, after?.custom)
      if (Object.keys(reset).length) {
        await setCustomFieldsIfAny({
          dataEngine: de,
          entityId: E.auth.role,
          recordId: before.id,
          organizationId: null,
          tenantId: before.tenantId,
          values: reset,
          notify: false,
        })
      }
    }], { transaction: true, label: 'auth.roles.update.undo' })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: updated,
      identifiers: {
        id: before.id,
        organizationId: null,
        tenantId: before.tenantId ?? null,
      },
      events: roleCrudEvents,
      indexer: roleCrudIndexer,
    })
  },
  redo: ({ input, ctx, logEntry }) => updateRoleCommand.execute(input, withRoleRedoLog(ctx, logEntry)),
}

const deleteRoleCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, Role> = {
  id: 'auth.roles.delete',
  atomicReplay: true,
  stabilizeReplay: stabilizeRoleReplay,
  authorizeReplay: (params) => authorizeRoleReplay('delete', params),
  async prepare(input, ctx) {
    const id = requireId(input, 'Role id required')
    const em = resolveCommandEm(ctx)
    const scope = await resolveActorScope(ctx)
    const existing = await findOneWithDecryption(em, Role, buildScopedRoleFilter(id, scope), {}, { tenantId: scope.actorTenantId, organizationId: null })
    if (!existing) return {}
    const actorTenantScope = resolveActorTenantScope(ctx)
    if (actorTenantScope) {
      const targetTenant = normalizeTenantId(existing.tenantId) ?? null
      if (!targetTenant || targetTenant !== actorTenantScope) return {}
    }
    const acls = await loadRoleAclSnapshots(em, id)
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.auth.role,
      recordId: id,
      tenantId: existing.tenantId ? String(existing.tenantId) : null,
    })
    return { before: captureRoleSnapshots(existing, acls, custom) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Role id required')
    const em = resolveCommandEm(ctx)
    const scope = await resolveActorScope(ctx)
    const role = await findOneWithDecryption(em, Role, buildScopedRoleFilter(id, scope), {}, { tenantId: scope.actorTenantId, organizationId: null })
    if (!role) throw new CrudHttpError(404, { error: 'Role not found' })
    assertRoleTenantInScope(resolveActorTenantScope(ctx), role.tenantId)

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const redoLogEntry = (ctx as RoleReplayRuntimeContext)[ROLE_REDO_LOG]
    let deleted: Role | null = null
    await withAtomicFlush(em, [async () => {
      if (redoLogEntry) {
        await authorizeRoleReplayAtMutation('delete', {
          operation: 'redo',
          input,
          ctx,
          logEntry: redoLogEntry,
        })
      }
      await lockRoleWriterAuthorizationState(em, [id])
      const activeAssignments = await em.count(UserRole, { role, deletedAt: null })
      if (activeAssignments > 0) throw new CrudHttpError(400, { error: 'Role has assigned users' })
      await em.nativeDelete(RoleAcl, { role: id })
      deleted = await de.deleteOrmEntity({
        entity: Role,
        where: buildScopedRoleFilter(id, scope),
        soft: false,
      })
      if (!deleted) throw new CrudHttpError(404, { error: 'Role not found' })
    }], {
      transaction: true,
      label: redoLogEntry ? 'auth.roles.delete.redo' : 'auth.roles.delete',
    })
    const deletedRole = deleted as Role | null
    if (!deletedRole) throw new CrudHttpError(404, { error: 'Role not found' })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: deletedRole,
      identifiers: {
        id,
        organizationId: null,
        tenantId: deletedRole.tenantId ? String(deletedRole.tenantId) : null,
      },
      events: roleCrudEvents,
      indexer: roleCrudIndexer,
    })

    return deletedRole
  },
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const beforeSnapshots = snapshots.before as RoleSnapshots | undefined
    const before = beforeSnapshots?.view
    const beforeUndo = beforeSnapshots?.undo ?? null
    const id = requireId(input, 'Role id required')
    return {
      actionLabel: translate('auth.audit.roles.delete', 'Delete role'),
      resourceKind: 'auth.role',
      resourceId: id,
      tenantId: before?.tenantId ?? null,
      snapshotBefore: before ?? null,
      payload: {
        undo: {
          before: beforeUndo,
        },
      },
    }
  },
  undo: async ({ input, logEntry, ctx }) => {
    const before = extractUndoPayload<RoleUndoPayload>(logEntry)?.before
    if (!before) return
    const em = resolveCommandEm(ctx)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let role: Role | null = null
    await withAtomicFlush(em, [async () => {
      await authorizeRoleReplayAtMutation('delete', {
        operation: 'undo',
        input,
        ctx,
        logEntry,
      })
      role = await findOneWithDecryption(em, Role, { id: before.id }, {}, { tenantId: null, organizationId: null })
      if (role) {
        role.deletedAt = null
        role.name = before.name
        role.tenantId = before.tenantId
        await em.flush()
      } else {
        role = await de.createOrmEntity({
          entity: Role,
          data: {
            id: before.id,
            name: before.name,
            tenantId: before.tenantId,
          },
        })
      }
      await restoreRoleAcls(em, before.id, before.acls)
      const reset = buildCustomFieldResetMap(before.custom, undefined)
      if (Object.keys(reset).length) {
        await setCustomFieldsIfAny({
          dataEngine: de,
          entityId: E.auth.role,
          recordId: before.id,
          organizationId: null,
          tenantId: before.tenantId ?? null,
          values: reset,
          notify: false,
        })
      }
    }], { transaction: true, label: 'auth.roles.delete.undo' })
    if (!role) throw new CrudHttpError(400, { error: '[internal] undo failed to restore role row' })
    await emitCrudUndoSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: role,
      identifiers: {
        id: before.id,
        organizationId: null,
        tenantId: before.tenantId ?? null,
      },
      events: roleCrudEvents,
      indexer: roleCrudIndexer,
    })
  },
  redo: ({ input, ctx, logEntry }) => deleteRoleCommand.execute(input, withRoleRedoLog(ctx, logEntry)),
}

type RoleReplayCommandKind = 'create' | 'update' | 'delete'

function normalizeRoleAclSnapshots(acls: RoleAclSnapshot[]): RoleAclSnapshot[] {
  return acls
    .map((acl) => ({
      ...acl,
      features: acl.features ? [...acl.features].sort((left, right) => left.localeCompare(right)) : null,
      organizations: acl.organizations ? [...acl.organizations].sort((left, right) => left.localeCompare(right)) : null,
    }))
    .sort((left, right) => {
      const tenantOrder = left.tenantId.localeCompare(right.tenantId)
      if (tenantOrder !== 0) return tenantOrder
      return (left.id ?? '').localeCompare(right.id ?? '')
    })
}

function normalizeRoleReplaySnapshot(snapshot: RoleUndoSnapshot): RoleUndoSnapshot {
  return {
    ...snapshot,
    acls: normalizeRoleAclSnapshots(snapshot.acls),
  }
}

function toRoleUpdateReplayState(snapshot: RoleUndoSnapshot): SerializedRole {
  return {
    name: snapshot.name,
    tenantId: snapshot.tenantId,
    ...(snapshot.custom && Object.keys(snapshot.custom).length ? { custom: snapshot.custom } : {}),
  }
}

function deriveRoleUpdateReplayInput(
  before: RoleUndoSnapshot | null,
  after: RoleUndoSnapshot | null,
): Record<string, unknown> {
  if (!before) return {}
  if (!after) return { id: before.id, name: before.name, tenantId: before.tenantId }
  const input: Record<string, unknown> = { id: after.id }
  if (before.name !== after.name) input.name = after.name
  if (before.tenantId !== after.tenantId) input.tenantId = after.tenantId
  return input
}

async function authorizeRoleReplay(
  commandKind: RoleReplayCommandKind,
  params: CommandReplayAuthorizationArgs<unknown>,
): Promise<void> {
  const { operation, ctx, logEntry } = params
  const em = requireTransactionalReplayEntityManager(ctx)
  await requireCurrentReplayFeature(ctx, 'auth.roles.manage')

  const undoPayload = extractUndoPayload<RoleUndoPayload>(logEntry)
  const before = undoPayload?.before ?? null
  const after = undoPayload?.after ?? null
  const roleId = logEntry.resourceId ?? before?.id ?? after?.id ?? null
  if (!roleId) {
    await assertReplaySnapshotMatches(null, { required: 'role replay snapshot' })
    return
  }

  const currentRole = await findOneWithDecryption(
    em,
    Role,
    { id: roleId, deletedAt: null },
    {},
    { tenantId: null, organizationId: null },
  )
  const rbacService = ctx.systemActor === true
    ? null
    : ctx.container.resolve('rbacService') as RbacService
  if (rbacService && currentRole) {
    await assertActorCanAccessRoleTarget({
      em,
      rbacService,
      requireBoundRbac: true,
      actorUserId: ctx.auth?.sub,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
      targetRoleId: roleId,
    })
    await assertActorCanModifySuperAdminRoleTarget({
      em,
      rbacService,
      requireBoundRbac: true,
      actorUserId: ctx.auth?.sub,
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
      targetRoleId: roleId,
    })
  }

  let currentSnapshot: RoleUndoSnapshot | null = null
  if (currentRole) {
    const currentTenantId = currentRole.tenantId ? String(currentRole.tenantId) : null
    const [acls, custom] = await Promise.all([
      loadRoleAclSnapshots(em, roleId),
      loadCustomFieldSnapshot(em, {
        entityId: E.auth.role,
        recordId: roleId,
        tenantId: currentTenantId,
      }),
    ])
    currentSnapshot = captureRoleSnapshots(currentRole, acls, custom).undo
  }

  const expectedCurrent = operation === 'undo'
    ? commandKind === 'create' ? after : commandKind === 'update' ? after : null
    : commandKind === 'create' ? null : before
  const storedReplayInput = extractStoredReplayInput(params.input, logEntry)
  const replayInput = Object.keys(storedReplayInput).length
    ? storedReplayInput
    : deriveRoleUpdateReplayInput(before, after)
  const movesTenant = commandKind === 'update'
    && 'tenantId' in replayInput
    && before?.tenantId !== after?.tenantId
  if (movesTenant) {
    await requireCurrentReplaySuperAdmin(ctx)
  }

  if (commandKind === 'update' && !movesTenant) {
    if (!currentSnapshot || !expectedCurrent) {
      await assertReplaySnapshotMatches(currentSnapshot, expectedCurrent)
    } else {
      await assertReplaySnapshotMatches(
        toRoleUpdateReplayState(currentSnapshot),
        toRoleUpdateReplayState(expectedCurrent),
      )
    }
  } else {
    await assertReplaySnapshotMatches(
      currentSnapshot ? normalizeRoleReplaySnapshot(currentSnapshot) : null,
      expectedCurrent ? normalizeRoleReplaySnapshot(expectedCurrent) : null,
    )
  }

  const desiredState = operation === 'undo'
    ? commandKind === 'create' ? null : before
    : commandKind === 'delete' ? null : after
  if (desiredState && !currentRole && rbacService) {
    const actorUserId = ctx.auth?.sub
    if (!actorUserId) throw forbidden()
    const actorAcl = await rbacService.loadAclWithEntityManager(em, actorUserId, {
      tenantId: ctx.auth?.tenantId ?? null,
      organizationId: ctx.auth?.orgId ?? null,
    })
    if (!actorAcl.isSuperAdmin) assertRoleTenantInScope(ctx.auth?.tenantId ?? null, desiredState.tenantId)
  }
  const restoresAcls = Boolean(
    desiredState
      && desiredState.acls.length > 0
      && (commandKind !== 'update' || movesTenant),
  )
  if (!restoresAcls || !desiredState || !rbacService) return

  await requireCurrentReplayFeature(ctx, 'auth.acl.manage')
  for (const acl of desiredState.acls) {
    await assertActorCanGrantAcl({
      em,
      rbacService,
      requireBoundRbac: true,
      actorUserId: ctx.auth?.sub,
      tenantId: acl.tenantId,
      organizationId: null,
      features: acl.features,
      isSuperAdmin: acl.isSuperAdmin,
      organizations: acl.organizations,
    })
  }
}

async function authorizeRoleReplayAtMutation(
  commandKind: RoleReplayCommandKind,
  params: CommandReplayAuthorizationArgs<unknown>,
): Promise<void> {
  const em = params.ctx.transactionalEm
    ?? params.ctx.container.resolve('em') as EntityManager
  const boundParams = params.ctx.transactionalEm
    ? params
    : { ...params, ctx: { ...params.ctx, transactionalEm: em } }
  await stabilizeRoleReplay(boundParams)
  await rerunReplayTransactionGuardAfterLocks(boundParams, em)
  await authorizeRoleReplay(commandKind, boundParams)
}

async function stabilizeRoleReplay(
  params: CommandReplayAuthorizationArgs<unknown>,
): Promise<void> {
  const undoPayload = extractUndoPayload<RoleUndoPayload>(params.logEntry)
  const before = undoPayload?.before ?? null
  const after = undoPayload?.after ?? null
  const targetRoleId = params.logEntry.resourceId ?? before?.id ?? after?.id ?? null
  const em = requireTransactionalReplayEntityManager(params.ctx)
  await lockReplayAuthorizationState(em, params.ctx, {
    targetRoleIds: targetRoleId ? [targetRoleId] : [],
    targetTenantIds: [
      ...(before?.tenantId ? [before.tenantId] : []),
      ...(after?.tenantId ? [after.tenantId] : []),
      ...(params.logEntry.tenantId ? [params.logEntry.tenantId] : []),
    ],
  })
}

registerCommand(createRoleCommand)
registerCommand(updateRoleCommand)
registerCommand(deleteRoleCommand)

function serializeRole(role: Role, custom?: Record<string, unknown> | null): SerializedRole {
  const payload: SerializedRole = {
    name: String(role.name ?? ''),
    tenantId: String(role.tenantId),
  }
  if (custom && Object.keys(custom).length) payload.custom = custom
  return payload
}

function captureRoleSnapshots(
  role: Role,
  acls: RoleAclSnapshot[] = [],
  custom?: Record<string, unknown> | null
): RoleSnapshots {
  return {
    view: serializeRole(role, custom),
    undo: {
      id: String(role.id),
      name: String(role.name ?? ''),
      tenantId: String(role.tenantId),
      acls,
      ...(custom && Object.keys(custom).length ? { custom } : {}),
    },
  }
}

async function loadRoleAclSnapshots(em: EntityManager, roleId: string): Promise<RoleAclSnapshot[]> {
  const entries = await findWithDecryption(em, RoleAcl, { role: roleId as unknown as Role }, {}, { tenantId: null, organizationId: null })
  return entries.map((entry) => ({
    id: entry.id ? String(entry.id) : null,
    tenantId: String(entry.tenantId),
    features: Array.isArray(entry.featuresJson) ? [...entry.featuresJson] : null,
    isSuperAdmin: Boolean(entry.isSuperAdmin),
    organizations: Array.isArray(entry.organizationsJson) ? [...entry.organizationsJson] : null,
  }))
}

async function restoreRoleAcls(em: EntityManager, roleId: string, acls: RoleAclSnapshot[]) {
  await lockRoleWriterAuthorizationState(em, [roleId])
  await em.nativeDelete(RoleAcl, { role: roleId as unknown as Role })
  if (!acls.length) {
    await em.flush()
    return
  }
  const roleRef = em.getReference(Role, roleId)
  for (const acl of acls) {
    const entity = em.create(RoleAcl, {
      id: acl.id ?? undefined,
      role: roleRef,
      tenantId: acl.tenantId,
      featuresJson: acl.features ?? null,
      isSuperAdmin: acl.isSuperAdmin,
      organizationsJson: acl.organizations ?? null,
      createdAt: new Date(),
    })
    em.persist(entity)
  }
  await em.flush()
}

type RoleUndoPayload = { before?: RoleUndoSnapshot | null; after?: RoleUndoSnapshot | null }
