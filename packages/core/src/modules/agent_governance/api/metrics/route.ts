import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { ObservabilityService } from '../../services/observability-service'
import { buildCommandRouteContext } from '../route-helpers'
import { agentGovernanceErrorSchema } from '../openapi'

const runStatusCountsSchema = z.object({
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  checkpoint: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  terminated: z.number().int().nonnegative(),
})

const skillStatusCountsSchema = z.object({
  draft: z.number().int().nonnegative(),
  validated: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  deprecated: z.number().int().nonnegative(),
})

const responseSchema = z.object({
  governance: z.object({
    runsTotal: z.number().int().nonnegative(),
    runsByStatus: runStatusCountsSchema,
    pendingApprovals: z.number().int().nonnegative(),
    checkpointRate: z.number().min(0).max(1),
    interventionLatencyMs: z.number().nonnegative(),
  }),
  memory: z.object({
    decisionsTotal: z.number().int().nonnegative(),
    traceCompletenessRate: z.number().min(0).max(1),
    precedentWhyLinks: z.number().int().nonnegative(),
    precedentUsefulnessRate: z.number().min(0).max(1),
  }),
  operations: z.object({
    failedRuns24h: z.number().int().nonnegative(),
    telemetryRepairSignals24h: z.number().int().nonnegative(),
    checkpointVolume24h: z.number().int().nonnegative(),
    alertRouting: z.object({
      severity: z.enum(['none', 'low', 'medium', 'high']),
      route: z.enum(['none', 'governance_admins', 'operators']),
      digestRecommended: z.boolean(),
      reasons: z.array(z.string()),
    }),
  }),
  learning: z.object({
    skillsTotal: z.number().int().nonnegative(),
    skillsByStatus: skillStatusCountsSchema,
    promotedSkills30d: z.number().int().nonnegative(),
    skillGuidanceImpact30d: z.object({
      terminalRunsWithSkills: z.number().int().nonnegative(),
      terminalRunsWithoutSkills: z.number().int().nonnegative(),
      successRateWithSkills: z.number().min(0).max(1),
      successRateWithoutSkills: z.number().min(0).max(1),
      successRateDelta: z.number(),
    }),
  }),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_governance.view'] },
}

export async function GET(req: Request) {
  const { ctx } = await buildCommandRouteContext(req)

  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null

  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const observabilityService = ctx.container.resolve('agentGovernanceObservabilityService') as ObservabilityService
  const metrics = await observabilityService.getMetrics({ tenantId, organizationId })

  return NextResponse.json(metrics)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Observability metrics',
  methods: {
    GET: {
      summary: 'Get governance, memory, operations, and learning metrics',
      responses: [{ status: 200, description: 'Metrics payload', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Missing scope', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 403, description: 'Forbidden', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
