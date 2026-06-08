import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ReactionBarWidget from './widget.client'

/**
 * Reaction bar — renders the grouped emoji counts below a channel-linked message
 * (`detail:messages:message:body:after`). Click an emoji to toggle the current
 * user's reaction (calls the slice-2d outbound reactions API).
 *
 * Reads the `_reactions` enrichment field added by `messageReactionsEnricher`.
 * Gated by the `communication_channels.react` feature at the API layer; the
 * widget itself surfaces only when there is at least one reaction.
 */
const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'communication_channels.injection.reaction-bar',
    title: 'Reaction bar',
    description:
      'Renders grouped emoji reactions below channel-linked messages. Tapping an emoji toggles the current user\'s reaction.',
    features: ['communication_channels.view'],
    priority: 90,
    enabled: true,
  },
  Widget: ReactionBarWidget,
}

export default widget
