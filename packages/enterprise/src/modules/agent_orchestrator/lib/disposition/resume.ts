import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { emitAgentOrchestratorEvent } from '../../events'
import type { AgentProposalDisposition } from '../../data/entities'

export type ResumeWorkflowForProposalInput = {
  proposalId: string
  processId: string
  stepId: string | null
  disposition: AgentProposalDisposition
  proposalPayload?: unknown
  tenantId: string
  organizationId: string
  userId?: string | null
}

/**
 * Human-path resume seam (area 03 → area 02).
 *
 * Emits the `agent_orchestrator.proposal.ready { processId, stepId, proposalId }`
 * audit/broadcast event, then delivers the resume signal to the parked workflow
 * instance via the workflows module's `sendSignal`. Area 02's `WAIT_FOR_SIGNAL`
 * keys on `signalName = 'agent_orchestrator.proposal.ready'` and matches the
 * parked instance by `processId`; the merged `disposition`/`payload` lands in
 * `WorkflowInstance.context` so the downstream effector reads the approved
 * (possibly edited) payload. A `rejected` proposal resumes too — the workflow
 * definition's effector transition condition (`disposition ∈ {auto_approved,
 * approved, edited}`) skips the effector.
 *
 * The auto-approve path NEVER reaches here (the executor proceeded inline and
 * never parked). `proposal.ready` is therefore the human-path resume signal only.
 *
 * `workflows` is an optional peer: the resume is best-effort and degrades
 * gracefully (logs) when the module is absent, so the disposition itself is
 * already committed and audited regardless of signal delivery.
 */
export async function resumeWorkflowForProposal(
  container: AwilixContainer,
  em: EntityManager,
  input: ResumeWorkflowForProposalInput,
): Promise<void> {
  await emitAgentOrchestratorEvent(
    'agent_orchestrator.proposal.ready',
    {
      processId: input.processId,
      stepId: input.stepId,
      proposalId: input.proposalId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    { persistent: true },
  )

  try {
    const signalHandler = (await import(
      '@open-mercato/core/modules/workflows/lib/signal-handler'
    )) as typeof import('@open-mercato/core/modules/workflows/lib/signal-handler')
    await signalHandler.sendSignal(em, container, {
      instanceId: input.processId,
      signalName: 'agent_orchestrator.proposal.ready',
      payload: {
        proposalId: input.proposalId,
        stepId: input.stepId,
        disposition: input.disposition,
        proposalPayload: input.proposalPayload,
      },
      userId: input.userId ?? undefined,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    })
  } catch (error) {
    console.warn('[agent_orchestrator] proposal.ready resume signal not delivered', {
      processId: input.processId,
      proposalId: input.proposalId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
