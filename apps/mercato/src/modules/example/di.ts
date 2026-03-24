import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  registerGatewayAdapter,
  registerPaymentGatewayDescriptor,
  registerWebhookHandler,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { registerShippingAdapter } from '@open-mercato/core/modules/shipping_carriers/lib/adapter-registry'
import { registerWebhookEndpointAdapter } from '@open-mercato/webhooks/modules/webhooks/lib/adapter-registry'
import { mockGatewayAdapter } from './lib/mock-gateway-adapter'
import { mockWebhookEndpointAdapter } from './lib/mock-webhook-endpoint-adapter'
import { mockShippingAdapter } from './lib/mock-shipping-adapter'

function readMockWebhookSessionId(payload: Record<string, unknown> | null): string | null {
  const data = payload?.data
  if (!data || typeof data !== 'object') return null
  const sessionId = (data as Record<string, unknown>).id
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : null
}

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
  registerWebhookHandler('mock', mockGatewayAdapter.verifyWebhook, {
    readSessionIdHint: readMockWebhookSessionId,
  })
  registerWebhookHandler('mock_usd', mockGatewayAdapter.verifyWebhook, {
    readSessionIdHint: readMockWebhookSessionId,
  })
  registerWebhookHandler('mock_processing', mockGatewayAdapter.verifyWebhook, {
    readSessionIdHint: readMockWebhookSessionId,
  })
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

  // Register mock inbound webhook adapter for webhooks module integration tests
  registerWebhookEndpointAdapter(mockWebhookEndpointAdapter)
}
