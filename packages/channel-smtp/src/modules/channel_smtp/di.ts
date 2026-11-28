import { validateAdapterCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getSmtpChannelAdapter } from './lib/adapter'
import { registerSmtpSystemEmailConfigResolver } from './lib/system-email-config'
import { channelSmtpHealthCheck } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  activate(() => {
    registerSmtpSystemEmailConfigResolver()
  })
  activate(() => {
    if (!hasChannelAdapter('smtp')) {
      registerChannelAdapter(getSmtpChannelAdapter())
    }
  }, () => {
    if (!hasChannelAdapter('smtp')) validateAdapterCapabilities(getSmtpChannelAdapter())
  })
  container.register({
    channelSmtpAdapter: asValue(getSmtpChannelAdapter()),
    channelSmtpHealthCheck: asValue(channelSmtpHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
