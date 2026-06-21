import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { disposeProposalSchema } from '../../../../data/validators'
import type {
  DisposeProposalCommandInput,
  DisposeProposalCommandResult,
} from '../../../../commands/dispose'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.proposals.dispose'] },
}

const errorSchema = z.object({ error: z.string() })

const disposeResultSchema = z.object({
  proposalId: z.string().uuid(),
  disposition: z.enum(['auto_approved', 'approved', 'edited', 'rejected']),
  dispositionBy: z.string().nullable(),
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
    return NextResponse.json({ error: 'Invalid proposal id' }, { status: 400 })
  }

  const body = await readJsonSafe(req, {})
  const parsed = disposeProposalSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const container = await createRequestContainer()
  const commandBus = container.resolve('commandBus') as CommandBus

  const commandCtx: CommandRuntimeContext = {
    container,
    auth: {
      sub: auth.sub,
      tenantId: auth.tenantId,
      orgId: auth.orgId,
    } as CommandRuntimeContext['auth'],
    organizationScope: null,
    selectedOrganizationId: auth.orgId,
    organizationIds: [auth.orgId],
    request: req,
  }

  const input: DisposeProposalCommandInput = {
    proposalId: id,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
    disposition: parsed.data.disposition,
    payload: parsed.data.payload,
    reason: parsed.data.reason,
  }

  try {
    const { result } = await commandBus.execute<
      DisposeProposalCommandInput,
      DisposeProposalCommandResult
    >('agent_orchestrator.proposals.dispose', { input, ctx: commandCtx })
    return NextResponse.json(result)
  } catch (err) {
    if (isCrudHttpError(err)) {
      // Pass the structured body through unchanged — for a 409 this is the
      // OptimisticLockConflictBody the client's surfaceRecordConflict reads.
      return NextResponse.json(err.body, { status: err.status })
    }
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Dispose a proposal',
  methods: {
    POST: {
      summary: 'Dispose a proposal',
      description:
        'Records an operator verdict (approve/edit/reject) on a pending AgentProposal. Routes through the audited dispose Command (mutation guard + optimistic lock); on a workflow-originated proposal it emits the resume signal. Edit overrides the proposal payload (requires payload + reason); reject requires a reason.',
      requestBody: {
        contentType: 'application/json',
        schema: disposeProposalSchema,
        description: 'The operator verdict and (for edit) the overriding payload.',
      },
      responses: [
        { status: 200, description: 'The updated proposal', schema: disposeResultSchema },
      ],
      errors: [
        { status: 400, description: 'Tenant context missing or invalid input', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.proposals.dispose', schema: errorSchema },
        { status: 404, description: 'Proposal not found (or cross-tenant)', schema: errorSchema },
        {
          status: 409,
          description: 'Optimistic-lock conflict (stale updatedAt) or already disposed',
          schema: optimisticLockConflictSchema,
        },
      ],
    },
  },
}
