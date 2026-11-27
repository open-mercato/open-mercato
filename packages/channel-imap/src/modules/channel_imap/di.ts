import { validateAdapterCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getImapChannelAdapter } from './lib/adapter'
import { channelImapHealthCheck } from './lib/health'

/**
 * Re-register the adapter on container creation as a safety net for runtime
 * environments that bypass module setup (worker-only nodes, ad-hoc CLI). The
 * underlying registry is process-wide so the registration is idempotent.
 */
function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  activate(() => {
    if (!hasChannelAdapter('imap')) {
      registerChannelAdapter(getImapChannelAdapter())
    }
  }, () => {
    if (!hasChannelAdapter('imap')) validateAdapterCapabilities(getImapChannelAdapter())
  })
  container.register({
    channelImapAdapter: asValue(getImapChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`). Without this, the hub's `container.resolve(...)`
    // throws and the channel reports permanently 'unhealthy'.
    channelImapHealthCheck: asValue(channelImapHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
