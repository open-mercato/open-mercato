import { validateAdapterCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getFcmChannelAdapter } from './lib/adapter'
import { ensureFcmFakeProviderInstalled } from './lib/fake-provider'
import { channelFcmHealthCheck } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  // Test-only: swap firebase-admin for a network-free fake when `OM_PUSH_FAKE_PROVIDERS` is set
  // (no-op in production), so integration specs exercise this adapter end-to-end. Swaps the SDK
  // client only — the adapter below stays registered. See lib/fake-provider.ts.
  activate(() => {
    ensureFcmFakeProviderInstalled()
  })

  activate(() => {
    if (!hasChannelAdapter('fcm')) {
      registerChannelAdapter(getFcmChannelAdapter())
    }
  }, () => {
    if (!hasChannelAdapter('fcm')) validateAdapterCapabilities(getFcmChannelAdapter())
  })
  container.register({
    channelFcmAdapter: asValue(getFcmChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`); without it the hub's resolve throws and the
    // channel reports permanently 'unhealthy'.
    channelFcmHealthCheck: asValue(channelFcmHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
