import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CancelEvalRunCommandInput, CancelEvalRunCommandResult } from '../../../../commands/evalRuns'
import { agentOrchestratorTag } from '../../../openapi'

/**
 * Terminal transition, not a delete: a suite run is an append-only >=6yr record,
 * so cancelling is the inverse of starting.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.run'] },
}

const errorSchema = z.object({ error: z.string() })
const resultSchema = z.object({ suiteRunId: z.string().uuid(), status: z.string() })

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const { id } = await ctx.params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid eval run id' }, { status: 400 })
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
    const { result } = await commandBus.execute<CancelEvalRunCommandInput, CancelEvalRunCommandResult>(
      'agent_orchestrator.evalRuns.cancel',
      {
        input: { tenantId: auth.tenantId, organizationId: auth.orgId, suiteRunId: id },
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
  tag: agentOrchestratorTag,
  summary: 'Cancel a running evaluation',
  methods: {
    POST: {
      summary: 'Move a queued or running evaluation to a terminal cancelled state',
      description:
        'Idempotent: cancelling an already-terminal run returns its current state. The suite run and its case runs are retained (append-only, >=6yr) — cancelling never deletes. Gated by agent_orchestrator.eval.run.',
      responses: [{ status: 200, description: 'The cancelled suite run', schema: resultSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.run', schema: errorSchema },
        { status: 404, description: 'Suite run not found (or cross-tenant)', schema: errorSchema },
      ],
    },
  },
}
