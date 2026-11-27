import { validateAdapterCapabilities } from '@open-mercato/core/modules/communication_channels/lib/adapter-compat'
import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  hasChannelAdapter,
  registerChannelAdapter,
} from '@open-mercato/core/modules/communication_channels/lib/adapter-registry-singleton'
import { getSesChannelAdapter } from './lib/adapter'
import { registerSesSystemEmailConfigResolver } from './lib/system-email-config'
import { channelSesHealthCheck } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void, validate?: () => void) => void) {
  activate(() => {
    registerSesSystemEmailConfigResolver()
  })
  activate(() => {
    if (!hasChannelAdapter('ses')) {
      registerChannelAdapter(getSesChannelAdapter())
    }
  }, () => {
    if (!hasChannelAdapter('ses')) validateAdapterCapabilities(getSesChannelAdapter())
  })
  container.register({
    channelSesAdapter: asValue(getSesChannelAdapter()),
    channelSesHealthCheck: asValue(channelSesHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate, validate) => registerProcessActivation(container, activate, validate))
}, { legacy: register })
