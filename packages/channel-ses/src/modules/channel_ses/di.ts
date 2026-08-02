import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getSesChannelAdapter } from './lib/adapter'
import { registerSesSystemEmailConfigResolver } from './lib/system-email-config'
import { channelSesHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  registerSesSystemEmailConfigResolver()
  if (!hasChannelAdapter('ses')) {
    registerChannelAdapter(getSesChannelAdapter())
  }
  container.register({
    channelSesAdapter: asValue(getSesChannelAdapter()),
    channelSesHealthCheck: asValue(channelSesHealthCheck),
  })
}
