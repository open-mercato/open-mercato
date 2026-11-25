import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerDataSyncAdapter } from '../data_sync/lib/adapter-registry'
import { syncExcelCustomersAdapter } from './lib/adapters/customers'

function registerWithActivation(_container: AppContainer, activate: (callback: () => void) => void) {
  activate(() => {
    registerDataSyncAdapter(syncExcelCustomersAdapter)
  })
}

export default register

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate) => registerProcessActivation(container, activate))
}, { legacy: register })
