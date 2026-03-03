import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { RetrievalBenchmarkService } from '../../../services/retrieval-benchmark-service'
import { buildCommandRouteContext } from '../../route-helpers'
import { agentGovernanceErrorSchema } from '../../openapi'

const benchmarkCaseSchema = z.object({
  actionType: z.string().min(1).max(200),
  targetEntity: z.string().min(1).max(200),
  targetId: z.string().max(255).optional().nullable(),
  query: z.string().max(500).optional().nullable(),
  signature: z.string().max(255).optional().nullable(),
  expectedSourceRefPrefixes: z.array(z.string().max(200)).max(30).optional(),
})

const requestSchema = z.object({
  cases: z.array(benchmarkCaseSchema).min(1).max(200),
  providers: z.array(z.string().min(1).max(120)).max(10).optional(),
  budget: z.object({
    tokenBudget: z.number().int().min(200).max(10000).optional(),
    costBudgetUsd: z.number().min(0.01).max(5).optional(),
    timeBudgetMs: z.number().int().min(100).max(20000).optional(),
    precedentLimit: z.number().int().min(1).max(40).optional(),
    rationaleLimit: z.number().int().min(0).max(60).optional(),
    neighborLimit: z.number().int().min(0).max(60).optional(),
  }).optional(),
})

const providerResultSchema = z.object({
  providerId: z.string(),
  cases: z.number().int().nonnegative(),
  averageLatencyMs: z.number().nonnegative(),
  averageTokens: z.number().nonnegative(),
  averageCostUsd: z.number().nonnegative(),
  hitRate: z.number().min(0).max(1),
  fallbackRate: z.number().min(0).max(1),
  score: z.number().min(0).max(1),
})

const responseSchema = z.object({
  providers: z.array(providerResultSchema),
  recommendedProviderId: z.string(),
  recommendationRationale: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_governance.memory.view'] },
}

export async function POST(req: Request) {
  const { ctx } = await buildCommandRouteContext(req)
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null

  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const bodyRaw = await req.json().catch(() => ({}))
  const body = requestSchema.parse(bodyRaw)

  const benchmarkService = ctx.container.resolve('agentGovernanceRetrievalBenchmarkService') as RetrievalBenchmarkService
  const result = await benchmarkService.benchmarkProviders({
    tenantId,
    organizationId,
    cases: body.cases,
    providers: body.providers,
    budget: body.budget,
  })

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Benchmark retrieval providers',
  methods: {
    POST: {
      summary: 'Benchmark native and external retrieval providers',
      requestBody: {
        contentType: 'application/json',
        schema: requestSchema,
      },
      responses: [{ status: 200, description: 'Benchmark result', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid request', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 403, description: 'Forbidden', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
