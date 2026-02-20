import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { NextRequest } from 'next/server'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { Warehouse } from '../../../data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { warehouseUpdateSchema } from '../../../data/validators'
import { warehouseCrudEvents, warehouseIndexer } from '../../../commands/warehouses'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { defaultOkResponseSchema } from '../../../lib/openapi'

const paramsSchema = z.object({ id: z.string().uuid() })
type AuthScope = { tenantId?: string; organizationId?: string } | null

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
}

const warehouseResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  isActive: z.boolean(),
  address: z.record(z.string(), z.unknown()).nullable(),
  timezone: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

function serializeWarehouse(record: Warehouse) {
  return {
    id: record.id,
    name: record.name,
    code: record.code,
    isActive: record.isActive,
    address: record.address,
    timezone: record.timezone,
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

  const record = await em.findOne(Warehouse, {
    id,
    ...(tenantId ? { tenantId } : {}),
    ...(organizationId ? { organizationId } : {}),
    deletedAt: null,
  })

  if (!record) {
    throw new CrudHttpError(404, { error: 'Warehouse not found' })
  }

  return Response.json(serializeWarehouse(record))
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

  const record = await em.findOne(Warehouse, {
    id,
    ...(tenantId ? { tenantId } : {}),
    ...(organizationId ? { organizationId } : {}),
    deletedAt: null,
  })

  if (!record) {
    throw new CrudHttpError(404, { error: 'Warehouse not found' })
  }

  const parsed = warehouseUpdateSchema.parse(body)
  if (parsed.name !== undefined) record.name = parsed.name
  if (parsed.code !== undefined) record.code = parsed.code
  if (parsed.is_active !== undefined) record.isActive = parsed.is_active
  if (parsed.address !== undefined) record.address = parsed.address
  if (parsed.timezone !== undefined) record.timezone = parsed.timezone

  await em.flush()

  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: record,
    identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
    events: warehouseCrudEvents,
    indexer: warehouseIndexer,
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

  const record = await em.findOne(Warehouse, {
    id,
    ...(tenantId ? { tenantId } : {}),
    ...(organizationId ? { organizationId } : {}),
    deletedAt: null,
  })

  if (!record) {
    throw new CrudHttpError(404, { error: 'Warehouse not found' })
  }

  record.deletedAt = new Date()
  await em.flush()

  await emitCrudSideEffects({
    dataEngine,
    action: 'deleted',
    entity: record,
    identifiers: { id: record.id, tenantId: record.tenantId, organizationId: record.organizationId },
    events: warehouseCrudEvents,
    indexer: warehouseIndexer,
  })

  return Response.json({ ok: true })
}

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Warehouse detail operations',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Get warehouse by ID',
      description: 'Returns a single warehouse by its UUID.',
      responses: [
        { status: 200, description: 'Warehouse detail', schema: warehouseResponseSchema },
      ],
      errors: [
        { status: 404, description: 'Warehouse not found', schema: errorSchema },
      ],
    },
    PUT: {
      summary: 'Update warehouse',
      description: 'Updates a warehouse by its UUID.',
      requestBody: { schema: warehouseUpdateSchema, description: 'Warehouse fields to update' },
      responses: [
        { status: 200, description: 'Update successful', schema: defaultOkResponseSchema },
      ],
      errors: [
        { status: 404, description: 'Warehouse not found', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete warehouse',
      description: 'Soft-deletes a warehouse by its UUID.',
      responses: [
        { status: 200, description: 'Delete successful', schema: defaultOkResponseSchema },
      ],
      errors: [
        { status: 404, description: 'Warehouse not found', schema: errorSchema },
      ],
    },
  },
}
