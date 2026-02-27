import type { CommandHandler } from '@open-mercato/shared/lib/commands'
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
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
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

type SerializedRole = {
  name: string
  tenantId: string | null
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
  tenantId: string | null
  acls: RoleAclSnapshot[]
  custom?: Record<string, unknown>
}

type RoleSnapshots = {
  view: SerializedRole
  undo: RoleUndoSnapshot
}

const createSchema = z.object({
  name: z.string().min(2).max(100),
  tenantId: z.string().uuid().nullable().optional(),
})

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100).optional(),
  tenantId: z.string().uuid().nullable().optional(),
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
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(createSchema, rawInput)
    const resolvedTenantId = parsed.tenantId === undefined ? ctx.auth?.tenantId ?? null : parsed.tenantId ?? null
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const custom = await loadCustomFieldSnapshot(em, {
      entityId: E.auth.role,
      recordId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
    })
    return serializeRole(result, custom)
  },
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    const em = (ctx.container.resolve('em') as EntityManager).fork()
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
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<RoleUndoPayload>(logEntry)?.after
    if (!undo) return
    const em = (ctx.container.resolve('em') as EntityManager)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
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
  },
}

const updateRoleCommand: CommandHandler<Record<string, unknown>, Role> = {
  id: 'auth.roles.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(updateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const existing = await em.findOne(Role, { id: parsed.id, deletedAt: null })
    if (!existing) throw new CrudHttpError(404, { error: 'Role not found' })
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
    const em = (ctx.container.resolve('em') as EntityManager)
    if (parsed.name !== undefined) {
      const current = await em.findOne(Role, { id: parsed.id, deletedAt: null })
      if (!current) throw new CrudHttpError(404, { error: 'Role not found' })
      const nextName = parsed.name
      if (nextName !== current.name) {
        const assignments = await em.count(UserRole, { role: current, deletedAt: null })
        if (assignments > 0) {
          throw new CrudHttpError(400, { error: 'Role name cannot be changed while users are assigned' })
        }
      }
    }
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const role = await de.updateOrmEntity({
      entity: Role,
      where: { id: parsed.id, deletedAt: null } as FilterQuery<Role>,
      apply: (entity) => {
        if (parsed.name !== undefined) entity.name = parsed.name
        if (parsed.tenantId !== undefined) entity.tenantId = parsed.tenantId ?? null
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

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: role,
      identifiers: {
        id: String(role.id),
        organizationId: null,
        tenantId: role.tenantId ? String(role.tenantId) : null,
      },
      events: roleCrudEvents,
      indexer: roleCrudIndexer,
    })

    return role
  },
  captureAfter: async (_input, result, ctx) => {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
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
    const em = (ctx.container.resolve('em') as EntityManager).fork()
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
  undo: async ({ logEntry, ctx }) => {
    const undo = extractUndoPayload<RoleUndoPayload>(logEntry)
    const before = undo?.before
    const after = undo?.after
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const updated = await de.updateOrmEntity({
      entity: Role,
      where: { id: before.id, deletedAt: null } as FilterQuery<Role>,
      apply: (entity) => {
        entity.name = before.name
        entity.tenantId = before.tenantId ?? null
      },
    })
    if (updated) {
      await restoreRoleAcls(em, before.id, before.acls)
    }
    const reset = buildCustomFieldResetMap(before.custom, after?.custom)
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
}

const deleteRoleCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, Role> = {
  id: 'auth.roles.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Role id required')
    const em = (ctx.container.resolve('em') as EntityManager)
    const existing = await em.findOne(Role, { id, deletedAt: null })
    if (!existing) return {}
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
    const em = (ctx.container.resolve('em') as EntityManager)
    const role = await em.findOne(Role, { id, deletedAt: null })
    if (!role) throw new CrudHttpError(404, { error: 'Role not found' })
    const activeAssignments = await em.count(UserRole, { role, deletedAt: null })
    if (activeAssignments > 0) throw new CrudHttpError(400, { error: 'Role has assigned users' })

    await em.nativeDelete(RoleAcl, { role: id })

    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const deleted = await de.deleteOrmEntity({
      entity: Role,
      where: { id, deletedAt: null } as FilterQuery<Role>,
      soft: false,
    })
    if (!deleted) throw new CrudHttpError(404, { error: 'Role not found' })

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: deleted,
      identifiers: {
        id,
        organizationId: null,
        tenantId: deleted.tenantId ? String(deleted.tenantId) : null,
      },
      events: roleCrudEvents,
      indexer: roleCrudIndexer,
    })

    return deleted
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
  undo: async ({ logEntry, ctx }) => {
    const before = extractUndoPayload<RoleUndoPayload>(logEntry)?.before
    if (!before) return
    const em = (ctx.container.resolve('em') as EntityManager)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    let role = await em.findOne(Role, { id: before.id })
    if (role) {
      role.deletedAt = null
      role.name = before.name
      role.tenantId = before.tenantId ?? null
      await em.flush()
    } else {
      role = await de.createOrmEntity({
        entity: Role,
        data: {
          id: before.id,
          name: before.name,
          tenantId: before.tenantId ?? null,
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
}

registerCommand(createRoleCommand)
registerCommand(updateRoleCommand)
registerCommand(deleteRoleCommand)

function serializeRole(role: Role, custom?: Record<string, unknown> | null): SerializedRole {
  const payload: SerializedRole = {
    name: String(role.name ?? ''),
    tenantId: role.tenantId ? String(role.tenantId) : null,
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
      tenantId: role.tenantId ? String(role.tenantId) : null,
      acls,
      ...(custom && Object.keys(custom).length ? { custom } : {}),
    },
  }
}

async function loadRoleAclSnapshots(em: EntityManager, roleId: string): Promise<RoleAclSnapshot[]> {
  const entries = await em.find(RoleAcl, { role: roleId as unknown as Role })
  return entries.map((entry) => ({
    id: entry.id ? String(entry.id) : null,
    tenantId: String(entry.tenantId),
    features: Array.isArray(entry.featuresJson) ? [...entry.featuresJson] : null,
    isSuperAdmin: Boolean(entry.isSuperAdmin),
    organizations: Array.isArray(entry.organizationsJson) ? [...entry.organizationsJson] : null,
  }))
}

async function restoreRoleAcls(em: EntityManager, roleId: string, acls: RoleAclSnapshot[]) {
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
