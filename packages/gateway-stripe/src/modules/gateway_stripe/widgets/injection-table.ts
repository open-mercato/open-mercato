import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import {
  buildPaymentGatewayPaymentLinkWidgetSpotId,
  buildPaymentGatewayTransactionCreateFieldSpotId,
} from '@open-mercato/shared/modules/payment_gateways/types'
import { gatewayStripeDetailWidgetSpotId } from '../integration'

export const injectionTable: ModuleInjectionTable = {
  [gatewayStripeDetailWidgetSpotId]: [
    {
      widgetId: 'gateway_stripe.injection.config',
      kind: 'tab',
      groupLabel: 'gateway_stripe.tabs.settings',
      priority: 100,
    },
  ],
  [buildPaymentGatewayTransactionCreateFieldSpotId('stripe')]: {
    widgetId: 'gateway_stripe.injection.transaction-fields',
    priority: 100,
  },
  [buildPaymentGatewayPaymentLinkWidgetSpotId('stripe')]: {
    widgetId: 'gateway_stripe.injection.payment-link',
    priority: 100,
  },
}

export default injectionTable
