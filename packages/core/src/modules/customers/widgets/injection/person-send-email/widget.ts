import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PersonSendEmailWidget from './widget.client'

/**
 * Phase 3 Task 15 — Person detail "Send email" header action.
 *
 * Injects a "Send email" button into the `detail:customers.person:header`
 * injection spot on the Person detail page.
 *
 * Behaviour:
 * - When the current user has no connected channel the button is replaced
 *   with a "Connect your mailbox" CTA that links to the communication-channels
 *   hub at `/backend/profile/communication-channels`.
 * - When connected channels are available the button opens
 *   `ComposeEmailDialog`, pre-filling the To field from the person's primary
 *   email and posting to `/api/customers/people/{id}/emails`.
 *
 * Feature-gated behind `customers.email.compose`.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'customers.injection.person-send-email',
    title: 'Person Send Email',
    description:
      'Renders a "Send email" button in the person detail header that opens the email compose dialog. Falls back to a "Connect your mailbox" CTA when no channel is connected.',
    features: ['customers.email.compose'],
    priority: 90,
    enabled: true,
  },
  Widget: PersonSendEmailWidget,
}

export default widget
