import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DataQualityScanRun } from '../../../data/entities'
import {
  resolveDataQualityRouteContext,
  toIsoString,
  unwrapRouteParams,
} from '../../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.scan.view'] },
}

export const metadata = routeMetadata

const paramsSchema = z.object({ id: z.string().uuid() })
const scanDetailSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid().nullable(),
  targetEntityType: z.string().nullable(),
  status: z.string(),
  progressJobId: z.string().uuid().nullable(),
  criteria: z.record(z.string(), z.unknown()).nullable(),
  totalCount: z.number(),
  scannedCount: z.number(),
  failedCount: z.number(),
  findingCount: z.number(),
  score: z.number().nullable(),
  requestedBy: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
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
    return NextResponse.json({ error: 'Invalid scan id', details: parsedParams.error.issues }, { status: 400 })
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
      softDeleteField: null,
    },
  )

  const scanRun = await em.findOne(DataQualityScanRun, where as never)
  if (!scanRun) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: scanRun.id,
    suiteId: scanRun.suiteId,
    targetEntityType: scanRun.targetEntityType,
    status: scanRun.status,
    progressJobId: scanRun.progressJobId,
    criteria: scanRun.criteriaJson ?? null,
    totalCount: scanRun.totalCount,
    scannedCount: scanRun.scannedCount,
    failedCount: scanRun.failedCount,
    findingCount: scanRun.findingCount,
    score: scanRun.score,
    requestedBy: scanRun.requestedBy,
    startedAt: toIsoString(scanRun.startedAt),
    finishedAt: toIsoString(scanRun.finishedAt),
    createdAt: toIsoString(scanRun.createdAt),
    updatedAt: toIsoString(scanRun.updatedAt),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Data quality scan detail',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Get a data quality scan run',
      responses: [{ status: 200, description: 'Scan detail', schema: scanDetailSchema }],
      errors: [{ status: 404, description: 'Scan not found' }],
    },
  },
}
