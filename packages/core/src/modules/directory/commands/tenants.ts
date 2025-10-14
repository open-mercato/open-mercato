import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { tenantCreateSchema, tenantUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { E } from '@open-mercato/core/generated/entities.ids.generated'

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
    const { base, custom } = splitCustomFieldPayload(rawInput)
    const parsed = tenantCreateSchema.parse(base)
    const de = ctx.container.resolve<DataEngine>('dataEngine')

    const tenant = await de.createOrmEntity({
      entity: Tenant,
      data: {
        name: parsed.name,
        isActive: parsed.isActive ?? true,
      },
    })

    if (custom && Object.keys(custom).length > 0) {
      await de.setCustomFields({
        entityId: E.directory.tenant,
        recordId: String(tenant.id),
        organizationId: null,
        tenantId: ctx.auth?.tenantId ?? null,
        values: custom,
        notify: false,
      })
    }

    const identifiers = {
      id: String(tenant.id),
      organizationId: null,
      tenantId: String(tenant.id),
    }

    await de.emitOrmEntityEvent({
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
    const { base } = splitCustomFieldPayload(rawInput)
    const parsed = tenantUpdateSchema.parse(base)
    const em = ctx.container.resolve<EntityManager>('em')
    const current = await em.findOne(Tenant, { id: parsed.id, deletedAt: null })
    if (!current) throw new CrudHttpError(404, { error: 'Tenant not found' })
    return { before: serializeTenant(current) }
  },
  async execute(rawInput, ctx) {
    const { base, custom } = splitCustomFieldPayload(rawInput)
    const parsed = tenantUpdateSchema.parse(base)
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

    if (custom && Object.keys(custom).length) {
      await de.setCustomFields({
        entityId: E.directory.tenant,
        recordId: String(tenant.id),
        organizationId: null,
        tenantId: ctx.auth?.tenantId ?? null,
        values: custom,
        notify: false,
      })
    }

    const identifiers = {
      id: String(tenant.id),
      organizationId: null,
      tenantId: String(tenant.id),
    }

    await de.emitOrmEntityEvent({
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
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (before) {
      for (const key of ['name', 'isActive']) {
        if (before[key] !== (after as any)[key]) {
          changes[key] = { from: before[key], to: (after as any)[key] }
        }
      }
    }
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
    const id = String(input?.body?.id ?? input?.query?.id ?? '')
    if (!id) return {}
    const em = ctx.container.resolve<EntityManager>('em')
    const existing = await em.findOne(Tenant, { id, deletedAt: null })
    return existing ? { before: serializeTenant(existing) } : {}
  },
  async execute(rawInput, ctx) {
    const id = String(rawInput?.body?.id ?? rawInput?.query?.id ?? '')
    if (!id) throw new CrudHttpError(400, { error: 'Tenant id required' })
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

    await de.emitOrmEntityEvent({
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
