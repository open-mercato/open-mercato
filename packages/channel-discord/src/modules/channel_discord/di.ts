import { validateAdapterCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
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
function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  activate(() => {
    if (!hasChannelAdapter('discord')) {
      registerChannelAdapter(getDiscordChannelAdapter())
    }
  }, () => {
    if (!hasChannelAdapter('discord')) validateAdapterCapabilities(getDiscordChannelAdapter())
  })
  container.register({
    channelDiscordAdapter: asValue(getDiscordChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`). Without this, the hub's `container.resolve(...)`
    // throws and the channel reports permanently 'unhealthy'.
    channelDiscordHealthCheck: asValue(channelDiscordHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
