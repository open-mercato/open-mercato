import { validateAdapterCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getExpoChannelAdapter } from './lib/adapter'
import { ensureExpoFakeProviderInstalled } from './lib/fake-provider'
import { channelExpoHealthCheck } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  // Test-only: swap expo-server-sdk for a network-free fake when `OM_PUSH_FAKE_PROVIDERS` is set
  // (no-op in production), so integration specs exercise this adapter end-to-end. Swaps the SDK
  // client only — the adapter below stays registered. See lib/fake-provider.ts.
  activate(() => {
    ensureExpoFakeProviderInstalled()
  })

  activate(() => {
    if (!hasChannelAdapter('expo')) {
      registerChannelAdapter(getExpoChannelAdapter())
    }
  }, () => {
    if (!hasChannelAdapter('expo')) validateAdapterCapabilities(getExpoChannelAdapter())
  })
  container.register({
    channelExpoAdapter: asValue(getExpoChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`); without it the hub's resolve throws.
    channelExpoHealthCheck: asValue(channelExpoHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
