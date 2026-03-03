import type { RetrievalPlanBudget, RetrievalPlannerService } from './retrieval-planner-service'
import type { RetrievalAdapterService } from './retrieval-adapter-service'

export type RetrievalBenchmarkCase = {
  actionType: string
  targetEntity: string
  targetId?: string | null
  query?: string | null
  signature?: string | null
  expectedSourceRefPrefixes?: string[]
}

export type RetrievalProviderBenchmark = {
  providerId: string
  cases: number
  averageLatencyMs: number
  averageTokens: number
  averageCostUsd: number
  hitRate: number
  fallbackRate: number
  score: number
}

export type RetrievalBenchmarkResult = {
  providers: RetrievalProviderBenchmark[]
  recommendedProviderId: string
  recommendationRationale: string
}

type RetrievalBenchmarkInput = {
  tenantId: string
  organizationId: string
  cases: RetrievalBenchmarkCase[]
  providers?: string[]
  budget?: RetrievalPlanBudget
}

type RetrievalBenchmarkServiceDeps = {
  retrievalPlannerService: Pick<RetrievalPlannerService, 'planContextBundle'>
  retrievalAdapterService?: Pick<RetrievalAdapterService, 'listProviders'>
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

function normalize(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(1, value / max))
}

function scoreProvider(input: {
  hitRate: number
  averageLatencyMs: number
  averageCostUsd: number
  maxLatencyMs: number
  maxCostUsd: number
}): number {
  const latencyPenalty = normalize(input.averageLatencyMs, input.maxLatencyMs)
  const costPenalty = normalize(input.averageCostUsd, input.maxCostUsd)
  const score = input.hitRate * 0.7 + (1 - latencyPenalty) * 0.2 + (1 - costPenalty) * 0.1
  return Math.max(0, Math.min(1, score))
}

function isHit(sourceRefs: string[], prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) {
    return sourceRefs.length > 0
  }
  return sourceRefs.some((ref) => prefixes.some((prefix) => ref.startsWith(prefix)))
}

export function createRetrievalBenchmarkService(deps: RetrievalBenchmarkServiceDeps) {
  async function benchmarkProviders(input: RetrievalBenchmarkInput): Promise<RetrievalBenchmarkResult> {
    const providers =
      input.providers && input.providers.length > 0
        ? [...new Set(input.providers)]
        : deps.retrievalAdapterService?.listProviders() ?? ['native']

    const providerResults: RetrievalProviderBenchmark[] = []

    for (const providerId of providers) {
      const latencies: number[] = []
      const tokens: number[] = []
      const costs: number[] = []
      let hits = 0
      let fallbackCount = 0

      for (const benchmarkCase of input.cases) {
        const plan = await deps.retrievalPlannerService.planContextBundle({
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          actionType: benchmarkCase.actionType,
          targetEntity: benchmarkCase.targetEntity,
          targetId: benchmarkCase.targetId ?? null,
          query: benchmarkCase.query ?? null,
          signature: benchmarkCase.signature ?? null,
          providerId,
          disableProviderFallback: true,
          budget: input.budget,
        })

        latencies.push(plan.elapsedMs)
        tokens.push(plan.estimatedTokens)
        costs.push(plan.estimatedCostUsd)
        if (plan.providerFallbackUsed) fallbackCount += 1
        if (isHit(plan.sourceRefs, benchmarkCase.expectedSourceRefPrefixes)) hits += 1
      }

      providerResults.push({
        providerId,
        cases: input.cases.length,
        averageLatencyMs: average(latencies),
        averageTokens: average(tokens),
        averageCostUsd: average(costs),
        hitRate: input.cases.length > 0 ? hits / input.cases.length : 0,
        fallbackRate: input.cases.length > 0 ? fallbackCount / input.cases.length : 0,
        score: 0,
      })
    }

    const maxLatencyMs = Math.max(1, ...providerResults.map((result) => result.averageLatencyMs))
    const maxCostUsd = Math.max(0.000001, ...providerResults.map((result) => result.averageCostUsd))

    for (const result of providerResults) {
      result.score = scoreProvider({
        hitRate: result.hitRate,
        averageLatencyMs: result.averageLatencyMs,
        averageCostUsd: result.averageCostUsd,
        maxLatencyMs,
        maxCostUsd,
      })
    }

    providerResults.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate
      if (a.averageLatencyMs !== b.averageLatencyMs) return a.averageLatencyMs - b.averageLatencyMs
      return a.providerId.localeCompare(b.providerId)
    })

    const best = providerResults[0] ?? null
    const recommendedProviderId = best?.providerId ?? 'native'
    const recommendationRationale = best
      ? `Selected ${best.providerId} (score=${best.score.toFixed(3)}, hitRate=${best.hitRate.toFixed(3)}, latency=${Math.round(best.averageLatencyMs)}ms).`
      : 'No benchmark data available; defaulting to native.'

    return {
      providers: providerResults,
      recommendedProviderId,
      recommendationRationale,
    }
  }

  return {
    benchmarkProviders,
  }
}

export type RetrievalBenchmarkService = ReturnType<typeof createRetrievalBenchmarkService>
