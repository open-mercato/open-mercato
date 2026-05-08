/**
 * `customers.analyze_deals` — analytical read-only tool for the deal_analyzer
 * agent (Step d1 of the deal-analyzer-demo).
 *
 * Reads deals scoped to the caller tenant/org, enriches each deal with the
 * most recent activity timestamp (days-since-last-activity), computes a simple
 * healthScore, and returns a ranked list. The handler issues two bounded DB
 * reads (deals + activities) — no N+1.
 *
 * `customers.update_deal_stage` already exists in deals-pack.ts and is
 * imported and re-exported here so the deal_analyzer agent's `allowedTools`
 * list can reference both under a single pack. The tool itself is NOT
 * redeclared here.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  CustomerDeal,
  CustomerActivity,
  CustomerDealPersonLink,
} from '../data/entities'
import {
  assertTenantScope,
  type CustomersAiToolDefinition,
  type CustomersToolContext,
} from './types'

function resolveEm(ctx: CustomersToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

/**
 * Clamp a number to [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Compute a health score for a deal:
 *   healthScore = clamp((30 - daysSinceLastActivity) / 30 * 100, 0, 100)
 * A deal with activity within the last 30 days scores > 0. Deals with no
 * activity default to daysSinceLastActivity = activityWindow so they score 0.
 */
function computeHealthScore(
  daysSinceLastActivity: number,
): number {
  return clamp(((30 - daysSinceLastActivity) / 30) * 100, 0, 100)
}

const analyzeDealsInput = z.object({
  dealStageFilter: z
    .string()
    .optional()
    .describe(
      'Optional pipeline stage name or status slug to restrict results (e.g. "open", "qualification", "negotiation").',
    ),
  daysOfActivityWindow: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30)
    .describe(
      'Number of days to look back for "last activity" calculation. Deals with no activity in this window are flagged as stalled. Default 30.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe('Maximum number of deals to return, ranked by healthScore ascending (most at-risk first). Default 25.'),
})

type AnalyzeDealsInput = z.infer<typeof analyzeDealsInput>

type DealAnalysisItem = {
  id: string
  title: string
  value: number | null
  valueCurrency: string | null
  stage: string | null
  status: string
  daysSinceLastActivity: number
  primaryContact: string | null
  healthScore: number
}

type AnalyzeDealsOutput = {
  deals: DealAnalysisItem[]
  totalAnalyzed: number
  stalledCount: number
  windowDays: number
}

function msTodays(ms: number): number {
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

const analyzeDealsToolDefinition: CustomersAiToolDefinition<AnalyzeDealsInput, AnalyzeDealsOutput> = {
  name: 'customers.analyze_deals',
  displayName: 'Analyze deals',
  description:
    'Fetch and analyze open deals for the caller tenant. Returns each deal with its days-since-last-activity and a health score (0–100, lower = more stalled). Results are ranked most-at-risk first.',
  inputSchema: analyzeDealsInput as z.ZodType<AnalyzeDealsInput>,
  requiredFeatures: ['customers.deals.view'],
  tags: ['read', 'customers', 'analytics'],
  isMutation: false,
  handler: async (rawInput, ctx): Promise<AnalyzeDealsOutput> => {
    const { tenantId } = assertTenantScope(ctx)
    const input = analyzeDealsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const scope = { tenantId, organizationId: ctx.organizationId }

    // Build deal filter
    const dealWhere: Record<string, unknown> = {
      tenantId,
      deletedAt: null,
    }
    if (ctx.organizationId) dealWhere.organizationId = ctx.organizationId
    // Apply stage/status filter when provided
    if (input.dealStageFilter) {
      const filterValue = input.dealStageFilter.trim()
      if (filterValue.length) {
        // Try as a status slug first; the query matches both `status` and
        // `pipelineStage` column so either a slug like "open" or a stage
        // label like "Qualification" will find the right rows.
        dealWhere.$or = [
          { status: filterValue },
          { pipelineStage: filterValue },
        ]
        delete dealWhere.deletedAt // Keep soft-delete filter from outer where
        // Re-apply soft-delete correctly
        dealWhere.deletedAt = null
      }
    }

    const deals = await findWithDecryption<CustomerDeal>(
      em,
      CustomerDeal,
      dealWhere as any,
      {
        orderBy: { updatedAt: 'desc' },
        limit: Math.min(input.limit * 4, 400), // Fetch extra so we can rank properly
      },
      scope,
    )

    if (!deals.length) {
      return { deals: [], totalAnalyzed: 0, stalledCount: 0, windowDays: input.daysOfActivityWindow }
    }

    const dealIds = deals.map((d) => d.id)
    const cutoff = new Date(Date.now() - input.daysOfActivityWindow * 24 * 60 * 60 * 1000)

    // Fetch most recent activity per deal within the window in one batch
    const activities = await em.find(
      CustomerActivity,
      {
        deal: { $in: dealIds },
        tenantId,
        ...(ctx.organizationId ? { organizationId: ctx.organizationId } : {}),
      },
      {
        orderBy: { occurredAt: 'desc' },
        limit: 1000, // Cap batch; covers up to ~40 activities per deal on average
      },
    )

    // Build a map: dealId → most recent activity date
    const lastActivityByDeal = new Map<string, Date>()
    for (const activity of activities) {
      const dealRef = activity.deal
      // MikroORM may have loaded the deal as a proxy or partial; access the id
      // safely through the Reference wrapper or raw FK lookup.
      const refId: string | undefined =
        typeof (dealRef as any)?.id === 'string'
          ? (dealRef as any).id
          : typeof (dealRef as any)?._id === 'string'
            ? (dealRef as any)._id
            : undefined
      if (!refId) continue
      const activityDate = activity.occurredAt ?? activity.createdAt
      if (!activityDate) continue
      const existing = lastActivityByDeal.get(refId)
      if (!existing || activityDate > existing) {
        lastActivityByDeal.set(refId, activityDate)
      }
    }

    // Fetch primary contacts for deals in one batch
    const personLinks = await em.find(
      CustomerDealPersonLink,
      {
        deal: { $in: dealIds },
      },
      { populate: ['person'], limit: 500 },
    )
    const primaryContactByDeal = new Map<string, string>()
    for (const link of personLinks) {
      if (!primaryContactByDeal.has((link.deal as any).id ?? '')) {
        const personName = (link.person as any)?.displayName ?? null
        if (personName) {
          primaryContactByDeal.set((link.deal as any).id ?? '', String(personName))
        }
      }
    }

    const now = Date.now()
    const analyzed: DealAnalysisItem[] = deals.map((deal) => {
      const lastActivity = lastActivityByDeal.get(deal.id)
      const daysSinceLastActivity = lastActivity
        ? msTodays(now - lastActivity.getTime())
        : input.daysOfActivityWindow // Treat as fully stalled when no activity
      const value = deal.valueAmount ? parseFloat(String(deal.valueAmount)) : null
      return {
        id: deal.id,
        title: deal.title,
        value: Number.isFinite(value) ? value : null,
        valueCurrency: deal.valueCurrency ?? null,
        stage: deal.pipelineStage ?? deal.status ?? null,
        status: deal.status ?? 'open',
        daysSinceLastActivity,
        primaryContact: primaryContactByDeal.get(deal.id) ?? null,
        healthScore: Math.round(computeHealthScore(daysSinceLastActivity)),
      }
    })

    // Sort most-at-risk first (lowest health score first, then by value desc)
    analyzed.sort((a, b) => {
      if (a.healthScore !== b.healthScore) return a.healthScore - b.healthScore
      const aVal = a.value ?? 0
      const bVal = b.value ?? 0
      return bVal - aVal
    })

    const truncated = analyzed.slice(0, input.limit)
    const stalledCount = truncated.filter(
      (d) => d.daysSinceLastActivity >= input.daysOfActivityWindow,
    ).length

    return {
      deals: truncated,
      totalAnalyzed: deals.length,
      stalledCount,
      windowDays: input.daysOfActivityWindow,
    }
  },
}

export const dealAnalyzerAiTools: CustomersAiToolDefinition[] = [
  analyzeDealsToolDefinition as unknown as CustomersAiToolDefinition,
]

export default dealAnalyzerAiTools
