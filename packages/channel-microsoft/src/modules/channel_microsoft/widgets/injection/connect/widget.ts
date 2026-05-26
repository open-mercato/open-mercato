import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ConnectMicrosoftWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_microsoft.injection.connect',
    title: 'Connect Microsoft 365',
    description: 'Starts the per-user Microsoft OAuth connection flow.',
    features: ['communication_channels.connect_user_channel'],
    priority: 110,
    enabled: true,
  },
  Widget: ConnectMicrosoftWidget,
}

export default widget
