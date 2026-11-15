import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getResendChannelAdapter } from './lib/adapter'
import { registerResendSystemEmailConfigResolver } from './lib/system-email-config'
import { channelResendHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  registerResendSystemEmailConfigResolver()
  if (!hasChannelAdapter('resend')) {
    registerChannelAdapter(getResendChannelAdapter())
  }
  container.register({
    channelResendAdapter: asValue(getResendChannelAdapter()),
    channelResendHealthCheck: asValue(channelResendHealthCheck),
  })
}
