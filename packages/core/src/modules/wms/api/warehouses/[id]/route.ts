import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { NextRequest } from 'next/server'
import { Warehouse } from '../../../data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createWmsCrudOpenApi, defaultOkResponseSchema } from '../../../lib/openapi'
import { warehouseUpdateSchema } from '../../../data/validators'

const paramsSchema = z.object({ id: z.string().uuid() })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
}

export async function GET(
  request: NextRequest,
  { params, container }: { params: { id: string }; container: any },
) {
  const { id } = paramsSchema.parse(params)
  const em = container.resolve<EntityManager>('em')
  const auth = container.resolve<any>('auth')
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

  return Response.json({
    id: record.id,
    name: record.name,
    code: record.code,
    isActive: record.isActive,
    address: record.address,
    timezone: record.timezone,
    createdAt: record.createdAt?.toISOString(),
    updatedAt: record.updatedAt?.toISOString(),
  })
}

export async function PUT(
  request: NextRequest,
  { params, container }: { params: { id: string }; container: any },
) {
  const { id } = paramsSchema.parse(params)
  const body = await request.json()
  const em = container.resolve<EntityManager>('em')
  const auth = container.resolve<any>('auth')
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

  return Response.json({ ok: true, id: record.id })
}

export async function DELETE(
  request: NextRequest,
  { params, container }: { params: { id: string }; container: any },
) {
  const { id } = paramsSchema.parse(params)
  const em = container.resolve<EntityManager>('em')
  const auth = container.resolve<any>('auth')
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

  return Response.json({ ok: true })
}

export const openApi = createWmsCrudOpenApi({
  resourceName: 'Warehouse',
  pluralName: 'Warehouses',
  querySchema: paramsSchema,
  listResponseSchema: z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string(),
    isActive: z.boolean(),
    address: z.record(z.string(), z.unknown()).nullable(),
    timezone: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  update: {
    schema: warehouseUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a warehouse by id.',
  },
  del: {
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a warehouse by id.',
  },
})
