import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { AgentProposal } from '../../data/entities'
import { createCorrectionRequestSchema } from '../../data/validators'
import type {
  CreateCorrectionCommandInput,
  CreateCorrectionCommandResult,
} from '../../commands/corrections'

/**
 * Explicit correction-recording surface (e.g. an `override`/`answer` outside the
 * dispose modal). Writes an append-only AgentCorrection (mandatory reason) and
 * auto-drafts an AgentEvalCase. The dispose endpoint auto-records edit/reject
 * corrections itself; this route is the fallback/explicit path.
 */
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.correct'] },
}

const errorSchema = z.object({ error: z.string() })
const resultSchema = z.object({ correctionId: z.string().uuid(), evalCaseId: z.string().uuid() })

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!auth.tenantId || !auth.orgId || !auth.sub) {
    return NextResponse.json({ error: 'Tenant context required' }, { status: 400 })
  }

  const parsed = createCorrectionRequestSchema.safeParse(await readJsonSafe(req, {}))
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 },
    )
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  // Decrypt to match the established proposal-read site (commands/dispose.ts) — the
  // payload (→ proposedValue / eval-case expected) is the PII-bearing field.
  const proposal = await findOneWithDecryption(
    em,
    AgentProposal,
    { id: parsed.data.proposalId, tenantId: auth.tenantId, organizationId: auth.orgId, deletedAt: null },
    undefined,
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )
  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

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
    const { result } = await commandBus.execute<CreateCorrectionCommandInput, CreateCorrectionCommandResult>(
      'agent_orchestrator.corrections.create',
      {
        input: {
          tenantId: auth.tenantId,
          organizationId: auth.orgId,
          proposalId: proposal.id,
          agentRunId: proposal.runId,
          processId: proposal.processId ?? null,
          stepId: proposal.stepId ?? null,
          agentDefinitionId: proposal.agentId,
          correctedByUserId: auth.sub,
          action: parsed.data.action,
          proposedValue: proposal.payload,
          correctedValue: parsed.data.correctedValue,
          reason: parsed.data.reason,
        },
        ctx: commandCtx,
      },
    )
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Record an agent correction',
  methods: {
    POST: {
      summary: 'Record a human correction of an agent proposal and auto-draft an eval case',
      description:
        'Writes an append-only AgentCorrection (mandatory non-empty reason) referencing a proposal, and auto-drafts a draft AgentEvalCase from it. Gated by agent_orchestrator.trace.correct.',
      requestBody: {
        contentType: 'application/json',
        schema: createCorrectionRequestSchema,
        description: 'The correction action, mandatory reason, and (for edits) the corrected value.',
      },
      responses: [{ status: 201, description: 'Correction recorded + eval case drafted', schema: resultSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.correct', schema: errorSchema },
        { status: 404, description: 'Proposal not found (or cross-tenant)', schema: errorSchema },
        { status: 422, description: 'Invalid input (e.g. empty reason)', schema: errorSchema },
      ],
    },
  },
}
