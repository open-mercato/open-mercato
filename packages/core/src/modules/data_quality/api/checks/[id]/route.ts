import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DataQualityCheck } from '../../../data/entities'
import { createCheckSchema, updateCheckSchema } from '../../../data/validators'
import {
  resolveDataQualityRouteContext,
  toIsoString,
  unwrapRouteParams,
  withMergedJsonBody,
} from '../../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.check.view'] },
  PUT: { requireAuth: true, requireFeatures: ['data_quality.check.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['data_quality.check.manage'] },
}

export const metadata = routeMetadata

const paramsSchema = z.object({ id: z.string().uuid() })
const updateCheckWithIdSchema = updateCheckSchema.extend({ id: z.string().uuid() })
const idResponseSchema = z.object({ id: z.string().uuid() })
const checkDetailSchema = createCheckSchema.extend({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: DataQualityCheck,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  actions: {
    update: {
      commandId: 'data_quality.check.update',
      schema: updateCheckWithIdSchema,
      response: ({ result }) => ({ id: result.id }),
    },
    delete: {
      commandId: 'data_quality.check.delete',
      schema: paramsSchema,
      response: ({ result }) => ({ id: result.id }),
    },
  },
})

export async function GET(
  req: Request,
  routeContext: { params?: Promise<{ id?: string }> | { id?: string } },
) {
  const context = await resolveDataQualityRouteContext(req)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsedParams = paramsSchema.safeParse(await unwrapRouteParams(routeContext))
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid check id', details: parsedParams.error.issues }, { status: 400 })
  }

  const em = context.container.resolve<EntityManager>('em')
  const where = buildScopedWhere(
    { id: parsedParams.data.id },
    {
      organizationId: context.selectedOrganizationId ?? undefined,
      organizationIds: context.organizationIds ?? undefined,
      tenantId: context.auth.tenantId,
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
  )

  const check = await em.findOne(DataQualityCheck, where as never)
  if (!check) {
    return NextResponse.json({ error: 'Check not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: check.id,
    code: check.code,
    name: check.name,
    description: check.description,
    targetEntityType: check.targetEntityType,
    failureExpression: check.failureExpression,
    severity: check.severity,
    weight: check.weight,
    enabled: check.enabled,
    tenantId: check.tenantId,
    organizationId: check.organizationId,
    createdAt: toIsoString(check.createdAt),
    updatedAt: toIsoString(check.updatedAt),
  })
}

export async function PUT(
  req: Request,
  routeContext: { params?: Promise<{ id?: string }> | { id?: string } },
) {
  const parsedParams = paramsSchema.safeParse(await unwrapRouteParams(routeContext))
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid check id', details: parsedParams.error.issues }, { status: 400 })
  }

  return crud.PUT(await withMergedJsonBody(req, { id: parsedParams.data.id }))
}

export async function DELETE(
  req: Request,
  routeContext: { params?: Promise<{ id?: string }> | { id?: string } },
) {
  const parsedParams = paramsSchema.safeParse(await unwrapRouteParams(routeContext))
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid check id', details: parsedParams.error.issues }, { status: 400 })
  }

  return crud.DELETE(await withMergedJsonBody(req, { id: parsedParams.data.id }))
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Data quality check detail',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Get a data quality check',
      responses: [{ status: 200, description: 'Check detail', schema: checkDetailSchema }],
      errors: [{ status: 404, description: 'Check not found' }],
    },
    PUT: {
      summary: 'Update a data quality check',
      requestBody: { contentType: 'application/json', schema: updateCheckSchema },
      responses: [{ status: 200, description: 'Updated check', schema: idResponseSchema }],
    },
    DELETE: {
      summary: 'Delete a data quality check',
      responses: [{ status: 200, description: 'Deleted check', schema: idResponseSchema }],
    },
  },
}
