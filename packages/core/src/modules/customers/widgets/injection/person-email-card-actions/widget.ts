import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PersonEmailCardActionsWidget from './widget.client'

export type EmailCardWidgetData = {
  interactionId?: string | null
  externalMessageId?: string | null
  rfcMessageId?: string | null
  personId?: string | null
  fromAddress?: string | null
  toAddresses?: string[] | null
  ccAddresses?: string[] | null
  subject?: string | null
  inReplyTo?: string | null
  references?: string[] | null
  /** Current visibility state of the email row, for toggling. */
  currentVisibility?: 'private' | 'shared' | null
  /** True when authorUserId === currentUserId. Drives whether the toggle renders. */
  isAuthor?: boolean | null
}

/**
 * Phase 3 Task 16 — Email card Reply / Reply All / Forward actions.
 *
 * Injects three ghost-icon buttons (Reply, Reply All, Forward) on every
 * email-type CustomerInteraction card in the ActivityHistorySection.
 *
 * The injection spot `customers:person-email-card-actions` is added to
 * `ActivityCard` when `activity.interactionType === 'email'`. The spot
 * passes `EmailCardWidgetData` sourced from the `InteractionSummary` row.
 *
 * Clicking a button opens `ComposeEmailDialog` pre-filled per the RFC 5322
 * reply/forward threading rules (Re: / Fwd: subject prefixes, In-Reply-To,
 * References headers, To/Cc pre-population).
 *
 * Feature-gated behind `customers.email.compose`. The widget renders null
 * when the user has no connected channel, silently skipping the CTA that the
 * person-send-email header widget already provides.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, EmailCardWidgetData> = {
  metadata: {
    id: 'customers.injection.person-email-card-actions',
    title: 'Person Email Card Actions',
    description:
      'Renders Reply / Reply All / Forward ghost-icon buttons on email activity cards in the interaction history timeline.',
    features: ['customers.email.compose'],
    priority: 80,
    enabled: true,
  },
  Widget: PersonEmailCardActionsWidget,
}

export default widget
