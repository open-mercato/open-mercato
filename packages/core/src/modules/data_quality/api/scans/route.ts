import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { buildScopedWhere } from '@open-mercato/shared/lib/api/crud'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'
import { DataQualityScanRun, DataQualitySuite } from '../../data/entities'
import {
  listScansSchema,
  startScanSchema,
  type StartScanInput,
} from '../../data/validators'
import { resolveDataQualityRouteContext, toIsoString } from '../helpers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['data_quality.scan.view'] },
  POST: { requireAuth: true, requireFeatures: ['data_quality.scan.run'] },
}

export const metadata = routeMetadata

const scanListItemSchema = z.object({
  id: z.string().uuid(),
  suiteId: z.string().uuid().nullable(),
  suiteName: z.string().nullable(),
  targetEntityType: z.string().nullable(),
  status: z.string(),
  progress: z.number(),
  totalCount: z.number(),
  scannedCount: z.number(),
  failedCount: z.number(),
  findingCount: z.number(),
  openFindingCount: z.number(),
  score: z.number().nullable(),
  requestedBy: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string().nullable(),
})
const pagedScanListSchema = z.object({
  items: z.array(scanListItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})
const startScanResultSchema = z.object({
  ok: z.literal(true),
  scanRunId: z.string().uuid(),
  progressJobId: z.string().uuid(),
  message: z.string(),
})

function calculateProgress(scanRun: DataQualityScanRun): number {
  if (scanRun.totalCount > 0) {
    return Math.min(100, Math.max(0, Math.round((scanRun.scannedCount / scanRun.totalCount) * 100)))
  }
  if (scanRun.status === 'completed') return 100
  if (scanRun.status === 'running') return 0
  return 0
}

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
  const query = listScansSchema.parse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    id: url.searchParams.get('id') ?? undefined,
    search: url.searchParams.get('search') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    suiteId: url.searchParams.get('suiteId') ?? undefined,
    targetEntityType: url.searchParams.get('targetEntityType') ?? undefined,
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
      softDeleteField: null,
    },
  ) as Record<string, unknown>

  if (query.id) where.id = query.id
  if (query.status) where.status = query.status
  if (query.suiteId) where.suiteId = query.suiteId
  if (query.targetEntityType) where.targetEntityType = query.targetEntityType

  const search = typeof query.search === 'string' ? query.search.trim() : ''
  if (search.length > 0) {
    const like = `%${escapeLikePattern(search)}%`
    const suiteWhere: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
      $or: [
        { code: { $ilike: like } },
        { name: { $ilike: like } },
      ],
    }
    if (context.selectedOrganizationId) {
      suiteWhere.organizationId = context.selectedOrganizationId
    } else if (context.organizationIds) {
      suiteWhere.organizationId = { $in: context.organizationIds }
    }

    const matchingSuites = await em.find(DataQualitySuite, suiteWhere as never, {
      fields: ['id'],
    })
    const matchingSuiteIds = matchingSuites.map((suite: DataQualitySuite) => suite.id)
    const searchConditions: Record<string, unknown>[] = [
      { status: { $ilike: like } },
      { targetEntityType: { $ilike: like } },
    ]
    if (matchingSuiteIds.length > 0) {
      searchConditions.push({ suiteId: { $in: matchingSuiteIds } })
    }
    where.$or = searchConditions
  }

  const offset = (query.page - 1) * query.pageSize
  const [items, total] = await em.findAndCount(DataQualityScanRun, where as never, {
    orderBy: { createdAt: 'DESC' },
    limit: query.pageSize,
    offset,
  })

  const suiteIds = Array.from(new Set(items.map((scanRun: DataQualityScanRun) => scanRun.suiteId).filter((suiteId: string | null): suiteId is string => Boolean(suiteId))))
  const suites = suiteIds.length > 0
    ? await em.find(DataQualitySuite, {
      id: { $in: suiteIds },
      tenantId,
      ...(context.selectedOrganizationId
        ? { organizationId: context.selectedOrganizationId }
        : context.organizationIds
          ? { organizationId: { $in: context.organizationIds } }
          : {}),
      deletedAt: null,
    } as never)
    : []
  const suiteNameById = new Map<string, string>(suites.map((suite: DataQualitySuite) => [suite.id, suite.name]))

  return NextResponse.json({
    items: items.map((scanRun: DataQualityScanRun) => ({
      id: scanRun.id,
      suiteId: scanRun.suiteId,
      suiteName: scanRun.suiteId ? (suiteNameById.get(scanRun.suiteId) ?? null) : null,
      targetEntityType: scanRun.targetEntityType,
      status: scanRun.status,
      progress: calculateProgress(scanRun),
      totalCount: scanRun.totalCount,
      scannedCount: scanRun.scannedCount,
      failedCount: scanRun.failedCount,
      findingCount: scanRun.findingCount,
      openFindingCount: scanRun.openFindingCount,
      score: scanRun.score,
      requestedBy: scanRun.requestedBy,
      startedAt: toIsoString(scanRun.startedAt),
      finishedAt: toIsoString(scanRun.finishedAt),
      createdAt: toIsoString(scanRun.createdAt),
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.ceil(total / query.pageSize),
  })
}

export async function POST(req: Request) {
  try {
    const context = await resolveDataQualityRouteContext(req)
    if (!context) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = context.auth.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await readJsonSafe<Record<string, unknown>>(req, {})
    const parsed = startScanSchema.parse(body)
    const guardUserId = context.auth.userId ?? context.auth.sub
    if (!guardUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const guardResult = await validateCrudMutationGuard(context.container, {
      tenantId,
      organizationId: context.selectedOrganizationId,
      userId: guardUserId,
      resourceKind: 'data_quality.scan',
      resourceId: 'new',
      operation: 'custom',
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: parsed,
    })
    if (guardResult && !guardResult.ok) {
      return NextResponse.json(guardResult.body, { status: guardResult.status })
    }

    const commandBus = context.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<StartScanInput, { scanRunId: string; progressJobId: string }>(
      'data_quality.scan.start',
      {
        input: parsed,
        ctx: context.commandContext,
      },
    )

    if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
      await runCrudMutationGuardAfterSuccess(context.container, {
        tenantId,
        organizationId: context.selectedOrganizationId,
        userId: guardUserId,
        resourceKind: 'data_quality.scan',
        resourceId: result.scanRunId,
        operation: 'custom',
        requestMethod: req.method,
        requestHeaders: req.headers,
        metadata: guardResult.metadata ?? null,
      })
    }

    return NextResponse.json({
      ok: true,
      scanRunId: result.scanRunId,
      progressJobId: result.progressJobId,
      message: 'Data quality scan started.',
    }, { status: 202 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    if (error && typeof error === 'object' && 'body' in error && 'status' in error) {
      const maybeCrudError = error as { body?: Record<string, unknown>; status?: number }
      if (typeof maybeCrudError.status === 'number' && maybeCrudError.body) {
        return NextResponse.json(maybeCrudError.body, { status: maybeCrudError.status })
      }
    }
    console.error('data_quality.scan.start failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Data Quality',
  summary: 'Data quality scan runs',
  methods: {
    GET: {
      summary: 'List data quality scan runs',
      query: listScansSchema,
      responses: [{ status: 200, description: 'Scan runs', schema: pagedScanListSchema }],
    },
    POST: {
      summary: 'Start a new data quality scan',
      requestBody: { contentType: 'application/json', schema: startScanSchema },
      responses: [{ status: 202, description: 'Scan queued', schema: startScanResultSchema }],
    },
  },
}
