import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ConnectApnsWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_apns.injection.connect',
    title: 'Connect APNs',
    description: 'Connects a tenant-wide Apple Push Notification service push channel.',
    features: ['communication_channels.connect_tenant_channel'],
    priority: 90,
    enabled: true,
  },
  Widget: ConnectApnsWidget,
}

export default widget
