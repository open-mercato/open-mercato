import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getMs365ChannelAdapter } from './lib/adapter'
import { channelMs365HealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  if (!hasChannelAdapter('ms365')) {
    registerChannelAdapter(getMs365ChannelAdapter())
  }
  container.register({
    channelMs365Adapter: asValue(getMs365ChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`). Without this, the hub's `container.resolve(...)`
    // throws and the integration reports permanently 'unhealthy'.
    channelMs365HealthCheck: asValue(channelMs365HealthCheck),
  })
}
