import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { NextRequest } from 'next/server'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarehouseLocation } from '../../../data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { locationUpdateSchema } from '../../../data/validators'
import { locationCrudEvents, locationIndexer } from '../../../commands/locations'
import { defaultOkResponseSchema } from '../../../lib/openapi'

const paramsSchema = z.object({ id: z.string().uuid() })
type AuthScope = { tenantId?: string; organizationId?: string } | null

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
}

const locationDetailSchema = z.object({
  id: z.string().uuid(),
  warehouseId: z.string().uuid(),
  code: z.string(),
  type: z.string(),
  parentId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  capacityUnits: z.number().nullable(),
  capacityWeight: z.number().nullable(),
  constraints: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

function serializeLocation(record: WarehouseLocation) {
  return {
    id: record.id,
    warehouseId: record.warehouseId,
    code: record.code,
    type: record.type,
    parentId: record.parentId,
    isActive: record.isActive,
    capacityUnits: record.capacityUnits,
    capacityWeight: record.capacityWeight,
    constraints: record.constraints,
    createdAt: record.createdAt?.toISOString(),
    updatedAt: record.updatedAt?.toISOString(),
  }
}

export async function GET(
  request: NextRequest,
  { params, container }: { params: { id: string }; container: AppContainer },
) {
  const { id } = paramsSchema.parse(params)
  const em = container.resolve<EntityManager>('em')
  const auth = container.resolve<AuthScope>('auth')
  const tenantId = auth?.tenantId
  const organizationId = auth?.organizationId

  const record = await em.findOne(WarehouseLocation, {
    id,
    ...(tenantId ? { tenantId } : {}),
    ...(organizationId ? { organizationId } : {}),
    deletedAt: null,
  })

  if (!record) {
    throw new CrudHttpError(404, { error: 'Location not found' })
  }

  return Response.json(serializeLocation(record))
}

export async function PUT(
  request: NextRequest,
  { params, container }: { params: { id: string }; container: AppContainer },
) {
  const { id } = paramsSchema.parse(params)
  const body = await request.json()
  const em = container.resolve<EntityManager>('em')
  const dataEngine = container.resolve<DataEngine>('dataEngine')
  const auth = container.resolve<AuthScope>('auth')
  const tenantId = auth?.tenantId
  const organizationId = auth?.organizationId

  const record = await em.findOne(WarehouseLocation, {
    id,
    ...(tenantId ? { tenantId } : {}),
    ...(organizationId ? { organizationId } : {}),
    deletedAt: null,
  })

  if (!record) {
    throw new CrudHttpError(404, { error: 'Location not found' })
  }

  const parsed = locationUpdateSchema.parse(body)
  if (parsed.warehouse_id !== undefined) record.warehouseId = parsed.warehouse_id
  if (parsed.code !== undefined) record.code = parsed.code
  if (parsed.type !== undefined) record.type = parsed.type
  if (parsed.parent_id !== undefined) record.parentId = parsed.parent_id
  if (parsed.is_active !== undefined) record.isActive = parsed.is_active
  if (parsed.capacity_units !== undefined) record.capacityUnits = parsed.capacity_units
  if (parsed.capacity_weight !== undefined) record.capacityWeight = parsed.capacity_weight
  if (parsed.constraints !== undefined) record.constraints = parsed.constraints

  await em.flush()

  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: record,
    identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
    events: locationCrudEvents,
    indexer: locationIndexer,
  })

  return Response.json({ ok: true, id: record.id })
}

export async function DELETE(
  request: NextRequest,
  { params, container }: { params: { id: string }; container: AppContainer },
) {
  const { id } = paramsSchema.parse(params)
  const em = container.resolve<EntityManager>('em')
  const dataEngine = container.resolve<DataEngine>('dataEngine')
  const auth = container.resolve<AuthScope>('auth')
  const tenantId = auth?.tenantId
  const organizationId = auth?.organizationId

  const record = await em.findOne(WarehouseLocation, {
    id,
    ...(tenantId ? { tenantId } : {}),
    ...(organizationId ? { organizationId } : {}),
    deletedAt: null,
  })

  if (!record) {
    throw new CrudHttpError(404, { error: 'Location not found' })
  }

  record.deletedAt = new Date()
  await em.flush()

  await emitCrudSideEffects({
    dataEngine,
    action: 'deleted',
    entity: record,
    identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
    events: locationCrudEvents,
    indexer: locationIndexer,
  })

  return Response.json({ ok: true })
}

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Warehouse location detail operations',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Get location by ID',
      description: 'Returns a single warehouse location by its UUID.',
      responses: [
        { status: 200, description: 'Location detail', schema: locationDetailSchema },
      ],
      errors: [
        { status: 404, description: 'Location not found', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Update location',
      description: 'Updates a warehouse location by its UUID.',
      requestBody: { schema: locationUpdateSchema, description: 'Location fields to update' },
      responses: [
        { status: 200, description: 'Update successful', schema: defaultOkResponseSchema },
      ],
      errors: [
        { status: 404, description: 'Location not found', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete location',
      description: 'Soft-deletes a warehouse location by its UUID.',
      responses: [
        { status: 200, description: 'Delete successful', schema: defaultOkResponseSchema },
      ],
      errors: [
        { status: 404, description: 'Location not found', schema: errorSchema },
      ],
    },
  },
}
