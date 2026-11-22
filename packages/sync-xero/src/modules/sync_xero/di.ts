import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { xeroContactsAdapter } from './lib/contacts/adapter'
import { xeroHealthCheck } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void) => void) {
  activate(() => {
    registerDataSyncAdapter(xeroContactsAdapter)
  })

  container.register({
    xeroHealthCheck: asValue(xeroHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate) => registerProcessActivation(container, activate))
}, { legacy: register })
