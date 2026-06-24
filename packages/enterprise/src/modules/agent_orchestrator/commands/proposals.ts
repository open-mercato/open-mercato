import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { AgentProposal } from '../data/entities'
import { agentProposalSchema } from '../data/validators'
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
      disposition: 'pending',
    })
    em.persist(proposal)
    await em.flush()

    await emitAgentOrchestratorEvent('agent_orchestrator.proposal.created', {
      id: proposal.id,
      runId: proposal.runId,
      agentId: proposal.agentId,
      processId: proposal.processId,
      stepId: proposal.stepId,
      tenantId: proposal.tenantId,
      organizationId: proposal.organizationId,
    }, { persistent: true })

    return { proposalId: proposal.id }
  },
}

registerCommand(createAgentProposalCommand)
