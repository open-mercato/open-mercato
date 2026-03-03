import { createHash } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  AgentGovernanceDecisionEntityLink,
  AgentGovernanceDecisionWhyLink,
  AgentGovernancePrecedentIndex,
} from '../data/entities'
import type { RetrievalAdapterService } from './retrieval-adapter-service'

export type RetrievalPlanBudget = {
  tokenBudget?: number
  costBudgetUsd?: number
  timeBudgetMs?: number
  precedentLimit?: number
  rationaleLimit?: number
  neighborLimit?: number
}

export type RetrievalPlanInput = {
  tenantId: string
  organizationId: string
  actionType: string
  targetEntity: string
  targetId?: string | null
  signature?: string | null
  query?: string | null
  providerId?: string | null
  disableProviderFallback?: boolean
  budget?: RetrievalPlanBudget
}

export type RetrievalContextSlice = {
  sliceId: string
  kind: 'precedent' | 'rationale' | 'neighbor' | 'fallback'
  title: string
  content: string
  sourceRef: string
  score: number
}

export type RetrievalPlanResult = {
  bundleId: string
  slices: RetrievalContextSlice[]
  sourceRefs: string[]
  fallbackUsed: boolean
  retrievalProvider: string
  providerFallbackUsed: boolean
  estimatedTokens: number
  estimatedCostUsd: number
  elapsedMs: number
  truncated: boolean
}

type RetrievalPlannerDeps = {
  em: EntityManager
  retrievalAdapterService?: Pick<RetrievalAdapterService, 'retrieveWithFallback'>
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableSerialize(val)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

function buildBundleId(input: RetrievalPlanInput, sourceRefs: string[]): string {
  return createHash('sha256')
    .update(
      stableSerialize({
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        actionType: input.actionType,
        targetEntity: input.targetEntity,
        targetId: input.targetId ?? null,
        signature: input.signature ?? null,
        query: input.query ?? null,
        sourceRefs,
      }),
    )
    .digest('hex')
}

function estimateTokens(content: string): number {
  if (!content) return 0
  return Math.max(1, Math.ceil(content.length / 4))
}

function estimateCostUsd(tokens: number): number {
  return Math.round((tokens / 1000) * 0.0005 * 1_000_000) / 1_000_000
}

function withDefaults(budget?: RetrievalPlanBudget): Required<RetrievalPlanBudget> {
  return {
    tokenBudget: Math.max(200, Math.min(10_000, budget?.tokenBudget ?? 1400)),
    costBudgetUsd: Math.max(0.01, Math.min(5, budget?.costBudgetUsd ?? 0.6)),
    timeBudgetMs: Math.max(100, Math.min(20_000, budget?.timeBudgetMs ?? 1800)),
    precedentLimit: Math.max(1, Math.min(40, budget?.precedentLimit ?? 8)),
    rationaleLimit: Math.max(0, Math.min(60, budget?.rationaleLimit ?? 12)),
    neighborLimit: Math.max(0, Math.min(60, budget?.neighborLimit ?? 10)),
  }
}

function deterministicSort(a: RetrievalContextSlice, b: RetrievalContextSlice): number {
  if (b.score !== a.score) return b.score - a.score
  if (a.kind !== b.kind) return a.kind.localeCompare(b.kind)
  if (a.sourceRef !== b.sourceRef) return a.sourceRef.localeCompare(b.sourceRef)
  return a.sliceId.localeCompare(b.sliceId)
}

export function createRetrievalPlannerService(deps: RetrievalPlannerDeps) {
  async function planContextBundle(input: RetrievalPlanInput): Promise<RetrievalPlanResult> {
    const startedAt = Date.now()
    const budget = withDefaults(input.budget)
    const slices: RetrievalContextSlice[] = []
    let estimatedTokens = 0
    let estimatedCostUsd = 0
    let fallbackUsed = false
    let retrievalProvider = 'native'
    let providerFallbackUsed = false
    let truncated = false

    const canAddSlice = (slice: RetrievalContextSlice): boolean => {
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs > budget.timeBudgetMs) {
        truncated = true
        return false
      }

      const nextTokens = estimatedTokens + estimateTokens(slice.content)
      const nextCost = estimateCostUsd(nextTokens)

      if (nextTokens > budget.tokenBudget || nextCost > budget.costBudgetUsd) {
        truncated = true
        return false
      }

      estimatedTokens = nextTokens
      estimatedCostUsd = nextCost
      slices.push(slice)
      return true
    }

    const externalResult = deps.retrievalAdapterService
      ? await deps.retrievalAdapterService.retrieveWithFallback(
          {
            tenantId: input.tenantId,
            organizationId: input.organizationId,
            actionType: input.actionType,
            targetEntity: input.targetEntity,
            targetId: input.targetId ?? null,
            signature: input.signature ?? null,
            query: input.query ?? null,
            limit: budget.precedentLimit,
          },
          {
            providerId: input.providerId ?? null,
            allowFallback: input.disableProviderFallback !== true,
          },
        )
      : null

    if (externalResult && externalResult.items.length > 0) {
      retrievalProvider = externalResult.providerId
      providerFallbackUsed = externalResult.fallbackUsed

      for (const item of externalResult.items) {
        const slice: RetrievalContextSlice = {
          sliceId: `${externalResult.providerId}:${item.sourceRef}:${item.kind}`,
          kind: item.kind,
          title: item.title,
          content: item.content,
          sourceRef: item.sourceRef,
          score: item.score,
        }

        if (!canAddSlice(slice)) {
          break
        }
      }
    }

    if (slices.length === 0) {
      try {
      const where: {
        tenantId: string
        organizationId: string
        signature?: string
        summary?: { $ilike: string }
      } = {
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      }

      if (input.signature) {
        where.signature = input.signature
      } else {
        const query =
          input.query
          ?? `${input.actionType} ${input.targetEntity}${input.targetId ? ` ${input.targetId}` : ''}`
        where.summary = { $ilike: `%${escapeLikePattern(query)}%` }
      }

        const precedentRows = await findWithDecryption(
          deps.em,
          AgentGovernancePrecedentIndex,
          where,
          {
            limit: budget.precedentLimit,
            orderBy: [{ score: 'DESC' }, { createdAt: 'DESC' }],
          },
          { tenantId: input.tenantId, organizationId: input.organizationId },
        )

        for (const precedent of precedentRows) {
          const content = precedent.summary?.trim() || `Signature ${precedent.signature}`
          const slice: RetrievalContextSlice = {
            sliceId: `precedent:${precedent.id}`,
            kind: 'precedent',
            title: precedent.signature,
            content,
            sourceRef: `decision_event:${precedent.decisionEventId}`,
            score: precedent.score,
          }

          if (!canAddSlice(slice)) {
            break
          }
        }

        if (slices.length > 0 && budget.rationaleLimit > 0) {
          const precedentEventIds = slices
            .filter((slice) => slice.kind === 'precedent')
            .map((slice) => slice.sourceRef.replace(/^decision_event:/, ''))
            .filter((value) => value.length > 0)

          if (precedentEventIds.length > 0) {
            const whyLinks = await findWithDecryption(
              deps.em,
              AgentGovernanceDecisionWhyLink,
              {
                tenantId: input.tenantId,
                organizationId: input.organizationId,
                decisionEvent: { $in: precedentEventIds },
              },
              {
                limit: budget.rationaleLimit,
                orderBy: { createdAt: 'DESC' },
              },
              { tenantId: input.tenantId, organizationId: input.organizationId },
            )

            for (const whyLink of whyLinks) {
              const content = `${whyLink.reasonType}${whyLink.summary ? `: ${whyLink.summary}` : ''}`
              const slice: RetrievalContextSlice = {
                sliceId: `why:${whyLink.id}`,
                kind: 'rationale',
                title: `Rationale ${whyLink.reasonType}`,
                content,
                sourceRef: `why_link:${whyLink.id}`,
                score: Math.max(0, Math.min(1, whyLink.confidence ?? 0.6)),
              }

              if (!canAddSlice(slice)) {
                break
              }
            }
          }
        }

        if (budget.neighborLimit > 0 && input.targetId) {
          const neighbors = await findWithDecryption(
            deps.em,
            AgentGovernanceDecisionEntityLink,
            {
              tenantId: input.tenantId,
              organizationId: input.organizationId,
              entityType: input.targetEntity,
              entityId: input.targetId,
            },
            {
              limit: budget.neighborLimit,
              orderBy: { createdAt: 'DESC' },
            },
            { tenantId: input.tenantId, organizationId: input.organizationId },
          )

          for (const neighbor of neighbors) {
            const slice: RetrievalContextSlice = {
              sliceId: `neighbor:${neighbor.id}`,
              kind: 'neighbor',
              title: `Neighbor ${neighbor.relationshipType}`,
              content: `${neighbor.entityType}:${neighbor.entityId} via ${neighbor.relationshipType}`,
              sourceRef: `decision_event:${neighbor.decisionEvent.id}`,
              score: 0.55,
            }

            if (!canAddSlice(slice)) {
              break
            }
          }
        }
      } catch {
        fallbackUsed = true
      }
    }

    if (slices.length === 0) {
      fallbackUsed = true
      const fallbackContent = `${input.actionType} ${input.targetEntity}${input.targetId ? ` ${input.targetId}` : ''}`
      const fallbackSlice: RetrievalContextSlice = {
        sliceId: `fallback:${input.targetEntity}`,
        kind: 'fallback',
        title: 'Fallback context',
        content: fallbackContent,
        sourceRef: `fallback:${input.targetEntity}`,
        score: 0.3,
      }

      canAddSlice(fallbackSlice)
    }

    slices.sort(deterministicSort)

    const sourceRefs = [...new Set(slices.map((slice) => slice.sourceRef))]
    const bundleId = buildBundleId(input, sourceRefs)

    return {
      bundleId,
      slices,
      sourceRefs,
      fallbackUsed,
      retrievalProvider,
      providerFallbackUsed,
      estimatedTokens,
      estimatedCostUsd,
      elapsedMs: Date.now() - startedAt,
      truncated,
    }
  }

  return {
    planContextBundle,
  }
}

export type RetrievalPlannerService = ReturnType<typeof createRetrievalPlannerService>
