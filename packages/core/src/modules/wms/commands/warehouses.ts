import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { Warehouse } from '../data/entities'
import { warehouseCreateSchema, warehouseUpdateSchema } from '../data/validators'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'

const scopeSchema = z.object({ tenant_id: z.string().uuid(), organization_id: z.string().uuid() })
type CreateInput = z.infer<typeof warehouseCreateSchema> & z.infer<typeof scopeSchema>
type UpdateInput = z.infer<typeof warehouseUpdateSchema> & z.infer<typeof scopeSchema> & { id: string }

export const warehouseCrudEvents: CrudEventsConfig<Warehouse> = {
  module: 'wms',
  entity: 'warehouse',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

export const warehouseIndexer: CrudIndexerConfig<Warehouse> = {
  entityType: (E as { wms?: { warehouse: string } }).wms?.warehouse ?? 'wms:warehouse',
}

registerCommand({
  id: 'wms.warehouses.create',
  execute: async (raw, ctx) => {
    const parsed = warehouseCreateSchema.merge(scopeSchema).parse(raw) as CreateInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = em.create(Warehouse, {
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      name: parsed.name,
      code: parsed.code,
      isActive: parsed.is_active ?? true,
      address: parsed.address ?? null,
      timezone: parsed.timezone ?? null,
    })
    await em.flush()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
      events: warehouseCrudEvents,
      indexer: warehouseIndexer,
    })
    return { id: record.id }
  },
} as CommandHandler<CreateInput, { id: string }>)

registerCommand({
  id: 'wms.warehouses.update',
  execute: async (raw, ctx) => {
    const parsed = warehouseUpdateSchema.merge(scopeSchema).merge(z.object({ id: z.string().uuid() })).parse(raw) as UpdateInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOneOrFail(Warehouse, { id: parsed.id, tenantId: parsed.tenant_id, organizationId: parsed.organization_id })
    if (parsed.name !== undefined) record.name = parsed.name
    if (parsed.code !== undefined) record.code = parsed.code
    if (parsed.is_active !== undefined) record.isActive = parsed.is_active
    if (parsed.address !== undefined) record.address = parsed.address
    if (parsed.timezone !== undefined) record.timezone = parsed.timezone
    await em.flush()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
      events: warehouseCrudEvents,
      indexer: warehouseIndexer,
    })
    return { id: record.id }
  },
} as CommandHandler<UpdateInput, { id: string }>)
