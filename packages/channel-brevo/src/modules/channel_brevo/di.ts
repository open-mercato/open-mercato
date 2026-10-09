import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getBrevoChannelAdapter } from './lib/adapter'
import { registerBrevoSystemEmailConfigResolver } from './lib/system-email-config'
import { channelBrevoHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  registerBrevoSystemEmailConfigResolver()
  if (!hasChannelAdapter('brevo')) {
    registerChannelAdapter(getBrevoChannelAdapter())
  }
  container.register({
    channelBrevoAdapter: asValue(getBrevoChannelAdapter()),
    channelBrevoHealthCheck: asValue(channelBrevoHealthCheck),
  })
}
