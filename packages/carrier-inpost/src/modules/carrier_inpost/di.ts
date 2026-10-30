import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { inpostHealthCheck } from './lib/health'
import { inpostAdapterV1 } from './lib/adapters/v1'

export function register(container: AppContainer) {
  registerShippingAdapter(inpostAdapterV1)

  container.register({
    inpostHealthCheck: asValue(inpostHealthCheck),
  })
}
