import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getGmailChannelAdapter } from './lib/adapter'

export function register(container: AppContainer): void {
  if (!hasChannelAdapter('gmail')) {
    registerChannelAdapter(getGmailChannelAdapter())
  }
  container.register({
    channelGmailAdapter: asValue(getGmailChannelAdapter()),
  })
}
