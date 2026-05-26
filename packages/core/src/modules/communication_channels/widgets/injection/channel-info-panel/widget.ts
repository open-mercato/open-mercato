import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ChannelInfoPanelWidget from './widget.client'

/**
 * Channel info panel — renders a short summary of channel context for a message
 * in the detail sidebar (`detail:messages:message:sidebar`).
 *
 * Reads `_channel` + `_channelContact` enrichments. Shows provider, channel
 * type, direction + delivery status, and (when matched) the linked CRM person id.
 */
// Loose `any` generics — see channel-badge/widget.ts for rationale.
const widget: InjectionWidgetModule<any, any> = {
  metadata: {
    id: 'communication_channels.injection.channel-info-panel',
    title: 'Channel info panel',
    description:
      'Sidebar panel showing channel + contact metadata for a channel-linked message.',
    features: ['communication_channels.view'],
    priority: 80,
    enabled: true,
  },
  Widget: ChannelInfoPanelWidget,
}

export default widget
