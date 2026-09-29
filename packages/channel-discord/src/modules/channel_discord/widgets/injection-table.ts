import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import { channelDiscordDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  'profile:communication-channels:connect': [
    {
      widgetId: 'channel_discord.injection.connect',
      priority: 120,
    },
  ],
  // The Discord integration's own detail page — the only spot in the product
  // that is Discord-scoped by construction, which is what a per-channel AI
  // setting needs (see the widget's file header).
  [channelDiscordDetailWidgetSpotId]: [
    {
      widgetId: 'channel_discord.injection.ai-auto-reply',
      priority: 40,
      kind: 'group',
      groupLabel: 'channel_discord.aiAutoReply.widget.title',
    },
  ],
}

export default injectionTable
