import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type {
  ArchiveEvalCaseCommandInput,
  ArchiveEvalCaseCommandResult,
} from '../../../../commands/corrections'

/**
 * Engineer approval of a drafted eval case (draft → archived). Editable target,
 * so the command enforces an optimistic lock on `updatedAt`; a stale write
 * returns a structured 409 the client surfaces via `surfaceRecordConflict`.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.eval.manage'] },
}

const errorSchema = z.object({ error: z.string() })
const resultSchema = z.object({
  evalCaseId: z.string().uuid(),
  status: z.string(),
  updatedAt: z.string(),
})
const optimisticLockConflictSchema = z.object({
  error: z.string(),
  code: z.string(),
  currentUpdatedAt: z.string(),
  expectedUpdatedAt: z.string(),
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
    return NextResponse.json({ error: 'Invalid eval case id' }, { status: 400 })
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
    const { result } = await commandBus.execute<ArchiveEvalCaseCommandInput, ArchiveEvalCaseCommandResult>(
      'agent_orchestrator.evalCases.archive',
      {
        input: {
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          evalCaseId: id,
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
  summary: 'Archive an eval case',
  methods: {
    POST: {
      summary: 'Archive a drafted eval case so it joins the exported regression set',
      description:
        'Flips an eval case to archived, removing it from the replayable set without deleting it. Enforces an optimistic lock on updatedAt (stale write → 409 surfaced via surfaceRecordConflict). Gated by agent_orchestrator.eval.manage.',
      responses: [{ status: 200, description: 'The archived eval case', schema: resultSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.eval.manage', schema: errorSchema },
        { status: 404, description: 'Eval case not found (or cross-tenant)', schema: errorSchema },
        {
          status: 409,
          description: 'Optimistic-lock conflict (stale updatedAt) or not in draft',
          schema: optimisticLockConflictSchema,
        },
      ],
    },
  },
}
