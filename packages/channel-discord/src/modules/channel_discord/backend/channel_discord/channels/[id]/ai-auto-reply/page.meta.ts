import type { PageMetadata } from '@open-mercato/shared/modules/registry'
import { CHANNEL_DISCORD_CONFIGURE_FEATURE } from '../../../../../lib/ai-features'

/**
 * Settings surface for one Discord channel's AI auto-reply. Guarded by the same
 * feature that gates connecting the bot — arming an agent to answer strangers on
 * the tenant's behalf is a configuration act, not a viewing one — and kept out of
 * the sidebar, because it is reached from the channel it configures.
 */
export const metadata: PageMetadata = {
  requireAuth: true,
  requireFeatures: [CHANNEL_DISCORD_CONFIGURE_FEATURE],
  titleKey: 'channel_discord.aiAutoReply.page.title',
  title: 'Discord AI auto-reply',
  navHidden: true,
}

export default metadata
