import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { tenantCreateSchema, tenantUpdateSchema } from '@open-mercato/core/modules/directory/data/validators'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import {
  parseWithCustomFields,
  setCustomFieldsIfAny,
  emitCrudSideEffects,
  buildChanges,
  requireId,
} from '@open-mercato/shared/lib/commands/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'

export const tenantCrudEvents: CrudEventsConfig = {
  module: 'directory',
  entity: 'tenant',
  persistent: true,
}

export const tenantCrudIndexer: CrudIndexerConfig = {
  entityType: E.directory.tenant,
}

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
type SerializedTenant = ReturnType<typeof serializeTenant>

const createTenantCommand: CommandHandler<TenantPayload, Tenant> = {
  id: 'directory.tenants.create',
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(tenantCreateSchema, rawInput)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)

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

    if (isTenantDataEncryptionEnabled()) {
      try {
        const kms = ctx.container.resolve('kmsService') as { createTenantDek?: (id: string) => Promise<unknown>; isHealthy?: () => boolean }
        if (kms?.isHealthy?.()) {
          await kms?.createTenantDek?.(String(tenant.id))
          console.info('🔑 [encryption][tenant] created tenant DEK', { tenantId: String(tenant.id) })
        } else {
          console.warn('⚠️ [encryption][tenant] kms not healthy, skipping tenant DEK provisioning', { tenantId: String(tenant.id) })
        }
      } catch (err) {
        console.warn('⚠️ [encryption] Failed to provision tenant key', err)
      }
    }

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
      events: tenantCrudEvents,
      indexer: tenantCrudIndexer,
    })

    return tenant
  },
  captureAfter: (_input, result) => serializeTenant(result),
  buildLog: async ({ result, ctx }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('directory.audit.tenants.create', 'Create tenant'),
      resourceKind: 'directory.tenant',
      resourceId: String(result.id),
      tenantId: ctx.auth?.tenantId ?? null,
    }
  },
}

const updateTenantCommand: CommandHandler<TenantPayload, Tenant> = {
  id: 'directory.tenants.update',
  async prepare(rawInput, ctx) {
    const { parsed } = parseWithCustomFields(tenantUpdateSchema, rawInput)
    const em = (ctx.container.resolve('em') as EntityManager)
    const current = await em.findOne(Tenant, { id: parsed.id, deletedAt: null })
    if (!current) throw new CrudHttpError(404, { error: 'Tenant not found' })
    return { before: serializeTenant(current) }
  },
  async execute(rawInput, ctx) {
    const { parsed, custom } = parseWithCustomFields(tenantUpdateSchema, rawInput)
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const tenant = await de.updateOrmEntity({
      entity: Tenant,
      where: { id: parsed.id, deletedAt: null } as FilterQuery<Tenant>,
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
      events: tenantCrudEvents,
      indexer: tenantCrudIndexer,
    })

    return tenant
  },
  captureAfter: (_input, result) => serializeTenant(result),
  buildLog: async ({ result, snapshots, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeRecord = (snapshots.before ?? null) as Record<string, unknown> | null
    const after = serializeTenant(result)
    const changes = buildChanges(beforeRecord, after as Record<string, unknown>, ['name', 'isActive'])
    return {
      actionLabel: translate('directory.audit.tenants.update', 'Update tenant'),
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
    const em = (ctx.container.resolve('em') as EntityManager)
    const existing = await em.findOne(Tenant, { id, deletedAt: null })
    return existing ? { before: serializeTenant(existing) } : {}
  },
  async execute(rawInput, ctx) {
    const id = requireId(rawInput, 'Tenant id required')
    const de = (ctx.container.resolve('dataEngine') as DataEngine)
    const tenant = await de.deleteOrmEntity({
      entity: Tenant,
      where: { id, deletedAt: null } as FilterQuery<Tenant>,
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
      events: tenantCrudEvents,
      indexer: tenantCrudIndexer,
    })

    return tenant
  },
  buildLog: async ({ snapshots, input, ctx }) => {
    const { translate } = await resolveTranslations()
    const beforeSnapshot = (snapshots.before ?? null) as SerializedTenant | null
    const id = String(input?.body?.id ?? input?.query?.id ?? '')
    const fallbackId = beforeSnapshot?.id ?? null
    return {
      actionLabel: translate('directory.audit.tenants.delete', 'Delete tenant'),
      resourceKind: 'directory.tenant',
      resourceId: id || fallbackId || null,
      snapshotBefore: beforeSnapshot ?? null,
      tenantId: ctx.auth?.tenantId ?? null,
    }
  },
}

registerCommand(createTenantCommand)
registerCommand(updateTenantCommand)
registerCommand(deleteTenantCommand)
