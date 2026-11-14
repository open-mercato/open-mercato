import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ConnectMs365Widget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_ms365.injection.connect',
    title: 'Connect Microsoft 365',
    description: 'Starts the per-user Microsoft 365 OAuth connection flow.',
    features: ['communication_channels.connect_user_channel'],
    priority: 110,
    enabled: true,
  },
  Widget: ConnectMs365Widget,
}

export default widget
