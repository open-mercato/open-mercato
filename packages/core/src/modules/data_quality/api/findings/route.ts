import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { DataQualityCheck, DataQualityFinding } from '../../data/entities'
import { listFindingsSchema } from '../../data/validators'
import { loadTargetRegistry } from '../../lib/targetRegistry'
import { resolveDataQualityRouteContext, toIsoString } from '../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.finding.view'] },
}

export const metadata = routeMetadata

const findingListItemSchema = z.object({
  id: z.string().uuid(),
  checkId: z.string().uuid(),
  checkName: z.string().nullable(),
  checkCode: z.string().nullable(),
  targetEntityType: z.string(),
  targetRecordId: z.string(),
  recordLink: z.string().nullable(),
  status: z.string(),
  severity: z.string(),
  message: z.string(),
  firstSeenAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
})
const pagedFindingListSchema = z.object({
  items: z.array(findingListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

export async function GET(req: Request) {
  const context = await resolveDataQualityRouteContext(req)
  if (!context) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = context.auth.tenantId
  if (!tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const query = listFindingsSchema.parse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    severity: url.searchParams.get('severity') ?? undefined,
    targetEntityType: url.searchParams.get('targetEntityType') ?? undefined,
    targetRecordId: url.searchParams.get('targetRecordId') ?? undefined,
    checkId: url.searchParams.get('checkId') ?? undefined,
    scanRunId: url.searchParams.get('scanRunId') ?? undefined,
    ids: url.searchParams.get('ids') ?? undefined,
  })

  const em = context.container.resolve<EntityManager>('em')
  const where = buildScopedWhere(
    {},
    {
      organizationId: context.selectedOrganizationId ?? undefined,
      organizationIds: context.organizationIds ?? undefined,
      tenantId,
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
  ) as Record<string, unknown>

  if (query.status) where.status = query.status
  if (query.severity) where.severity = query.severity
  if (query.targetEntityType) where.targetEntityType = query.targetEntityType
  if (query.targetRecordId) where.targetRecordId = query.targetRecordId
  if (query.checkId) where.checkId = query.checkId
  if (query.scanRunId) where.scanRunId = query.scanRunId

  const requestedIds = parseIdsParam(query.ids)
  if (requestedIds.length > 0) {
    where.id = { $in: requestedIds }
  }

  const offset = (query.page - 1) * query.pageSize
  const [items, total] = await em.findAndCount(DataQualityFinding, where as never, {
    orderBy: { lastSeenAt: 'DESC' },
    limit: query.pageSize,
    offset,
  })

  const checkIds = Array.from(new Set(items.map((finding: DataQualityFinding) => finding.checkId)))
  const checks = checkIds.length > 0
    ? await em.find(DataQualityCheck, {
      id: { $in: checkIds },
    tenantId,
      ...(context.selectedOrganizationId
        ? { organizationId: context.selectedOrganizationId }
        : context.organizationIds
          ? { organizationId: { $in: context.organizationIds } }
          : {}),
      deletedAt: null,
    } as never)
    : []
  const checkMap = new Map<string, DataQualityCheck>(checks.map((check: DataQualityCheck) => [check.id, check]))
  const registry = loadTargetRegistry()
  const targetMap = new Map(registry.targets.map((target) => [target.entityId, target]))

  return NextResponse.json({
    items: items.map((finding: DataQualityFinding) => {
      const check = checkMap.get(finding.checkId)
      const target = targetMap.get(finding.targetEntityType)
      return {
        id: finding.id,
        checkId: finding.checkId,
        checkName: check?.name ?? null,
        checkCode: check?.code ?? null,
        targetEntityType: finding.targetEntityType,
        targetRecordId: finding.targetRecordId,
        recordLink: target?.recordLink?.replace('{id}', finding.targetRecordId) ?? null,
        status: finding.status,
        severity: finding.severity,
        message: finding.message,
        firstSeenAt: toIsoString(finding.firstSeenAt),
        lastSeenAt: toIsoString(finding.lastSeenAt),
      }
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Data quality findings',
  methods: {
    GET: {
      summary: 'List data quality findings',
      query: listFindingsSchema,
      responses: [{ status: 200, description: 'Findings', schema: pagedFindingListSchema }],
    },
  },
}
