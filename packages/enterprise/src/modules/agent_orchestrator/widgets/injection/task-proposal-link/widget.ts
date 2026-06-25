import type { InjectionRowActionWidget } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Adds a "Review proposal" row action to the workflows My Tasks table for
 * USER_TASK rows that carry a `proposalId`. Additive injection into the
 * existing `data-table:workflows.tasks.list:row-actions` spot — does not touch
 * any workflows file (BACKWARD_COMPATIBILITY.md §6). Gated on
 * `agent_orchestrator.proposals.view`.
 */
const widget: InjectionRowActionWidget = {
  metadata: {
    id: 'agent_orchestrator.injection.task-proposal-link',
    priority: 30,
    features: ['agent_orchestrator.proposals.view'],
  },
  rowActions: [
    {
      id: 'review_proposal',
      label: 'agent_orchestrator.tasks.reviewProposal',
      icon: 'Bot',
      onSelect: (row: unknown, context: unknown) => {
        const record = row as { proposalId?: string; proposal_id?: string }
        const proposalId = record.proposalId ?? record.proposal_id
        if (!proposalId) return
        const ctx = context as { navigate?: (path: string) => void }
        if (ctx.navigate) {
          ctx.navigate(`/backend/caseload/${proposalId}`)
        }
      },
    },
  ],
}

export default widget
