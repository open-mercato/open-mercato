import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerDeal, CustomerPipeline } from '../../../../data/entities'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['customers.deals.view'] },
}

const paramsSchema = z.object({
  id: z.string().uuid(),
})

function notFound(message: string) {
  return NextResponse.json({ error: message }, { status: 404 })
}

function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 })
}

function badRequest(message: string, code?: string) {
  return NextResponse.json(
    code ? { error: message, code } : { error: message },
    { status: 400 },
  )
}

function startOfIsoWeek(date: Date): Date {
  const value = new Date(date)
  const day = value.getDay()
  const diff = day === 0 ? -6 : 1 - day
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() + diff)
  return value
}

function startOfQuarter(date: Date): Date {
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1)
}

function calculateSalesCycleDays(createdAt: Date, closedAt: Date): number {
  const diffMs = closedAt.getTime() - createdAt.getTime()
  if (diffMs <= 0) return 0
  return Math.floor(diffMs / 86400000)
}

export async function GET(request: Request, context: { params?: Record<string, unknown> }) {
  const { translate } = await resolveTranslations()
  const parsedParams = paramsSchema.safeParse(context.params)
  if (!parsedParams.success) {
    return notFound(translate('customers.errors.deal_not_found', 'Deal not found'))
  }

  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.sub && !auth?.isApiKey) {
    return NextResponse.json({ error: translate('customers.errors.authentication_required', 'Authentication required') }, { status: 401 })
  }

  let rbac: RbacService | null = null
  try {
    rbac = (container.resolve('rbacService') as RbacService)
  } catch {
    rbac = null
  }

  if (!rbac || !auth?.sub) {
    return forbidden(translate('customers.errors.access_denied', 'Access denied'))
  }
  const hasFeature = await rbac.userHasAllFeatures(auth.sub, ['customers.deals.view'], {
    tenantId: auth.tenantId ?? null,
    organizationId: auth.orgId ?? null,
  })
  if (!hasFeature) {
    return forbidden(translate('customers.errors.access_denied', 'Access denied'))
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const em = (container.resolve('em') as EntityManager)
  const deal = await findOneWithDecryption(
    em,
    CustomerDeal,
    { id: parsedParams.data.id, tenantId: auth.tenantId ?? null, deletedAt: null },
    {},
    { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null },
  )
  if (!deal) {
    return notFound(translate('customers.errors.deal_not_found', 'Deal not found'))
  }

  const allowedOrgIds = new Set<string>()
  if (Array.isArray(scope?.filterIds)) {
    scope.filterIds.forEach((id) => {
      if (typeof id === 'string' && id.trim().length) allowedOrgIds.add(id)
    })
  } else if (auth.orgId) {
    allowedOrgIds.add(auth.orgId)
  }
  if (allowedOrgIds.size && deal.organizationId && !allowedOrgIds.has(deal.organizationId)) {
    return forbidden(translate('customers.errors.access_denied', 'Access denied'))
  }

  if (!deal.closureOutcome) {
    return badRequest(translate('customers.errors.deal_not_closed', 'Deal is not closed'), 'DEAL_NOT_CLOSED')
  }

  const now = new Date()
  const weekStart = startOfIsoWeek(now)
  const quarterStart = startOfQuarter(now)
  const dealsClosedThisPeriod = await em.count(CustomerDeal, {
    organizationId: deal.organizationId,
    tenantId: deal.tenantId,
    closureOutcome: deal.closureOutcome,
    deletedAt: null,
    updatedAt: { $gte: weekStart },
  })

  let dealRankInQuarter: number | null = null
  if (deal.closureOutcome === 'won' && deal.valueAmount !== null) {
    const higherValueDeals = await em.count(CustomerDeal, {
      organizationId: deal.organizationId,
      tenantId: deal.tenantId,
      closureOutcome: 'won',
      deletedAt: null,
      updatedAt: { $gte: quarterStart },
      valueAmount: { $gt: deal.valueAmount },
    })
    dealRankInQuarter = higherValueDeals + 1
  }

  const pipeline = deal.pipelineId
    ? await findOneWithDecryption(
      em,
      CustomerPipeline,
      { id: deal.pipelineId, tenantId: deal.tenantId, organizationId: deal.organizationId },
      {},
      { tenantId: deal.tenantId, organizationId: deal.organizationId },
    )
    : null

  let lossReasonLabel: string | null = null
  if (deal.lossReasonId) {
    const dictionaryEntry = await findOneWithDecryption(
      em,
      DictionaryEntry,
      {
        id: deal.lossReasonId,
        organizationId: deal.organizationId,
        tenantId: deal.tenantId,
      },
      { populate: ['dictionary'] },
      { tenantId: deal.tenantId, organizationId: deal.organizationId },
    )
    const dictionaryKey =
      dictionaryEntry?.dictionary &&
      typeof (dictionaryEntry.dictionary as { key?: unknown }).key === 'string'
        ? (dictionaryEntry.dictionary as { key: string }).key
        : null
    if (dictionaryKey === 'sales.deal_loss_reason') {
      lossReasonLabel = dictionaryEntry?.label ?? dictionaryEntry?.value ?? null
    }
  }

  return NextResponse.json({
    dealValue: deal.valueAmount !== null ? Number(deal.valueAmount) : null,
    dealCurrency: deal.valueCurrency ?? null,
    closureOutcome: deal.closureOutcome,
    closedAt: deal.updatedAt.toISOString(),
    pipelineName: pipeline?.name ?? null,
    dealsClosedThisPeriod,
    salesCycleDays: calculateSalesCycleDays(deal.createdAt, deal.updatedAt),
    dealRankInQuarter,
    lossReason: lossReasonLabel,
  })
}

const dealStatsResponseSchema = z.object({
  dealValue: z.number().nullable(),
  dealCurrency: z.string().nullable(),
  closureOutcome: z.enum(['won', 'lost']),
  closedAt: z.string(),
  pipelineName: z.string().nullable(),
  dealsClosedThisPeriod: z.number().int(),
  salesCycleDays: z.number().int().nullable(),
  dealRankInQuarter: z.number().int().nullable(),
  lossReason: z.string().nullable(),
})

const dealStatsErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Customers',
  summary: 'Fetch deal closure stats',
  methods: {
    GET: {
      summary: 'Fetch analytics for a closed deal',
      description: 'Returns week-to-date closure counts, sales cycle length, quarter ranking, and loss reason context for a closed deal.',
      responses: [
        { status: 200, description: 'Deal closure stats payload', schema: dealStatsResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Deal is not closed', schema: dealStatsErrorSchema },
        { status: 401, description: 'Unauthorized', schema: dealStatsErrorSchema },
        { status: 403, description: 'Forbidden for tenant/organization scope', schema: dealStatsErrorSchema },
        { status: 404, description: 'Deal not found', schema: dealStatsErrorSchema },
      ],
    },
  },
}
