import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  registerGatewayAdapter,
  registerPaymentGatewayDescriptor,
  registerWebhookHandler,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { registerShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { mockGatewayAdapter } from './lib/mock-gateway-adapter'
import { mockShippingAdapter } from './lib/mock-shipping-adapter'

// Example DI registrar; modules can register their own services/components
export function register(container: AppContainer) {
  // Register mock gateway adapter for payment testing (no real credentials needed)
  registerGatewayAdapter(mockGatewayAdapter)
  registerWebhookHandler('mock', mockGatewayAdapter.verifyWebhook)
  registerPaymentGatewayDescriptor({
    providerKey: 'mock',
    label: 'Mock Gateway',
    sessionConfig: {
      fields: [
        {
          key: 'captureMethod',
          label: 'Capture method',
          type: 'select',
          options: [
            { value: 'automatic', label: 'Automatic capture' },
            { value: 'manual', label: 'Manual capture' },
          ],
        },
      ],
      supportedCurrencies: '*',
      supportedPaymentTypes: [{ value: 'mock', label: 'Mock payment' }],
      presentation: 'either',
    },
  })

  // Register mock shipping adapter for carrier testing (no real credentials needed)
  registerShippingAdapter(mockShippingAdapter)
}
