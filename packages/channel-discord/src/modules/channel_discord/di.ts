import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getDiscordChannelAdapter } from './lib/adapter'
import { channelDiscordHealthCheck } from './lib/health'

/**
 * Re-register the adapter on container creation as a safety net for runtime
 * environments that bypass module setup (worker-only nodes, ad-hoc CLI). The
 * underlying registry is process-wide so the registration is idempotent.
 */
export function register(container: AppContainer): void {
  if (!hasChannelAdapter('discord')) {
    registerChannelAdapter(getDiscordChannelAdapter())
  }
  container.register({
    channelDiscordAdapter: asValue(getDiscordChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`). Without this, the hub's `container.resolve(...)`
    // throws and the channel reports permanently 'unhealthy'.
    channelDiscordHealthCheck: asValue(channelDiscordHealthCheck),
  })
}
