import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerPipelineStage } from '../../../data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

const querySchema = z.object({
  pipelineId: z.string().uuid(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
})

type StageMetric = {
  stageId: string
  stageLabel: string
  stageOrder: number
  stageColor: string | null
  dealCount: number
  totalValue: number
  averageAge: number
  weightedValue: number
}

type PipelineMetrics = {
  stages: StageMetric[]
  totals: {
    dealCount: number
    totalValue: number
    weightedValue: number
    wonCount: number
    wonValue: number
    lostCount: number
    lostValue: number
    conversionRate: number
  }
}

export async function GET(request: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }

  if (!rbac || !auth?.sub) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  const hasFeatures = await rbac.userHasAllFeatures(auth.sub, ['customers.deals.view', 'customers.analytics.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeatures) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const url = new URL(request.url)
  const queryResult = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!queryResult.success) {
    return NextResponse.json({ error: 'Invalid query parameters', details: queryResult.error.flatten() }, { status: 400 })
  }
  const query = queryResult.data

  const em = (container.resolve('em') as EntityManager)
  const decryptionScope = { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null }

  const stages = await findWithDecryption(
    em,
    CustomerPipelineStage,
    {
      pipelineId: query.pipelineId,
    },
    { orderBy: { order: 'ASC' } },
    decryptionScope,
  )

  const dealFilter: Record<string, unknown> = {
    pipelineId: query.pipelineId,
    deletedAt: null,
  }
  if (auth.tenantId) dealFilter.tenantId = auth.tenantId
  if (auth.orgId) dealFilter.organizationId = auth.orgId
  if (query.dateFrom) dealFilter.createdAt = { $gte: query.dateFrom }
  if (query.dateTo) {
    dealFilter.createdAt = {
      ...(dealFilter.createdAt as Record<string, unknown> ?? {}),
      $lte: query.dateTo,
    }
  }

  const deals = await findWithDecryption(em, CustomerDeal, dealFilter, {}, decryptionScope)

  const now = Date.now()
  const stageMetrics = new Map<string, StageMetric>()
  for (const stage of stages) {
    stageMetrics.set(stage.id, {
      stageId: stage.id,
      stageLabel: stage.label,
      stageOrder: stage.order ?? 0,
      stageColor: null,
      dealCount: 0,
      totalValue: 0,
      averageAge: 0,
      weightedValue: 0,
    })
  }

  let wonCount = 0
  let wonValue = 0
  let lostCount = 0
  let lostValue = 0
  let totalDeals = 0
  let totalValue = 0
  let totalWeightedValue = 0

  for (const deal of deals) {
    const value = deal.valueAmount ? parseFloat(deal.valueAmount) : 0
    const probability = deal.probability ?? 0
    const weighted = value * (probability / 100)
    const ageMs = deal.stageEnteredAt ? now - deal.stageEnteredAt.getTime() : now - deal.createdAt.getTime()
    const ageDays = Math.max(0, Math.round(ageMs / (1000 * 60 * 60 * 24)))

    totalDeals++
    totalValue += value
    totalWeightedValue += weighted

    const normalizedStatus = deal.status === 'win' ? 'won' : deal.status === 'loose' ? 'lost' : deal.status
    if (normalizedStatus === 'won') {
      wonCount++
      wonValue += value
    } else if (normalizedStatus === 'lost') {
      lostCount++
      lostValue += value
    }

    if (deal.pipelineStageId && stageMetrics.has(deal.pipelineStageId)) {
      const metric = stageMetrics.get(deal.pipelineStageId)!
      metric.dealCount++
      metric.totalValue += value
      metric.weightedValue += weighted
      metric.averageAge = metric.dealCount > 0
        ? Math.round((metric.averageAge * (metric.dealCount - 1) + ageDays) / metric.dealCount)
        : ageDays
    }
  }

  const closedCount = wonCount + lostCount
  const conversionRate = closedCount > 0 ? Math.round((wonCount / closedCount) * 10000) / 100 : 0

  const result: PipelineMetrics = {
    stages: Array.from(stageMetrics.values()).sort((a, b) => a.stageOrder - b.stageOrder),
    totals: {
      dealCount: totalDeals,
      totalValue: Math.round(totalValue * 100) / 100,
      weightedValue: Math.round(totalWeightedValue * 100) / 100,
      wonCount,
      wonValue: Math.round(wonValue * 100) / 100,
      lostCount,
      lostValue: Math.round(lostValue * 100) / 100,
      conversionRate,
    },
  }

  return NextResponse.json(result)
}

export const metadata = {
  methods: ['GET'],
  requireAuth: true,
  requireFeatures: ['customers.deals.view', 'customers.analytics.view'],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Pipeline metrics',
  methods: {
    GET: {
      summary: 'Get pipeline metrics',
      description: 'Returns aggregated metrics per pipeline stage including deal counts, total values, weighted values, and conversion rates.',
      responses: [
        { status: 200, description: 'Pipeline metrics with per-stage breakdown' },
        { status: 400, description: 'Invalid query parameters' },
        { status: 401, description: 'Authentication required' },
        { status: 403, description: 'Access denied' },
      ],
    },
  },
}
