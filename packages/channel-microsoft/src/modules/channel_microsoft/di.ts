import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getMicrosoftChannelAdapter } from './lib/adapter'

export function register(container: AppContainer): void {
  if (!hasChannelAdapter('microsoft')) {
    registerChannelAdapter(getMicrosoftChannelAdapter())
  }
  container.register({
    channelMicrosoftAdapter: asValue(getMicrosoftChannelAdapter()),
  })
}
