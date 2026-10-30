import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ProcessDefinition, ProcessInstance } from '../../../data/entities'
import { buildMilestoneStages, parseMilestonesReached, parseProcessMilestones } from '../../../lib/tasks/milestones'
import { readProcessOutcome } from '../../../lib/tasks/outcome'
import { resolveOutcomeHref } from '../../../lib/tasks/outcomeLink'

/**
 * One business execution, as a business reader and an external integrator see it.
 *
 * This is the whole external contract for a running process: its status, the
 * milestones it has reached, what it produced. Nothing here exposes how many
 * agents ran, which runtime executed them, or which workflow step they sat on —
 * that is internal orchestration topology, and an integrator coupled to it cannot
 * be refactored around.
 *
 * `:id` accepts EITHER the execution id or the workflow instance id, because
 * runs, proposals and the trace inspector all carry the latter. Org-scoped —
 * cross-org ids return 404, never the row.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.processes.view'] },
}

const idSchema = z.string().uuid()

type RouteContext = { params: Promise<{ id: string }> }

const errorSchema = z.object({ error: z.string() })

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Execution not found' }, { status: 404 })

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? undefined }
  const decryptionScope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }
  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()

  const byInstance = await findOneWithDecryption(
    em,
    ProcessInstance,
    { workflowInstanceId: parsedId.data, ...scope, deletedAt: null },
    undefined,
    decryptionScope,
  )
  const execution =
    byInstance ??
    (await findOneWithDecryption(
      em,
      ProcessInstance,
      { id: parsedId.data, ...scope, deletedAt: null },
      undefined,
      decryptionScope,
    ))
  if (!execution) return NextResponse.json({ error: 'Execution not found' }, { status: 404 })

  // The declared milestone VOCABULARY lives on the definition; what the execution
  // actually reached lives on the row. An execution started outside a business
  // process (straight from the Studio) has no vocabulary, and then the reached
  // list is the whole story it can tell.
  const definition = execution.processDefinitionId
    ? await em.findOne(ProcessDefinition, { id: execution.processDefinitionId, ...scope, deletedAt: null })
    : null

  const reached = parseMilestonesReached(execution.milestonesReached)
  const terminal = ['completed', 'auto_completed', 'failed', 'cancelled'].includes(execution.status)
  const milestones = definition
    ? buildMilestoneStages(parseProcessMilestones(definition.milestones), reached, { terminal })
    : reached.map((entry) => ({ key: entry.key, label: entry.key, state: 'done' as const, at: entry.at }))

  const outcome = readProcessOutcome(execution)

  return NextResponse.json({
    execution,
    milestones,
    outcome: outcome ? { ...outcome, href: resolveOutcomeHref(outcome) } : null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get one business execution',
  methods: {
    GET: {
      summary: 'Get a process execution with its milestones and outcome',
      description:
        'Returns the business-facing view of one execution: derived status, the declared milestones with the ones reached marked done, and the optional outcome with a resolved href. Accepts the execution id or the workflow instance id. Org-scoped; gated by agent_orchestrator.processes.view.',
      responses: [{ status: 200, description: 'Process execution' }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.processes.view', schema: errorSchema },
        { status: 404, description: 'Unknown execution id', schema: errorSchema },
      ],
    },
  },
}
