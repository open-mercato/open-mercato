import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DataQualityFinding, DataQualityScanRun } from '../../data/entities'
import { resolveDataQualityRouteContext, toIsoString } from '../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.view'] },
}

export const metadata = routeMetadata

const summaryResponseSchema = z.object({
  score: z.number(),
  openFindingCount: z.number(),
  criticalCount: z.number(),
  warningCount: z.number(),
  lastScanRun: z.object({
    id: z.string().uuid(),
    status: z.string(),
    finishedAt: z.string().nullable(),
  }).nullable(),
})

export async function GET(req: Request) {
  const context = await resolveDataQualityRouteContext(req)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const em = context.container.resolve<EntityManager>('em')
  const findingScope = buildScopedWhere(
    {},
    {
      organizationId: context.selectedOrganizationId ?? undefined,
      organizationIds: context.organizationIds ?? undefined,
      tenantId: context.auth.tenantId,
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
  ) as Record<string, unknown>

  const openFindingCount = await em.count(DataQualityFinding, {
    ...findingScope,
    status: 'open',
  } as never)
  const criticalCount = await em.count(DataQualityFinding, {
    ...findingScope,
    status: 'open',
    severity: 'critical',
  } as never)
  const warningCount = await em.count(DataQualityFinding, {
    ...findingScope,
    status: 'open',
    severity: 'warning',
  } as never)
  const totalFindings = await em.count(DataQualityFinding, findingScope as never)

  const scanScope = buildScopedWhere(
    {
      status: { $in: ['completed', 'failed', 'cancelled'] },
    },
    {
      organizationId: context.selectedOrganizationId ?? undefined,
      organizationIds: context.organizationIds ?? undefined,
      tenantId: context.auth.tenantId,
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: null,
    },
  )
  const lastScan = await em.findOne(DataQualityScanRun, scanScope as never, {
    orderBy: { finishedAt: 'DESC' },
  })

  const score = totalFindings > 0
    ? Math.round(((totalFindings - openFindingCount) / totalFindings) * 10000) / 100
    : 100

  return NextResponse.json({
    score,
    openFindingCount,
    criticalCount,
    warningCount,
    lastScanRun: lastScan ? {
      id: lastScan.id,
      status: lastScan.status,
      finishedAt: toIsoString(lastScan.finishedAt),
    } : null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Data quality summary',
  methods: {
    GET: {
      summary: 'Get data quality summary and scorecard',
      responses: [{ status: 200, description: 'Summary', schema: summaryResponseSchema }],
    },
  },
}
