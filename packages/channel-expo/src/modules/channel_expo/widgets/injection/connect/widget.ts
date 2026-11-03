import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ConnectExpoWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_expo.injection.connect',
    title: 'Connect Expo',
    description: 'Connects a tenant-wide Expo push channel.',
    features: ['communication_channels.connect_tenant_channel'],
    priority: 80,
    enabled: true,
  },
  Widget: ConnectExpoWidget,
}

export default widget
