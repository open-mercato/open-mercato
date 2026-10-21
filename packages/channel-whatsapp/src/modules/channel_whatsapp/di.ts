import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getWhatsAppChannelAdapter } from './lib/adapter'
import { channelWhatsAppHealthCheck } from './lib/health'

export function register(container: AppContainer): void {
  if (!hasChannelAdapter('whatsapp')) {
    registerChannelAdapter(getWhatsAppChannelAdapter())
  }
  container.register({
    channelWhatsAppAdapter: asValue(getWhatsAppChannelAdapter()),
    channelWhatsAppHealthCheck: asValue(channelWhatsAppHealthCheck),
  })
}
