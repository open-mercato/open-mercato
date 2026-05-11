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
  CustomerEntity,
} from '../data/entities'
import {
  assertTenantScope,
  type CustomersAiToolDefinition,
  type CustomersToolContext,
} from './types'

function refIdOf(ref: unknown): string | undefined {
  if (!ref) return undefined
  if (typeof ref === 'string') return ref
  if (typeof ref === 'object' && typeof (ref as { id?: unknown }).id === 'string') {
    return (ref as { id: string }).id
  }
  return undefined
}

function resolveEm(ctx: CustomersToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Compute a health score for a deal:
 *   healthScore = clamp((30 - daysSinceLastActivity) / 30 * 100, 0, 100)
 * A deal with activity within the last 30 days scores > 0. Deals with no
 * activity default to daysSinceLastActivity = activityWindow so they score 0.
 * Exported for unit testing.
 */
export function computeHealthScore(daysSinceLastActivity: number): number {
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

export function msTodays(ms: number): number {
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
    // Apply stage/status filter when provided. `$or` is composed with the
    // outer `deletedAt: null` filter — both must hold — so the caller-supplied
    // value matches either the canonical status slug or the stage label.
    if (input.dealStageFilter) {
      const filterValue = input.dealStageFilter.trim()
      if (filterValue.length) {
        dealWhere.$or = [
          { status: filterValue },
          { pipelineStage: filterValue },
        ]
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

    // Fetch most recent activity per deal within the window in one batch.
    // CustomerActivity has encrypted columns (subject, body); use the
    // tenant-aware helper even though this query only reads occurredAt/deal,
    // so future readers cannot accidentally surface ciphertext.
    const activityWhere: Record<string, unknown> = {
      deal: { $in: dealIds },
      tenantId,
    }
    if (ctx.organizationId) activityWhere.organizationId = ctx.organizationId
    const activities = await findWithDecryption<CustomerActivity>(
      em,
      CustomerActivity,
      activityWhere as any,
      {
        orderBy: { occurredAt: 'desc' },
        limit: 1000,
      },
      scope,
    )

    const lastActivityByDeal = new Map<string, Date>()
    for (const activity of activities) {
      const refId = refIdOf((activity as { deal?: unknown }).deal)
      if (!refId) continue
      const activityDate = activity.occurredAt ?? activity.createdAt
      if (!activityDate) continue
      const existing = lastActivityByDeal.get(refId)
      if (!existing || activityDate > existing) {
        lastActivityByDeal.set(refId, activityDate)
      }
    }

    // Fetch primary contacts for deals in one batch. CustomerDealPersonLink
    // has no encrypted columns, but the linked CustomerEntity.display_name is
    // encrypted, so resolve names via findWithDecryption rather than
    // populating the relation through raw em.find.
    const personLinkWhere: Record<string, unknown> = {
      deal: { $in: dealIds },
      tenantId,
    }
    if (ctx.organizationId) personLinkWhere.organizationId = ctx.organizationId
    const personLinks = await em.find(
      CustomerDealPersonLink,
      personLinkWhere as any,
      { limit: 500 },
    )

    const linksByDeal = new Map<string, string>() // dealId → personId (first link wins)
    for (const link of personLinks) {
      const dealRefId = refIdOf((link as { deal?: unknown }).deal)
      const personRefId = refIdOf((link as { person?: unknown }).person)
      if (!dealRefId || !personRefId) continue
      if (!linksByDeal.has(dealRefId)) linksByDeal.set(dealRefId, personRefId)
    }

    const primaryContactByDeal = new Map<string, string>()
    const personIds = Array.from(new Set(linksByDeal.values()))
    if (personIds.length) {
      const personWhere: Record<string, unknown> = {
        id: { $in: personIds },
        tenantId,
      }
      if (ctx.organizationId) personWhere.organizationId = ctx.organizationId
      const persons = await findWithDecryption<CustomerEntity>(
        em,
        CustomerEntity,
        personWhere as any,
        undefined,
        scope,
      )
      const nameByPersonId = new Map<string, string>()
      for (const person of persons) {
        const name = person.displayName
        if (typeof name === 'string' && name.length) {
          nameByPersonId.set(person.id, name)
        }
      }
      for (const [dealId, personId] of linksByDeal) {
        const name = nameByPersonId.get(personId)
        if (name) primaryContactByDeal.set(dealId, name)
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
