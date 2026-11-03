import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ConnectFcmWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_fcm.injection.connect',
    title: 'Connect FCM',
    description: 'Connects a tenant-wide Firebase Cloud Messaging push channel.',
    features: ['communication_channels.connect_tenant_channel'],
    priority: 100,
    enabled: true,
  },
  Widget: ConnectFcmWidget,
}

export default widget
