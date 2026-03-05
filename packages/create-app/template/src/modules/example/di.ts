import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerGatewayAdapter, registerWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { mockGatewayAdapter } from './lib/mock-gateway-adapter'

// Example DI registrar; modules can register their own services/components
export function register(container: AppContainer) {
  // Register mock gateway adapter for payment testing (no real credentials needed)
  registerGatewayAdapter(mockGatewayAdapter)
  registerWebhookHandler('mock', mockGatewayAdapter.verifyWebhook)
}
