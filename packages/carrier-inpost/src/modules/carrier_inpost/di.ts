import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { inpostHealthCheck } from './lib/health'
import { inpostAdapterV1 } from './lib/adapters/v1'

function registerWithActivation(container: AppContainer, activate: (callback: () => void) => void) {
  activate(() => {
    registerShippingAdapter(inpostAdapterV1)
  })

  container.register({
    inpostHealthCheck: asValue(inpostHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate) => registerProcessActivation(container, activate))
}, { legacy: register })
