import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentProposal } from '../data/entities'
import { agentProposalSchema, guardResultsSchema } from '../data/validators'
import { getProcessSubject } from '../lib/processes/subjectContext'
import { emitAgentOrchestratorEvent } from '../events'
import { invalidateAgentProposalCache } from '../lib/crudCache'

const createAgentProposalSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  agentId: z.string().min(1),
  runId: z.string().uuid(),
  payload: agentProposalSchema,
  confidence: z.number().nullable().optional(),
  processId: z.string().uuid().nullable().optional(),
  stepId: z.string().nullable().optional(),
  /** Output-phase guardrail verdict checks (Phase 1). Null when guardrails are off. */
  guardResults: guardResultsSchema.nullable().optional(),
  /** `eval` keeps a replay proposal out of the operator caseload; it is never disposed. */
  source: z.enum(['runtime', 'eval']).optional(),
})
export type CreateAgentProposalInput = z.infer<typeof createAgentProposalSchema>

// dispose lives in area 03.
const createAgentProposalCommand: CommandHandler<CreateAgentProposalInput, { proposalId: string }> = {
  id: 'agent_orchestrator.proposals.create',
  async execute(rawInput, ctx) {
    const input = createAgentProposalSchema.parse(rawInput)
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    // An empty option set is the agent saying it has nothing to propose. It gets its
    // own terminus at creation: queueing it for review would park the WAIT_FOR_SIGNAL
    // step on a decision no operator can make.
    const proposesNothing = input.payload.options.length === 0
    const proposal = em.create(AgentProposal, {
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      agentId: input.agentId,
      runId: input.runId,
      payload: input.payload,
      confidence: input.confidence ?? null,
      processId: input.processId ?? null,
      stepId: input.stepId ?? null,
      guardResults: input.guardResults ?? null,
      source: input.source ?? 'runtime',
      disposition: proposesNothing ? 'none_proposed' : 'pending',
    })
    em.persist(proposal)
    await em.flush()
    await invalidateAgentProposalCache(
      ctx.container,
      { id: proposal.id, tenantId: proposal.tenantId, organizationId: proposal.organizationId },
      'agent_orchestrator.proposals.create',
    )

    // `subject` (process projection spec, 2026-06-25): the INVOKE_AGENT node's
    // business-record descriptor, read from the async-scoped binding the workflow
    // bridge established. Additive optional payload field, never a column — the
    // projection subscriber persists it onto `agent_processes` only.
    await emitAgentOrchestratorEvent('agent_orchestrator.proposal.created', {
      id: proposal.id,
      runId: proposal.runId,
      agentId: proposal.agentId,
      // Carried on the event so subscribers and the caseload can tell a replay
      // from production work WITHOUT re-reading the row.
      source: proposal.source,
      // How many mutually-exclusive alternatives the agent offered (additive).
      optionCount: input.payload.options.length,
      processId: proposal.processId,
      stepId: proposal.stepId,
      subject: getProcessSubject() ?? null,
      tenantId: proposal.tenantId,
      organizationId: proposal.organizationId,
    }, { persistent: true })

    return { proposalId: proposal.id }
  },
}

registerCommand(createAgentProposalCommand)
