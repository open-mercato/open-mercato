import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentProposal } from '../data/entities'
import { agentProposalSchema, guardResultsSchema } from '../data/validators'
import { getProcessSubject } from '../lib/processes/subjectContext'
import { emitAgentOrchestratorEvent } from '../events'

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
      disposition: 'pending',
    })
    em.persist(proposal)
    await em.flush()

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
