import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getGmailChannelAdapter } from './lib/adapter'
import { channelGmailHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  if (!hasChannelAdapter('gmail')) {
    registerChannelAdapter(getGmailChannelAdapter())
  }
  container.register({
    channelGmailAdapter: asValue(getGmailChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`). Without this, the hub's `container.resolve(...)`
    // throws and the channel reports permanently 'unhealthy'.
    channelGmailHealthCheck: asValue(channelGmailHealthCheck),
  })
}
