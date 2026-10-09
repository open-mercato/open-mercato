import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getMailjetChannelAdapter } from './lib/adapter'
import { registerMailjetSystemEmailConfigResolver } from './lib/system-email-config'
import { channelMailjetHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  registerMailjetSystemEmailConfigResolver()
  if (!hasChannelAdapter('mailjet')) {
    registerChannelAdapter(getMailjetChannelAdapter())
  }
  container.register({
    channelMailjetAdapter: asValue(getMailjetChannelAdapter()),
    channelMailjetHealthCheck: asValue(channelMailjetHealthCheck),
  })
}
