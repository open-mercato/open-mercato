import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import {
  buildProposalHref,
  isAuditEntryProposalVerified,
  readAuditEntryCorrelation,
} from '../../../lib/identity/auditEntryLinks'

function verifiedProposalIdOf(row: unknown): string | null {
  const { proposalId } = readAuditEntryCorrelation(row)
  return proposalId && isAuditEntryProposalVerified(row) ? proposalId : null
}

/**
 * Adds an "Open proposal" row action to the core audit log actions table, shown only on
 * entries whose `proposalId` the server verified (`_agent_orchestrator.proposalVerified`,
 * from `data/enrichers.ts`): a proposal id copied from a user-writable workflow context is
 * not trusted on its own. Gated separately from the run link because proposals and traces
 * have their own features.
 */
const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'agent_orchestrator.injection.audit-proposal-link',
    priority: 29,
    features: ['agent_orchestrator.proposals.view'],
  },
  rowActions: [
    {
      id: 'agent_orchestrator.open_proposal',
      label: 'agent_orchestrator.audit.links.openProposal',
      icon: 'FileCheck',
      isVisible: (row: unknown) => verifiedProposalIdOf(row) !== null,
      onSelect: (row: unknown, context: unknown) => {
        const proposalId = verifiedProposalIdOf(row)
        if (!proposalId) return
        const ctx = context as { navigate?: (path: string) => void }
        ctx.navigate?.(buildProposalHref(proposalId))
      },
    },
  ],
}

export default widget
