import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { tenantCreateSchema, tenantUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'

export const tenantCrudEvents = {
  module: 'directory',
  entity: 'tenant',
  persistent: true,
} as const

export const tenantCrudIndexer = {
  entityType: E.directory.tenant,
} as const

function serializeTenant(entity: Tenant) {
  return {
    id: String(entity.id),
    name: entity.name,
    isActive: !!entity.isActive,
    createdAt: entity.createdAt ? entity.createdAt.toISOString() : null,
    updatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : null,
    deletedAt: entity.deletedAt ? entity.deletedAt.toISOString() : null,
  }
}

type TenantPayload = Record<string, unknown>

const createTenantCommand: CommandHandler<TenantPayload, Tenant> = {
  id: 'directory.tenants.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(tenantCreateSchema, rawInput)
    const de = ctx.container.resolve<DataEngine>('dataEngine')

    const tenant = await de.createOrmEntity({
      entity: Tenant,
      data: {
        name: parsed.name,
        isActive: parsed.isActive ?? true,
      },
    })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.directory.tenant,
      recordId: String(tenant.id),
      organizationId: null,
      tenantId: ctx.auth?.tenantId ?? null,
      values: custom,
    })

    const identifiers = {
      id: String(tenant.id),
      organizationId: null,
      tenantId: String(tenant.id),
    }

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'created',
      entity: tenant,
      identifiers,
      events: tenantCrudEvents as any,
      indexer: tenantCrudIndexer as any,
    })

    return tenant
  },
  captureAfter: (_input, result) => serializeTenant(result),
  buildLog: ({ result, ctx }) => ({
    actionLabel: 'Create tenant',
    resourceKind: 'directory.tenant',
    resourceId: String(result.id),
    tenantId: ctx.auth?.tenantId ?? null,
  }),
}

const updateTenantCommand: CommandHandler<TenantPayload, Tenant> = {
  id: 'directory.tenants.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(tenantUpdateSchema, rawInput)
    const em = ctx.container.resolve<EntityManager>('em')
    const current = await em.findOne(Tenant, { id: parsed.id, deletedAt: null })
    if (!current) throw new CrudHttpError(404, { error: 'Tenant not found' })
    return { before: serializeTenant(current) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(tenantUpdateSchema, rawInput)
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    const tenant = await de.updateOrmEntity({
      entity: Tenant,
      where: { id: parsed.id, deletedAt: null } as any,
      apply: (entity) => {
        if (parsed.name !== undefined) entity.name = parsed.name
        if (parsed.isActive !== undefined) entity.isActive = parsed.isActive
        entity.updatedAt = new Date()
      },
    })
    if (!tenant) throw new CrudHttpError(404, { error: 'Tenant not found' })

    await setCustomFieldsIfAny({
      dataEngine: de,
      entityId: E.directory.tenant,
      recordId: String(tenant.id),
      organizationId: null,
      tenantId: ctx.auth?.tenantId ?? null,
      values: custom,
    })

    const identifiers = {
      id: String(tenant.id),
      organizationId: null,
      tenantId: String(tenant.id),
    }

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'updated',
      entity: tenant,
      identifiers,
      events: tenantCrudEvents as any,
      indexer: tenantCrudIndexer as any,
    })

    return tenant
  },
  captureAfter: (_input, result) => serializeTenant(result),
  buildLog: ({ result, snapshots, ctx }) => {
    const before = (snapshots.before ?? null) as Record<string, unknown> | null
    const after = serializeTenant(result)
    const changes = buildChanges(before, after, ['name', 'isActive'])
    return {
      actionLabel: 'Update tenant',
      resourceKind: 'directory.tenant',
      resourceId: String(result.id),
      changes,
      tenantId: ctx.auth?.tenantId ?? null,
    }
  },
}

const deleteTenantCommand: CommandHandler<{ body: any; query: Record<string, string> }, Tenant> = {
  id: 'directory.tenants.delete',
  async prepare(input, ctx) {
    const id = requireId(input, 'Tenant id required')
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(Tenant, { id, deletedAt: null })
    return existing ? { before: serializeTenant(existing) } : {}
  },
  async execute(rawInput, ctx) {
    const id = requireId(rawInput, 'Tenant id required')
    const de = ctx.container.resolve<DataEngine>('dataEngine')
    const tenant = await de.deleteOrmEntity({
      entity: Tenant,
      where: { id, deletedAt: null } as any,
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!tenant) throw new CrudHttpError(404, { error: 'Tenant not found' })

    const identifiers = {
      id: String(id),
      organizationId: null,
      tenantId: String(id),
    }

    await emitCrudSideEffects({
      dataEngine: de,
      action: 'deleted',
      entity: tenant,
      identifiers,
      events: tenantCrudEvents as any,
      indexer: tenantCrudIndexer as any,
    })

    return tenant
  },
  buildLog: ({ snapshots, input, ctx }) => {
    const before = snapshots.before ?? null
    const id = String(input?.body?.id ?? input?.query?.id ?? '')
    return {
      actionLabel: 'Delete tenant',
      resourceKind: 'directory.tenant',
      resourceId: id || (before && (before as any).id) || null,
      snapshotBefore: before ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
    }
  },
}

registerCommand(createTenantCommand)
registerCommand(updateTenantCommand)
registerCommand(deleteTenantCommand)
