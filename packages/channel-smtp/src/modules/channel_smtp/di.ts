import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getSmtpChannelAdapter } from './lib/adapter'
import { registerSmtpSystemEmailConfigResolver } from './lib/system-email-config'
import { channelSmtpHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  registerSmtpSystemEmailConfigResolver()
  if (!hasChannelAdapter('smtp')) {
    registerChannelAdapter(getSmtpChannelAdapter())
  }
  container.register({
    channelSmtpAdapter: asValue(getSmtpChannelAdapter()),
    channelSmtpHealthCheck: asValue(channelSmtpHealthCheck),
  })
}
