import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DataQualitySuite } from '../../../data/entities'
import { createSuiteSchema, updateSuiteSchema } from '../../../data/validators'
import {
  resolveDataQualityRouteContext,
  toIsoString,
  unwrapRouteParams,
  withMergedJsonBody,
} from '../../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.suite.view'] },
  PUT: { requireAuth: true, requireFeatures: ['data_quality.suite.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['data_quality.suite.manage'] },
}

export const metadata = routeMetadata

const paramsSchema = z.object({ id: z.string().uuid() })
const updateSuiteWithIdSchema = updateSuiteSchema.extend({ id: z.string().uuid() })
const idResponseSchema = z.object({ id: z.string().uuid() })
const suiteDetailSchema = createSuiteSchema.extend({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: DataQualitySuite,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  actions: {
    update: {
      commandId: 'data_quality.suite.update',
      schema: updateSuiteWithIdSchema,
      response: ({ result }) => ({ id: result.id }),
    },
    delete: {
      commandId: 'data_quality.suite.delete',
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
    return NextResponse.json({ error: 'Invalid suite id', details: parsedParams.error.issues }, { status: 400 })
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

  const suite = await em.findOne(DataQualitySuite, where as never)
  if (!suite) {
    return NextResponse.json({ error: 'Suite not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: suite.id,
    code: suite.code,
    name: suite.name,
    description: suite.description,
    enabled: suite.enabled,
    tenantId: suite.tenantId,
    organizationId: suite.organizationId,
    createdAt: toIsoString(suite.createdAt),
    updatedAt: toIsoString(suite.updatedAt),
  })
}

export async function PUT(
  req: Request,
  routeContext: { params?: Promise<{ id?: string }> | { id?: string } },
) {
  const parsedParams = paramsSchema.safeParse(await unwrapRouteParams(routeContext))
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid suite id', details: parsedParams.error.issues }, { status: 400 })
  }

  return crud.PUT(await withMergedJsonBody(req, { id: parsedParams.data.id }))
}

export async function DELETE(
  req: Request,
  routeContext: { params?: Promise<{ id?: string }> | { id?: string } },
) {
  const parsedParams = paramsSchema.safeParse(await unwrapRouteParams(routeContext))
  if (!parsedParams.success) {
    return NextResponse.json({ error: 'Invalid suite id', details: parsedParams.error.issues }, { status: 400 })
  }

  return crud.DELETE(await withMergedJsonBody(req, { id: parsedParams.data.id }))
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Data quality suite detail',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Get a data quality suite',
      responses: [{ status: 200, description: 'Suite detail', schema: suiteDetailSchema }],
      errors: [{ status: 404, description: 'Suite not found' }],
    },
    PUT: {
      summary: 'Update a data quality suite',
      requestBody: { contentType: 'application/json', schema: updateSuiteSchema },
      responses: [{ status: 200, description: 'Updated suite', schema: idResponseSchema }],
    },
    DELETE: {
      summary: 'Delete a data quality suite',
      responses: [{ status: 200, description: 'Deleted suite', schema: idResponseSchema }],
    },
  },
}
