import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { CHANNEL_DISCORD_VIEW_FEATURE } from '../../../lib/ai-features'
import DiscordAiAutoReplyWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'channel_discord.injection.ai-auto-reply',
    title: 'AI auto-reply',
    description: 'Per-channel AI auto-reply configuration for connected Discord bots.',
    // Viewing the panel needs only read access; the settings page and its PUT
    // route enforce `channel_discord.configure` before anything is written.
    features: [CHANNEL_DISCORD_VIEW_FEATURE],
    priority: 40,
    enabled: true,
  },
  Widget: DiscordAiAutoReplyWidget,
}

export default widget
