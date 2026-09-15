import type { NotificationTypeDefinition } from '@open-mercato/shared/modules/notifications/types'

/**
 * The module ships exactly one notification type (F7): a proposal is parked on a
 * human decision.
 *
 * Why it exists at all when a workflow-borne proposal already raises a
 * `USER_TASK`: that task is created by the INVOKE_AGENT executor, so a proposal
 * produced outside a workflow — a Playground run, most importantly — reaches
 * nobody. The cockpit's first-run failure was exactly that: the operator waited
 * on the system while the system waited on her.
 *
 * Cleared rather than superseded once the verdict lands — see
 * `subscribers/proposal-disposed-notification-clear.ts`.
 */
export const AGENT_PROPOSAL_PENDING_NOTIFICATION = 'agent_orchestrator.proposal.pending'

export const AGENT_PROPOSAL_SOURCE_ENTITY_TYPE = 'agent_orchestrator:agent_proposal'

export const notificationTypes: NotificationTypeDefinition[] = [
  {
    type: AGENT_PROPOSAL_PENDING_NOTIFICATION,
    module: 'agent_orchestrator',
    channels: ['in_app'],
    titleKey: 'agent_orchestrator.notifications.proposalPending.title',
    bodyKey: 'agent_orchestrator.notifications.proposalPending.body',
    icon: 'clipboard-list',
    severity: 'info',
    actions: [
      {
        id: 'review',
        labelKey: 'agent_orchestrator.notifications.proposalPending.review',
        variant: 'outline',
        href: '/backend/caseload/{sourceEntityId}',
        icon: 'external-link',
      },
    ],
    linkHref: '/backend/caseload/{sourceEntityId}',
    expiresAfterHours: 168,
  },
]

export default notificationTypes
