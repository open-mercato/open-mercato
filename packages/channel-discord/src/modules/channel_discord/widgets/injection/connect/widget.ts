import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ConnectDiscordWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_discord.injection.connect',
    title: 'Connect Discord',
    description: 'Connects a Discord bot as a two-way communication channel.',
    features: ['communication_channels.connect_user_channel'],
    priority: 100,
    enabled: true,
  },
  Widget: ConnectDiscordWidget,
}

export default widget
