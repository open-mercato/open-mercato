import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  registerGatewayAdapter,
  registerPaymentGatewayDescriptor,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { autopayHealthCheck } from './lib/health'
import { autopayAdapterV1 } from './lib/adapters/v1'

export function register(container: AppContainer) {
  registerGatewayAdapter(autopayAdapterV1, { version: 'v1' })

  registerPaymentGatewayDescriptor({
    providerKey: 'autopay',
    label: 'Autopay',
    sessionConfig: {
      supportedCurrencies: ['PLN'],
      defaultRendererKey: 'autopay.hosted_redirect',
      renderers: [
        {
          key: 'autopay.hosted_redirect',
          label: 'Autopay Hosted Redirect',
          type: 'redirect',
          description: 'Redirects the payer to Autopay\'s hosted payment page (bank transfer, BLIK, cards).',
          supportedPaymentTypes: '*',
        },
      ],
    },
  })

  container.register({
    autopayHealthCheck: asValue(autopayHealthCheck),
  })
}
