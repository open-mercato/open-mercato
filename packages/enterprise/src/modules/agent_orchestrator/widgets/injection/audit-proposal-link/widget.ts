import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'
import { buildProposalHref, readAuditEntryCorrelation } from '../../../lib/identity/auditEntryLinks'

/**
 * Adds an "Open proposal" row action to the core audit log actions table, shown only on
 * entries written by a proposal disposition (correlation carries a `proposalId`). Gated
 * separately from the run link because proposals and traces have their own features.
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
      isVisible: (row: unknown) => readAuditEntryCorrelation(row).proposalId !== null,
      onSelect: (row: unknown, context: unknown) => {
        const { proposalId } = readAuditEntryCorrelation(row)
        if (!proposalId) return
        const ctx = context as { navigate?: (path: string) => void }
        ctx.navigate?.(buildProposalHref(proposalId))
      },
    },
  ],
}

export default widget
