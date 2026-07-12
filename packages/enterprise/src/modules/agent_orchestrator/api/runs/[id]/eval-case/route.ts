import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type {
  CreateEvalCaseFromRunCommandInput,
  CreateEvalCaseFromRunCommandResult,
} from '../../../../commands/corrections'

/**
 * "Add to evals" from the trace inspector: drafts a golden-run `AgentEvalCase`
 * from the run's input/output. Idempotent — one golden-run case per run; a
 * repeat call returns the existing case with `created: false`.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const errorSchema = z.object({ error: z.string() })
const resultSchema = z.object({
  evalCase: z.object({ id: z.string().uuid(), status: z.string() }),
  created: z.boolean(),
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
    const { result } = await commandBus.execute<
      CreateEvalCaseFromRunCommandInput,
      CreateEvalCaseFromRunCommandResult
    >('agent_orchestrator.evalCases.createFromRun', {
      input: {
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
        agentRunId: id,
      },
      ctx: commandCtx,
    })
    return NextResponse.json({
      evalCase: { id: result.evalCaseId, status: result.status },
      created: result.created,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Draft an eval case from a run',
  methods: {
    POST: {
      summary: 'Create a draft golden-run eval case from this run',
      description:
        'Drafts an AgentEvalCase (sourceType golden_run) from the run input/output. Idempotent per run — a repeat call returns the existing case with created: false. Org-scoped; gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'The draft eval case', schema: resultSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
        { status: 404, description: 'Unknown run id (or cross-tenant)', schema: errorSchema },
      ],
    },
  },
}
