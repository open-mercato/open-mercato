import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TaskProposalDraftWidget from './widget.client'

/**
 * Renders a pending proposal as a DRAFT CARD on its disposition task (spec
 * §7.6) — the would-be mutation, the confidence the threshold was compared
 * against, and one click to the agent run trace. Mounted on the workflows
 * `workflows.task.detail:context` spot; gated on
 * `agent_orchestrator.proposals.view`, and it renders nothing at all for a task
 * that carries no proposal.
 */
const widget: InjectionWidgetModule<unknown, unknown> = {
  metadata: {
    id: 'agent_orchestrator.injection.task-proposal-draft',
    title: 'Agent proposal draft',
    description: 'The proposed mutation an operator is being asked to approve',
    features: ['agent_orchestrator.proposals.view'],
    priority: 30,
    enabled: true,
  },
  Widget: TaskProposalDraftWidget,
}

export default widget
