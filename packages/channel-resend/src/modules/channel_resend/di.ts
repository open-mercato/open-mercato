import { validateAdapterCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getResendChannelAdapter } from './lib/adapter'
import { registerResendSystemEmailConfigResolver } from './lib/system-email-config'
import { channelResendHealthCheck } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  activate(() => {
    registerResendSystemEmailConfigResolver()
  })
  activate(() => {
    if (!hasChannelAdapter('resend')) {
      registerChannelAdapter(getResendChannelAdapter())
    }
  }, () => {
    if (!hasChannelAdapter('resend')) validateAdapterCapabilities(getResendChannelAdapter())
  })
  container.register({
    channelResendAdapter: asValue(getResendChannelAdapter()),
    channelResendHealthCheck: asValue(channelResendHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
