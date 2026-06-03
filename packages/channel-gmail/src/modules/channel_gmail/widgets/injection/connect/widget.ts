import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ConnectGmailWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_gmail.injection.connect',
    title: 'Connect Gmail',
    description: 'Starts the per-user Gmail OAuth connection flow.',
    features: ['communication_channels.connect_user_channel'],
    priority: 120,
    enabled: true,
  },
  Widget: ConnectGmailWidget,
}

export default widget
