import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { findAndCountWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { runStartSchema } from '../../data/validators'
import { AgentGovernanceRun } from '../../data/entities'
import { buildCommandRouteContext } from '../route-helpers'
import { agentGovernanceErrorSchema } from '../openapi'

const runListQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
  status: z.enum(['queued', 'running', 'checkpoint', 'paused', 'failed', 'completed', 'terminated']).optional(),
  playbookId: z.string().uuid().optional(),
  riskBandId: z.string().uuid().optional(),
}).passthrough()

const runStartResponseSchema = z.object({
  id: z.string().uuid(),
  approvalTaskId: z.string().uuid().nullable(),
  checkpointReasons: z.array(z.string()),
  telemetryEventId: z.string().uuid().nullable(),
  telemetryRepairRequired: z.boolean(),
})

const runListItemSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  playbookId: z.string().uuid().nullable().optional(),
  policyId: z.string().uuid().nullable().optional(),
  riskBandId: z.string().uuid().nullable().optional(),
  status: z.string(),
  autonomyMode: z.string(),
  actionType: z.string(),
  targetEntity: z.string(),
  targetId: z.string().nullable().optional(),
  pauseReason: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  failedAt: z.string().nullable().optional(),
  terminatedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const runListResponseSchema = z.object({
  items: z.array(runListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(1),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_governance.runs.view'] },
  POST: { requireAuth: true, requireFeatures: ['agent_governance.runs.manage'] },
}

export async function GET(req: Request) {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const organizationScope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request: req,
  })

  const tenantId = auth.tenantId
  const organizationId = organizationScope?.selectedId ?? auth.orgId

  if (!tenantId || !organizationId) {
    return NextResponse.json({ error: 'Missing tenant or organization context' }, { status: 400 })
  }

  const url = new URL(req.url)
  const query = runListQuerySchema.parse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    playbookId: url.searchParams.get('playbookId') ?? undefined,
    riskBandId: url.searchParams.get('riskBandId') ?? undefined,
  })

  const where: Record<string, unknown> = {
    tenantId,
    organizationId,
  }

  if (query.status) where.status = query.status
  if (query.playbookId) where.playbookId = query.playbookId
  if (query.riskBandId) where.riskBandId = query.riskBandId

  const em = container.resolve('em')

  const [items, total] = await findAndCountWithDecryption(
    em,
    AgentGovernanceRun,
    where,
    {
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
      orderBy: { createdAt: 'DESC' },
    },
    { tenantId, organizationId },
  )

  return NextResponse.json({
    items,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  })
}

export async function POST(req: Request) {
  const { ctx, translate, commandBus } = await buildCommandRouteContext(req)

  const body = await req.json().catch(() => ({}))
  const input = parseScopedCommandInput(runStartSchema, body, ctx, translate)

  const result = await (commandBus as CommandBus).execute<
    z.infer<typeof runStartSchema>,
    {
      runId: string
      approvalTaskId: string | null
      checkpointReasons: string[]
      telemetryEventId: string | null
      telemetryRepairRequired: boolean
    }
  >(
    'agent_governance.runs.start',
    { input, ctx },
  )

  return NextResponse.json(
    {
      id: result.result.runId,
      approvalTaskId: result.result.approvalTaskId,
      checkpointReasons: result.result.checkpointReasons,
      telemetryEventId: result.result.telemetryEventId,
      telemetryRepairRequired: result.result.telemetryRepairRequired,
    },
    { status: 201 },
  )
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Governance',
  summary: 'Run control entrypoint',
  methods: {
    GET: {
      summary: 'List governed runs',
      query: runListQuerySchema,
      responses: [{ status: 200, description: 'Runs list', schema: runListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 400, description: 'Invalid query', schema: agentGovernanceErrorSchema },
      ],
    },
    POST: {
      summary: 'Start a governed run',
      requestBody: {
        contentType: 'application/json',
        schema: runStartSchema,
      },
      responses: [{ status: 201, description: 'Run started', schema: runStartResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: agentGovernanceErrorSchema },
        { status: 401, description: 'Unauthorized', schema: agentGovernanceErrorSchema },
        { status: 403, description: 'Forbidden', schema: agentGovernanceErrorSchema },
      ],
    },
  },
}
