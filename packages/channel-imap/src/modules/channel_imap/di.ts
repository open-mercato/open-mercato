import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getImapChannelAdapter } from './lib/adapter'

/**
 * Re-register the adapter on container creation as a safety net for runtime
 * environments that bypass module setup (worker-only nodes, ad-hoc CLI). The
 * underlying registry is process-wide so the registration is idempotent.
 */
export function register(container: AppContainer): void {
  if (!hasChannelAdapter('imap')) {
    registerChannelAdapter(getImapChannelAdapter())
  }
  container.register({
    channelImapAdapter: asValue(getImapChannelAdapter()),
  })
}
