import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import {
  registerGatewayAdapter,
  registerPaymentGatewayDescriptor,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { autopayHealthCheck } from './lib/health'
import { autopayAdapterV1 } from './lib/adapters/v1'

function registerWithActivation(container: AppContainer, activate: (callback: () => void) => void) {
  activate(() => {
    registerGatewayAdapter(autopayAdapterV1, { version: 'v1' })
  })

  activate(() => {
    registerPaymentGatewayDescriptor({
      providerKey: 'autopay',
      label: 'Autopay',
      requiresPayerFields: ['email'],
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
  })

  container.register({
    autopayHealthCheck: asValue(autopayHealthCheck),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate) => registerProcessActivation(container, activate))
}, { legacy: register })
