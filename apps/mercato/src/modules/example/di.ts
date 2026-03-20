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
  registerGatewayAdapter({
    ...mockGatewayAdapter,
    providerKey: 'mock_usd',
  })
  registerGatewayAdapter({
    ...mockGatewayAdapter,
    providerKey: 'mock_processing',
    async createSession(input) {
      const result = await mockGatewayAdapter.createSession({
        ...input,
        captureMethod: 'manual',
      })
      return {
        ...result,
        status: 'pending',
      }
    },
  })
  registerWebhookHandler('mock', mockGatewayAdapter.verifyWebhook)
  registerWebhookHandler('mock_usd', mockGatewayAdapter.verifyWebhook)
  registerWebhookHandler('mock_processing', mockGatewayAdapter.verifyWebhook)
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
  registerPaymentGatewayDescriptor({
    providerKey: 'mock_usd',
    label: 'Mock Gateway (USD only)',
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
      supportedCurrencies: ['USD'],
      supportedPaymentTypes: [{ value: 'mock', label: 'Mock payment' }],
      presentation: 'either',
    },
  })
  registerPaymentGatewayDescriptor({
    providerKey: 'mock_processing',
    label: 'Mock Gateway (pending state)',
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
