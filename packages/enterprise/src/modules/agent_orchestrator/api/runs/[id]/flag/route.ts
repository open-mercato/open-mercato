import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type {
  ToggleRunFlagCommandInput,
  ToggleRunFlagCommandResult,
} from '../../../../commands/runActions'

/**
 * "Flag" from the trace inspector: toggle the operator triage flag on a run.
 * Gated by `trace.correct` — the same operator-triage tier that records
 * corrections; flagging is a lighter form of the same review signal.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.correct'] },
}

const errorSchema = z.object({ error: z.string() })
const resultSchema = z.object({
  flagged: z.boolean(),
  flaggedAt: z.string().nullable(),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus
  const commandCtx: CommandRuntimeContext = {
    container,
    auth: { sub: auth.sub, tenantId: auth.tenantId, orgId: auth.orgId } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: auth.orgId,
    organizationIds: [auth.orgId],
    request: req,
  }

  try {
    const { result } = await commandBus.execute<ToggleRunFlagCommandInput, ToggleRunFlagCommandResult>(
      'agent_orchestrator.runs.toggleFlag',
      {
        input: {
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          agentRunId: id,
          userId: auth.sub,
        },
        ctx: commandCtx,
      },
    )
    return NextResponse.json(result)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Toggle the triage flag on a run',
  methods: {
    POST: {
      summary: 'Flag or unflag an agent run',
      description:
        'Toggles the operator triage flag: an unflagged run gains flaggedAt/flaggedBy, a flagged run has both cleared. Org-scoped; gated by agent_orchestrator.trace.correct.',
      responses: [{ status: 200, description: 'The new flag state', schema: resultSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.correct', schema: errorSchema },
        { status: 404, description: 'Unknown run id (or cross-tenant)', schema: errorSchema },
      ],
    },
  },
}
