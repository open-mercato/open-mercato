import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { WarehouseLocation } from '../data/entities'
import { locationCreateSchema, locationUpdateSchema } from '../data/validators'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { E } from '#generated/entities.ids.generated'

const scopeSchema = z.object({ tenant_id: z.string().uuid(), organization_id: z.string().uuid() })
type CreateInput = z.infer<typeof locationCreateSchema> & z.infer<typeof scopeSchema>
type UpdateInput = z.infer<typeof locationUpdateSchema> & z.infer<typeof scopeSchema> & { id: string }

export const locationCrudEvents: CrudEventsConfig<WarehouseLocation> = {
  module: 'wms',
  entity: 'warehouse_location',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

export const locationIndexer: CrudIndexerConfig<WarehouseLocation> = {
  entityType: (E as { wms?: { warehouse_location: string } }).wms?.warehouse_location ?? 'wms:warehouse_location',
}

registerCommand({
  id: 'wms.locations.create',
  execute: async (raw, ctx) => {
    const parsed = locationCreateSchema.merge(scopeSchema).parse(raw) as CreateInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = em.create(WarehouseLocation, {
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
      warehouseId: parsed.warehouse_id,
      code: parsed.code,
      type: parsed.type,
      parentId: parsed.parent_id ?? null,
      isActive: parsed.is_active ?? true,
      capacityUnits: parsed.capacity_units ?? null,
      capacityWeight: parsed.capacity_weight ?? null,
      constraints: parsed.constraints ?? null,
    })
    await em.flush()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: record,
      identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
      events: locationCrudEvents,
      indexer: locationIndexer,
    })
    return { id: record.id }
  },
} as CommandHandler<CreateInput, { id: string }>)

registerCommand({
  id: 'wms.locations.update',
  execute: async (raw, ctx) => {
    const parsed = locationUpdateSchema.merge(scopeSchema).merge(z.object({ id: z.string().uuid() })).parse(raw) as UpdateInput
    const em = ctx.container.resolve<EntityManager>('em').fork()
    const record = await em.findOneOrFail(WarehouseLocation, {
      id: parsed.id,
      tenantId: parsed.tenant_id,
      organizationId: parsed.organization_id,
    })
    if (parsed.warehouse_id !== undefined) record.warehouseId = parsed.warehouse_id
    if (parsed.code !== undefined) record.code = parsed.code
    if (parsed.type !== undefined) record.type = parsed.type
    if (parsed.parent_id !== undefined) record.parentId = parsed.parent_id
    if (parsed.is_active !== undefined) record.isActive = parsed.is_active
    if (parsed.capacity_units !== undefined) record.capacityUnits = parsed.capacity_units
    if (parsed.capacity_weight !== undefined) record.capacityWeight = parsed.capacity_weight
    if (parsed.constraints !== undefined) record.constraints = parsed.constraints
    await em.flush()
    const dataEngine = ctx.container.resolve<DataEngine>('dataEngine')
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: record,
      identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
      events: locationCrudEvents,
      indexer: locationIndexer,
    })
    return { id: record.id }
  },
} as CommandHandler<UpdateInput, { id: string }>)
