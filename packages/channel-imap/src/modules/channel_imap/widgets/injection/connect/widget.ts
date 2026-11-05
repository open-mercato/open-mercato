import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ConnectImapWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_imap.injection.connect',
    title: 'Connect IMAP',
    description: 'Connects a per-user IMAP and SMTP mailbox.',
    features: ['communication_channels.connect_user_channel'],
    priority: 100,
    enabled: true,
  },
  Widget: ConnectImapWidget,
}

export default widget
