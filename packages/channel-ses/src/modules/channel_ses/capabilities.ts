import { baseEmailCapabilities } from '@open-mercato/core/modules/communication_channels/lib/email-capabilities'
import type { ChannelCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter'

export const sesCapabilities: ChannelCapabilities = {
  ...baseEmailCapabilities,
  fileSharing: true,
  conversationHistory: false,
}
