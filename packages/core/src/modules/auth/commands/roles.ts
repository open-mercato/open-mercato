import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
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
import { E } from '@open-mercato/core/generated/entities.ids.generated'

type SerializedRole = {
  name: string
  tenantId: string | null
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

export const roleCrudEvents: CrudEventsConfig<Role> = {
  module: 'auth',
  entity: 'role',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
  }),
}

export const roleCrudIndexer: CrudIndexerConfig<Role> = {
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
    const de = ctx.container.resolve<DataEngine>('dataEngine')
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
  captureAfter: (_input, result) => serializeRole(result),
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('auth.audit.roles.create', 'Create role'),
      resourceKind: 'auth.role',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      snapshotAfter: serializeRole(result),
    }
  },
}

const updateRoleCommand: CommandHandler<Record<string, unknown>, Role> = {
  id: 'auth.roles.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(updateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(Role, { id: parsed.id, deletedAt: null })
    if (!existing) throw new CrudHttpError(404, { error: 'Role not found' })
    return { before: serializeRole(existing) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(updateSchema, rawInput)
    const de = ctx.container.resolve<DataEngine>('dataEngine')
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
  captureAfter: (_input, result) => serializeRole(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedRole | undefined
    const after = serializeRole(result)
    const changes = buildChanges(before ?? null, after as Record<string, unknown>, ['name', 'tenantId'])
    return {
      actionLabel: translate('auth.audit.roles.update', 'Update role'),
      resourceKind: 'auth.role',
      resourceId: String(result.id),
      tenantId: result.tenantId ? String(result.tenantId) : null,
      changes,
      snapshotBefore: before ?? null,
      snapshotAfter: after,
    }
  },
}

const deleteRoleCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, Role> = {
  id: 'auth.roles.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Role id required')
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(Role, { id, deletedAt: null })
    if (!existing) return {}
    return { before: serializeRole(existing) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'Role id required')
    const em = ctx.container.resolve<EntityManager>('em')
    const role = await em.findOne(Role, { id, deletedAt: null })
    if (!role) throw new CrudHttpError(404, { error: 'Role not found' })
    const activeAssignments = await em.count(UserRole, { role, deletedAt: null })
    if (activeAssignments > 0) throw new CrudHttpError(400, { error: 'Role has assigned users' })

    await em.nativeDelete(RoleAcl, { role: id })

    const de = ctx.container.resolve<DataEngine>('dataEngine')
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
    const before = snapshots.before as SerializedRole | undefined
    const id = requireId(input, 'Role id required')
    return {
      actionLabel: translate('auth.audit.roles.delete', 'Delete role'),
      resourceKind: 'auth.role',
      resourceId: id,
      tenantId: before?.tenantId ?? null,
      snapshotBefore: before ?? null,
    }
  },
}

registerCommand(createRoleCommand)
registerCommand(updateRoleCommand)
registerCommand(deleteRoleCommand)

function serializeRole(role: Role): SerializedRole {
  return {
    name: String(role.name ?? ''),
    tenantId: role.tenantId ? String(role.tenantId) : null,
  }
}
