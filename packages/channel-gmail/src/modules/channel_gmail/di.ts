import { validateAdapterCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getGmailChannelAdapter } from './lib/adapter'
import { channelGmailHealthCheck } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  activate(() => {
    if (!hasChannelAdapter('gmail')) {
      registerChannelAdapter(getGmailChannelAdapter())
    }
  }, () => {
    if (!hasChannelAdapter('gmail')) validateAdapterCapabilities(getGmailChannelAdapter())
  })
  container.register({
    channelGmailAdapter: asValue(getGmailChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`). Without this, the hub's `container.resolve(...)`
    // throws and the channel reports permanently 'unhealthy'.
    channelGmailHealthCheck: asValue(channelGmailHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
