import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type ProposalCorrelationSource = {
  id: string
  runId?: string | null
  agentId?: string | null
}

/**
 * Correlation ids stamped on the action logs a proposal's disposition writes, so
 * the audit trail links every verdict-driven write back to the proposal, the
 * agent run that produced it and the agent. Present values only.
 */
export function buildProposalAuditCorrelation(proposal: ProposalCorrelationSource): Record<string, string> {
  const correlation: Record<string, string> = { proposalId: proposal.id }
  if (proposal.runId) correlation.agentRunId = proposal.runId
  if (proposal.agentId) correlation.agentId = proposal.agentId
  return correlation
}

export function withProposalAuditCorrelation(
  commandCtx: CommandRuntimeContext,
  proposal: ProposalCorrelationSource,
): CommandRuntimeContext {
  return {
    ...commandCtx,
    auditCorrelation: { ...(commandCtx.auditCorrelation ?? {}), ...buildProposalAuditCorrelation(proposal) },
  }
}
