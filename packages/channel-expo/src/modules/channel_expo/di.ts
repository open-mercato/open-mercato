import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getExpoChannelAdapter } from './lib/adapter'
import { ensureExpoFakeProviderInstalled } from './lib/fake-provider'
import { channelExpoHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  // Test-only: swap expo-server-sdk for a network-free fake when `OM_PUSH_FAKE_PROVIDERS` is set
  // (no-op in production), so integration specs exercise this adapter end-to-end. Swaps the SDK
  // client only — the adapter below stays registered. See lib/fake-provider.ts.
  ensureExpoFakeProviderInstalled()

  if (!hasChannelAdapter('expo')) {
    registerChannelAdapter(getExpoChannelAdapter())
  }
  container.register({
    channelExpoAdapter: asValue(getExpoChannelAdapter()),
    // Registered under the exact service name declared in `integration.ts`
    // (`healthCheck.service`); without it the hub's resolve throws.
    channelExpoHealthCheck: asValue(channelExpoHealthCheck),
  })
}
