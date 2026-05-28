import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getMicrosoftChannelAdapter } from './lib/adapter'
import { channelMicrosoftHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  if (!hasChannelAdapter('microsoft')) {
    registerChannelAdapter(getMicrosoftChannelAdapter())
  }
  container.register({
    channelMicrosoftAdapter: asValue(getMicrosoftChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`). Without this, the hub's `container.resolve(...)`
    // throws and the channel reports permanently 'unhealthy'.
    channelMicrosoftHealthCheck: asValue(channelMicrosoftHealthCheck),
  })
}
